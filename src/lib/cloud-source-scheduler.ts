import {
  CloudFetchQueueStatus,
  CloudFetchRunStatus,
  type CloudFetchFrequency,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

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
  const starvationTasks = due
    .filter((task) => task.consecutiveDeferrals > 0)
    .sort(compareStarvation)
    .slice(0, reservedStarvationCount);
  const reservedTaskIds = new Set(starvationTasks.map((task) => task.id));
  for (const task of starvationTasks) {
    currentBucket.tasks.push({ task, score: scoreTask(task, params.now), lane: "starvation" });
  }

  // Fill the remaining request budget by score, highest value/urgency first.
  const rest = due
    .filter((task) => !reservedTaskIds.has(task.id))
    .sort((a, b) => scoreTask(b, params.now) - scoreTask(a, params.now));
  for (const task of rest) {
    currentBucket.tasks.push({
      task,
      score: scoreTask(task, params.now),
      lane: task.consecutiveFailures > 0 ? "retry" : "normal",
    });
  }
  evictOverCapacity(currentBucket, params.config, params.requestedLimit, debug);

  for (const item of currentBucket.tasks) {
    debug.selected[item.task.id] = {
      lane: item.lane,
      bucketStart: currentBucket.start.toISOString(),
      score: item.score,
    };
  }
  // Due tasks that lost the current-hour budget competition are deferred so they
  // gain aging/starvation priority on the next poll.
  const selectedIds = new Set(currentBucket.tasks.map((item) => item.task.id));
  for (const task of due) {
    if (!selectedIds.has(task.id)) {
      debug.deferred[task.id] = debug.deferred[task.id] ?? { reason: "hour_budget_full" };
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
}) {
  const prisma = params.prisma ?? (await getPrismaClient());
  const now = params.now ?? new Date();
  const config = await loadCloudFetchConfig(prisma);
  await expireStaleCloudFetchLeases({ prisma, now });

  const budget = await computeLeaseBudget({ prisma, now, config, requestedLimit: params.limit });
  if (budget.limit <= 0) {
    return { status: "empty" as const, runId: null, tasks: [], budget };
  }
  await materializeDueCloudFetchQueue({
    prisma,
    now,
    limit: budget.limit,
    tokenBudgetRemaining: budget.tokenBudget,
  });

  const queuedItems = await prisma.cloudFetchQueueItem.findMany({
    where: { status: CloudFetchQueueStatus.QUEUED, dueAt: { lte: now } },
    orderBy: [{ priorityScore: "desc" }, { mustSucceedBy: "asc" }, { createdAt: "asc" }],
    take: Math.max(params.limit, budget.limit),
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

  const selected = [];
  let remainingTokens = budget.tokenBudget;
  for (const item of queuedItems) {
    if (selected.length >= budget.limit) break;
    const estimate = estimatedDurationForTask(item.cloudSourceTask, config);
    const estimatedTokens = estimatedTokensForTask(item.cloudSourceTask);
    if (estimatedTokens > remainingTokens) continue;
    selected.push({ item, estimate, estimatedTokens });
    remainingTokens -= estimatedTokens;
  }

  if (selected.length === 0) {
    return { status: "empty" as const, runId: null, tasks: [], budget };
  }

  const maxEstimatedDuration = Math.max(...selected.map((entry) => entry.estimate));
  const leaseExpiresAt = new Date(
    now.getTime() +
      Math.max(config.leaseTtlMinutes, Math.ceil(maxEstimatedDuration / 60) + 10) * MINUTE_MS,
  );
  const run = await prisma.cloudFetchRun.create({
    data: {
      leaseOwner: params.leaseOwner,
      requestedLimit: params.limit,
      tasksClaimed: selected.length,
      status: CloudFetchRunStatus.RUNNING,
    },
  });

  for (const { item, estimate } of selected) {
    await prisma.cloudFetchQueueItem.update({
      where: { id: item.id },
      data: {
        status: CloudFetchQueueStatus.LEASED,
        leasedAt: now,
        leaseExpiresAt,
        leaseOwner: params.leaseOwner,
        runId: run.id,
        attempts: { increment: 1 },
      },
    });
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
      },
    });
    await prisma.cloudSourceTask.update({
      where: { id: item.cloudSourceTaskId },
      data: { lastStartedAt: now, lastQueuedAt: now, lastRunId: run.id },
    });
  }

  return {
    status: "ok" as const,
    runId: run.id,
    tasks: selected.map(({ item, estimate }) => ({
      cloudSourceTaskId: item.cloudSourceTaskId,
      builderId: item.cloudSourceTask.builderId,
      summaryLanguage: item.cloudSourceTask.summaryLanguage,
      estimatedDurationSeconds: estimate,
      source: item.cloudSourceTask.builder,
    })),
    budget,
  };
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
  return aDeferred - bDeferred;
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

async function loadCloudFetchConfig(prisma: PrismaClient): Promise<CloudFetchConfigShape> {
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
  prisma: PrismaClient;
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
  const activeCanonicalKeys = await loadActiveCanonicalKeys(params);
  const activeSubmissionCounts = await loadActiveSubmissionCounts(
    params.prisma,
    tasks.map((task) => task.builderId),
  );

  return {
    activeCanonicalKeys,
    tasks: tasks
      .filter((task) => !activeQueuedTaskIds.has(task.id))
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
          activeSubmissionCount: activeSubmissionCounts.get(task.builderId) ?? 1,
          consecutiveDeferrals: task.consecutiveDeferrals,
          consecutiveFailures: task.consecutiveFailures,
          circuitBreakerUntil: task.circuitBreakerUntil,
          lastDeferredAt: task.lastDeferredAt,
        };
      }),
  };
}

async function loadActiveSubmissionCounts(prisma: PrismaClient, builderIds: string[]) {
  if (builderIds.length === 0) return new Map<string, number>();
  const grouped = await prisma.cloudSourceSubmission.groupBy({
    by: ["cloudBuilderId"],
    where: { cloudBuilderId: { in: builderIds }, active: true },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.cloudBuilderId, row._count._all]));
}

async function loadActiveCanonicalKeys(params: {
  prisma: PrismaClient;
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
          select: { builder: { select: { canonicalKey: true } } },
        })
      : Promise.resolve([]),
  ]);
  return new Set([
    ...activeLeases.map((item) => item.cloudSourceTask.builder.canonicalKey),
    ...recentRuns.map((task) => task.builder.canonicalKey),
  ]);
}

async function expireStaleCloudFetchLeases(params: { prisma: PrismaClient; now: Date }) {
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
}

async function computeLeaseBudget(params: {
  prisma: PrismaClient;
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
  prisma: PrismaClient;
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
