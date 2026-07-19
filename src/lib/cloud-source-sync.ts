import { CloudFetchQueueStatus, CloudFetchRunStatus } from "@prisma/client";
import { recomputeCloudFetchRun } from "@/lib/cloud-fetch-run-lifecycle";
import { mergeCloudFetchRunTaskDetails } from "@/lib/cloud-fetch-plan-details";
import { cloudShardExecutionBudget } from "@/lib/local-agent-timeouts";
import { StaleWorkerWriteError } from "@/lib/reset-fence";
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
  mustSucceedBy?: Date | null;
  estimatedDurationSeconds?: number | null;
  builder?: {
    sourceType: string;
  };
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

type CloudSyncPrisma = {
  cloudFetchConfig?: {
    findUnique(args: unknown): Promise<Partial<CloudFetchSyncConfig> | null>;
  };
  cloudSourceTask: {
    findUnique(args: unknown): Promise<CloudSyncTaskRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  cloudFetchRunTask: {
    updateMany(args: unknown): Promise<{ count: number }>;
    findMany(args: unknown): Promise<Array<{
      cloudSourceTaskId: string;
      status: string;
      usageTokens?: number | null;
      usageCostUsd?: number | string | { toString(): string } | null;
      details?: unknown;
    }>>;
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
      mustSucceedBy: true,
      estimatedDurationSeconds: true,
      builder: { select: { sourceType: true } },
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
  const existingRunTask = (
    await params.prisma.cloudFetchRunTask.findMany({
      where: {
        runId: params.result.runId,
        cloudSourceTaskId: params.result.cloudSourceTaskId,
      },
    })
  )[0];
  const mergedDetails = mergeCloudFetchRunTaskDetails(
    existingRunTask?.details,
    params.result.details,
  );

  // Guard the finalizing write on the task still being RUNNING. The caller's
  // pre-check confirmed RUNNING, but under READ COMMITTED a concurrent
  // finalizer (e.g. a lease-expiry sweep marking it FAILED) can commit between
  // that check and this write; an unguarded update would resurrect the expired
  // task back to SUCCEEDED and trigger an immediate duplicate re-fetch. If the
  // status already moved on, this run's write is stale — surface it as 409.
  const claimedRunTask = await params.prisma.cloudFetchRunTask.updateMany({
    where: {
      runId: params.result.runId,
      cloudSourceTaskId: params.result.cloudSourceTaskId,
      status: CloudFetchRunStatus.RUNNING,
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
      details: mergedDetails,
    },
  });
  if (claimedRunTask.count === 0) throw new StaleWorkerWriteError();

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
            mustSucceedBy: task.mustSucceedBy ?? null,
            executionBudgetSeconds: conservativeCloudTaskFailureExecutionBudgetSeconds({
              task,
              existingDetails: existingRunTask?.details,
            }),
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
    sourceTaskResult: {
      cloudSourceTaskId: params.result.cloudSourceTaskId,
      status: params.result.status,
      plannedPosts: params.result.plannedPosts,
      syncedPosts: params.result.syncedPosts,
      failedPosts: params.result.failedPosts,
      actualDurationSeconds: params.result.actualDurationSeconds ?? null,
      failureReason,
      usageTokens: params.result.usageTokens ?? null,
      usageCostUsd: params.result.usageCostUsd ?? null,
      details: mergedDetails,
    },
    builderId: task.builderId,
    summaryLanguage: task.summaryLanguage,
  };
}

function conservativeCloudTaskFailureExecutionBudgetSeconds(params: {
  task: Pick<CloudSyncTaskRow, "estimatedDurationSeconds" | "builder">;
  existingDetails: unknown;
}) {
  const executionPlan = record(record(params.existingDetails)?.executionPlan);
  const planBudgets = [
    positiveIntegerOrNull(executionPlan?.provisionalExecutionBudgetSeconds),
    positiveIntegerOrNull(executionPlan?.executionBudgetSeconds),
    ...Object.values(record(executionPlan?.posts) ?? {}).map((post) =>
      positiveIntegerOrNull(record(post)?.executionBudgetSeconds),
    ),
  ].filter((value): value is number => value != null);

  const fallbackBudgetSeconds = cloudShardExecutionBudget({
    estimatedWorkSeconds: params.task.estimatedDurationSeconds,
    sourceType: params.task.builder?.sourceType,
  }).executionBudgetSeconds;

  return Math.max(fallbackBudgetSeconds, ...planBudgets);
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
  if (!params.succeeded || actualDurationSeconds == null) {
    return { successSampleCount, estimatedSuccessProbability, ...tokenStats, ...postYieldStats };
  }

  const durationSampleCount = params.task.durationSampleCount + 1;
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
