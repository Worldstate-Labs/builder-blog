import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelQueuedCloudFetchForTasks,
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
