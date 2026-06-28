import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelQueuedCloudFetchForTasks,
  estimateCloudTaskRuntime,
  heartbeatCloudFetchRun,
  nextCloudTaskFailureSchedule,
  nextCloudTaskSuccessSchedule,
  planCloudFetchWindow,
  type CloudSchedulerTaskInput,
} from "../src/lib/cloud-source-scheduler";

const now = new Date("2026-06-27T12:00:00.000Z");
const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

const baseTask = (overrides: Partial<CloudSchedulerTaskInput>): CloudSchedulerTaskInput => ({
  id: overrides.id ?? "task",
  canonicalKey: overrides.canonicalKey ?? `BLOG:https://example.com/${overrides.id ?? "task"}`,
  sourceType: overrides.sourceType ?? "blog",
  releaseAt: overrides.releaseAt ?? now,
  mustSucceedBy: overrides.mustSucceedBy ?? minutesFromNow(60),
  estimatedDurationSeconds: overrides.estimatedDurationSeconds ?? 600,
  estimatedSuccessProbability: overrides.estimatedSuccessProbability ?? 0.9,
  activeSubmissionCount: overrides.activeSubmissionCount ?? 1,
  consecutiveDeferrals: overrides.consecutiveDeferrals ?? 0,
  consecutiveFailures: overrides.consecutiveFailures ?? 0,
  circuitBreakerUntil: overrides.circuitBreakerUntil,
});

test("duration-aware planning prefers more feasible short tasks under worker-seconds budget", () => {
  const plan = planCloudFetchWindow({
    now,
    config: {
      maxTasksPerHour: 3,
      maxActiveLeases: 3,
      workerSecondsPerHour: 1_800,
      planningHorizonHours: 2,
      starvationReserveRatio: 0,
      retryReserveRatio: 0,
    },
    tasks: [
      baseTask({
        id: "long-low-yield",
        estimatedDurationSeconds: 1_800,
        estimatedSuccessProbability: 0.5,
      }),
      baseTask({ id: "short-a", estimatedDurationSeconds: 600, estimatedSuccessProbability: 0.95 }),
      baseTask({ id: "short-b", estimatedDurationSeconds: 600, estimatedSuccessProbability: 0.95 }),
    ],
  });

  assert.deepEqual(plan.currentHourTaskIds.sort(), ["short-a", "short-b"]);
  assert.equal(plan.debug.skipped["long-low-yield"]?.reason, "evicted_low_score");
});

test("starvation reserve admits an old deferred task before normal score-only candidates", () => {
  const plan = planCloudFetchWindow({
    now,
    config: {
      maxTasksPerHour: 4,
      maxActiveLeases: 4,
      workerSecondsPerHour: 3_600,
      planningHorizonHours: 2,
      starvationReserveRatio: 0.25,
      retryReserveRatio: 0,
    },
    tasks: [
      baseTask({
        id: "old-long",
        estimatedDurationSeconds: 1_800,
        estimatedSuccessProbability: 0.5,
        consecutiveDeferrals: 9,
        lastDeferredAt: minutesFromNow(-240),
      }),
      baseTask({ id: "short-a", estimatedDurationSeconds: 600 }),
      baseTask({ id: "short-b", estimatedDurationSeconds: 600 }),
      baseTask({ id: "short-c", estimatedDurationSeconds: 600 }),
      baseTask({ id: "short-d", estimatedDurationSeconds: 600 }),
    ],
  });

  assert.ok(plan.currentHourTaskIds.includes("old-long"));
  assert.equal(plan.debug.selected["old-long"]?.lane, "starvation");
  assert.equal(plan.currentHourTaskIds.length, 4);
});

test("planner excludes circuit-broken and active canonical source tasks", () => {
  const plan = planCloudFetchWindow({
    now,
    config: {
      maxTasksPerHour: 4,
      maxActiveLeases: 4,
      workerSecondsPerHour: 3_600,
      planningHorizonHours: 2,
      starvationReserveRatio: 0,
      retryReserveRatio: 0,
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

const generousConfig = {
  maxTasksPerHour: 5,
  maxActiveLeases: 5,
  workerSecondsPerHour: 36_000,
  planningHorizonHours: 48,
  starvationReserveRatio: 0,
  retryReserveRatio: 0,
};

test("work-conserving: a ready task with a far deadline is leased now when capacity is free", () => {
  const plan = planCloudFetchWindow({
    now,
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

test("fills the current hour up to the count budget and defers the rest", () => {
  const plan = planCloudFetchWindow({
    now,
    config: { ...generousConfig, maxTasksPerHour: 2 },
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
