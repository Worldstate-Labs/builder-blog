import {
  CloudFetchQueueStatus,
  CloudFetchRunStatus,
} from "@prisma/client";

type CloudFetchRunTaskStateRow = {
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
  cloudFetchQueueItem: {
    findMany(args: unknown): Promise<Array<{ runId: string | null; cloudSourceTaskId: string }>>;
    updateMany(args: unknown): Promise<unknown>;
  };
  cloudFetchRunTask: CloudFetchRunAggregatePrisma["cloudFetchRunTask"] & {
    updateMany(args: unknown): Promise<unknown>;
  };
};

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

  await params.prisma.cloudFetchQueueItem.updateMany({
    where: { status: CloudFetchQueueStatus.LEASED, leaseExpiresAt: { lt: params.now } },
    data: {
      status: CloudFetchQueueStatus.QUEUED,
      leasedAt: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      runId: null,
    },
  });

  const expiredRunIds = new Set<string>();
  for (const item of expiredItems) {
    if (!item.runId) continue;
    expiredRunIds.add(item.runId);
    await params.prisma.cloudFetchRunTask.updateMany({
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
  }

  for (const runId of expiredRunIds) {
    await recomputeCloudFetchRun(params.prisma, { runId, finishedAt: params.now });
  }

  return {
    expiredLeases: expiredItems.length,
    expiredRuns: expiredRunIds.size,
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
  const tasksFailed = tasks.filter((task) =>
    task.status === CloudFetchRunStatus.FAILED || task.status === CloudFetchRunStatus.PARTIAL
  ).length;
  const tasksRunning = tasks.filter((task) => task.status === CloudFetchRunStatus.RUNNING).length;
  const runStatus = cloudRunStatus({ tasksSucceeded, tasksFailed, tasksRunning });
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
  tasksFailed: number;
  tasksRunning: number;
}) {
  if (params.tasksRunning > 0) return CloudFetchRunStatus.RUNNING;
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
