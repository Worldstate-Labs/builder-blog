import {
  CLOUD_FETCH_CONFIG_ID,
  serializeCloudFetchConfig,
} from "@/lib/cloud-source-config";
import {
  DEFAULT_CLOUD_FETCH_MATERIALIZE_LIMIT,
  calculateCloudFetchLeaseBudget,
  createCanonicalActivityPolicy,
  estimateCloudFetchTaskTokens,
  estimateCloudTaskRuntime,
  planCloudFetchWindow,
  type CloudSchedulerTaskInput,
} from "@/lib/cloud-source-scheduler";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const PENDING_REASON_PRIORITY: CloudPendingSourceReason[] = [
  "queued",
  "ready_for_lease",
  "circuit_breaker",
  "retry_backoff",
  "canonical_active",
  "canonical_cooldown",
  "token_budget",
  "scheduler_capacity",
];

export type CloudPendingSourceReason =
  | "queued"
  | "ready_for_lease"
  | "circuit_breaker"
  | "retry_backoff"
  | "canonical_active"
  | "canonical_cooldown"
  | "token_budget"
  | "scheduler_capacity";

export type CloudPendingSource = {
  taskId: string;
  builderId: string;
  summaryLanguage: string;
  sourceType: string;
  name: string;
  canonicalKey: string;
  reason: CloudPendingSourceReason;
  estimatedTokens: number;
  consecutiveDeferrals: number;
  consecutiveFailures: number;
  lastDeferredAt: string | null;
  nextAttemptAt: string | null;
  circuitBreakerUntil: string | null;
};

export type CloudPendingSourceSnapshot = {
  budget: {
    tokenBudgetPerHour: number;
    recentUsageTokens: number;
    activeEstimatedTokens: number;
    remainingTokens: number;
  };
  sources: CloudPendingSource[];
};

type PendingCloudTaskInput = {
  id: string;
  builderId: string;
  summaryLanguage: string;
  effectiveFrequency: "DAILY" | "WEEKLY";
  consecutiveDeferrals: number;
  consecutiveFailures: number;
  estimatedDurationSeconds: number | null;
  estimatedTokenCost: number | null;
  estimatedSuccessProbability: number | null;
  estimatedPostYield: number | null;
  durationP75Seconds: number | null;
  durationP90Seconds: number | null;
  durationSampleCount: number;
  successSampleCount: number;
  circuitBreakerUntil: Date | null;
  nextAttemptAt: Date | null;
  mustSucceedBy: Date | null;
  lastSuccessAt: Date | null;
  lastDeferredAt: Date | null;
  builder: {
    id: string;
    name: string;
    canonicalKey: string;
    sourceType: string;
  };
};

type PendingCloudQueueItemInput = {
  cloudSourceTaskId: string;
  status: "QUEUED" | "LEASED";
  dueAt: Date;
  leaseExpiresAt: Date | null;
  cloudSourceTask?: {
    estimatedTokenCost: number | null;
    builder: {
      canonicalKey: string;
      sourceType: string;
    };
  };
};

type PendingCloudRecentRunTaskInput = {
  cloudSourceTaskId: string;
  canonicalKey: string;
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  startedAt: Date | null;
  usageTokens: number | null;
};

type PendingCloudFetchSourcesPrisma = {
  cloudFetchConfig: {
    findUnique(args: { where: { id: string } }): Promise<Partial<{
      tokenBudgetPerHour: number;
      starvationReserveRatio: number;
      leaseTtlMinutes: number;
      schedulingLeadMinutes: number;
      retryBaseMinutes: number;
      failureCircuitBreakerThreshold: number;
      canonicalCooldownMinutes: number;
      durationColdStartBufferRatio: number;
    }> | null>;
  };
  cloudSourceTask: {
    findMany(args: Record<string, unknown>): Promise<PendingCloudTaskInput[]>;
  };
  cloudSourceSubmission: {
    groupBy(args: Record<string, unknown>): Promise<Array<{
      cloudBuilderId: string;
      _count: { _all: number };
    }>>;
  };
  cloudFetchQueueItem: {
    findMany(args: Record<string, unknown>): Promise<PendingCloudQueueItemInput[]>;
  };
  cloudFetchRunTask: {
    findMany(args: Record<string, unknown>): Promise<Array<{
      usageTokens?: number | null;
      cloudSourceTaskId?: string;
      status?: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
      startedAt?: Date | null;
      builder?: { canonicalKey: string };
    }>>;
  };
};

export function buildPendingCloudFetchSnapshot(params: {
  now: Date;
  requestedLimit?: number;
  config: Partial<{
    tokenBudgetPerHour: number;
    starvationReserveRatio: number;
    leaseTtlMinutes: number;
    schedulingLeadMinutes: number;
    retryBaseMinutes: number;
    failureCircuitBreakerThreshold: number;
    canonicalCooldownMinutes: number;
    durationColdStartBufferRatio: number;
  }> | null;
  tasks: PendingCloudTaskInput[];
  activeSubmissionCounts: Record<string, number>;
  activeLeaseItems?: PendingCloudQueueItemInput[];
  queueItems: PendingCloudQueueItemInput[];
  recentRunTasks: PendingCloudRecentRunTaskInput[];
  recentUsageTokens: number;
}): CloudPendingSourceSnapshot {
  const config = serializeCloudFetchConfig(params.config ?? null);
  const requestedLimit = params.requestedLimit ?? DEFAULT_CLOUD_FETCH_MATERIALIZE_LIMIT;
  const taskById = new Map(params.tasks.map((task) => [task.id, task]));
  const queueItemsByTaskId = new Map<string, PendingCloudQueueItemInput[]>();
  const leasedTaskIds = new Set<string>();
  const activeLeaseCanonicalKeys = new Set<string>();
  const activeLeaseItems = params.activeLeaseItems
    ?? params.queueItems.filter(
      (queueItem) =>
        queueItem.status === "LEASED"
        && (!queueItem.leaseExpiresAt || queueItem.leaseExpiresAt > params.now),
    );

  for (const queueItem of params.queueItems) {
    const items = queueItemsByTaskId.get(queueItem.cloudSourceTaskId) ?? [];
    items.push(queueItem);
    queueItemsByTaskId.set(queueItem.cloudSourceTaskId, items);
  }
  for (const leaseItem of activeLeaseItems) {
    leasedTaskIds.add(leaseItem.cloudSourceTaskId);
    const leasedTask = taskById.get(leaseItem.cloudSourceTaskId);
    if (leasedTask) {
      activeLeaseCanonicalKeys.add(leasedTask.builder.canonicalKey);
      continue;
    }
    const leaseCanonicalKey = leaseItem.cloudSourceTask?.builder.canonicalKey;
    if (leaseCanonicalKey) activeLeaseCanonicalKeys.add(leaseCanonicalKey);
  }

  const activeEstimatedTokens = activeLeaseItems
    .reduce(
      (sum, leaseItem) => {
        const task = taskById.get(leaseItem.cloudSourceTaskId);
        if (task) {
          return sum + estimateCloudFetchTaskTokens({
            estimatedTokenCost: task.estimatedTokenCost,
            sourceType: task.builder.sourceType,
          });
        }
        if (!leaseItem.cloudSourceTask) return sum;
        return sum + estimateCloudFetchTaskTokens({
          estimatedTokenCost: leaseItem.cloudSourceTask.estimatedTokenCost,
          sourceType: leaseItem.cloudSourceTask.builder.sourceType,
        });
      },
      0,
    );
  const budget = calculateCloudFetchLeaseBudget({
    tokenBudgetPerHour: config.tokenBudgetPerHour,
    recentUsageTokens: params.recentUsageTokens,
    activeEstimatedTokens,
    requestedLimit,
  });
  const canonicalActivityPolicy = createCanonicalActivityPolicy({
    activeLeaseCanonicalKeys,
    recentRuns: params.recentRunTasks.map((task) => ({
      canonicalKey: task.canonicalKey,
      cloudSourceTaskId: task.cloudSourceTaskId,
      status: task.status,
    })),
  });

  const pendingSources: CloudPendingSource[] = [];
  const schedulableTasks: CloudSchedulerTaskInput[] = [];
  const schedulableSourceData = new Map<string, PendingCloudTaskInput>();

  for (const task of params.tasks) {
    if ((params.activeSubmissionCounts[task.builderId] ?? 0) <= 0) continue;
    if (leasedTaskIds.has(task.id)) continue;

    const estimatedTokens = estimateCloudFetchTaskTokens({
      estimatedTokenCost: task.estimatedTokenCost,
      sourceType: task.builder.sourceType,
    });
    const queuedItems = queueItemsByTaskId.get(task.id) ?? [];
    const hasQueuedItem = queuedItems.some((item) => item.status === "QUEUED");
    if (hasQueuedItem) {
      pendingSources.push(toPendingSource(task, "queued", estimatedTokens));
      continue;
    }

    if (task.circuitBreakerUntil && task.circuitBreakerUntil > params.now) {
      pendingSources.push(toPendingSource(task, "circuit_breaker", estimatedTokens));
      continue;
    }

    if (task.nextAttemptAt && task.nextAttemptAt > params.now) {
      if (task.consecutiveFailures > 0) {
        pendingSources.push(toPendingSource(task, "retry_backoff", estimatedTokens));
      }
      continue;
    }

    if (canonicalActivityPolicy.activeCanonicalKeys.has(task.builder.canonicalKey)) {
      pendingSources.push(toPendingSource(task, "canonical_active", estimatedTokens));
      continue;
    }

    if (canonicalActivityPolicy.blocksCandidate({
      canonicalKey: task.builder.canonicalKey,
      cloudSourceTaskId: task.id,
    })) {
      pendingSources.push(toPendingSource(task, "canonical_cooldown", estimatedTokens));
      continue;
    }

    const estimate = estimateCloudTaskRuntime({
      sourceType: task.builder.sourceType,
      durationP75Seconds: task.durationP75Seconds,
      durationP90Seconds: task.durationP90Seconds,
      durationSampleCount: task.durationSampleCount,
      successSampleCount: task.successSampleCount,
      estimatedSuccessProbability: task.estimatedSuccessProbability,
      config,
    });
    schedulableTasks.push({
      id: task.id,
      canonicalKey: task.builder.canonicalKey,
      sourceType: task.builder.sourceType,
      releaseAt: maxDate(params.now, task.nextAttemptAt ?? params.now),
      mustSucceedBy: task.mustSucceedBy ?? taskDeadline(task.effectiveFrequency, task.lastSuccessAt ?? params.now),
      estimatedDurationSeconds: task.estimatedDurationSeconds ?? estimate.estimatedDurationSeconds,
      estimatedTokenCost: estimatedTokens,
      estimatedPostYield: task.estimatedPostYield ?? estimate.estimatedPostYield,
      estimatedSuccessProbability: task.estimatedSuccessProbability ?? estimate.estimatedSuccessProbability,
      activeSubmissionCount: params.activeSubmissionCounts[task.builderId] ?? 0,
      consecutiveDeferrals: task.consecutiveDeferrals,
      consecutiveFailures: task.consecutiveFailures,
      circuitBreakerUntil: task.circuitBreakerUntil,
      lastDeferredAt: task.lastDeferredAt,
    });
    schedulableSourceData.set(task.id, task);
  }

  const plan = planCloudFetchWindow({
    now: params.now,
    requestedLimit: budget.limit,
    config: {
      tokenBudgetPerHour: budget.tokenBudget,
      starvationReserveRatio: config.starvationReserveRatio,
    },
    tasks: schedulableTasks,
  });
  const selectedTaskIds = new Set(plan.currentHourTaskIds);

  for (const task of schedulableTasks) {
    const sourceTask = schedulableSourceData.get(task.id);
    if (!sourceTask) continue;
    if (selectedTaskIds.has(task.id)) {
      pendingSources.push(toPendingSource(sourceTask, "ready_for_lease", task.estimatedTokenCost));
      continue;
    }
    pendingSources.push(
      toPendingSource(
        sourceTask,
        classifySchedulableReason({
          budget,
          planReason: plan.debug.deferred[task.id]?.reason,
          taskEstimatedTokens: task.estimatedTokenCost,
        }),
        task.estimatedTokenCost,
      ),
    );
  }

  pendingSources.sort(comparePendingSources);

  return {
    budget: {
      tokenBudgetPerHour: budget.tokenBudgetPerHour,
      recentUsageTokens: budget.recentUsageTokens,
      activeEstimatedTokens: budget.activeEstimatedTokens,
      remainingTokens: budget.tokenBudget,
    },
    sources: pendingSources,
  };
}

export async function getPendingCloudFetchSources(params: {
  prisma: PendingCloudFetchSourcesPrisma;
  now: Date;
}): Promise<CloudPendingSourceSnapshot> {
  const config = serializeCloudFetchConfig(
    await params.prisma.cloudFetchConfig.findUnique({
      where: { id: CLOUD_FETCH_CONFIG_ID },
    }),
  );
  const tasks = await params.prisma.cloudSourceTask.findMany({
    where: {
      status: "ACTIVE",
      cloudLanguageLibrary: { enabled: true },
    },
    include: {
      builder: {
        select: {
          id: true,
          name: true,
          canonicalKey: true,
          sourceType: true,
        },
      },
    },
  });
  const builderIds = tasks.map((task) => task.builderId);
  const taskIds = tasks.map((task) => task.id);
  const oneHourAgo = new Date(params.now.getTime() - HOUR_MS);
  const cooldownStartedAt = new Date(
    params.now.getTime() - config.canonicalCooldownMinutes * MINUTE_MS,
  );

  const [submissionCounts, activeLeaseItems, queueItems, recentUsageRows, cooldownRows] = await Promise.all([
    builderIds.length > 0
      ? params.prisma.cloudSourceSubmission.groupBy({
          by: ["cloudBuilderId"],
          where: {
            cloudBuilderId: { in: builderIds },
            active: true,
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    params.prisma.cloudFetchQueueItem.findMany({
      where: {
        status: "LEASED",
        leaseExpiresAt: { gt: params.now },
      },
      select: {
        cloudSourceTaskId: true,
        status: true,
        dueAt: true,
        leaseExpiresAt: true,
        cloudSourceTask: {
          select: {
            estimatedTokenCost: true,
            builder: {
              select: {
                canonicalKey: true,
                sourceType: true,
              },
            },
          },
        },
      },
    }),
    taskIds.length > 0
      ? params.prisma.cloudFetchQueueItem.findMany({
          where: {
            cloudSourceTaskId: { in: taskIds },
            status: "QUEUED",
          },
        })
      : Promise.resolve([]),
    params.prisma.cloudFetchRunTask.findMany({
      where: {
        startedAt: { gte: oneHourAgo },
      },
      select: { usageTokens: true },
    }),
    config.canonicalCooldownMinutes > 0
      ? params.prisma.cloudFetchRunTask.findMany({
          where: {
            startedAt: { gte: cooldownStartedAt },
          },
          select: {
            cloudSourceTaskId: true,
            status: true,
            startedAt: true,
            builder: { select: { canonicalKey: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return buildPendingCloudFetchSnapshot({
    now: params.now,
    requestedLimit: DEFAULT_CLOUD_FETCH_MATERIALIZE_LIMIT,
    config,
    tasks,
    activeSubmissionCounts: Object.fromEntries(
      submissionCounts.map((row) => [row.cloudBuilderId, row._count._all]),
    ),
    activeLeaseItems,
    queueItems,
    recentRunTasks: cooldownRows.map((row) => ({
      cloudSourceTaskId: row.cloudSourceTaskId ?? "",
      canonicalKey: row.builder?.canonicalKey ?? "",
      status: row.status ?? "FAILED",
      startedAt: row.startedAt ?? null,
      usageTokens: row.usageTokens ?? null,
    })),
    recentUsageTokens: recentUsageRows.reduce(
      (sum, row) => sum + (row.usageTokens ?? 0),
      0,
    ),
  });
}

function classifySchedulableReason(params: {
  budget: ReturnType<typeof calculateCloudFetchLeaseBudget>;
  planReason?: string;
  taskEstimatedTokens: number;
}): CloudPendingSourceReason {
  if (params.planReason === "canonical_selected") return "scheduler_capacity";
  if (params.budget.tokenBudget <= 0) return "token_budget";
  if (params.taskEstimatedTokens > params.budget.tokenBudget) {
    return "token_budget";
  }
  return "scheduler_capacity";
}

function toPendingSource(
  task: PendingCloudTaskInput,
  reason: CloudPendingSourceReason,
  estimatedTokens: number,
): CloudPendingSource {
  return {
    taskId: task.id,
    builderId: task.builderId,
    summaryLanguage: task.summaryLanguage,
    sourceType: task.builder.sourceType,
    name: task.builder.name,
    canonicalKey: task.builder.canonicalKey,
    reason,
    estimatedTokens,
    consecutiveDeferrals: task.consecutiveDeferrals,
    consecutiveFailures: task.consecutiveFailures,
    lastDeferredAt: task.lastDeferredAt?.toISOString() ?? null,
    nextAttemptAt: task.nextAttemptAt?.toISOString() ?? null,
    circuitBreakerUntil: task.circuitBreakerUntil?.toISOString() ?? null,
  };
}

function comparePendingSources(a: CloudPendingSource, b: CloudPendingSource) {
  const reasonDelta =
    PENDING_REASON_PRIORITY.indexOf(a.reason) - PENDING_REASON_PRIORITY.indexOf(b.reason);
  if (reasonDelta !== 0) return reasonDelta;
  if (a.consecutiveDeferrals !== b.consecutiveDeferrals) {
    return b.consecutiveDeferrals - a.consecutiveDeferrals;
  }
  const deferredAtA = a.lastDeferredAt ? Date.parse(a.lastDeferredAt) : Number.NEGATIVE_INFINITY;
  const deferredAtB = b.lastDeferredAt ? Date.parse(b.lastDeferredAt) : Number.NEGATIVE_INFINITY;
  if (deferredAtA !== deferredAtB) return deferredAtB - deferredAtA;
  const nameDelta = a.name.localeCompare(b.name);
  if (nameDelta !== 0) return nameDelta;
  return a.taskId.localeCompare(b.taskId);
}

function maxDate(...dates: Date[]) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function taskDeadline(frequency: "DAILY" | "WEEKLY", from: Date) {
  return new Date(from.getTime() + (frequency === "WEEKLY" ? 7 * 24 : 24) * HOUR_MS);
}
