import assert from "node:assert/strict";
import test from "node:test";
import { CloudFetchQueueStatus } from "@prisma/client";

import {
  cancelQueuedCloudFetchForTasks,
  createCanonicalActivityPolicy,
  estimateCloudTaskRuntime,
  heartbeatCloudFetchRun,
  leaseCloudFetchTasks,
  materializeDueCloudFetchQueue,
  nextCloudTaskFailureSchedule,
  nextCloudTaskSuccessSchedule,
  planCloudFetchWindow,
  type CloudSchedulerTaskInput,
} from "../src/lib/cloud-source-scheduler";

const now = new Date("2026-06-27T12:00:00.000Z");
const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const resetFenceQuery = (
  query: string,
  lastResetAt = new Date(0),
  startedAt = now,
) => query.includes("clock_timestamp") ? [{ now: startedAt }] : [{ lastResetAt }];

const baseTask = (overrides: Partial<CloudSchedulerTaskInput>): CloudSchedulerTaskInput => ({
  id: overrides.id ?? "task",
  canonicalKey: overrides.canonicalKey ?? `BLOG:https://example.com/${overrides.id ?? "task"}`,
  sourceType: overrides.sourceType ?? "blog",
  releaseAt: overrides.releaseAt ?? now,
  mustSucceedBy: overrides.mustSucceedBy ?? minutesFromNow(60),
  estimatedDurationSeconds: overrides.estimatedDurationSeconds ?? 600,
  estimatedTokenCost: overrides.estimatedTokenCost ?? 100_000,
  estimatedPostYield: overrides.estimatedPostYield ?? 3,
  estimatedSuccessProbability: overrides.estimatedSuccessProbability ?? 0.9,
  activeSubmissionCount: overrides.activeSubmissionCount ?? 1,
  consecutiveDeferrals: overrides.consecutiveDeferrals ?? 0,
  consecutiveFailures: overrides.consecutiveFailures ?? 0,
  circuitBreakerUntil: overrides.circuitBreakerUntil,
});

type LeaseQueueFindManyArgs = {
  where?: Record<string, unknown>;
  cursor?: { id: string };
  include?: unknown;
  orderBy?: unknown;
  select?: unknown;
  skip?: number;
  take?: number;
};

function leaseTokenFitClauses(where: Record<string, unknown> | undefined) {
  const relation = where?.cloudSourceTask as
    | {
        is?: {
          OR?: Array<Record<string, unknown>>;
        };
      }
    | undefined;
  return relation?.is?.OR ?? [];
}

function hasEstimatedTokenCeiling(where: Record<string, unknown> | undefined, ceiling: number) {
  return leaseTokenFitClauses(where).some((clause) => {
    const estimatedTokenCost = clause.estimatedTokenCost as { lte?: number } | null | undefined;
    return estimatedTokenCost?.lte === ceiling;
  });
}

function nullFallbackSourceFilters(where: Record<string, unknown> | undefined) {
  const nullClause = leaseTokenFitClauses(where).find(
    (clause) => clause.estimatedTokenCost === null,
  ) as
    | {
        builder?: {
          is?: {
            OR?: Array<Record<string, unknown>>;
          };
        };
      }
    | undefined;
  return nullClause?.builder?.is?.OR ?? [];
}

function hasInsensitiveSourceType(
  filters: Array<Record<string, unknown>>,
  sourceType: string,
) {
  return filters.some((filter) => {
    const field = filter.sourceType as { equals?: string; mode?: string } | undefined;
    return field?.equals === sourceType && field.mode === "insensitive";
  });
}

function hasInsensitiveUnknownSourceFallback(filters: Array<Record<string, unknown>>) {
  return filters.some((filter) => {
    const field = filter.sourceType as { notIn?: string[]; mode?: string } | undefined;
    return Array.isArray(field?.notIn) && field.mode === "insensitive";
  });
}

function excludedCanonicalKeys(where: Record<string, unknown> | undefined) {
  const keys = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    const canonicalField = record.canonicalKey as
      | { in?: string[]; notIn?: string[] }
      | undefined;
    for (const key of canonicalField?.in ?? []) keys.add(key);
    for (const key of canonicalField?.notIn ?? []) keys.add(key);
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(where);
  return [...keys];
}

function allowedCanonicalActivityPairs(where: Record<string, unknown> | undefined) {
  const relation = where?.cloudSourceTask as
    | {
        is?: {
          AND?: Array<Record<string, unknown>>;
        };
      }
    | undefined;
  const pairs: Array<{ canonicalKey: string; cloudSourceTaskId: string }> = [];
  for (const clause of relation?.is?.AND ?? []) {
    const options = clause.OR;
    if (!Array.isArray(options)) continue;
    for (const option of options) {
      const cloudSourceTaskId = typeof option.id === "string" ? option.id : null;
      const canonicalKey = option.builder?.is?.canonicalKey;
      if (cloudSourceTaskId && typeof canonicalKey === "string") {
        pairs.push({ canonicalKey, cloudSourceTaskId });
      }
    }
  }
  return pairs;
}

test("scheduler pauses active tasks with no active submitters before queueing", async () => {
  const taskUpdates: unknown[] = [];
  const queueUpdates: unknown[] = [];
  let queueCreates = 0;
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: { findUnique: async () => null },
    cloudSourceTask: {
      findMany: async () => [
        {
          id: "orphan_task",
          builderId: "orphan_builder",
          effectiveFrequency: "DAILY",
          lastSuccessAt: null,
          mustSucceedBy: null,
          nextAttemptAt: null,
          estimatedDurationSeconds: null,
          estimatedTokenCost: null,
          estimatedPostYield: null,
          estimatedSuccessProbability: null,
          durationP75Seconds: null,
          durationP90Seconds: null,
          durationSampleCount: 0,
          successSampleCount: 0,
          consecutiveDeferrals: 0,
          consecutiveFailures: 0,
          circuitBreakerUntil: null,
          lastDeferredAt: null,
          builder: {
            id: "orphan_builder",
            canonicalKey: "BLOG:https://example.com/orphan",
            sourceType: "blog",
          },
        },
      ],
      updateMany: async (args: unknown) => {
        taskUpdates.push(args);
        return { count: 1 };
      },
    },
    cloudFetchQueueItem: {
      findMany: async () => [],
      updateMany: async (args: unknown) => {
        queueUpdates.push(args);
        return { count: 1 };
      },
      create: async () => {
        queueCreates += 1;
        return {};
      },
    },
    cloudFetchRunTask: { findMany: async () => [] },
    cloudSourceSubmission: { groupBy: async () => [] },
  };

  const result = await materializeDueCloudFetchQueue({
    prisma: prisma as never,
    now,
  });

  assert.equal(result.queued, 0);
  assert.equal(queueCreates, 0);
  assert.match(JSON.stringify(taskUpdates), /"status":"PAUSED"/);
  assert.match(JSON.stringify(queueUpdates), /"status":"CANCELLED"/);
});

test("a scheduler invocation that began before RESET cannot recreate queue state", async () => {
  let queueCreates = 0;
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) {
      return callback(this);
    },
    async $queryRawUnsafe(query: string) {
      return resetFenceQuery(query, new Date(now.getTime() + 1));
    },
    cloudFetchConfig: { findUnique: async () => null },
    cloudSourceTask: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    cloudFetchQueueItem: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      create: async () => { queueCreates += 1; return {}; },
    },
    cloudFetchRunTask: { findMany: async () => [] },
    cloudSourceSubmission: { groupBy: async () => [] },
  };

  await assert.rejects(
    materializeDueCloudFetchQueue({ prisma: prisma as never, now }),
    /started before the latest global reset/,
  );
  assert.equal(queueCreates, 0);
});

test("token-aware planning prefers higher-yield tasks under the hourly token budget", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 3,
    config: {
      tokenBudgetPerHour: 200_000,
      starvationReserveRatio: 0,
    },
    tasks: [
      baseTask({
        id: "expensive-low-yield",
        estimatedTokenCost: 200_000,
        estimatedSuccessProbability: 0.5,
      }),
      baseTask({ id: "efficient-a", estimatedTokenCost: 100_000, estimatedSuccessProbability: 0.95 }),
      baseTask({ id: "efficient-b", estimatedTokenCost: 100_000, estimatedSuccessProbability: 0.95 }),
    ],
  });

  assert.deepEqual(plan.currentHourTaskIds.sort(), ["efficient-a", "efficient-b"]);
  assert.equal(plan.debug.skipped["expensive-low-yield"]?.reason, "evicted_low_score");
});

test("token-aware planning scores expected synced posts, not just source count", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 1,
    config: {
      tokenBudgetPerHour: 100_000,
      starvationReserveRatio: 0,
    },
    tasks: [
      baseTask({
        id: "many-posts",
        estimatedTokenCost: 100_000,
        estimatedPostYield: 8,
        estimatedSuccessProbability: 0.8,
      }),
      baseTask({
        id: "one-post",
        estimatedTokenCost: 80_000,
        estimatedPostYield: 1,
        estimatedSuccessProbability: 0.99,
      }),
    ],
  });

  assert.deepEqual(plan.currentHourTaskIds, ["many-posts"]);
  assert.equal(plan.debug.skipped["one-post"]?.reason, "evicted_low_score");
});

test("starvation reserve admits an old deferred task before normal score-only candidates", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 4,
    config: {
      tokenBudgetPerHour: 500_000,
      starvationReserveRatio: 0.25,
    },
    tasks: [
      baseTask({
        id: "old-long",
        estimatedTokenCost: 200_000,
        estimatedSuccessProbability: 0.5,
        consecutiveDeferrals: 9,
        lastDeferredAt: minutesFromNow(-240),
      }),
      baseTask({ id: "short-a", estimatedTokenCost: 100_000 }),
      baseTask({ id: "short-b", estimatedTokenCost: 100_000 }),
      baseTask({ id: "short-c", estimatedTokenCost: 100_000 }),
      baseTask({ id: "short-d", estimatedTokenCost: 100_000 }),
    ],
  });

  assert.ok(plan.currentHourTaskIds.includes("old-long"));
  assert.equal(plan.debug.selected["old-long"]?.lane, "starvation");
  assert.equal(plan.currentHourTaskIds.length, 4);
});

test("planner excludes circuit-broken and active canonical source tasks", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 4,
    config: {
      tokenBudgetPerHour: 500_000,
      starvationReserveRatio: 0,
    },
    activeCanonicalKeys: new Set(["BLOG:https://example.com/live"]),
    tasks: [
      baseTask({ id: "healthy" }),
      baseTask({
        id: "broken",
        circuitBreakerUntil: minutesFromNow(30),
      }),
      baseTask({
        id: "same-source",
        canonicalKey: "BLOG:https://example.com/live",
      }),
    ],
  });

  assert.deepEqual(plan.currentHourTaskIds, ["healthy"]);
  assert.equal(plan.debug.skipped.broken?.reason, "circuit_breaker");
  assert.equal(plan.debug.skipped["same-source"]?.reason, "canonical_active");
});

test("canonical activity policy allows a lone same-task failed run but blocks sibling tasks on that canonical", () => {
  const canonicalKey = "BLOG:https://example.com/shared";
  const policy = createCanonicalActivityPolicy({
    recentRuns: [
      {
        canonicalKey,
        cloudSourceTaskId: "task_failed",
        status: "FAILED",
      },
    ],
  });

  assert.equal(
    policy.blocksCandidate({ canonicalKey, cloudSourceTaskId: "task_failed" }),
    false,
  );
  assert.equal(
    policy.blocksCandidate({ canonicalKey, cloudSourceTaskId: "task_sibling" }),
    true,
  );
});

test("canonical activity policy blocks same-task running, succeeded, and partial runs", () => {
  const canonicalKey = "BLOG:https://example.com/recent";

  for (const status of ["RUNNING", "SUCCEEDED", "PARTIAL"] as const) {
    const policy = createCanonicalActivityPolicy({
      recentRuns: [
        {
          canonicalKey,
          cloudSourceTaskId: "task_recent",
          status,
        },
      ],
    });

    assert.equal(
      policy.blocksCandidate({ canonicalKey, cloudSourceTaskId: "task_recent" }),
      true,
      `${status} should block the same task`,
    );
  }
});

test("canonical activity policy blocks all candidates once multiple failed task ids exist on one canonical", () => {
  const canonicalKey = "BLOG:https://example.com/shared-failures";
  const policy = createCanonicalActivityPolicy({
    recentRuns: [
      {
        canonicalKey,
        cloudSourceTaskId: "task_failed_a",
        status: "FAILED",
      },
      {
        canonicalKey,
        cloudSourceTaskId: "task_failed_b",
        status: "FAILED",
      },
    ],
  });

  assert.equal(
    policy.blocksCandidate({ canonicalKey, cloudSourceTaskId: "task_failed_a" }),
    true,
  );
  assert.equal(
    policy.blocksCandidate({ canonicalKey, cloudSourceTaskId: "task_failed_b" }),
    true,
  );
});

test("canonical activity policy keeps an active lease canonical globally blocked even when a lone failed run exists", () => {
  const canonicalKey = "BLOG:https://example.com/active-plus-failed";
  const policy = createCanonicalActivityPolicy({
    activeLeaseCanonicalKeys: [canonicalKey],
    recentRuns: [
      {
        canonicalKey,
        cloudSourceTaskId: "task_failed",
        status: "FAILED",
      },
    ],
  });

  assert.ok(policy.summary.blockedCanonicalKeys.has(canonicalKey));
  assert.deepEqual(policy.summary.failedOnlyCandidates, []);
  assert.equal(
    policy.blocksCandidate({ canonicalKey, cloudSourceTaskId: "task_failed" }),
    true,
  );
});

test("leaseCloudFetchTasks excludes canonicals with an existing active lease in its DB predicate", async () => {
  const blockedCanonical = "BLOG:https://example.com/already-leased";
  const leaseFindCalls: Array<{ where?: Record<string, unknown> }> = [];
  const blockedQueuedItem = {
    id: "queue_blocked_active_1",
    cloudSourceTaskId: "cloud_task_blocked_active_1",
    mustSucceedBy: minutesFromNow(20),
    createdAt: new Date("2026-06-27T11:00:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_blocked_active_1",
      builderId: "cloud_builder_blocked_active_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_blocked_active_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Blocked Active",
        handle: null,
        sourceUrl: "https://example.com/already-leased.xml",
        fetchUrl: "https://example.com/already-leased.xml",
        canonicalKey: blockedCanonical,
      },
    },
  };
  const eligibleQueuedItem = {
    id: "queue_eligible_after_active_1",
    cloudSourceTaskId: "cloud_task_eligible_after_active_1",
    mustSucceedBy: minutesFromNow(21),
    createdAt: new Date("2026-06-27T11:01:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_eligible_after_active_1",
      builderId: "cloud_builder_eligible_after_active_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_eligible_after_active_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Eligible After Active",
        handle: null,
        sourceUrl: "https://example.com/eligible-after-active.xml",
        fetchUrl: "https://example.com/eligible-after-active.xml",
        canonicalKey: "BLOG:https://example.com/eligible-after-active.xml",
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: {
      findUnique: async () => ({
        tokenBudgetPerHour: 200_000,
        starvationReserveRatio: 0,
        leaseTtlMinutes: 60,
        schedulingLeadMinutes: 120,
        retryBaseMinutes: 30,
        failureCircuitBreakerThreshold: 5,
        canonicalCooldownMinutes: 60,
        durationColdStartBufferRatio: 0.5,
      }),
    },
    cloudFetchQueueItem: {
      updateMany: async (args: { where?: { id?: string } }) => ({ count: args.where?.id ? 1 : 0 }),
      findMany: async (args: LeaseQueueFindManyArgs) => {
        if (args.select) {
          if (args.where?.status === CloudFetchQueueStatus.LEASED) {
            return [
              {
                cloudSourceTask: {
                  estimatedTokenCost: 100_000,
                  builder: {
                    canonicalKey: blockedCanonical,
                    sourceType: "blog",
                  },
                },
              },
            ];
          }
          return [];
        }
        if (!args.include) return [];
        leaseFindCalls.push({ where: args.where });
        return excludedCanonicalKeys(args.where).includes(blockedCanonical)
          ? [eligibleQueuedItem]
          : [blockedQueuedItem];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      findMany: async () => [],
      create: async () => ({}),
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_active_lease_filter_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async () => [],
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 1,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.tasks.map((task) => task.cloudSourceTaskId),
    ["cloud_task_eligible_after_active_1"],
  );
  assert.deepEqual(excludedCanonicalKeys(leaseFindCalls[0]?.where), [blockedCanonical]);
});

test("leaseCloudFetchTasks does not emit a lone-failed DB exception for a canonical that still has an active lease", async () => {
  const blockedCanonical = "BLOG:https://example.com/active-and-failed";
  const leaseFindCalls: Array<{ where?: Record<string, unknown> }> = [];
  const eligibleQueuedItem = {
    id: "queue_eligible_after_active_failed_1",
    cloudSourceTaskId: "cloud_task_eligible_after_active_failed_1",
    mustSucceedBy: minutesFromNow(21),
    createdAt: new Date("2026-06-27T11:01:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_eligible_after_active_failed_1",
      builderId: "cloud_builder_eligible_after_active_failed_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_eligible_after_active_failed_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Eligible After Active Failed",
        handle: null,
        sourceUrl: "https://example.com/eligible-after-active-failed.xml",
        fetchUrl: "https://example.com/eligible-after-active-failed.xml",
        canonicalKey: "BLOG:https://example.com/eligible-after-active-failed.xml",
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: {
      findUnique: async () => ({
        tokenBudgetPerHour: 200_000,
        starvationReserveRatio: 0,
        leaseTtlMinutes: 60,
        schedulingLeadMinutes: 120,
        retryBaseMinutes: 30,
        failureCircuitBreakerThreshold: 5,
        canonicalCooldownMinutes: 60,
        durationColdStartBufferRatio: 0.5,
      }),
    },
    cloudFetchQueueItem: {
      updateMany: async (args: { where?: { id?: string } }) => ({ count: args.where?.id ? 1 : 0 }),
      findMany: async (args: LeaseQueueFindManyArgs) => {
        if (args.select) {
          if (args.where?.status === CloudFetchQueueStatus.LEASED) {
            return [
              {
                cloudSourceTask: {
                  estimatedTokenCost: 100_000,
                  builder: {
                    canonicalKey: blockedCanonical,
                    sourceType: "blog",
                  },
                },
              },
            ];
          }
          return [];
        }
        if (!args.include) return [];
        leaseFindCalls.push({ where: args.where });
        return [eligibleQueuedItem];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      findMany: async () => [
        {
          cloudSourceTaskId: "cloud_task_retry_anchor_1",
          status: "FAILED",
          builder: { canonicalKey: blockedCanonical },
        },
      ],
      create: async () => ({}),
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_active_failed_filter_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async () => [],
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 1,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.tasks.map((task) => task.cloudSourceTaskId),
    ["cloud_task_eligible_after_active_failed_1"],
  );
  assert.deepEqual(excludedCanonicalKeys(leaseFindCalls[0]?.where), [blockedCanonical]);
  assert.deepEqual(allowedCanonicalActivityPairs(leaseFindCalls[0]?.where), []);
});

test("leaseCloudFetchTasks keeps a lone recent failed task leasable while blocking sibling canonicals in the DB predicate", async () => {
  const sharedCanonical = "BLOG:https://example.com/lone-failed";
  const leaseFindCalls: Array<{ where?: Record<string, unknown> }> = [];
  const sameTaskQueuedItem = {
    id: "queue_same_failed_1",
    cloudSourceTaskId: "cloud_task_same_failed_1",
    mustSucceedBy: minutesFromNow(20),
    createdAt: new Date("2026-06-27T11:00:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_same_failed_1",
      builderId: "cloud_builder_same_failed_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_same_failed_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Same Failed",
        handle: null,
        sourceUrl: "https://example.com/lone-failed.xml",
        fetchUrl: "https://example.com/lone-failed.xml",
        canonicalKey: sharedCanonical,
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: {
      findUnique: async () => ({
        tokenBudgetPerHour: 200_000,
        starvationReserveRatio: 0,
        leaseTtlMinutes: 60,
        schedulingLeadMinutes: 120,
        retryBaseMinutes: 30,
        failureCircuitBreakerThreshold: 5,
        canonicalCooldownMinutes: 60,
        durationColdStartBufferRatio: 0.5,
      }),
    },
    cloudFetchQueueItem: {
      updateMany: async (args: { where?: { id?: string } }) => ({ count: args.where?.id ? 1 : 0 }),
      findMany: async (args: LeaseQueueFindManyArgs) => {
        if (args.select) return [];
        if (!args.include) return [];
        leaseFindCalls.push({ where: args.where });
        return [sameTaskQueuedItem];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      findMany: async () => [
        {
          cloudSourceTaskId: "cloud_task_same_failed_1",
          status: "FAILED",
          builder: { canonicalKey: sharedCanonical },
        },
      ],
      create: async () => ({}),
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_same_failed_filter_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async () => [],
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 1,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.tasks.map((task) => task.cloudSourceTaskId),
    ["cloud_task_same_failed_1"],
  );
  assert.deepEqual(allowedCanonicalActivityPairs(leaseFindCalls[0]?.where), [
    {
      canonicalKey: sharedCanonical,
      cloudSourceTaskId: "cloud_task_same_failed_1",
    },
  ]);
});

test("leaseCloudFetchTasks blocks sibling queued rows after a recent failed run on the same canonical", async () => {
  const sharedCanonical = "BLOG:https://example.com/retry-only";
  const leaseFindCalls: Array<{ where?: Record<string, unknown> }> = [];
  const siblingQueuedItem = {
    id: "queue_failed_sibling_1",
    cloudSourceTaskId: "cloud_task_failed_sibling_1",
    mustSucceedBy: minutesFromNow(20),
    createdAt: new Date("2026-06-27T11:00:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_failed_sibling_1",
      builderId: "cloud_builder_failed_sibling_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_failed_sibling_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Failed Sibling",
        handle: null,
        sourceUrl: "https://example.com/retry-only.xml?alt=sibling",
        fetchUrl: "https://example.com/retry-only.xml?alt=sibling",
        canonicalKey: sharedCanonical,
      },
    },
  };
  const eligibleQueuedItem = {
    id: "queue_failed_unique_1",
    cloudSourceTaskId: "cloud_task_failed_unique_1",
    mustSucceedBy: minutesFromNow(21),
    createdAt: new Date("2026-06-27T11:01:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_failed_unique_1",
      builderId: "cloud_builder_failed_unique_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_failed_unique_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Eligible Unique",
        handle: null,
        sourceUrl: "https://example.com/failed-unique.xml",
        fetchUrl: "https://example.com/failed-unique.xml",
        canonicalKey: "BLOG:https://example.com/failed-unique.xml",
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: {
      findUnique: async () => ({
        tokenBudgetPerHour: 200_000,
        starvationReserveRatio: 0,
        leaseTtlMinutes: 60,
        schedulingLeadMinutes: 120,
        retryBaseMinutes: 30,
        failureCircuitBreakerThreshold: 5,
        canonicalCooldownMinutes: 60,
        durationColdStartBufferRatio: 0.5,
      }),
    },
    cloudFetchQueueItem: {
      updateMany: async (args: { where?: { id?: string } }) => ({ count: args.where?.id ? 1 : 0 }),
      findMany: async (args: LeaseQueueFindManyArgs) => {
        if (args.select) return [];
        if (!args.include) return [];
        leaseFindCalls.push({ where: args.where });
        return excludedCanonicalKeys(args.where).includes(sharedCanonical)
          ? [eligibleQueuedItem]
          : [siblingQueuedItem];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      findMany: async () => [
        {
          cloudSourceTaskId: "cloud_task_retry_anchor_1",
          status: "FAILED",
          builder: { canonicalKey: sharedCanonical },
        },
      ],
      create: async () => ({}),
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_failed_sibling_filter_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async () => [],
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 1,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.tasks.map((task) => task.cloudSourceTaskId),
    ["cloud_task_failed_unique_1"],
  );
  assert.ok(excludedCanonicalKeys(leaseFindCalls[0]?.where).includes(sharedCanonical));
});

for (const recentStatus of ["SUCCEEDED", "PARTIAL"] as const) {
  test(`leaseCloudFetchTasks blocks a recent ${recentStatus} task on the same canonical`, async () => {
    const sharedCanonical = `BLOG:https://example.com/recent-${recentStatus.toLowerCase()}`;
    const leaseFindCalls: Array<{ where?: Record<string, unknown> }> = [];
    const blockedQueuedItem = {
      id: `queue_${recentStatus.toLowerCase()}_blocked_1`,
      cloudSourceTaskId: `cloud_task_${recentStatus.toLowerCase()}_blocked_1`,
      mustSucceedBy: minutesFromNow(20),
      createdAt: new Date("2026-06-27T11:00:00.000Z"),
      cloudSourceTask: {
        id: `cloud_task_${recentStatus.toLowerCase()}_blocked_1`,
        builderId: `cloud_builder_${recentStatus.toLowerCase()}_blocked_1`,
        summaryLanguage: "en",
        estimatedDurationSeconds: 600,
        estimatedTokenCost: 100_000,
        durationP75Seconds: null,
        durationP90Seconds: null,
        durationSampleCount: 0,
        successSampleCount: 0,
        estimatedSuccessProbability: 0.9,
        builder: {
          id: `cloud_builder_${recentStatus.toLowerCase()}_blocked_1`,
          kind: "BLOG",
          sourceType: "blog",
          name: `Blocked ${recentStatus}`,
          handle: null,
          sourceUrl: `https://example.com/recent-${recentStatus.toLowerCase()}.xml`,
          fetchUrl: `https://example.com/recent-${recentStatus.toLowerCase()}.xml`,
          canonicalKey: sharedCanonical,
        },
      },
    };
    const eligibleQueuedItem = {
      id: `queue_${recentStatus.toLowerCase()}_eligible_1`,
      cloudSourceTaskId: `cloud_task_${recentStatus.toLowerCase()}_eligible_1`,
      mustSucceedBy: minutesFromNow(21),
      createdAt: new Date("2026-06-27T11:01:00.000Z"),
      cloudSourceTask: {
        id: `cloud_task_${recentStatus.toLowerCase()}_eligible_1`,
        builderId: `cloud_builder_${recentStatus.toLowerCase()}_eligible_1`,
        summaryLanguage: "en",
        estimatedDurationSeconds: 600,
        estimatedTokenCost: 100_000,
        durationP75Seconds: null,
        durationP90Seconds: null,
        durationSampleCount: 0,
        successSampleCount: 0,
        estimatedSuccessProbability: 0.9,
        builder: {
          id: `cloud_builder_${recentStatus.toLowerCase()}_eligible_1`,
          kind: "BLOG",
          sourceType: "blog",
          name: `Eligible ${recentStatus}`,
          handle: null,
          sourceUrl: `https://example.com/eligible-${recentStatus.toLowerCase()}.xml`,
          fetchUrl: `https://example.com/eligible-${recentStatus.toLowerCase()}.xml`,
          canonicalKey: `BLOG:https://example.com/eligible-${recentStatus.toLowerCase()}.xml`,
        },
      },
    };
    const prisma = {
      async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
      async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
      cloudFetchConfig: {
        findUnique: async () => ({
          tokenBudgetPerHour: 200_000,
          starvationReserveRatio: 0,
          leaseTtlMinutes: 60,
          schedulingLeadMinutes: 120,
          retryBaseMinutes: 30,
          failureCircuitBreakerThreshold: 5,
          canonicalCooldownMinutes: 60,
          durationColdStartBufferRatio: 0.5,
        }),
      },
      cloudFetchQueueItem: {
        updateMany: async (args: { where?: { id?: string } }) => ({ count: args.where?.id ? 1 : 0 }),
        findMany: async (args: LeaseQueueFindManyArgs) => {
          if (args.select) return [];
          if (!args.include) return [];
          leaseFindCalls.push({ where: args.where });
          return excludedCanonicalKeys(args.where).includes(sharedCanonical)
            ? [eligibleQueuedItem]
            : [blockedQueuedItem];
        },
        count: async () => 0,
        create: async () => ({}),
      },
      cloudSourceTask: {
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
        update: async () => ({}),
      },
      cloudFetchRunTask: {
        findMany: async () => [
          {
            cloudSourceTaskId: `cloud_task_${recentStatus.toLowerCase()}_blocked_1`,
            status: recentStatus,
            builder: { canonicalKey: sharedCanonical },
          },
        ],
        create: async () => ({}),
      },
      cloudSourceSubmission: { groupBy: async () => [] },
      cloudFetchRun: {
        create: async (args: { data: Record<string, unknown> }) => ({
          id: `run_cloud_recent_${recentStatus.toLowerCase()}_filter_1`,
          ...args.data,
        }),
      },
      feedItem: {
        findMany: async () => [],
      },
    };

    const result = await leaseCloudFetchTasks({
      prisma: prisma as never,
      now,
      limit: 1,
      leaseOwner: "local-cloud-runner:test",
    });

    assert.equal(result.status, "ok");
    assert.deepEqual(
      result.tasks.map((task) => task.cloudSourceTaskId),
      [`cloud_task_${recentStatus.toLowerCase()}_eligible_1`],
    );
    assert.ok(excludedCanonicalKeys(leaseFindCalls[0]?.where).includes(sharedCanonical));
  });
}

test("planner selects at most one due task per canonical key and defers siblings as canonical_selected", () => {
  const sharedCanonical = "BLOG:https://example.com/shared";
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 4,
    config: {
      tokenBudgetPerHour: 500_000,
      starvationReserveRatio: 0,
    },
    tasks: [
      baseTask({
        id: "shared-normal",
        canonicalKey: sharedCanonical,
        estimatedPostYield: 6,
        estimatedSuccessProbability: 0.95,
      }),
      baseTask({
        id: "shared-retry",
        canonicalKey: sharedCanonical,
        consecutiveFailures: 1,
        estimatedPostYield: 1,
        estimatedSuccessProbability: 0.5,
      }),
      baseTask({ id: "other-a" }),
      baseTask({ id: "other-b" }),
    ],
  });

  assert.deepEqual(plan.currentHourTaskIds.sort(), ["other-a", "other-b", "shared-normal"]);
  assert.equal(plan.debug.selected["shared-normal"]?.lane, "normal");
  assert.equal(plan.debug.deferred["shared-retry"]?.reason, "canonical_selected");
});

test("starvation reserve fills unique canonical slots before normal lane selection", () => {
  const sharedCanonical = "BLOG:https://example.com/starved-shared";
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 4,
    config: {
      tokenBudgetPerHour: 400_000,
      starvationReserveRatio: 0.5,
    },
    tasks: [
      baseTask({
        id: "shared-starved-1",
        canonicalKey: sharedCanonical,
        consecutiveDeferrals: 10,
        lastDeferredAt: minutesFromNow(-300),
      }),
      baseTask({
        id: "shared-starved-2",
        canonicalKey: sharedCanonical,
        consecutiveDeferrals: 9,
        lastDeferredAt: minutesFromNow(-290),
      }),
      baseTask({
        id: "unique-starved",
        canonicalKey: "BLOG:https://example.com/starved-unique",
        consecutiveDeferrals: 8,
        lastDeferredAt: minutesFromNow(-280),
      }),
      baseTask({
        id: "normal-a",
        canonicalKey: "BLOG:https://example.com/normal-a",
      }),
      baseTask({
        id: "normal-b",
        canonicalKey: "BLOG:https://example.com/normal-b",
      }),
    ],
  });

  assert.ok(plan.currentHourTaskIds.includes("shared-starved-1"));
  assert.ok(plan.currentHourTaskIds.includes("unique-starved"));
  assert.ok(plan.currentHourTaskIds.includes("normal-a"));
  assert.ok(plan.currentHourTaskIds.includes("normal-b"));
  assert.equal(plan.debug.selected["shared-starved-1"]?.lane, "starvation");
  assert.equal(plan.debug.selected["unique-starved"]?.lane, "starvation");
  assert.equal(plan.debug.deferred["shared-starved-2"]?.reason, "canonical_selected");
});

test("planner backfills freed capacity after eviction with an unrepresented canonical candidate", () => {
  const sharedCanonical = "BLOG:https://example.com/shared-eviction";
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 2,
    config: {
      tokenBudgetPerHour: 100_000,
      starvationReserveRatio: 0.5,
    },
    tasks: [
      baseTask({
        id: "shared-starved-expensive",
        canonicalKey: sharedCanonical,
        estimatedTokenCost: 150_000,
        consecutiveDeferrals: 10,
        lastDeferredAt: minutesFromNow(-300),
      }),
      baseTask({
        id: "shared-cheap",
        canonicalKey: sharedCanonical,
        estimatedTokenCost: 50_000,
        estimatedPostYield: 6,
        estimatedSuccessProbability: 0.95,
      }),
      baseTask({
        id: "other-cheap",
        canonicalKey: "BLOG:https://example.com/other-cheap",
        estimatedTokenCost: 50_000,
        estimatedPostYield: 5,
        estimatedSuccessProbability: 0.9,
      }),
    ],
  });

  assert.deepEqual(plan.currentHourTaskIds.sort(), ["other-cheap", "shared-cheap"]);
  assert.equal(plan.debug.selected["shared-cheap"]?.lane, "normal");
  assert.equal(plan.debug.deferred["shared-starved-expensive"]?.reason, "canonical_selected");
});

test("runtime estimate uses conservative source priors while history is sparse", () => {
  const estimate = estimateCloudTaskRuntime({
    sourceType: "podcast",
    durationP75Seconds: 700,
    durationP90Seconds: 900,
    durationSampleCount: 1,
    successSampleCount: 0,
    estimatedSuccessProbability: null,
    config: { durationColdStartBufferRatio: 0.5 },
  });

  assert.equal(estimate.estimatedDurationSeconds, 2_700);
  assert.equal(estimate.estimatedSuccessProbability, 0.75);
});

test("successful task update resets failures and schedules the next deadline window", () => {
  const update = nextCloudTaskSuccessSchedule({
    now,
    effectiveFrequency: "DAILY",
    schedulingLeadMinutes: 120,
  });

  assert.equal(update.lastSuccessAt.toISOString(), now.toISOString());
  assert.equal(update.consecutiveFailures, 0);
  assert.equal(update.consecutiveDeferrals, 0);
  assert.equal(update.mustSucceedBy.toISOString(), "2026-06-28T12:00:00.000Z");
  assert.equal(update.nextAttemptAt.toISOString(), "2026-06-28T10:00:00.000Z");
});

test("failed task update applies exponential backoff and circuit breaker threshold", () => {
  const update = nextCloudTaskFailureSchedule({
    now,
    previousConsecutiveFailures: 4,
    retryBaseMinutes: 30,
    failureCircuitBreakerThreshold: 5,
    failureReason: "source unavailable",
  });

  assert.equal(update.lastFailureAt.toISOString(), now.toISOString());
  assert.equal(update.consecutiveFailures, 5);
  assert.equal(update.nextAttemptAt.toISOString(), "2026-06-27T20:00:00.000Z");
  assert.equal(update.circuitBreakerUntil?.toISOString(), "2026-06-28T20:00:00.000Z");
  assert.equal(update.circuitBreakerReason, "source unavailable");
});

test("cloud fetch heartbeat extends active leases for a running cloud run", async () => {
  const queueUpdates: unknown[] = [];
  const runUpdates: unknown[] = [];
  const prisma = {
    cloudFetchConfig: {
      findUnique: async () => ({ leaseTtlMinutes: 15 }),
    },
    cloudFetchQueueItem: {
      updateMany: async (args: unknown) => {
        queueUpdates.push(args);
        return { count: 2 };
      },
    },
    cloudFetchRun: {
      findUnique: async () => ({
        id: "run_cloud_1",
        details: { heartbeatCount: 2 },
      }),
      update: async (args: unknown) => {
        runUpdates.push(args);
        return null;
      },
    },
  };

  const result = await heartbeatCloudFetchRun({
    prisma: prisma as never,
    now,
    runId: "run_cloud_1",
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.extendedLeases, 2);
  assert.equal(result.leaseExpiresAt, "2026-06-27T12:15:00.000Z");
  assert.deepEqual(queueUpdates[0], {
    where: {
      runId: "run_cloud_1",
      leaseOwner: "local-cloud-runner:test",
      status: "LEASED",
      // Heartbeats only extend: rows whose lease already runs past the new
      // expiry are left untouched so a long task's lease is never clawed back.
      leaseExpiresAt: { lt: new Date("2026-06-27T12:15:00.000Z") },
    },
    data: {
      leaseExpiresAt: new Date("2026-06-27T12:15:00.000Z"),
    },
  });
  assert.deepEqual(runUpdates[0], {
    where: { id: "run_cloud_1" },
    data: {
      details: {
        heartbeatAt: "2026-06-27T12:00:00.000Z",
        heartbeatCount: 3,
        leaseExpiresAt: "2026-06-27T12:15:00.000Z",
      },
    },
  });
});

test("cancelQueuedCloudFetchForTasks cancels only queued items for the given tasks", async () => {
  const calls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const prisma = {
    cloudFetchQueueItem: {
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        calls.push(args);
        return { count: 2 };
      },
    },
  };

  const result = await cancelQueuedCloudFetchForTasks({
    prisma: prisma as never,
    taskIds: ["task_a", "task_b"],
  });

  assert.equal(result.cancelled, 2);
  assert.deepEqual(calls[0].where.cloudSourceTaskId, { in: ["task_a", "task_b"] });
  assert.equal(calls[0].where.status, "QUEUED");
  assert.equal(calls[0].data.status, "CANCELLED");
});

test("cancelQueuedCloudFetchForTasks no-ops on an empty task list", async () => {
  let called = false;
  const prisma = {
    cloudFetchQueueItem: {
      async updateMany() {
        called = true;
        return { count: 0 };
      },
    },
  };

  const result = await cancelQueuedCloudFetchForTasks({
    prisma: prisma as never,
    taskIds: [],
  });

  assert.equal(result.cancelled, 0);
  assert.equal(called, false);
});

test("leaseCloudFetchTasks skips lease batch history when nothing is due", async () => {
  const createdRuns: { data: Record<string, unknown> }[] = [];
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: { findUnique: async () => null },
    cloudFetchQueueItem: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [],
      count: async () => 0,
      create: async () => ({}),
      update: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: { findMany: async () => [] },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => {
        createdRuns.push(args);
        return { id: "run_empty_1", ...args.data };
      },
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 2,
    leaseOwner: "local-cloud-runner:test",
  });

  // The lease reports empty, but no lease batch is recorded because a worker
  // session can ask repeatedly and empty asks are heartbeat/progress events.
  assert.equal(result.status, "empty");
  assert.equal(result.runId, null);
  assert.deepEqual(result.tasks, []);
  assert.equal(createdRuns.length, 0);
});

test("materializeDueCloudFetchQueue allows same-task failed reruns but blocks sibling, success, and partial recent runs", async () => {
  const queueCreates: Array<{ data: { cloudSourceTaskId: string } }> = [];
  const taskUpdates: unknown[] = [];
  const sharedCanonical = "BLOG:https://example.com/shared.xml";
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: { findUnique: async () => null },
    cloudSourceTask: {
      findMany: async () => [
        {
          id: "task_failed_same",
          builderId: "builder_failed_same",
          effectiveFrequency: "DAILY",
          lastSuccessAt: null,
          mustSucceedBy: null,
          nextAttemptAt: null,
          estimatedDurationSeconds: null,
          estimatedTokenCost: null,
          estimatedPostYield: null,
          estimatedSuccessProbability: null,
          durationP75Seconds: null,
          durationP90Seconds: null,
          durationSampleCount: 0,
          successSampleCount: 0,
          consecutiveDeferrals: 0,
          consecutiveFailures: 1,
          circuitBreakerUntil: null,
          lastDeferredAt: null,
          builder: {
            id: "builder_failed_same",
            canonicalKey: sharedCanonical,
            sourceType: "blog",
          },
        },
        {
          id: "task_failed_sibling",
          builderId: "builder_failed_sibling",
          effectiveFrequency: "DAILY",
          lastSuccessAt: null,
          mustSucceedBy: null,
          nextAttemptAt: null,
          estimatedDurationSeconds: null,
          estimatedTokenCost: null,
          estimatedPostYield: null,
          estimatedSuccessProbability: null,
          durationP75Seconds: null,
          durationP90Seconds: null,
          durationSampleCount: 0,
          successSampleCount: 0,
          consecutiveDeferrals: 0,
          consecutiveFailures: 0,
          circuitBreakerUntil: null,
          lastDeferredAt: null,
          builder: {
            id: "builder_failed_sibling",
            canonicalKey: sharedCanonical,
            sourceType: "blog",
          },
        },
        {
          id: "task_success",
          builderId: "builder_success",
          effectiveFrequency: "DAILY",
          lastSuccessAt: null,
          mustSucceedBy: null,
          nextAttemptAt: null,
          estimatedDurationSeconds: null,
          estimatedTokenCost: null,
          estimatedPostYield: null,
          estimatedSuccessProbability: null,
          durationP75Seconds: null,
          durationP90Seconds: null,
          durationSampleCount: 0,
          successSampleCount: 0,
          consecutiveDeferrals: 0,
          consecutiveFailures: 0,
          circuitBreakerUntil: null,
          lastDeferredAt: null,
          builder: {
            id: "builder_success",
            canonicalKey: "BLOG:https://example.com/success.xml",
            sourceType: "blog",
          },
        },
        {
          id: "task_partial",
          builderId: "builder_partial",
          effectiveFrequency: "DAILY",
          lastSuccessAt: null,
          mustSucceedBy: null,
          nextAttemptAt: null,
          estimatedDurationSeconds: null,
          estimatedTokenCost: null,
          estimatedPostYield: null,
          estimatedSuccessProbability: null,
          durationP75Seconds: null,
          durationP90Seconds: null,
          durationSampleCount: 0,
          successSampleCount: 0,
          consecutiveDeferrals: 0,
          consecutiveFailures: 0,
          circuitBreakerUntil: null,
          lastDeferredAt: null,
          builder: {
            id: "builder_partial",
            canonicalKey: "BLOG:https://example.com/partial.xml",
            sourceType: "blog",
          },
        },
      ],
      updateMany: async (args: unknown) => {
        taskUpdates.push(args);
        return { count: 0 };
      },
    },
    cloudFetchQueueItem: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      create: async (args: { data: { cloudSourceTaskId: string } }) => {
        queueCreates.push(args);
        return {};
      },
    },
    cloudFetchRunTask: {
      findMany: async () => [
        {
          cloudSourceTaskId: "task_failed_same",
          status: "FAILED",
          builder: { canonicalKey: sharedCanonical },
        },
        {
          cloudSourceTaskId: "task_success",
          status: "SUCCEEDED",
          builder: { canonicalKey: "BLOG:https://example.com/success.xml" },
        },
        {
          cloudSourceTaskId: "task_partial",
          status: "PARTIAL",
          builder: { canonicalKey: "BLOG:https://example.com/partial.xml" },
        },
      ],
    },
    cloudSourceSubmission: {
      groupBy: async () => [
        { cloudBuilderId: "builder_failed_same", _count: { _all: 1 } },
        { cloudBuilderId: "builder_failed_sibling", _count: { _all: 1 } },
        { cloudBuilderId: "builder_success", _count: { _all: 1 } },
        { cloudBuilderId: "builder_partial", _count: { _all: 1 } },
      ],
    },
  };

  const result = await materializeDueCloudFetchQueue({
    prisma: prisma as never,
    now,
    limit: 10,
  });

  assert.equal(result.queued, 1);
  assert.deepEqual(
    queueCreates.map((item) => item.data.cloudSourceTaskId),
    ["task_failed_same"],
  );
  assert.equal(taskUpdates.length, 0);
});

test("leaseCloudFetchTasks marks expired leased run tasks failed before requeueing", async () => {
  const queueUpdates: unknown[] = [];
  const runTaskUpdates: unknown[] = [];
  const events: string[] = [];
  const runUpdates: unknown[] = [];
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: { findUnique: async () => null },
    cloudFetchQueueItem: {
      updateMany: async (args: unknown) => {
        events.push("queue");
        queueUpdates.push(args);
        return { count: 1 };
      },
      findMany: async (args: { where?: Record<string, unknown>; include?: unknown; select?: unknown }) => {
        if (
          args.where?.status === "LEASED" &&
          args.where?.leaseExpiresAt &&
          args.select &&
          "runId" in (args.select as Record<string, unknown>)
        ) {
          return [{ runId: "run_expired_1", cloudSourceTaskId: "cloud_task_1" }];
        }
        return [];
      },
      count: async () => 0,
      create: async () => ({}),
      update: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      updateMany: async (args: unknown) => {
        events.push("runTask");
        runTaskUpdates.push(args);
        return { count: 1 };
      },
      findMany: async (args: { where?: Record<string, unknown> }) => {
        if (args.where?.runId === "run_expired_1") {
          return [
            { status: "FAILED", usageTokens: null, usageCostUsd: null },
          ];
        }
        return [];
      },
      create: async () => ({}),
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_new_1",
        ...args.data,
      }),
      update: async (args: unknown) => {
        runUpdates.push(args);
        return {};
      },
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 2,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "empty");
  assert.deepEqual(runTaskUpdates[0], {
    where: {
      runId: "run_expired_1",
      cloudSourceTaskId: "cloud_task_1",
      status: "RUNNING",
    },
    data: {
      status: "FAILED",
      finishedAt: now,
      failureReason: "cloud_lease_expired",
    },
  });
  assert.deepEqual(runUpdates[0], {
    where: { id: "run_expired_1" },
    data: {
      status: "FAILED",
      tasksSucceeded: 0,
      tasksFailed: 1,
      usageTokens: null,
      usageCostUsd: null,
      finishedAt: now,
    },
  });
  assert.deepEqual(events, ["runTask", "queue"]);
  assert.equal(queueUpdates.length, 1);
  assert.deepEqual(queueUpdates[0], {
    where: {
      runId: "run_expired_1",
      cloudSourceTaskId: "cloud_task_1",
      status: "LEASED",
      leaseExpiresAt: { lt: now },
    },
    data: {
      status: "QUEUED",
      leasedAt: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      runId: null,
    },
  });
});

test("leaseCloudFetchTasks does not requeue an expired lease after the run task already finalized", async () => {
  const queueUpdates: unknown[] = [];
  const runTaskUpdates: unknown[] = [];
  const runUpdates: unknown[] = [];
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: { findUnique: async () => null },
    cloudFetchQueueItem: {
      updateMany: async (args: unknown) => {
        queueUpdates.push(args);
        return { count: 1 };
      },
      findMany: async (args: { where?: Record<string, unknown>; include?: unknown; select?: unknown }) => {
        if (
          args.where?.status === "LEASED" &&
          args.where?.leaseExpiresAt &&
          args.select &&
          "runId" in (args.select as Record<string, unknown>)
        ) {
          return [{ runId: "run_expired_2", cloudSourceTaskId: "cloud_task_2" }];
        }
        return [];
      },
      count: async () => 0,
      create: async () => ({}),
      update: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      updateMany: async (args: unknown) => {
        runTaskUpdates.push(args);
        return { count: 0 };
      },
      findMany: async () => [],
      create: async () => ({}),
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_new_2",
        ...args.data,
      }),
      update: async (args: unknown) => {
        runUpdates.push(args);
        return {};
      },
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 2,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "empty");
  assert.equal(runTaskUpdates.length, 1);
  assert.equal(queueUpdates.length, 0);
  assert.equal(runUpdates.length, 0);
});

test("leaseCloudFetchTasks returns fetched post keys for leased cloud builders", async () => {
  const feedFindCalls: unknown[] = [];
  const queueUpdates: unknown[] = [];
  const runTaskCreates: unknown[] = [];
  const sourceTaskUpdates: unknown[] = [];
  const queuedItem = {
    id: "queue_1",
    cloudSourceTaskId: "cloud_task_zh",
    mustSucceedBy: minutesFromNow(60),
    cloudSourceTask: {
      id: "cloud_task_zh",
      builderId: "cloud_builder_zh",
      summaryLanguage: "zh",
      estimatedDurationSeconds: 300,
      estimatedTokenCost: 50_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_zh",
        kind: "BLOG",
        sourceType: "blog",
        name: "Cloud Source",
        handle: null,
        sourceUrl: "https://example.com/feed.xml",
        fetchUrl: "https://example.com/feed.xml",
        canonicalKey: "BLOG:https://example.com/feed.xml",
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: { findUnique: async () => null },
    cloudFetchQueueItem: {
      // The claim is a status-guarded updateMany({ where: { id, status: QUEUED } });
      // other updateMany calls (expiry requeue) carry no id and stay no-ops here.
      updateMany: async (args: { where?: { id?: unknown } }) => {
        if (args.where?.id) {
          queueUpdates.push(args);
          return { count: 1 };
        }
        return { count: 0 };
      },
      findMany: async (args: { include?: unknown }) => {
        if (args.include) return [queuedItem];
        return [];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async (args: unknown) => {
        sourceTaskUpdates.push(args);
        return {};
      },
    },
    cloudFetchRunTask: {
      findMany: async () => [],
      create: async (args: unknown) => {
        runTaskCreates.push(args);
        return {};
      },
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async (args: unknown) => {
        feedFindCalls.push(args);
        return [
          {
            builderId: "cloud_builder_zh",
            kind: "BLOG_POST",
            externalId: "https://example.com/post-1",
            publishedAt: new Date("2026-06-27T11:00:00.000Z"),
            createdAt: new Date("2026-06-27T11:05:00.000Z"),
          },
        ];
      },
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 1,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.runId, "run_cloud_1");
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.tasks[0].fetchedItems, [
    {
      builderId: "cloud_builder_zh",
      kind: "BLOG_POST",
      externalId: "https://example.com/post-1",
      publishedAt: new Date("2026-06-27T11:00:00.000Z"),
      createdAt: new Date("2026-06-27T11:05:00.000Z"),
    },
  ]);
  assert.deepEqual((feedFindCalls[0] as { where: unknown }).where, {
    builderId: { in: ["cloud_builder_zh"] },
  });
  assert.equal(queueUpdates.length, 1);
  assert.equal(runTaskCreates.length, 1);
  assert.equal(sourceTaskUpdates.length, 1);
});

test("leaseCloudFetchTasks skips a very large over-budget prefix in the DB and leases a later fitting task", async () => {
  const leaseFindCalls: Array<{
    where?: Record<string, unknown>;
    cursor?: { id: string };
    orderBy?: unknown;
    skip?: number;
    take?: number;
  }> = [];
  const queueUpdates: Array<{ where?: { id?: string } }> = [];
  const runTaskCreates: Array<{ data: { cloudSourceTaskId: string } }> = [];
  const expensiveQueuedItem = {
    id: "queue_expensive_1",
    cloudSourceTaskId: "cloud_task_expensive_1",
    mustSucceedBy: minutesFromNow(30),
    createdAt: new Date("2026-06-27T11:00:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_expensive_1",
      builderId: "cloud_builder_expensive_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 200_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_expensive_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Expensive Source",
        handle: null,
        sourceUrl: "https://example.com/expensive.xml",
        fetchUrl: "https://example.com/expensive.xml",
        canonicalKey: "BLOG:https://example.com/expensive.xml",
      },
    },
  };
  const cheapQueuedItem = {
    id: "queue_cheap_1",
    cloudSourceTaskId: "cloud_task_cheap_1",
    mustSucceedBy: minutesFromNow(31),
    createdAt: new Date("2026-06-27T11:01:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_cheap_1",
      builderId: "cloud_builder_cheap_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_cheap_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Cheap Source",
        handle: null,
        sourceUrl: "https://example.com/cheap.xml",
        fetchUrl: "https://example.com/cheap.xml",
        canonicalKey: "BLOG:https://example.com/cheap.xml",
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: {
      findUnique: async () => ({
        tokenBudgetPerHour: 150_000,
        starvationReserveRatio: 0,
        leaseTtlMinutes: 60,
        schedulingLeadMinutes: 120,
        retryBaseMinutes: 30,
        failureCircuitBreakerThreshold: 5,
        canonicalCooldownMinutes: 0,
        durationColdStartBufferRatio: 0.5,
      }),
    },
    cloudFetchQueueItem: {
      updateMany: async (args: { where?: { id?: string } }) => {
        if (args.where?.id) {
          queueUpdates.push(args);
          return { count: 1 };
        }
        return { count: 0 };
      },
      findMany: async (args: LeaseQueueFindManyArgs) => {
        if (args.select) return [];
        if (!args.include) return [];
        leaseFindCalls.push({
          where: args.where,
          cursor: args.cursor,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
        });
        return hasEstimatedTokenCeiling(args.where, 150_000) ? [cheapQueuedItem] : [expensiveQueuedItem];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      findMany: async () => [],
      create: async (args: { data: { cloudSourceTaskId: string } }) => {
        runTaskCreates.push(args);
        return {};
      },
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_paginated_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async () => [],
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 1,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.runId, "run_cloud_paginated_1");
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].cloudSourceTaskId, "cloud_task_cheap_1");
  assert.equal(queueUpdates.length, 1);
  assert.equal(queueUpdates[0]?.where?.id, "queue_cheap_1");
  assert.equal(runTaskCreates.length, 1);
  assert.equal(runTaskCreates[0]?.data.cloudSourceTaskId, "cloud_task_cheap_1");
  assert.equal(leaseFindCalls.length, 1);
  assert.deepEqual(leaseFindCalls[0], {
    where: leaseFindCalls[0]?.where,
    cursor: undefined,
    orderBy: [
      { priorityScore: "desc" },
      { mustSucceedBy: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    skip: undefined,
    take: 1,
  });
  assert.ok(hasEstimatedTokenCeiling(leaseFindCalls[0]?.where, 150_000));
  const fallbackFilters = nullFallbackSourceFilters(leaseFindCalls[0]?.where);
  assert.ok(hasInsensitiveSourceType(fallbackFilters, "blog"));
  assert.ok(!hasInsensitiveSourceType(fallbackFilters, "podcast"));
  assert.ok(hasInsensitiveUnknownSourceFallback(fallbackFilters));
});

test("leaseCloudFetchTasks leases at most one queued item per canonical key and excludes selected canonicals on later pages", async () => {
  const sharedCanonical = "BLOG:https://example.com/shared.xml";
  const leaseFindCalls: Array<{
    where?: Record<string, unknown>;
    cursor?: { id: string };
    orderBy?: unknown;
    skip?: number;
    take?: number;
  }> = [];
  const queueUpdates: Array<{ where?: { id?: string } }> = [];
  const runTaskCreates: Array<{ data: { cloudSourceTaskId: string } }> = [];
  const sharedQueuedItemA = {
    id: "queue_shared_1",
    cloudSourceTaskId: "cloud_task_shared_1",
    mustSucceedBy: minutesFromNow(20),
    createdAt: new Date("2026-06-27T11:00:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_shared_1",
      builderId: "cloud_builder_shared_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_shared_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Shared A",
        handle: null,
        sourceUrl: "https://example.com/shared.xml",
        fetchUrl: "https://example.com/shared.xml",
        canonicalKey: sharedCanonical,
      },
    },
  };
  const sharedQueuedItemB = {
    id: "queue_shared_2",
    cloudSourceTaskId: "cloud_task_shared_2",
    mustSucceedBy: minutesFromNow(21),
    createdAt: new Date("2026-06-27T11:01:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_shared_2",
      builderId: "cloud_builder_shared_2",
      summaryLanguage: "zh",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_shared_2",
        kind: "BLOG",
        sourceType: "blog",
        name: "Shared B",
        handle: null,
        sourceUrl: "https://example.com/shared.xml?lang=zh",
        fetchUrl: "https://example.com/shared.xml?lang=zh",
        canonicalKey: sharedCanonical,
      },
    },
  };
  const sharedQueuedItemC = {
    id: "queue_shared_3",
    cloudSourceTaskId: "cloud_task_shared_3",
    mustSucceedBy: minutesFromNow(22),
    createdAt: new Date("2026-06-27T11:02:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_shared_3",
      builderId: "cloud_builder_shared_3",
      summaryLanguage: "ja",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_shared_3",
        kind: "BLOG",
        sourceType: "blog",
        name: "Shared C",
        handle: null,
        sourceUrl: "https://example.com/shared.xml?lang=ja",
        fetchUrl: "https://example.com/shared.xml?lang=ja",
        canonicalKey: sharedCanonical,
      },
    },
  };
  const uniqueQueuedItem = {
    id: "queue_unique_1",
    cloudSourceTaskId: "cloud_task_unique_1",
    mustSucceedBy: minutesFromNow(23),
    createdAt: new Date("2026-06-27T11:03:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_unique_1",
      builderId: "cloud_builder_unique_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_unique_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Unique Later",
        handle: null,
        sourceUrl: "https://example.com/unique.xml",
        fetchUrl: "https://example.com/unique.xml",
        canonicalKey: "BLOG:https://example.com/unique.xml",
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: {
      findUnique: async () => ({
        tokenBudgetPerHour: 200_000,
        starvationReserveRatio: 0,
        leaseTtlMinutes: 60,
        schedulingLeadMinutes: 120,
        retryBaseMinutes: 30,
        failureCircuitBreakerThreshold: 5,
        canonicalCooldownMinutes: 0,
        durationColdStartBufferRatio: 0.5,
      }),
    },
    cloudFetchQueueItem: {
      updateMany: async (args: { where?: { id?: string } }) => {
        if (args.where?.id) {
          queueUpdates.push(args);
          return { count: 1 };
        }
        return { count: 0 };
      },
      findMany: async (args: LeaseQueueFindManyArgs) => {
        if (args.select) return [];
        if (!args.include) return [];
        leaseFindCalls.push({
          where: args.where,
          cursor: args.cursor,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
        });
        if (!args.cursor) return [sharedQueuedItemA, sharedQueuedItemB];
        if (args.cursor.id === "queue_shared_2") {
          return excludedCanonicalKeys(args.where).includes(sharedCanonical)
            ? [uniqueQueuedItem]
            : [sharedQueuedItemC, uniqueQueuedItem];
        }
        return [];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      findMany: async () => [],
      create: async (args: { data: { cloudSourceTaskId: string } }) => {
        runTaskCreates.push(args);
        return {};
      },
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_canonical_dedupe_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async () => [],
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 2,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.runId, "run_cloud_canonical_dedupe_1");
  assert.deepEqual(
    result.tasks.map((task) => task.cloudSourceTaskId),
    ["cloud_task_shared_1", "cloud_task_unique_1"],
  );
  assert.equal(queueUpdates.length, 2);
  assert.deepEqual(
    queueUpdates.map((update) => update.where?.id),
    ["queue_shared_1", "queue_unique_1"],
  );
  assert.equal(runTaskCreates.length, 2);
  assert.deepEqual(
    runTaskCreates.map((create) => create.data.cloudSourceTaskId),
    ["cloud_task_shared_1", "cloud_task_unique_1"],
  );
  assert.equal(leaseFindCalls.length, 2);
  assert.equal(leaseFindCalls[0]?.cursor, undefined);
  assert.equal(leaseFindCalls[0]?.skip, undefined);
  assert.equal(leaseFindCalls[0]?.take, 2);
  assert.deepEqual(leaseFindCalls[1]?.cursor, { id: "queue_shared_2" });
  assert.equal(leaseFindCalls[1]?.skip, 1);
  assert.equal(leaseFindCalls[1]?.take, 2);
  assert.deepEqual(excludedCanonicalKeys(leaseFindCalls[0]?.where), []);
  assert.deepEqual(excludedCanonicalKeys(leaseFindCalls[1]?.where), [sharedCanonical]);
});

test("leaseCloudFetchTasks matches stored estimates and null source-type priors in its fit predicate", async () => {
  const leaseFindCalls: Array<{
    where?: Record<string, unknown>;
    cursor?: { id: string };
    orderBy?: unknown;
    skip?: number;
    take?: number;
  }> = [];
  const queueUpdates: Array<{ where?: { id?: string } }> = [];
  const runTaskCreates: Array<{ data: { cloudSourceTaskId: string } }> = [];
  const blogNullQueuedItem = {
    id: "queue_blog_null_1",
    cloudSourceTaskId: "cloud_task_blog_null_1",
    mustSucceedBy: minutesFromNow(20),
    createdAt: new Date("2026-06-27T11:00:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_blog_null_1",
      builderId: "cloud_builder_blog_null_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: null,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_blog_null_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Blog Null Estimate",
        handle: null,
        sourceUrl: "https://example.com/blog-null.xml",
        fetchUrl: "https://example.com/blog-null.xml",
        canonicalKey: "BLOG:https://example.com/blog-null.xml",
      },
    },
  };
  const blogStoredHundredKItem = {
    id: "queue_blog_100k_1",
    cloudSourceTaskId: "cloud_task_blog_100k_1",
    mustSucceedBy: minutesFromNow(21),
    createdAt: new Date("2026-06-27T11:01:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_blog_100k_1",
      builderId: "cloud_builder_blog_100k_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 100_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_blog_100k_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Blog Hundred K",
        handle: null,
        sourceUrl: "https://example.com/blog-100k.xml",
        fetchUrl: "https://example.com/blog-100k.xml",
        canonicalKey: "BLOG:https://example.com/blog-100k.xml",
      },
    },
  };
  const podcastStoredFortyKItem = {
    id: "queue_podcast_40k_1",
    cloudSourceTaskId: "cloud_task_podcast_40k_1",
    mustSucceedBy: minutesFromNow(22),
    createdAt: new Date("2026-06-27T11:02:00.000Z"),
    cloudSourceTask: {
      id: "cloud_task_podcast_40k_1",
      builderId: "cloud_builder_podcast_40k_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 600,
      estimatedTokenCost: 40_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_podcast_40k_1",
        kind: "PODCAST",
        sourceType: "podcast",
        name: "Podcast Stored Forty K",
        handle: null,
        sourceUrl: "https://example.com/podcast-40k.xml",
        fetchUrl: "https://example.com/podcast-40k.xml",
        canonicalKey: "BLOG:https://example.com/podcast-40k.xml",
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: {
      findUnique: async () => ({
        tokenBudgetPerHour: 100_000,
        starvationReserveRatio: 0,
        leaseTtlMinutes: 60,
        schedulingLeadMinutes: 120,
        retryBaseMinutes: 30,
        failureCircuitBreakerThreshold: 5,
        canonicalCooldownMinutes: 0,
        durationColdStartBufferRatio: 0.5,
      }),
    },
    cloudFetchQueueItem: {
      updateMany: async (args: { where?: { id?: string } }) => {
        if (args.where?.id) {
          queueUpdates.push(args);
          return { count: 1 };
        }
        return { count: 0 };
      },
      findMany: async (args: LeaseQueueFindManyArgs) => {
        if (args.select) return [];
        if (!args.include) return [];
        leaseFindCalls.push({
          where: args.where,
          cursor: args.cursor,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
        });
        if (!args.cursor && hasEstimatedTokenCeiling(args.where, 100_000)) {
          return [blogNullQueuedItem, blogStoredHundredKItem];
        }
        if (args.cursor?.id === "queue_blog_100k_1" && hasEstimatedTokenCeiling(args.where, 40_000)) {
          return [podcastStoredFortyKItem];
        }
        return [blogStoredHundredKItem];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      findMany: async () => [],
      create: async (args: { data: { cloudSourceTaskId: string } }) => {
        runTaskCreates.push(args);
        return {};
      },
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_fit_predicate_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async () => [],
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 2,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.runId, "run_cloud_fit_predicate_1");
  assert.deepEqual(
    result.tasks.map((task) => task.cloudSourceTaskId),
    ["cloud_task_blog_null_1", "cloud_task_podcast_40k_1"],
  );
  assert.equal(queueUpdates.length, 2);
  assert.deepEqual(
    queueUpdates.map((update) => update.where?.id),
    ["queue_blog_null_1", "queue_podcast_40k_1"],
  );
  assert.equal(runTaskCreates.length, 2);
  assert.deepEqual(
    runTaskCreates.map((create) => create.data.cloudSourceTaskId),
    ["cloud_task_blog_null_1", "cloud_task_podcast_40k_1"],
  );
  assert.equal(leaseFindCalls.length, 2);
  assert.equal(leaseFindCalls[0]?.cursor, undefined);
  assert.equal(leaseFindCalls[0]?.skip, undefined);
  assert.equal(leaseFindCalls[0]?.take, 2);
  assert.ok(hasEstimatedTokenCeiling(leaseFindCalls[0]?.where, 100_000));
  const initialFallbackFilters = nullFallbackSourceFilters(leaseFindCalls[0]?.where);
  assert.ok(hasInsensitiveSourceType(initialFallbackFilters, "blog"));
  assert.ok(!hasInsensitiveSourceType(initialFallbackFilters, "podcast"));
  assert.ok(hasInsensitiveUnknownSourceFallback(initialFallbackFilters));
  assert.deepEqual(leaseFindCalls[1]?.cursor, { id: "queue_blog_100k_1" });
  assert.equal(leaseFindCalls[1]?.skip, 1);
  assert.equal(leaseFindCalls[1]?.take, 2);
  assert.ok(hasEstimatedTokenCeiling(leaseFindCalls[1]?.where, 40_000));
  const remainingFallbackFilters = nullFallbackSourceFilters(leaseFindCalls[1]?.where);
  assert.ok(!hasInsensitiveSourceType(remainingFallbackFilters, "blog"));
  assert.ok(!hasInsensitiveSourceType(remainingFallbackFilters, "podcast"));
  assert.ok(!hasInsensitiveUnknownSourceFallback(remainingFallbackFilters));
});

test("leaseCloudFetchTasks includes provisional execution plans in leased tasks and extends the initial lease to cover them", async () => {
  const queueUpdates: Array<{ data: { leaseExpiresAt: Date } }> = [];
  const runTaskCreates: Array<{ data: { details?: { executionPlan?: Record<string, unknown> } } }> = [];
  const queuedItem = {
    id: "queue_plan_1",
    cloudSourceTaskId: "cloud_task_plan_1",
    mustSucceedBy: minutesFromNow(90),
    cloudSourceTask: {
      id: "cloud_task_plan_1",
      builderId: "cloud_builder_plan_1",
      summaryLanguage: "en",
      estimatedDurationSeconds: 70 * 60,
      estimatedTokenCost: 50_000,
      durationP75Seconds: null,
      durationP90Seconds: null,
      durationSampleCount: 0,
      successSampleCount: 0,
      estimatedSuccessProbability: 0.9,
      builder: {
        id: "cloud_builder_plan_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Planned Source",
        handle: null,
        sourceUrl: "https://example.com/planned.xml",
        fetchUrl: "https://example.com/planned.xml",
        canonicalKey: "BLOG:https://example.com/planned.xml",
      },
    },
  };
  const prisma = {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(this); },
    async $queryRawUnsafe(query: string) { return resetFenceQuery(query); },
    cloudFetchConfig: { findUnique: async () => null },
    cloudFetchQueueItem: {
      updateMany: async (args: { where?: { id?: unknown }; data: { leaseExpiresAt: Date } }) => {
        if (args.where?.id) {
          queueUpdates.push(args);
          return { count: 1 };
        }
        return { count: 0 };
      },
      findMany: async (args: { include?: unknown }) => {
        if (args.include) return [queuedItem];
        return [];
      },
      count: async () => 0,
      create: async () => ({}),
    },
    cloudSourceTask: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    cloudFetchRunTask: {
      findMany: async () => [],
      create: async (args: { data: { details?: { executionPlan?: Record<string, unknown> } } }) => {
        runTaskCreates.push(args);
        return {};
      },
    },
    cloudSourceSubmission: { groupBy: async () => [] },
    cloudFetchRun: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: "run_cloud_plan_1",
        ...args.data,
      }),
    },
    feedItem: {
      findMany: async () => [],
    },
  };

  const result = await leaseCloudFetchTasks({
    prisma: prisma as never,
    now,
    limit: 1,
    leaseOwner: "local-cloud-runner:test",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.runId, "run_cloud_plan_1");
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.tasks[0], {
    cloudSourceTaskId: "cloud_task_plan_1",
    builderId: "cloud_builder_plan_1",
    summaryLanguage: "en",
    mustSucceedBy: "2026-06-27T13:30:00.000Z",
    estimatedDurationSeconds: 4_200,
    provisionalExecutionBudgetSeconds: 6_900,
    workloadClass: "standard",
    budgetReason: "scaled_and_rounded",
    deadlineState: "at_risk",
    source: queuedItem.cloudSourceTask.builder,
    fetchedItems: [],
  });
  assert.equal(queueUpdates.length, 1);
  assert.equal(queueUpdates[0]?.data.leaseExpiresAt.toISOString(), "2026-06-27T14:05:00.000Z");
  assert.deepEqual(runTaskCreates[0]?.data.details?.executionPlan, {
    mustSucceedBy: "2026-06-27T13:30:00.000Z",
    estimatedDurationSeconds: 4_200,
    provisionalExecutionBudgetSeconds: 6_900,
    workloadClass: "standard",
    budgetReason: "scaled_and_rounded",
    deadlineState: "at_risk",
  });
});

const generousConfig = {
  tokenBudgetPerHour: 1_000_000,
  starvationReserveRatio: 0,
};

test("work-conserving: a ready task with a far deadline is leased now when capacity is free", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 5,
    config: generousConfig,
    tasks: [
      baseTask({
        id: "fresh-daily",
        releaseAt: now,
        mustSucceedBy: minutesFromNow(24 * 60),
        estimatedDurationSeconds: 600,
      }),
    ],
  });

  // The old latest-feasible-bucket planner parked this ~23h out; a
  // work-conserving planner serves it now since the worker has capacity.
  assert.deepEqual(plan.currentHourTaskIds, ["fresh-daily"]);
});

test("fills the current request up to the CLI-requested limit and defers the rest", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 2,
    config: generousConfig,
    tasks: [
      baseTask({ id: "a", mustSucceedBy: minutesFromNow(24 * 60), estimatedDurationSeconds: 600 }),
      baseTask({ id: "b", mustSucceedBy: minutesFromNow(24 * 60), estimatedDurationSeconds: 600 }),
      baseTask({ id: "c", mustSucceedBy: minutesFromNow(24 * 60), estimatedDurationSeconds: 600 }),
    ],
  });

  assert.equal(plan.currentHourTaskIds.length, 2);
  // The unselected ready task is deferred so it ages up on the next poll.
  assert.equal(Object.keys(plan.debug.deferred).length, 1);
});

test("a task not yet released is not leased now", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 5,
    config: generousConfig,
    tasks: [
      baseTask({
        id: "backoff",
        releaseAt: minutesFromNow(30),
        mustSucceedBy: minutesFromNow(24 * 60),
      }),
    ],
  });

  assert.deepEqual(plan.currentHourTaskIds, []);
  assert.equal(Object.keys(plan.debug.deferred).length, 0);
});

test("an overdue but released task is still leasable (catch-up), not abandoned", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 5,
    config: generousConfig,
    tasks: [
      // deadline already passed an hour ago, but it is released and active
      baseTask({ id: "overdue", releaseAt: now, mustSucceedBy: minutesFromNow(-60) }),
    ],
  });

  assert.deepEqual(plan.currentHourTaskIds, ["overdue"]);
});

test("an overdue catch-up task yields the only slot to an on-time task", () => {
  const plan = planCloudFetchWindow({
    now,
    requestedLimit: 1,
    config: generousConfig,
    tasks: [
      baseTask({ id: "overdue", releaseAt: now, mustSucceedBy: minutesFromNow(-60) }),
      baseTask({ id: "ontime", releaseAt: now, mustSucceedBy: minutesFromNow(30) }),
    ],
  });

  // Overdue work is lowest priority: it must not displace an on-time task.
  assert.deepEqual(plan.currentHourTaskIds, ["ontime"]);
});
