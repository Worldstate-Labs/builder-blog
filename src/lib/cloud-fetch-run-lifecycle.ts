import {
  CloudFetchQueueStatus,
  CloudFetchRunStatus,
} from "@prisma/client";
import {
  lockCloudFetchRunTaskRows,
  type LockedCloudFetchRunTaskRow,
} from "@/lib/cloud-fetch-run-task-lock";

type CloudFetchRunTaskStateRow = {
  cloudSourceTaskId?: string;
  status: string;
  usageTokens?: number | null;
  usageCostUsd?: number | string | { toString(): string } | null;
};

type CloudFetchRunAggregatePrisma = {
  cloudFetchRun: {
    update(args: unknown): Promise<unknown>;
  };
  cloudFetchRunTask: {
    findMany(args: unknown): Promise<CloudFetchRunTaskStateRow[]>;
  };
};

type CloudFetchRunLifecyclePrisma = CloudFetchRunAggregatePrisma & {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<LockedCloudFetchRunTaskRow[]>;
  cloudFetchRun: CloudFetchRunAggregatePrisma["cloudFetchRun"] & {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
  cloudFetchQueueItem: {
    findMany(args: unknown): Promise<Array<{ runId: string | null; cloudSourceTaskId: string }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  cloudFetchRunTask: CloudFetchRunAggregatePrisma["cloudFetchRunTask"] & {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

type CloudFetchRunFinalizerPrisma = CloudFetchRunAggregatePrisma & {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<LockedCloudFetchRunTaskRow[]>;
  cloudFetchRun: CloudFetchRunAggregatePrisma["cloudFetchRun"] & {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
  cloudFetchQueueItem: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  cloudFetchRunTask: CloudFetchRunAggregatePrisma["cloudFetchRunTask"] & {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

const TERMINAL_CLOUD_WORKER_JOB_STATUSES = [
  "succeeded",
  "failed",
  "timed_out",
  "killed",
  "replaced",
  "stale",
] as const;

export async function expireLeasedCloudFetchRuns(params: {
  prisma: CloudFetchRunLifecyclePrisma;
  now: Date;
}) {
  const expiredItems = await params.prisma.cloudFetchQueueItem.findMany({
    where: {
      status: CloudFetchQueueStatus.LEASED,
      leaseExpiresAt: { lt: params.now },
      runId: { not: null },
    },
    select: { runId: true, cloudSourceTaskId: true },
  });

  const expiredRunIds = new Set<string>();
  let expiredLeases = 0;
  for (const item of expiredItems) {
    if (!item.runId) continue;
    const expiredTask = await params.prisma.cloudFetchRunTask.updateMany({
      where: {
        runId: item.runId,
        cloudSourceTaskId: item.cloudSourceTaskId,
        status: CloudFetchRunStatus.RUNNING,
      },
      data: {
        status: CloudFetchRunStatus.FAILED,
        finishedAt: params.now,
        failureReason: "cloud_lease_expired",
      },
    });
    if (expiredTask.count !== 1) continue;
    const requeuedItem = await params.prisma.cloudFetchQueueItem.updateMany({
      where: {
        runId: item.runId,
        cloudSourceTaskId: item.cloudSourceTaskId,
        status: CloudFetchQueueStatus.LEASED,
        leaseExpiresAt: { lt: params.now },
      },
      data: {
        status: CloudFetchQueueStatus.QUEUED,
        leasedAt: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        runId: null,
      },
    });
    if (requeuedItem.count !== 1) continue;
    expiredLeases += 1;
    expiredRunIds.add(item.runId);
  }

  for (const runId of expiredRunIds) {
    await recomputeCloudFetchRun(params.prisma, { runId, finishedAt: params.now });
  }

  return {
    expiredLeases,
    expiredRuns: expiredRunIds.size,
  };
}

export async function finalizeRunningCloudFetchRuns(params: {
  prisma: CloudFetchRunFinalizerPrisma;
  runs: Array<{ id: string }>;
  now: Date;
  failureReason: string;
}) {
  let finalizedRuns = 0;
  let finalizedTasks = 0;
  let requeuedQueueItems = 0;

  for (const run of params.runs) {
    const runningTaskRows = await params.prisma.cloudFetchRunTask.findMany({
      where: {
        runId: run.id,
        status: CloudFetchRunStatus.RUNNING,
      },
      orderBy: [{ cloudSourceTaskId: "asc" }],
      select: { cloudSourceTaskId: true },
    });
    const taskIds = runningTaskRows
      .map((task) => task.cloudSourceTaskId)
      .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0);
    if (taskIds.length === 0) continue;

    await lockCloudFetchRunTaskRows(params.prisma, {
      runId: run.id,
      cloudSourceTaskIds: taskIds,
    });

    const lockedRunningTasks = await params.prisma.cloudFetchRunTask.findMany({
      where: {
        runId: run.id,
        status: CloudFetchRunStatus.RUNNING,
        cloudSourceTaskId: { in: taskIds },
      },
      orderBy: [{ cloudSourceTaskId: "asc" }],
      select: { cloudSourceTaskId: true },
    });

    let runFinalizedTasks = 0;
    for (const task of lockedRunningTasks) {
      const finalizedTask = await params.prisma.cloudFetchRunTask.updateMany({
        where: {
          runId: run.id,
          cloudSourceTaskId: task.cloudSourceTaskId,
          status: CloudFetchRunStatus.RUNNING,
        },
        data: {
          status: CloudFetchRunStatus.FAILED,
          finishedAt: params.now,
          failureReason: params.failureReason,
        },
      });
      if (finalizedTask.count === 0) continue;

      runFinalizedTasks += finalizedTask.count;
      finalizedTasks += finalizedTask.count;

      const requeuedItem = await params.prisma.cloudFetchQueueItem.updateMany({
        where: {
          runId: run.id,
          cloudSourceTaskId: task.cloudSourceTaskId,
          status: CloudFetchQueueStatus.LEASED,
        },
        data: {
          status: CloudFetchQueueStatus.QUEUED,
          leasedAt: null,
          leaseExpiresAt: null,
          leaseOwner: null,
          runId: null,
        },
      });
      requeuedQueueItems += requeuedItem.count;
    }
    if (runFinalizedTasks === 0) continue;
    finalizedRuns += 1;

    const runStillRunning = await params.prisma.cloudFetchRun.findMany({
      where: {
        id: run.id,
        status: CloudFetchRunStatus.RUNNING,
      },
      orderBy: [{ id: "asc" }],
      select: { id: true },
    });
    if (runStillRunning.length === 0) continue;

    await recomputeCloudFetchRun(params.prisma, { runId: run.id, finishedAt: params.now });
  }

  return {
    finalizedRuns,
    finalizedTasks,
    requeuedQueueItems,
  };
}

export async function reconcileTerminalCloudWorkerRuns(params: {
  prisma: CloudFetchRunLifecyclePrisma;
  now: Date;
}) {
  const emptyResult = {
    reconciledRuns: 0,
    finalizedTasks: 0,
    requeuedQueueItems: 0,
  };
  const cloudFetchRun = (params.prisma as Partial<CloudFetchRunLifecyclePrisma>).cloudFetchRun;
  if (!cloudFetchRun || typeof cloudFetchRun.findMany !== "function") return emptyResult;

  const runs = await cloudFetchRun.findMany({
    where: {
      status: CloudFetchRunStatus.RUNNING,
      agentJobRun: {
        is: {
          status: { in: [...TERMINAL_CLOUD_WORKER_JOB_STATUSES] },
        },
      },
    },
    orderBy: [{ id: "asc" }],
    select: { id: true },
  });
  const finalized = await finalizeRunningCloudFetchRuns({
    prisma: params.prisma,
    runs,
    now: params.now,
    failureReason: "cloud_worker_stopped",
  });

  return {
    reconciledRuns: finalized.finalizedRuns,
    finalizedTasks: finalized.finalizedTasks,
    requeuedQueueItems: finalized.requeuedQueueItems,
  };
}

export async function recomputeCloudFetchRun(
  prisma: CloudFetchRunAggregatePrisma,
  params: { runId: string; finishedAt: Date },
) {
  const tasks = await prisma.cloudFetchRunTask.findMany({
    where: { runId: params.runId },
    select: { status: true, usageTokens: true, usageCostUsd: true },
  });
  const tasksSucceeded = tasks.filter((task) => task.status === CloudFetchRunStatus.SUCCEEDED).length;
  const tasksPartial = tasks.filter((task) => task.status === CloudFetchRunStatus.PARTIAL).length;
  const tasksStrictlyFailed = tasks.filter((task) => task.status === CloudFetchRunStatus.FAILED).length;
  // The persisted counter has no partial column, so it keeps meaning
  // "sources that did not fully succeed"; run status uses the breakdown.
  const tasksFailed = tasksStrictlyFailed + tasksPartial;
  const tasksRunning = tasks.filter((task) => task.status === CloudFetchRunStatus.RUNNING).length;
  const runStatus = cloudRunStatus({
    tasksSucceeded,
    tasksPartial,
    tasksFailed: tasksStrictlyFailed,
    tasksRunning,
  });
  const usageTokens = sumNullableNumbers(tasks.map((task) => task.usageTokens));
  const usageCostUsd = sumNullableNumbers(tasks.map((task) => numericValue(task.usageCostUsd)));
  await prisma.cloudFetchRun.update({
    where: { id: params.runId },
    data: {
      status: runStatus,
      ...(tasksRunning === 0 ? { finishedAt: params.finishedAt } : {}),
      tasksSucceeded,
      tasksFailed,
      usageTokens,
      usageCostUsd,
    },
  });
  return {
    runStatus,
    tasksSucceeded,
    tasksFailed,
    tasksRunning,
    usageTokens,
    usageCostUsd,
  };
}

function cloudRunStatus(params: {
  tasksSucceeded: number;
  tasksPartial: number;
  tasksFailed: number;
  tasksRunning: number;
}) {
  if (params.tasksRunning > 0) return CloudFetchRunStatus.RUNNING;
  if (params.tasksPartial > 0) return CloudFetchRunStatus.PARTIAL;
  if (params.tasksSucceeded > 0 && params.tasksFailed > 0) return CloudFetchRunStatus.PARTIAL;
  if (params.tasksFailed > 0) return CloudFetchRunStatus.FAILED;
  return CloudFetchRunStatus.SUCCEEDED;
}

function sumNullableNumbers(values: Array<number | null | undefined>) {
  let found = false;
  let total = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    found = true;
    total += value;
  }
  if (!found) return null;
  return Number(total.toFixed(4));
}

function numericValue(value: CloudFetchRunTaskStateRow["usageCostUsd"]) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toString === "function") return Number(value.toString());
  return null;
}
