import {
  CloudFetchQueueStatus,
  CloudFetchRunStatus,
  type CloudFetchFrequency,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { expireLeasedCloudFetchRuns } from "@/lib/cloud-fetch-run-lifecycle";
import type { CloudFetchExecutionPlan } from "@/lib/cloud-source-contracts";
import { cloudDeadlineState, cloudShardExecutionBudget } from "@/lib/local-agent-timeouts";
import { databaseClockNow, lockResetFenceForWorker } from "@/lib/reset-fence";

type CloudSchedulerDb = Prisma.TransactionClient;

export type CloudSchedulerTaskInput = {
  id: string;
  canonicalKey: string;
  sourceType: string;
  releaseAt: Date;
  mustSucceedBy: Date;
  estimatedDurationSeconds: number;
  estimatedTokenCost: number;
  estimatedPostYield: number;
  estimatedSuccessProbability: number;
  activeSubmissionCount: number;
  consecutiveDeferrals: number;
  consecutiveFailures: number;
  circuitBreakerUntil?: Date | null;
  lastDeferredAt?: Date | null;
};

export type CloudSchedulerConfig = {
  tokenBudgetPerHour: number;
  starvationReserveRatio: number;
};

export type CloudTaskEstimateInput = {
  sourceType: string;
  durationP75Seconds?: number | null;
  durationP90Seconds?: number | null;
  durationSampleCount: number;
  successSampleCount: number;
  estimatedSuccessProbability?: number | null;
  config: {
    durationColdStartBufferRatio: number;
  };
};

export type CloudFetchFrequencyKey = "DAILY" | "WEEKLY";

type CanonicalActivityCandidate = {
  canonicalKey: string;
  cloudSourceTaskId: string;
};

type CanonicalActivityRecentRun = CanonicalActivityCandidate & {
  status: CloudFetchRunStatus;
};

type CanonicalActivitySummary = {
  blockedCanonicalKeys: Set<string>;
  failedOnlyCandidates: CanonicalActivityCandidate[];
};

type CloudFetchConfigShape = CloudSchedulerConfig & {
  leaseTtlMinutes: number;
  schedulingLeadMinutes: number;
  retryBaseMinutes: number;
  failureCircuitBreakerThreshold: number;
  canonicalCooldownMinutes: number;
  durationColdStartBufferRatio: number;
};

type BucketTask = {
  task: CloudSchedulerTaskInput;
  score: number;
  lane: "normal" | "starvation" | "retry";
};

type BucketPlan = {
  start: Date;
  tasks: BucketTask[];
};

type PlanDebugRecord = {
  reason?: string;
  lane?: "normal" | "starvation" | "retry";
  bucketStart?: string;
  score?: number;
};

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MIN_ESTIMATED_TOKENS = 1_000;
const DEFAULT_MATERIALIZE_LIMIT = 100;
const CLOUD_FETCHED_ITEM_LIMIT_PER_LEASE = 5_000;
const CLOUD_SCHEDULER_TRANSACTION_OPTIONS = { maxWait: 60_000, timeout: 60_000 } as const;

const SOURCE_TYPE_PRIORS: Record<string, {
  durationP75Seconds: number;
  successProbability: number;
  estimatedTokenCost: number;
  estimatedPostYield: number;
}> = {
  podcast: { durationP75Seconds: 1_800, successProbability: 0.75, estimatedTokenCost: 160_000, estimatedPostYield: 3 },
  youtube: { durationP75Seconds: 1_200, successProbability: 0.78, estimatedTokenCost: 120_000, estimatedPostYield: 3 },
  video: { durationP75Seconds: 1_200, successProbability: 0.78, estimatedTokenCost: 120_000, estimatedPostYield: 3 },
  website: { durationP75Seconds: 900, successProbability: 0.8, estimatedTokenCost: 80_000, estimatedPostYield: 3 },
  blog: { durationP75Seconds: 600, successProbability: 0.85, estimatedTokenCost: 60_000, estimatedPostYield: 3 },
  rss: { durationP75Seconds: 600, successProbability: 0.85, estimatedTokenCost: 60_000, estimatedPostYield: 3 },
  x: { durationP75Seconds: 300, successProbability: 0.82, estimatedTokenCost: 30_000, estimatedPostYield: 3 },
  twitter: { durationP75Seconds: 300, successProbability: 0.82, estimatedTokenCost: 30_000, estimatedPostYield: 3 },
  auto: { durationP75Seconds: 900, successProbability: 0.8, estimatedTokenCost: 80_000, estimatedPostYield: 3 },
};
const SOURCE_TYPE_PRIOR_KEYS_EXCLUDING_AUTO = Object.keys(SOURCE_TYPE_PRIORS)
  .filter((sourceType) => sourceType !== "auto");

export function estimateCloudTaskRuntime(input: CloudTaskEstimateInput) {
  const prior = sourceTypePrior(input.sourceType);
  const historicalDuration = Math.max(
    input.durationP75Seconds ?? 0,
    input.durationP90Seconds ?? 0,
  );
  const sparseHistoryBuffer =
    input.durationSampleCount < 3 ? 1 + input.config.durationColdStartBufferRatio : 1;
  const estimatedDurationSeconds = Math.ceil(
    Math.max(prior.durationP75Seconds, historicalDuration || prior.durationP75Seconds) *
      sparseHistoryBuffer,
  );
  return {
    estimatedDurationSeconds,
    estimatedTokenCost: prior.estimatedTokenCost,
    estimatedPostYield: prior.estimatedPostYield,
    estimatedSuccessProbability:
      input.successSampleCount > 0 && input.estimatedSuccessProbability != null
        ? clamp(input.estimatedSuccessProbability, 0.05, 0.99)
        : prior.successProbability,
  };
}

export function createCanonicalActivityPolicy(params: {
  activeLeaseCanonicalKeys?: Iterable<string>;
  recentRuns?: Iterable<CanonicalActivityRecentRun>;
}) {
  const activeCanonicalKeys = new Set(params.activeLeaseCanonicalKeys ?? []);
  const recentRunsByCanonical = new Map<string, CanonicalActivityRecentRun[]>();

  for (const run of params.recentRuns ?? []) {
    const runs = recentRunsByCanonical.get(run.canonicalKey) ?? [];
    runs.push(run);
    recentRunsByCanonical.set(run.canonicalKey, runs);
  }

  const blockedCanonicalKeys = new Set(activeCanonicalKeys);
  const failedOnlyCandidates: CanonicalActivityCandidate[] = [];
  for (const [canonicalKey, recentRuns] of recentRunsByCanonical) {
    if (blockedCanonicalKeys.has(canonicalKey)) continue;
    let hasNonFailedRun = false;
    const failedTaskIds = new Set<string>();
    for (const run of recentRuns) {
      if (run.status === CloudFetchRunStatus.FAILED) {
        failedTaskIds.add(run.cloudSourceTaskId);
        continue;
      }
      hasNonFailedRun = true;
    }
    if (hasNonFailedRun || failedTaskIds.size > 1) {
      blockedCanonicalKeys.add(canonicalKey);
      continue;
    }
    if (failedTaskIds.size === 1) {
      failedOnlyCandidates.push({
        canonicalKey,
        cloudSourceTaskId: [...failedTaskIds][0]!,
      });
    }
  }
  const failedOnlyTaskIdByCanonical = new Map(
    failedOnlyCandidates.map((candidate) => [candidate.canonicalKey, candidate.cloudSourceTaskId]),
  );

  return {
    activeCanonicalKeys,
    summary: {
      blockedCanonicalKeys,
      failedOnlyCandidates,
    } satisfies CanonicalActivitySummary,
    blocksCandidate(candidate: CanonicalActivityCandidate) {
      if (blockedCanonicalKeys.has(candidate.canonicalKey)) return true;
      const failedOnlyTaskId = failedOnlyTaskIdByCanonical.get(candidate.canonicalKey);
      return failedOnlyTaskId != null && failedOnlyTaskId !== candidate.cloudSourceTaskId;
    },
  };
}

export function planCloudFetchWindow(params: {
  now: Date;
  requestedLimit: number;
  config: CloudSchedulerConfig;
  tasks: CloudSchedulerTaskInput[];
  activeCanonicalKeys?: Set<string>;
}) {
  const debug = {
    selected: {} as Record<string, PlanDebugRecord>,
    skipped: {} as Record<string, PlanDebugRecord>,
    deferred: {} as Record<string, PlanDebugRecord>,
  };
  const activeCanonicalKeys = params.activeCanonicalKeys ?? new Set<string>();
  const currentBucket: BucketPlan = { start: params.now, tasks: [] };

  const eligible = params.tasks.filter((task) => {
    if (task.circuitBreakerUntil && task.circuitBreakerUntil > params.now) {
      debug.skipped[task.id] = { reason: "circuit_breaker" };
      return false;
    }
    if (activeCanonicalKeys.has(task.canonicalKey)) {
      debug.skipped[task.id] = { reason: "canonical_active" };
      return false;
    }
    return true;
  });

  // Due now = released (backoff elapsed) and able to finish before its deadline
  // from the current hour. The scheduler is work-conserving: a local worker
  // session is handed every due task it has budget for, rather than parking work
  // near its deadline. The deadline still drives priority via scoreTask's
  // urgency term.
  // Released = retry backoff elapsed (circuit breaker is already filtered above).
  // Deadline feasibility is NOT a gate: an overdue task stays leasable as
  // low-priority catch-up (see scoreTask) instead of being abandoned forever
  // once its mustSucceedBy passes.
  const due = eligible.filter(
    (task) => task.releaseAt.getTime() <= currentBucket.start.getTime(),
  );
  for (const task of eligible) {
    if (!due.includes(task)) {
      debug.skipped[task.id] = debug.skipped[task.id] ?? { reason: "not_due" };
    }
  }

  // Starvation reserve: the most-deferred due tasks get guaranteed slots and are
  // protected from eviction (see lowestScoreIndex).
  const reservedStarvationCount = reserveCount(
    params.requestedLimit,
    params.config.starvationReserveRatio,
  );
  const selectedTaskIds = new Set<string>();
  const selectedCanonicalKeys = new Set<string>();
  const starvationTasks = due
    .filter((task) => task.consecutiveDeferrals > 0)
    .sort(compareStarvation);
  for (const task of starvationTasks) {
    if (currentBucket.tasks.length >= reservedStarvationCount) break;
    if (selectedCanonicalKeys.has(task.canonicalKey)) continue;
    currentBucket.tasks.push({ task, score: scoreTask(task, params.now), lane: "starvation" });
    selectedTaskIds.add(task.id);
    selectedCanonicalKeys.add(task.canonicalKey);
  }

  // Fill the remaining request budget by score, highest value/urgency first.
  const rest = due
    .sort((a, b) => compareTaskScoreDescending(a, b, params.now));
  for (const task of rest) {
    if (selectedTaskIds.has(task.id)) continue;
    if (selectedCanonicalKeys.has(task.canonicalKey)) continue;
    currentBucket.tasks.push({
      task,
      score: scoreTask(task, params.now),
      lane: task.consecutiveFailures > 0 ? "retry" : "normal",
    });
    selectedTaskIds.add(task.id);
    selectedCanonicalKeys.add(task.canonicalKey);
  }
  evictOverCapacity(currentBucket, params.config, params.requestedLimit, debug);
  backfillAfterEviction(
    currentBucket,
    due,
    params.now,
    reservedStarvationCount,
    params.config,
    params.requestedLimit,
    debug,
  );

  for (const item of currentBucket.tasks) {
    debug.selected[item.task.id] = {
      lane: item.lane,
      bucketStart: currentBucket.start.toISOString(),
      score: item.score,
    };
  }
  // Due tasks that lost the current-hour budget competition are deferred so they
  // gain aging/starvation priority on the next poll.
  const finalSelectedIds = new Set(currentBucket.tasks.map((item) => item.task.id));
  const finalSelectedCanonicalKeys = new Set(
    currentBucket.tasks.map((item) => item.task.canonicalKey),
  );
  for (const task of due) {
    if (!finalSelectedIds.has(task.id)) {
      debug.deferred[task.id] = debug.deferred[task.id] ?? {
        reason: finalSelectedCanonicalKeys.has(task.canonicalKey)
          ? "canonical_selected"
          : "hour_budget_full",
      };
    }
  }

  return {
    currentHourTaskIds: currentBucket.tasks
      .slice()
      .sort(compareBucketTasksForExecution)
      .map((item) => item.task.id),
    buckets: [
      {
        start: currentBucket.start,
        taskIds: currentBucket.tasks.map((item) => item.task.id),
      },
    ],
    debug,
  };
}

export async function materializeDueCloudFetchQueue(params: {
  limit?: number;
  now?: Date;
  prisma?: PrismaClient;
  tokenBudgetRemaining?: number;
} = {}) {
  const prisma = params.prisma ?? (await getPrismaClient());
  const now = params.now ?? new Date();
  const workerStartedAt = await databaseClockNow(prisma);
  return prisma.$transaction(
    (tx) => materializeDueCloudFetchQueueInTransaction({
      ...params,
      prisma: tx,
      now,
      workerStartedAt,
    }),
    CLOUD_SCHEDULER_TRANSACTION_OPTIONS,
  );
}

async function materializeDueCloudFetchQueueInTransaction(params: {
  limit?: number;
  now: Date;
  prisma: CloudSchedulerDb;
  tokenBudgetRemaining?: number;
  workerStartedAt: Date;
}) {
  const { prisma, now } = params;
  await lockResetFenceForWorker(prisma, params.workerStartedAt);
  const config = await loadCloudFetchConfig(prisma);
  const { tasks, activeCanonicalKeys } = await loadEligibleCloudTasks({ prisma, now, config });
  const requestedLimit = normalizedLeaseLimit(params.limit ?? DEFAULT_MATERIALIZE_LIMIT);
  const plan = planCloudFetchWindow({
    now,
    requestedLimit,
    config: {
      tokenBudgetPerHour: Math.max(
        0,
        Math.min(config.tokenBudgetPerHour, params.tokenBudgetRemaining ?? config.tokenBudgetPerHour),
      ),
      starvationReserveRatio: config.starvationReserveRatio,
    },
    tasks,
    activeCanonicalKeys,
  });
  const selectedIds = new Set(plan.currentHourTaskIds);
  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id));

  let created = 0;
  for (const task of selectedTasks) {
    try {
      await prisma.cloudFetchQueueItem.create({
        data: {
          cloudSourceTaskId: task.id,
          status: CloudFetchQueueStatus.QUEUED,
          priorityScore: plan.debug.selected[task.id]?.score ?? 0,
          dueAt: now,
          mustSucceedBy: task.mustSucceedBy,
        },
      });
      created += 1;
    } catch (error) {
      // Backed by migration index CloudFetchQueueItem_active_task_key.
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  const deferredIds = Object.keys(plan.debug.deferred);
  if (deferredIds.length > 0) {
    await prisma.cloudSourceTask.updateMany({
      where: { id: { in: deferredIds } },
      data: { consecutiveDeferrals: { increment: 1 }, lastDeferredAt: now },
    });
  }

  return {
    status: "ok" as const,
    queued: created,
    planned: selectedTasks.length,
    deferred: deferredIds.length,
    debug: plan.debug,
  };
}

export async function leaseCloudFetchTasks(params: {
  limit: number;
  leaseOwner: string;
  now?: Date;
  prisma?: PrismaClient;
  workerStartedAt?: Date;
}) {
  const prisma = params.prisma ?? (await getPrismaClient());
  const now = params.now ?? new Date();
  const workerStartedAt = params.workerStartedAt ?? await databaseClockNow(prisma);
  return prisma.$transaction(
    (tx) => leaseCloudFetchTasksInTransaction({
      ...params,
      prisma: tx,
      now,
      workerStartedAt,
    }),
    CLOUD_SCHEDULER_TRANSACTION_OPTIONS,
  );
}

async function leaseCloudFetchTasksInTransaction(params: {
  limit: number;
  leaseOwner: string;
  now: Date;
  prisma: CloudSchedulerDb;
  workerStartedAt: Date;
}) {
  const { prisma, now } = params;
  await lockResetFenceForWorker(prisma, params.workerStartedAt);
  const config = await loadCloudFetchConfig(prisma);
  await expireStaleCloudFetchLeases({ prisma, now });

  const budget = await computeLeaseBudget({ prisma, now, config, requestedLimit: params.limit });
  if (budget.limit <= 0) {
    return { status: "empty" as const, runId: null, tasks: [], budget };
  }
  await materializeDueCloudFetchQueueInTransaction({
    prisma,
    now,
    limit: budget.limit,
    tokenBudgetRemaining: budget.tokenBudget,
    workerStartedAt: params.workerStartedAt,
  });
  const canonicalActivityPolicy = await loadCanonicalActivityPolicy({ prisma, now, config });

  const selected = [];
  const queuedItemsPageSize = Math.max(params.limit, budget.limit);
  const queuedItemsOrder = [
    { priorityScore: "desc" as const },
    { mustSucceedBy: "asc" as const },
    { createdAt: "asc" as const },
    { id: "asc" as const },
  ];
  let remainingTokens = budget.tokenBudget;
  let cursor: { id: string } | undefined;
  const selectedCanonicalKeys = new Set<string>();
  while (selected.length < budget.limit && remainingTokens >= MIN_ESTIMATED_TOKENS) {
    const queuedItems = await prisma.cloudFetchQueueItem.findMany({
      where: queuedLeaseItemsWhere(
        now,
        remainingTokens,
        selectedCanonicalKeys,
        canonicalActivityPolicy.summary,
      ),
      orderBy: queuedItemsOrder,
      take: queuedItemsPageSize,
      ...(cursor ? { cursor, skip: 1 } : {}),
      include: {
        cloudSourceTask: {
          include: {
            builder: {
              select: {
                id: true,
                kind: true,
                sourceType: true,
                name: true,
                handle: true,
                sourceUrl: true,
                fetchUrl: true,
                canonicalKey: true,
              },
            },
          },
        },
      },
    });
    if (queuedItems.length === 0) break;

    for (const item of queuedItems) {
      if (selected.length >= budget.limit) break;
      const candidate = {
        canonicalKey: item.cloudSourceTask.builder.canonicalKey,
        cloudSourceTaskId: item.cloudSourceTaskId,
      };
      if (selectedCanonicalKeys.has(candidate.canonicalKey)) continue;
      if (canonicalActivityPolicy.blocksCandidate(candidate)) continue;
      const estimate = estimatedDurationForTask(item.cloudSourceTask, config);
      const estimatedTokens = estimatedTokensForTask(item.cloudSourceTask);
      if (estimatedTokens > remainingTokens) continue;
      const executionPlan = provisionalExecutionPlanForLease({
        now,
        mustSucceedBy: item.mustSucceedBy,
        sourceType: item.cloudSourceTask.builder.sourceType,
        estimatedDurationSeconds: estimate,
      });
      selected.push({ item, estimate, estimatedTokens, executionPlan });
      selectedCanonicalKeys.add(item.cloudSourceTask.builder.canonicalKey);
      remainingTokens -= estimatedTokens;
      if (remainingTokens < MIN_ESTIMATED_TOKENS) break;
    }

    if (queuedItems.length < queuedItemsPageSize) break;
    cursor = { id: queuedItems[queuedItems.length - 1]!.id };
  }

  if (selected.length === 0) {
    return { status: "empty" as const, runId: null, tasks: [], budget };
  }

  const fetchedItemsByBuilderId = await loadFetchedItemsForCloudBuilders(
    prisma,
    selected.map(({ item }) => item.cloudSourceTask.builderId),
  );
  const initialLeaseSeconds = Math.max(
    config.leaseTtlMinutes * 60,
    ...selected.map((entry) => entry.executionPlan.provisionalExecutionBudgetSeconds + 10 * 60),
  );
  const leaseExpiresAt = new Date(now.getTime() + initialLeaseSeconds * 1000);
  const run = await prisma.cloudFetchRun.create({
    data: {
      leaseOwner: params.leaseOwner,
      requestedLimit: params.limit,
      tasksClaimed: selected.length,
      status: CloudFetchRunStatus.RUNNING,
    },
  });

  const claimed: typeof selected = [];
  for (const entry of selected) {
    const { item, estimate, executionPlan } = entry;
    // Guard the claim on status: QUEUED so a concurrent lease transaction that
    // already flipped this item to LEASED cannot be overwritten. Without the
    // guard two runs could double-lease the same task (READ COMMITTED lets both
    // snapshots see the same QUEUED row; the ResetFence FOR SHARE lock does not
    // serialize workers against each other).
    const claim = await prisma.cloudFetchQueueItem.updateMany({
      where: { id: item.id, status: CloudFetchQueueStatus.QUEUED },
      data: {
        status: CloudFetchQueueStatus.LEASED,
        leasedAt: now,
        leaseExpiresAt,
        leaseOwner: params.leaseOwner,
        runId: run.id,
        attempts: { increment: 1 },
      },
    });
    if (claim.count === 0) continue;
    await prisma.cloudFetchRunTask.create({
      data: {
        runId: run.id,
        cloudSourceTaskId: item.cloudSourceTaskId,
        builderId: item.cloudSourceTask.builderId,
        summaryLanguage: item.cloudSourceTask.summaryLanguage,
        status: CloudFetchRunStatus.RUNNING,
        startedAt: now,
        estimatedDurationSeconds: estimate,
        successProbabilitySnapshot: item.cloudSourceTask.estimatedSuccessProbability,
        details: {
          executionPlan,
        },
      },
    });
    await prisma.cloudSourceTask.update({
      where: { id: item.cloudSourceTaskId },
      data: { lastStartedAt: now, lastQueuedAt: now, lastRunId: run.id },
    });
    claimed.push(entry);
  }

  // Every selected item lost its claim race: the run has nothing to do, so drop
  // it (no run tasks reference it yet) and report empty.
  if (claimed.length === 0) {
    await prisma.cloudFetchRun.delete({ where: { id: run.id } });
    return { status: "empty" as const, runId: null, tasks: [], budget };
  }
  // Keep tasksClaimed honest when some items were stolen by a concurrent lease.
  if (claimed.length !== selected.length) {
    await prisma.cloudFetchRun.update({
      where: { id: run.id },
      data: { tasksClaimed: claimed.length },
    });
  }

  return {
    status: "ok" as const,
    runId: run.id,
    tasks: claimed.map(({ item, estimate, executionPlan }) => ({
      cloudSourceTaskId: item.cloudSourceTaskId,
      builderId: item.cloudSourceTask.builderId,
      summaryLanguage: item.cloudSourceTask.summaryLanguage,
      mustSucceedBy: executionPlan.mustSucceedBy,
      estimatedDurationSeconds: estimate,
      provisionalExecutionBudgetSeconds: executionPlan.provisionalExecutionBudgetSeconds,
      workloadClass: executionPlan.workloadClass,
      budgetReason: executionPlan.budgetReason,
      deadlineState: executionPlan.deadlineState,
      source: item.cloudSourceTask.builder,
      fetchedItems: fetchedItemsByBuilderId.get(item.cloudSourceTask.builderId) ?? [],
    })),
    budget,
  };
}

async function loadFetchedItemsForCloudBuilders(prisma: CloudSchedulerDb, builderIds: string[]) {
  const uniqueBuilderIds = [...new Set(builderIds.filter(Boolean))];
  if (uniqueBuilderIds.length === 0) return new Map<string, {
    builderId: string;
    kind: string;
    externalId: string;
    publishedAt: Date | null;
    createdAt: Date;
  }[]>();

  const rows = await prisma.feedItem.findMany({
    where: { builderId: { in: uniqueBuilderIds } },
    select: {
      builderId: true,
      kind: true,
      externalId: true,
      publishedAt: true,
      createdAt: true,
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: CLOUD_FETCHED_ITEM_LIMIT_PER_LEASE,
  });
  const byBuilderId = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.builderId) continue;
    const bucket = byBuilderId.get(row.builderId) ?? [];
    bucket.push(row);
    byBuilderId.set(row.builderId, bucket);
  }
  return byBuilderId;
}

export async function heartbeatCloudFetchRun(params: {
  runId: string;
  leaseOwner?: string | null;
  now?: Date;
  prisma?: PrismaClient;
}) {
  const prisma = params.prisma ?? (await getPrismaClient());
  const now = params.now ?? new Date();
  const runId = params.runId.trim();
  if (!runId) {
    return { status: "empty" as const, runId: null, extendedLeases: 0, leaseExpiresAt: null };
  }
  const config = await loadCloudFetchConfig(prisma);
  const run = await prisma.cloudFetchRun.findUnique({
    where: { id: runId },
    select: { details: true },
  });
  if (!run) {
    return { status: "empty" as const, runId, extendedLeases: 0, leaseExpiresAt: null };
  }

  const leaseExpiresAt = new Date(now.getTime() + config.leaseTtlMinutes * MINUTE_MS);
  const where: Prisma.CloudFetchQueueItemWhereInput = {
    runId,
    status: CloudFetchQueueStatus.LEASED,
    // Only ever extend a lease. A long task can hold an initial lease that runs
    // past the plain TTL (see leaseCloudFetchTasksInTransaction); a heartbeat
    // must never claw that window back below its current expiry.
    leaseExpiresAt: { lt: leaseExpiresAt },
  };
  const leaseOwner = params.leaseOwner?.trim();
  if (leaseOwner) where.leaseOwner = leaseOwner;
  const updated = await prisma.cloudFetchQueueItem.updateMany({
    where,
    data: { leaseExpiresAt },
  });
  const previousDetails = objectDetails(run.details);
  const previousHeartbeatCount =
    typeof previousDetails.heartbeatCount === "number" ? previousDetails.heartbeatCount : 0;
  try {
    await prisma.cloudFetchRun.update({
      where: { id: runId },
      data: {
        details: {
          ...previousDetails,
          heartbeatAt: now.toISOString(),
          heartbeatCount: previousHeartbeatCount + 1,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        },
      },
    });
  } catch (error) {
    // The run was reset/deleted between the read above and this write. Treat the
    // heartbeat as a no-op rather than surfacing a 500 to the worker.
    if (!isRecordNotFoundError(error)) throw error;
    return { status: "empty" as const, runId, extendedLeases: 0, leaseExpiresAt: null };
  }
  return {
    status: "ok" as const,
    runId,
    extendedLeases: updated.count,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
  };
}

export function nextCloudTaskSuccessSchedule(params: {
  now: Date;
  effectiveFrequency: CloudFetchFrequencyKey;
  schedulingLeadMinutes: number;
}) {
  const intervalMs = cloudFrequencyIntervalMs(params.effectiveFrequency);
  const mustSucceedBy = new Date(params.now.getTime() + intervalMs);
  return {
    lastSuccessAt: params.now,
    consecutiveFailures: 0,
    consecutiveDeferrals: 0,
    mustSucceedBy,
    nextAttemptAt: new Date(mustSucceedBy.getTime() - params.schedulingLeadMinutes * MINUTE_MS),
    circuitBreakerUntil: null,
    circuitBreakerReason: null,
  };
}

export function nextCloudTaskFailureSchedule(params: {
  now: Date;
  previousConsecutiveFailures: number;
  retryBaseMinutes: number;
  failureCircuitBreakerThreshold: number;
  failureReason: string;
}) {
  const consecutiveFailures = params.previousConsecutiveFailures + 1;
  const backoffExponent = Math.min(consecutiveFailures - 1, 5);
  const backoffMinutes = params.retryBaseMinutes * 2 ** backoffExponent;
  const nextAttemptAt = new Date(params.now.getTime() + backoffMinutes * MINUTE_MS);
  const breakerTripped = consecutiveFailures >= params.failureCircuitBreakerThreshold;
  return {
    lastFailureAt: params.now,
    lastFailureReason: params.failureReason,
    consecutiveFailures,
    nextAttemptAt,
    circuitBreakerUntil: breakerTripped
      ? new Date(nextAttemptAt.getTime() + 24 * HOUR_MS)
      : null,
    circuitBreakerReason: breakerTripped ? params.failureReason : null,
  };
}

function evictOverCapacity(
  bucket: BucketPlan,
  config: CloudSchedulerConfig,
  requestedLimit: number,
  debug: { skipped: Record<string, PlanDebugRecord> },
) {
  while (
    bucket.tasks.length > requestedLimit ||
    totalEstimatedTokens(bucket.tasks) > config.tokenBudgetPerHour
  ) {
    const evictIndex = lowestScoreIndex(bucket.tasks);
    const [evicted] = bucket.tasks.splice(evictIndex, 1);
    debug.skipped[evicted.task.id] = { reason: "evicted_low_score", score: evicted.score };
  }
}

function backfillAfterEviction(
  bucket: BucketPlan,
  due: CloudSchedulerTaskInput[],
  now: Date,
  reservedStarvationCount: number,
  config: CloudSchedulerConfig,
  requestedLimit: number,
  debug: { skipped: Record<string, PlanDebugRecord> },
) {
  const starvationCandidates = due
    .filter((task) => task.consecutiveDeferrals > 0)
    .sort(compareStarvation);
  const scoreCandidates = due
    .slice()
    .sort((a, b) => compareTaskScoreDescending(a, b, now));

  const tryAddCandidate = (
    task: CloudSchedulerTaskInput,
    lane: BucketTask["lane"],
  ) => {
    const selectedIds = new Set(bucket.tasks.map((item) => item.task.id));
    const selectedCanonicalKeys = new Set(bucket.tasks.map((item) => item.task.canonicalKey));
    if (selectedIds.has(task.id)) return false;
    if (selectedCanonicalKeys.has(task.canonicalKey)) return false;
    if (bucket.tasks.length >= requestedLimit) return false;
    if (totalEstimatedTokens(bucket.tasks) + task.estimatedTokenCost > config.tokenBudgetPerHour) {
      return false;
    }
    bucket.tasks.push({ task, score: scoreTask(task, now), lane });
    delete debug.skipped[task.id];
    return true;
  };

  let starvationSelectedCount = bucket.tasks.filter((item) => item.lane === "starvation").length;
  if (starvationSelectedCount < reservedStarvationCount) {
    for (const task of starvationCandidates) {
      if (starvationSelectedCount >= reservedStarvationCount) break;
      if (tryAddCandidate(task, "starvation")) {
        starvationSelectedCount += 1;
      }
    }
  }

  for (const task of scoreCandidates) {
    tryAddCandidate(
      task,
      task.consecutiveFailures > 0 ? "retry" : "normal",
    );
  }
}

function lowestScoreIndex(tasks: BucketTask[]) {
  const firstNormalIndex = tasks.findIndex((item) => item.lane !== "starvation");
  let index = firstNormalIndex >= 0 ? firstNormalIndex : 0;
  for (let i = 0; i < tasks.length; i += 1) {
    if (firstNormalIndex >= 0 && tasks[i].lane === "starvation") continue;
    if (tasks[i].score < tasks[index].score) index = i;
  }
  return index;
}

function totalEstimatedTokens(tasks: BucketTask[]) {
  return tasks.reduce((sum, item) => sum + item.task.estimatedTokenCost, 0);
}

// Lower than any on-time task's urgency even after max aging, so overdue
// catch-up work never outranks an on-time task.
const CATCHUP_URGENCY = 1e-12;

function hashTaskId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function scoreTask(task: CloudSchedulerTaskInput, now: Date) {
  const expectedPosts = Math.max(0.1, task.estimatedPostYield);
  const submissionWeight = Math.sqrt(Math.max(1, task.activeSubmissionCount));
  const slackMs = task.mustSucceedBy.getTime() - now.getTime();
  // Overdue work is catch-up: a low, fixed urgency so it never displaces an
  // on-time task but still runs with spare capacity. On-time tasks keep
  // deadline-driven urgency.
  const urgency = slackMs <= 0 ? CATCHUP_URGENCY : 1 / Math.max(MINUTE_MS, slackMs);
  const aging = 1 + Math.min(task.consecutiveDeferrals, 10) * 0.15;
  const expectedValue =
    expectedPosts * submissionWeight * clamp(task.estimatedSuccessProbability, 0.01, 1) * aging;
  // Tiny deterministic jitter breaks exact score ties so synchronized identical
  // tasks are not starved by array position; far smaller than the aging signal,
  // so it never reorders meaningfully-different tasks.
  const jitter = 1 + (hashTaskId(task.id) % 997) / 1_000_000;
  return (
    (expectedValue * urgency * jitter) /
    Math.max(task.estimatedTokenCost, MIN_ESTIMATED_TOKENS)
  );
}

function compareStarvation(a: CloudSchedulerTaskInput, b: CloudSchedulerTaskInput) {
  if (b.consecutiveDeferrals !== a.consecutiveDeferrals) {
    return b.consecutiveDeferrals - a.consecutiveDeferrals;
  }
  const aDeferred = a.lastDeferredAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bDeferred = b.lastDeferredAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aDeferred !== bDeferred) return aDeferred - bDeferred;
  return a.id.localeCompare(b.id);
}

function compareTaskScoreDescending(
  a: CloudSchedulerTaskInput,
  b: CloudSchedulerTaskInput,
  now: Date,
) {
  const scoreDelta = scoreTask(b, now) - scoreTask(a, now);
  if (scoreDelta !== 0) return scoreDelta;
  return a.id.localeCompare(b.id);
}

function compareBucketTasksForExecution(a: BucketTask, b: BucketTask) {
  const laneOrder = laneRank(a.lane) - laneRank(b.lane);
  if (laneOrder !== 0) return laneOrder;
  const slackA = a.task.mustSucceedBy.getTime() - a.task.estimatedDurationSeconds * 1000;
  const slackB = b.task.mustSucceedBy.getTime() - b.task.estimatedDurationSeconds * 1000;
  return slackA - slackB;
}

function laneRank(lane: BucketTask["lane"]) {
  if (lane === "starvation") return 0;
  if (lane === "retry") return 1;
  return 2;
}

function reserveCount(capacity: number, ratio: number) {
  if (ratio <= 0 || capacity <= 0) return 0;
  return Math.max(1, Math.floor(capacity * ratio));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cloudFrequencyIntervalMs(frequency: CloudFetchFrequencyKey) {
  return frequency === "DAILY" ? 24 * HOUR_MS : 7 * 24 * HOUR_MS;
}

async function loadCloudFetchConfig(prisma: CloudSchedulerDb): Promise<CloudFetchConfigShape> {
  const stored = await prisma.cloudFetchConfig.findUnique({ where: { id: "global" } });
  return {
    tokenBudgetPerHour: stored?.tokenBudgetPerHour ?? 1_000_000,
    leaseTtlMinutes: stored?.leaseTtlMinutes ?? 60,
    schedulingLeadMinutes: stored?.schedulingLeadMinutes ?? 120,
    retryBaseMinutes: stored?.retryBaseMinutes ?? 30,
    starvationReserveRatio: stored?.starvationReserveRatio ?? 0.15,
    failureCircuitBreakerThreshold: stored?.failureCircuitBreakerThreshold ?? 5,
    canonicalCooldownMinutes: stored?.canonicalCooldownMinutes ?? 60,
    durationColdStartBufferRatio: stored?.durationColdStartBufferRatio ?? 0.5,
  };
}

async function loadEligibleCloudTasks(params: {
  prisma: CloudSchedulerDb;
  now: Date;
  config: CloudFetchConfigShape;
}) {
  const tasks = await params.prisma.cloudSourceTask.findMany({
    where: {
      status: "ACTIVE",
      cloudLanguageLibrary: { enabled: true },
      OR: [{ circuitBreakerUntil: null }, { circuitBreakerUntil: { lte: params.now } }],
    },
    include: {
      builder: {
        select: {
          id: true,
          canonicalKey: true,
          sourceType: true,
        },
      },
    },
  });
  const activeQueueItems = await params.prisma.cloudFetchQueueItem.findMany({
    where: {
      cloudSourceTaskId: { in: tasks.map((task) => task.id) },
      status: { in: [CloudFetchQueueStatus.QUEUED, CloudFetchQueueStatus.LEASED] },
    },
    select: { cloudSourceTaskId: true },
  });
  const activeQueuedTaskIds = new Set(activeQueueItems.map((item) => item.cloudSourceTaskId));
  const canonicalActivityPolicy = await loadCanonicalActivityPolicy(params);
  const activeSubmissionCounts = await loadActiveSubmissionCounts(
    params.prisma,
    tasks.map((task) => task.builderId),
  );
  const orphanTaskIds = tasks
    .filter((task) => (activeSubmissionCounts.get(task.builderId) ?? 0) === 0)
    .map((task) => task.id);
  if (orphanTaskIds.length > 0) {
    await params.prisma.cloudSourceTask.updateMany({
      where: { id: { in: orphanTaskIds } },
      data: { status: "PAUSED" },
    });
    await cancelQueuedCloudFetchForTasks({
      prisma: params.prisma,
      taskIds: orphanTaskIds,
    });
  }

  return {
    activeCanonicalKeys: canonicalActivityPolicy.activeCanonicalKeys,
    tasks: tasks
      .filter(
        (task) =>
          !activeQueuedTaskIds.has(task.id) &&
          (activeSubmissionCounts.get(task.builderId) ?? 0) > 0 &&
          !canonicalActivityPolicy.blocksCandidate({
            canonicalKey: task.builder.canonicalKey,
            cloudSourceTaskId: task.id,
          }),
      )
      .map((task) => {
        const mustSucceedBy = task.mustSucceedBy ?? taskDeadline(task.effectiveFrequency, task.lastSuccessAt ?? params.now);
        // Work-conserving: a task is releasable as soon as its retry backoff has
        // elapsed (nextAttemptAt). The deadline drives PRIORITY (urgency), not
        // release time — so a fresh source (nextAttemptAt = now) is due now
        // instead of being parked until just before its first interval deadline.
        const releaseAt = maxDate(params.now, task.nextAttemptAt ?? params.now);
        const estimate = estimateCloudTaskRuntime({
          sourceType: task.builder.sourceType,
          durationP75Seconds: task.durationP75Seconds,
          durationP90Seconds: task.durationP90Seconds,
          durationSampleCount: task.durationSampleCount,
          successSampleCount: task.successSampleCount,
          estimatedSuccessProbability: task.estimatedSuccessProbability,
          config: params.config,
        });
        return {
          id: task.id,
          canonicalKey: task.builder.canonicalKey,
          sourceType: task.builder.sourceType,
          releaseAt,
          mustSucceedBy,
          estimatedDurationSeconds: task.estimatedDurationSeconds ?? estimate.estimatedDurationSeconds,
          estimatedTokenCost: task.estimatedTokenCost ?? estimate.estimatedTokenCost,
          estimatedPostYield: task.estimatedPostYield ?? estimate.estimatedPostYield,
          estimatedSuccessProbability:
            task.estimatedSuccessProbability ?? estimate.estimatedSuccessProbability,
          activeSubmissionCount: activeSubmissionCounts.get(task.builderId) ?? 0,
          consecutiveDeferrals: task.consecutiveDeferrals,
          consecutiveFailures: task.consecutiveFailures,
          circuitBreakerUntil: task.circuitBreakerUntil,
          lastDeferredAt: task.lastDeferredAt,
        };
      }),
  };
}

async function loadActiveSubmissionCounts(prisma: CloudSchedulerDb, builderIds: string[]) {
  if (builderIds.length === 0) return new Map<string, number>();
  const grouped = await prisma.cloudSourceSubmission.groupBy({
    by: ["cloudBuilderId"],
    where: { cloudBuilderId: { in: builderIds }, active: true },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.cloudBuilderId, row._count._all]));
}

async function loadCanonicalActivityPolicy(params: {
  prisma: CloudSchedulerDb;
  now: Date;
  config: CloudFetchConfigShape;
}) {
  const cooldownStartedAt = new Date(
    params.now.getTime() - params.config.canonicalCooldownMinutes * MINUTE_MS,
  );
  const [activeLeases, recentRuns] = await Promise.all([
    params.prisma.cloudFetchQueueItem.findMany({
      where: { status: CloudFetchQueueStatus.LEASED, leaseExpiresAt: { gt: params.now } },
      select: {
        cloudSourceTask: { select: { builder: { select: { canonicalKey: true } } } },
      },
    }),
    params.config.canonicalCooldownMinutes > 0
      ? params.prisma.cloudFetchRunTask.findMany({
          where: { startedAt: { gte: cooldownStartedAt } },
          select: {
            cloudSourceTaskId: true,
            status: true,
            builder: { select: { canonicalKey: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  return createCanonicalActivityPolicy({
    activeLeaseCanonicalKeys: activeLeases.map(
      (item) => item.cloudSourceTask.builder.canonicalKey,
    ),
    recentRuns: recentRuns.map((task) => ({
      canonicalKey: task.builder.canonicalKey,
      cloudSourceTaskId: task.cloudSourceTaskId,
      status: task.status,
    })),
  });
}

async function expireStaleCloudFetchLeases(params: { prisma: CloudSchedulerDb; now: Date }) {
  await expireLeasedCloudFetchRuns(params);
}

async function computeLeaseBudget(params: {
  prisma: CloudSchedulerDb;
  now: Date;
  config: CloudFetchConfigShape;
  requestedLimit: number;
}) {
  const oneHourAgo = new Date(params.now.getTime() - HOUR_MS);
  const [recentTasks, activeLeases] = await Promise.all([
    params.prisma.cloudFetchRunTask.findMany({
      where: { startedAt: { gte: oneHourAgo } },
      select: { usageTokens: true },
    }),
    params.prisma.cloudFetchQueueItem.findMany({
      where: { status: CloudFetchQueueStatus.LEASED, leaseExpiresAt: { gt: params.now } },
      select: {
        cloudSourceTask: {
          select: {
            estimatedTokenCost: true,
            builder: { select: { sourceType: true } },
          },
        },
      },
    }),
  ]);
  const recentUsageTokens = recentTasks.reduce(
    (sum, task) => sum + (task.usageTokens ?? 0),
    0,
  );
  const activeEstimatedTokens = activeLeases.reduce(
    (sum, item) => sum + estimatedTokensForTask(item.cloudSourceTask),
    0,
  );
  const tokenBudget = Math.max(0, params.config.tokenBudgetPerHour - recentUsageTokens - activeEstimatedTokens);
  return {
    limit: tokenBudget > 0 ? normalizedLeaseLimit(params.requestedLimit) : 0,
    tokenBudget,
    tokenBudgetPerHour: params.config.tokenBudgetPerHour,
    recentUsageTokens,
    activeEstimatedTokens,
  };
}

function estimatedDurationForTask(task: {
  estimatedDurationSeconds: number | null;
  durationP75Seconds: number | null;
  durationP90Seconds: number | null;
  durationSampleCount: number;
  successSampleCount: number;
  estimatedSuccessProbability: number | null;
  builder: { sourceType: string };
}, config: { durationColdStartBufferRatio: number }) {
  return task.estimatedDurationSeconds ??
    estimateCloudTaskRuntime({
      sourceType: task.builder.sourceType,
      durationP75Seconds: task.durationP75Seconds,
      durationP90Seconds: task.durationP90Seconds,
      durationSampleCount: task.durationSampleCount,
      successSampleCount: task.successSampleCount,
      estimatedSuccessProbability: task.estimatedSuccessProbability,
      config,
    }).estimatedDurationSeconds;
}

function estimatedTokensForTask(task: {
  estimatedTokenCost?: number | null;
  builder: { sourceType: string };
}) {
  return Math.max(
    MIN_ESTIMATED_TOKENS,
    task.estimatedTokenCost ?? sourceTypePrior(task.builder.sourceType).estimatedTokenCost,
  );
}

function queuedLeaseItemsWhere(
  now: Date,
  remainingTokens: number,
  excludedCanonicalKeys?: Set<string>,
  canonicalActivitySummary?: CanonicalActivitySummary,
): Prisma.CloudFetchQueueItemWhereInput {
  const excluded = [...(excludedCanonicalKeys ?? [])];
  return {
    status: CloudFetchQueueStatus.QUEUED,
    dueAt: { lte: now },
    cloudSourceTask: {
      is: {
        ...cloudSourceTaskFitWhere(remainingTokens),
        ...canonicalActivityTaskWhere(canonicalActivitySummary),
      },
    },
    ...(excluded.length > 0
      ? {
          NOT: {
            cloudSourceTask: {
              is: {
                builder: {
                  is: {
                    canonicalKey: { in: excluded },
                  },
                },
              },
            },
          },
        }
      : {}),
  };
}

function canonicalActivityTaskWhere(
  canonicalActivitySummary?: CanonicalActivitySummary,
): Prisma.CloudSourceTaskWhereInput {
  if (!canonicalActivitySummary) return {};
  const blockedCanonicalKeys = [...canonicalActivitySummary.blockedCanonicalKeys];
  const failedOnlyCandidates = canonicalActivitySummary.failedOnlyCandidates;
  if (blockedCanonicalKeys.length === 0 && failedOnlyCandidates.length === 0) return {};

  const excludedCanonicalKeys = [
    ...new Set([
      ...blockedCanonicalKeys,
      ...failedOnlyCandidates.map((candidate) => candidate.canonicalKey),
    ]),
  ];

  return {
    AND: [
      {
        OR: [
          ...failedOnlyCandidates.map((candidate) => ({
            id: candidate.cloudSourceTaskId,
            builder: {
              is: {
                canonicalKey: candidate.canonicalKey,
              },
            },
          })),
          {
            builder: {
              is: {
                canonicalKey: { notIn: excludedCanonicalKeys },
              },
            },
          },
        ],
      },
    ],
  };
}

function cloudSourceTaskFitWhere(remainingTokens: number): Prisma.CloudSourceTaskWhereInput {
  const nullEstimateSourceTypeFilters = sourceTypeFallbackFiltersForBudget(remainingTokens);
  return {
    OR: [
      { estimatedTokenCost: { lte: remainingTokens } },
      ...(nullEstimateSourceTypeFilters.length > 0
        ? [{
            estimatedTokenCost: null,
            builder: {
              is: {
                OR: nullEstimateSourceTypeFilters,
              },
            },
          }]
        : []),
    ],
  };
}

function sourceTypeFallbackFiltersForBudget(remainingTokens: number): Prisma.BuilderWhereInput[] {
  const sourceTypeFilters: Prisma.BuilderWhereInput[] = SOURCE_TYPE_PRIOR_KEYS_EXCLUDING_AUTO
    .filter((sourceType) => sourceTypePrior(sourceType).estimatedTokenCost <= remainingTokens)
    .map((sourceType) => ({
      sourceType: { equals: sourceType, mode: "insensitive" },
    }));
  if (SOURCE_TYPE_PRIORS.auto.estimatedTokenCost <= remainingTokens) {
    sourceTypeFilters.push({
      sourceType: {
        notIn: SOURCE_TYPE_PRIOR_KEYS_EXCLUDING_AUTO,
        mode: "insensitive",
      },
    });
  }
  return sourceTypeFilters;
}

function provisionalExecutionPlanForLease(params: {
  now: Date;
  mustSucceedBy: Date;
  sourceType: string;
  estimatedDurationSeconds: number;
}): CloudFetchExecutionPlan {
  const budget = cloudShardExecutionBudget({
    estimatedWorkSeconds: params.estimatedDurationSeconds,
    sourceType: params.sourceType,
  });
  return {
    mustSucceedBy: params.mustSucceedBy.toISOString(),
    estimatedDurationSeconds: params.estimatedDurationSeconds,
    provisionalExecutionBudgetSeconds: budget.executionBudgetSeconds,
    workloadClass: budget.workloadClass,
    budgetReason: budget.budgetReason,
    deadlineState: cloudDeadlineState({
      now: params.now,
      mustSucceedBy: params.mustSucceedBy,
      executionBudgetSeconds: budget.executionBudgetSeconds,
    }),
  };
}

function sourceTypePrior(sourceType: string) {
  return SOURCE_TYPE_PRIORS[sourceType.toLowerCase()] ?? SOURCE_TYPE_PRIORS.auto;
}

function normalizedLeaseLimit(limit: number) {
  if (!Number.isFinite(limit)) return DEFAULT_MATERIALIZE_LIMIT;
  return Math.max(0, Math.min(DEFAULT_MATERIALIZE_LIMIT, Math.floor(limit)));
}

function taskDeadline(frequency: CloudFetchFrequency, from: Date) {
  return new Date(from.getTime() + cloudFrequencyIntervalMs(frequency));
}

function maxDate(...dates: Date[]) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function isRecordNotFoundError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2025");
}

function objectDetails(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

async function getPrismaClient() {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}

// Cancel still-queued fetches for tasks that a submission change superseded.
// Only QUEUED items are cancelled; LEASED / in-flight runs are left to finish.
export async function cancelQueuedCloudFetchForTasks(params: {
  prisma: PrismaClient | CloudSchedulerDb;
  taskIds: string[];
}): Promise<{ cancelled: number }> {
  if (params.taskIds.length === 0) return { cancelled: 0 };
  const result = await params.prisma.cloudFetchQueueItem.updateMany({
    where: {
      cloudSourceTaskId: { in: params.taskIds },
      status: CloudFetchQueueStatus.QUEUED,
    },
    data: { status: CloudFetchQueueStatus.CANCELLED },
  });
  return { cancelled: result.count };
}
