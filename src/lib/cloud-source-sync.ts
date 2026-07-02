import { CloudFetchQueueStatus, CloudFetchRunStatus } from "@prisma/client";
import {
  nextCloudTaskFailureSchedule,
  nextCloudTaskSuccessSchedule,
  type CloudFetchFrequencyKey,
} from "@/lib/cloud-source-scheduler";

export type CloudFetchTaskSyncStatus = "succeeded" | "partial" | "failed";

export type CloudFetchTaskSyncResult = {
  runId: string;
  cloudSourceTaskId: string;
  status: CloudFetchTaskSyncStatus;
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  actualDurationSeconds?: number | null;
  failureReason?: string | null;
  usageTokens?: number | null;
  usageCostUsd?: number | null;
  details?: Record<string, unknown>;
};

export type CloudFetchSyncConfig = {
  schedulingLeadMinutes: number;
  retryBaseMinutes: number;
  failureCircuitBreakerThreshold: number;
};

type CloudSyncTaskRow = {
  builderId: string;
  summaryLanguage: string;
  effectiveFrequency: CloudFetchFrequencyKey;
  consecutiveFailures: number;
  durationP50Seconds?: number | null;
  durationP75Seconds?: number | null;
  durationP90Seconds?: number | null;
  durationSampleCount: number;
  estimatedTokenCost?: number | null;
  tokenSampleCount: number;
  estimatedPostYield?: number | null;
  postYieldSampleCount: number;
  successSampleCount: number;
  estimatedSuccessProbability?: number | null;
};

type CloudSyncRunTaskRow = {
  status: string;
  usageTokens?: number | null;
  usageCostUsd?: number | string | { toString(): string } | null;
};

type CloudSyncPrisma = {
  cloudFetchConfig?: {
    findUnique(args: unknown): Promise<Partial<CloudFetchSyncConfig> | null>;
  };
  cloudSourceTask: {
    findUnique(args: unknown): Promise<CloudSyncTaskRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  cloudFetchRunTask: {
    update(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<CloudSyncRunTaskRow[]>;
  };
  cloudFetchQueueItem: {
    updateMany(args: unknown): Promise<unknown>;
  };
  cloudFetchRun: {
    update(args: unknown): Promise<unknown>;
  };
};

export async function loadCloudFetchSyncConfig(prisma: {
  cloudFetchConfig: { findUnique(args: unknown): Promise<Partial<CloudFetchSyncConfig> | null> };
}): Promise<CloudFetchSyncConfig> {
  const stored = await prisma.cloudFetchConfig.findUnique({ where: { id: "global" } });
  return {
    schedulingLeadMinutes: stored?.schedulingLeadMinutes ?? 120,
    retryBaseMinutes: stored?.retryBaseMinutes ?? 30,
    failureCircuitBreakerThreshold: stored?.failureCircuitBreakerThreshold ?? 5,
  };
}

export async function applyCloudFetchTaskSyncResult(params: {
  prisma: CloudSyncPrisma;
  now?: Date;
  config: CloudFetchSyncConfig;
  result: CloudFetchTaskSyncResult;
}) {
  const now = params.now ?? new Date();
  const task = await params.prisma.cloudSourceTask.findUnique({
    where: { id: params.result.cloudSourceTaskId },
    select: {
      effectiveFrequency: true,
      builderId: true,
      summaryLanguage: true,
      consecutiveFailures: true,
      durationP50Seconds: true,
      durationP75Seconds: true,
      durationP90Seconds: true,
      durationSampleCount: true,
      estimatedTokenCost: true,
      tokenSampleCount: true,
      estimatedPostYield: true,
      postYieldSampleCount: true,
      successSampleCount: true,
      estimatedSuccessProbability: true,
    },
  });
  if (!task) {
    throw new Error(`Cloud source task ${params.result.cloudSourceTaskId} was not found.`);
  }

  const succeeded = params.result.status === "succeeded" || params.result.status === "partial";
  const partial = params.result.status === "partial";
  const runTaskStatus = partial
    ? CloudFetchRunStatus.PARTIAL
    : succeeded
      ? CloudFetchRunStatus.SUCCEEDED
      : CloudFetchRunStatus.FAILED;
  const queueStatus = succeeded ? CloudFetchQueueStatus.SUCCEEDED : CloudFetchQueueStatus.FAILED;
  const taskFailureReason = params.result.failureReason?.trim() || "cloud_sync_failed";
  const failureReason = params.result.status === "succeeded" ? null : taskFailureReason;

  await params.prisma.cloudFetchRunTask.update({
    where: {
      runId_cloudSourceTaskId: {
        runId: params.result.runId,
        cloudSourceTaskId: params.result.cloudSourceTaskId,
      },
    },
    data: {
      status: runTaskStatus,
      finishedAt: now,
      plannedPosts: params.result.plannedPosts,
      syncedPosts: params.result.syncedPosts,
      failedPosts: params.result.failedPosts,
      actualDurationSeconds: params.result.actualDurationSeconds ?? null,
      failureReason,
      usageTokens: params.result.usageTokens ?? null,
      usageCostUsd: params.result.usageCostUsd ?? null,
      details: params.result.details ?? {},
    },
  });

  await params.prisma.cloudFetchQueueItem.updateMany({
    where: {
      runId: params.result.runId,
      cloudSourceTaskId: params.result.cloudSourceTaskId,
      status: CloudFetchQueueStatus.LEASED,
    },
    data: {
      status: queueStatus,
      leaseExpiresAt: null,
    },
  });

  await params.prisma.cloudSourceTask.update({
    where: { id: params.result.cloudSourceTaskId },
    data: {
      ...(succeeded
        ? nextCloudTaskSuccessSchedule({
            now,
            effectiveFrequency: task.effectiveFrequency,
            schedulingLeadMinutes: params.config.schedulingLeadMinutes,
          })
        : nextCloudTaskFailureSchedule({
            now,
            previousConsecutiveFailures: task.consecutiveFailures,
            retryBaseMinutes: params.config.retryBaseMinutes,
            failureCircuitBreakerThreshold: params.config.failureCircuitBreakerThreshold,
            failureReason: taskFailureReason,
          })),
      ...nextCloudTaskRuntimeStats({
        task,
        actualDurationSeconds: params.result.actualDurationSeconds,
        usageTokens: params.result.usageTokens,
        syncedPosts: params.result.syncedPosts,
        succeeded,
      }),
    },
  });

  const run = await recomputeCloudFetchRun(params.prisma, {
    runId: params.result.runId,
    finishedAt: now,
  });
  return {
    ...run,
    builderId: task.builderId,
    summaryLanguage: task.summaryLanguage,
  };
}

function nextCloudTaskRuntimeStats(params: {
  task: CloudSyncTaskRow;
  actualDurationSeconds?: number | null;
  usageTokens?: number | null;
  syncedPosts?: number | null;
  succeeded: boolean;
}) {
  const actualDurationSeconds = positiveIntegerOrNull(params.actualDurationSeconds);
  const usageTokens = positiveIntegerOrNull(params.usageTokens);
  const syncedPosts = nonNegativeIntegerOrNull(params.syncedPosts);
  const durationSampleCount =
    params.task.durationSampleCount + (actualDurationSeconds == null ? 0 : 1);
  const tokenSampleCount = params.task.tokenSampleCount + (usageTokens == null ? 0 : 1);
  const postYieldSampleCount =
    params.task.postYieldSampleCount + (syncedPosts == null ? 0 : 1);
  const successSampleCount = params.task.successSampleCount + 1;
  const estimatedSuccessProbability = movingAverageRatio({
    previousAverage: params.task.estimatedSuccessProbability,
    previousSamples: params.task.successSampleCount,
    nextValue: params.succeeded ? 1 : 0,
  });
  const tokenStats = usageTokens == null
    ? {}
    : {
        tokenSampleCount,
        estimatedTokenCost: movingAverage({
          previousAverage: params.task.estimatedTokenCost,
          previousSamples: params.task.tokenSampleCount,
          nextValue: usageTokens,
        }),
      };
  const postYieldStats = syncedPosts == null
    ? {}
    : {
        postYieldSampleCount,
        estimatedPostYield: movingAverageFloat({
          previousAverage: params.task.estimatedPostYield,
          previousSamples: params.task.postYieldSampleCount,
          nextValue: syncedPosts,
        }),
      };
  if (actualDurationSeconds == null) {
    return { successSampleCount, estimatedSuccessProbability, ...tokenStats, ...postYieldStats };
  }

  const durationP50Seconds = movingAverage({
    previousAverage: params.task.durationP50Seconds,
    previousSamples: params.task.durationSampleCount,
    nextValue: actualDurationSeconds,
  });
  const durationP75Seconds = Math.max(
    durationP50Seconds,
    movingAverage({
      previousAverage: params.task.durationP75Seconds,
      previousSamples: params.task.durationSampleCount,
      nextValue: actualDurationSeconds,
    }),
  );
  const durationP90Seconds = Math.max(
    durationP75Seconds,
    movingAverage({
      previousAverage: params.task.durationP90Seconds,
      previousSamples: params.task.durationSampleCount,
      nextValue: actualDurationSeconds,
    }),
  );
  return {
    durationSampleCount,
    durationP50Seconds,
    durationP75Seconds,
    durationP90Seconds,
    estimatedDurationSeconds: durationP75Seconds,
    successSampleCount,
    estimatedSuccessProbability,
    ...tokenStats,
    ...postYieldStats,
  };
}

function nonNegativeIntegerOrNull(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

async function recomputeCloudFetchRun(
  prisma: CloudSyncPrisma,
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

function movingAverage(params: {
  previousAverage?: number | null;
  previousSamples: number;
  nextValue: number;
}) {
  const previousAverage = positiveIntegerOrNull(params.previousAverage) ?? params.nextValue;
  const previousSamples = Math.max(0, params.previousSamples);
  return Math.round((previousAverage * previousSamples + params.nextValue) / (previousSamples + 1));
}

function movingAverageFloat(params: {
  previousAverage?: number | null;
  previousSamples: number;
  nextValue: number;
}) {
  const previousAverage =
    typeof params.previousAverage === "number" && Number.isFinite(params.previousAverage)
      ? params.previousAverage
      : params.nextValue;
  const previousSamples = Math.max(0, params.previousSamples);
  return (previousAverage * previousSamples + params.nextValue) / (previousSamples + 1);
}

function movingAverageRatio(params: {
  previousAverage?: number | null;
  previousSamples: number;
  nextValue: 0 | 1;
}) {
  const previousAverage =
    typeof params.previousAverage === "number" && Number.isFinite(params.previousAverage)
      ? params.previousAverage
      : params.nextValue;
  const previousSamples = Math.max(0, params.previousSamples);
  const next = (previousAverage * previousSamples + params.nextValue) / (previousSamples + 1);
  return Math.min(0.99, Math.max(0.01, Number(next.toFixed(4))));
}

function positiveIntegerOrNull(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
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

function numericValue(value: CloudSyncRunTaskRow["usageCostUsd"]) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toString === "function") return Number(value.toString());
  return null;
}
