import test from "node:test";
import assert from "node:assert/strict";
import { applyCloudFetchTaskSyncResult } from "../src/lib/cloud-source-sync";

test("cloud sync marks a successful leased task and advances the next deadline window", async () => {
  const now = new Date("2026-06-27T10:00:00.000Z");
  const prisma = fakeCloudSyncPrisma({
    task: {
      id: "task_1",
      builderId: "builder_1",
      summaryLanguage: "zh",
      effectiveFrequency: "DAILY",
      consecutiveFailures: 2,
      durationSampleCount: 0,
      estimatedTokenCost: null,
      tokenSampleCount: 0,
      estimatedPostYield: null,
      postYieldSampleCount: 0,
      successSampleCount: 0,
    },
    runTasks: [
      {
        runId: "run_1",
        cloudSourceTaskId: "task_1",
        status: "RUNNING",
        usageTokens: null,
        usageCostUsd: null,
      },
    ],
  });

  const result = await applyCloudFetchTaskSyncResult({
    prisma,
    now,
    config: {
      schedulingLeadMinutes: 120,
      retryBaseMinutes: 30,
      failureCircuitBreakerThreshold: 5,
    },
    result: {
      runId: "run_1",
      cloudSourceTaskId: "task_1",
      status: "succeeded",
      plannedPosts: 3,
      syncedPosts: 3,
      failedPosts: 0,
      actualDurationSeconds: 420,
      usageTokens: 12000,
      usageCostUsd: 0.42,
    },
  });

  assert.equal(result.runStatus, "SUCCEEDED");
  assert.equal(result.builderId, "builder_1");
  assert.equal(result.summaryLanguage, "zh");
  assert.deepEqual(prisma.cloudFetchRunTask.updateManyCalls[0], {
    where: {
      runId: "run_1",
      cloudSourceTaskId: "task_1",
      status: "RUNNING",
    },
    data: {
      status: "SUCCEEDED",
      finishedAt: now,
      plannedPosts: 3,
      syncedPosts: 3,
      failedPosts: 0,
      actualDurationSeconds: 420,
      failureReason: null,
      usageTokens: 12000,
      usageCostUsd: 0.42,
      details: {},
    },
  });
  assert.equal(prisma.cloudFetchQueueItem.updateManyCalls[0].data.status, "SUCCEEDED");
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.lastSuccessAt, now);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.consecutiveFailures, 0);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.estimatedTokenCost, 12000);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.tokenSampleCount, 1);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.estimatedPostYield, 3);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.postYieldSampleCount, 1);
  assert.equal((prisma.cloudSourceTask.updateCalls[0].data.mustSucceedBy as Date).toISOString(), "2026-06-28T10:00:00.000Z");
  assert.equal((prisma.cloudSourceTask.updateCalls[0].data.nextAttemptAt as Date).toISOString(), "2026-06-28T08:00:00.000Z");
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.status, "SUCCEEDED");
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.tasksSucceeded, 1);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.tasksFailed, 0);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.usageTokens, 12000);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.usageCostUsd, 0.42);
});

test("cloud sync marks failures with backoff and keeps a mixed run partial", async () => {
  const now = new Date("2026-06-27T10:00:00.000Z");
  const prisma = fakeCloudSyncPrisma({
    task: {
      id: "task_2",
      builderId: "builder_2",
      summaryLanguage: "en",
      effectiveFrequency: "WEEKLY",
      consecutiveFailures: 1,
      durationSampleCount: 4,
      estimatedTokenCost: 1000,
      tokenSampleCount: 4,
      estimatedPostYield: 2,
      postYieldSampleCount: 4,
      successSampleCount: 4,
    },
    runTasks: [
      {
        runId: "run_2",
        cloudSourceTaskId: "task_1",
        status: "SUCCEEDED",
        usageTokens: 1000,
        usageCostUsd: 0.1,
      },
      {
        runId: "run_2",
        cloudSourceTaskId: "task_2",
        status: "RUNNING",
        usageTokens: null,
        usageCostUsd: null,
      },
    ],
  });

  const result = await applyCloudFetchTaskSyncResult({
    prisma,
    now,
    config: {
      schedulingLeadMinutes: 120,
      retryBaseMinutes: 30,
      failureCircuitBreakerThreshold: 3,
    },
    result: {
      runId: "run_2",
      cloudSourceTaskId: "task_2",
      status: "failed",
      plannedPosts: 3,
      syncedPosts: 1,
      failedPosts: 2,
      actualDurationSeconds: 900,
      failureReason: "summary_missing",
      usageTokens: 2000,
      usageCostUsd: 0.2,
    },
  });

  assert.equal(result.runStatus, "PARTIAL");
  assert.deepEqual(result.sourceTaskResult, {
    cloudSourceTaskId: "task_2",
    status: "failed",
    plannedPosts: 3,
    syncedPosts: 1,
    failedPosts: 2,
    actualDurationSeconds: 900,
    failureReason: "summary_missing",
    usageTokens: 2000,
    usageCostUsd: 0.2,
    details: {},
  });
  assert.equal(prisma.cloudFetchRunTask.updateManyCalls[0].data.status, "FAILED");
  assert.equal(prisma.cloudFetchQueueItem.updateManyCalls[0].data.status, "FAILED");
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.consecutiveFailures, 2);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.estimatedTokenCost, 1200);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.tokenSampleCount, 5);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.estimatedPostYield, 1.8);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.postYieldSampleCount, 5);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.lastFailureReason, "summary_missing");
  assert.equal((prisma.cloudSourceTask.updateCalls[0].data.nextAttemptAt as Date).toISOString(), "2026-06-27T11:00:00.000Z");
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.circuitBreakerUntil, null);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.status, "PARTIAL");
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.tasksSucceeded, 1);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.tasksFailed, 1);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.usageTokens, 3000);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.usageCostUsd, 0.3);
});

test("cloud sync keeps partial source results visible without failure backoff", async () => {
  const now = new Date("2026-06-27T10:00:00.000Z");
  const prisma = fakeCloudSyncPrisma({
    task: {
      id: "task_2",
      builderId: "builder_2",
      summaryLanguage: "en",
      effectiveFrequency: "DAILY",
      consecutiveFailures: 1,
      durationSampleCount: 0,
      estimatedTokenCost: null,
      tokenSampleCount: 0,
      estimatedPostYield: null,
      postYieldSampleCount: 0,
      successSampleCount: 0,
    },
    runTasks: [
      {
        runId: "run_2",
        cloudSourceTaskId: "task_1",
        status: "SUCCEEDED",
        usageTokens: 1000,
        usageCostUsd: 0.1,
      },
      {
        runId: "run_2",
        cloudSourceTaskId: "task_2",
        status: "RUNNING",
        usageTokens: null,
        usageCostUsd: null,
      },
    ],
  });

  const result = await applyCloudFetchTaskSyncResult({
    prisma,
    now,
    config: {
      schedulingLeadMinutes: 120,
      retryBaseMinutes: 30,
      failureCircuitBreakerThreshold: 3,
    },
    result: {
      runId: "run_2",
      cloudSourceTaskId: "task_2",
      status: "partial",
      plannedPosts: 2,
      syncedPosts: 1,
      failedPosts: 1,
      failureReason: "worker_missing_result",
    },
  });

  assert.equal(result.runStatus, "PARTIAL");
  assert.deepEqual(result.sourceTaskResult, {
    cloudSourceTaskId: "task_2",
    status: "partial",
    plannedPosts: 2,
    syncedPosts: 1,
    failedPosts: 1,
    actualDurationSeconds: null,
    failureReason: "worker_missing_result",
    usageTokens: null,
    usageCostUsd: null,
    details: {},
  });
  assert.equal(prisma.cloudFetchRunTask.updateManyCalls[0].data.status, "PARTIAL");
  assert.equal(prisma.cloudFetchRunTask.updateManyCalls[0].data.failureReason, "worker_missing_result");
  assert.equal(prisma.cloudFetchQueueItem.updateManyCalls[0].data.status, "SUCCEEDED");
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.lastSuccessAt, now);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.consecutiveFailures, 0);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.status, "PARTIAL");
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.tasksSucceeded, 1);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.tasksFailed, 1);
});

test("cloud sync merges final details without dropping an existing execution plan", async () => {
  const now = new Date("2026-07-19T10:00:00.000Z");
  const prisma = fakeCloudSyncPrisma({
    task: {
      id: "task_3",
      builderId: "builder_3",
      summaryLanguage: "en",
      effectiveFrequency: "DAILY",
      consecutiveFailures: 0,
      durationSampleCount: 0,
      estimatedTokenCost: null,
      tokenSampleCount: 0,
      estimatedPostYield: null,
      postYieldSampleCount: 0,
      successSampleCount: 0,
    },
    runTasks: [
      {
        runId: "run_3",
        cloudSourceTaskId: "task_3",
        status: "RUNNING",
        usageTokens: null,
        usageCostUsd: null,
        details: {
          executionPlan: {
            mustSucceedBy: "2026-07-19T14:00:00.000Z",
            sourceWindow: "daily",
            posts: {
              post_1: {
                postTaskId: "post_1",
                executionBudgetSeconds: 3600,
                budgetReason: "minimum_budget",
              },
            },
          },
          retainedMarker: true,
        },
      },
    ],
  });

  const result = await applyCloudFetchTaskSyncResult({
    prisma,
    now,
    config: {
      schedulingLeadMinutes: 120,
      retryBaseMinutes: 30,
      failureCircuitBreakerThreshold: 3,
    },
    result: {
      runId: "run_3",
      cloudSourceTaskId: "task_3",
      status: "succeeded",
      plannedPosts: 1,
      syncedPosts: 1,
      failedPosts: 0,
      details: {
        fetchTaskIds: ["post_1"],
        posts: [{ postTaskId: "post_1", status: "synced" }],
        workerUsages: [{ workerId: "worker-1", taskIds: ["post_1"] }],
      },
    },
  });

  assert.deepEqual(prisma.cloudFetchRunTask.updateManyCalls[0].data.details, {
    executionPlan: {
      mustSucceedBy: "2026-07-19T14:00:00.000Z",
      sourceWindow: "daily",
      posts: {
        post_1: {
          postTaskId: "post_1",
          executionBudgetSeconds: 3600,
          budgetReason: "minimum_budget",
        },
      },
    },
    retainedMarker: true,
    fetchTaskIds: ["post_1"],
    posts: [{ postTaskId: "post_1", status: "synced" }],
    workerUsages: [{ workerId: "worker-1", taskIds: ["post_1"] }],
  });
  assert.deepEqual(result.sourceTaskResult.details, prisma.cloudFetchRunTask.updateManyCalls[0].data.details);
});

function fakeCloudSyncPrisma({
  task,
  runTasks,
}: {
  task: {
    id: string;
    builderId: string;
    summaryLanguage: string;
    effectiveFrequency: "DAILY" | "WEEKLY";
    consecutiveFailures: number;
    durationSampleCount: number;
    estimatedTokenCost?: number | null;
    tokenSampleCount: number;
    estimatedPostYield?: number | null;
    postYieldSampleCount: number;
    successSampleCount: number;
  };
  runTasks: Array<{
    runId: string;
    cloudSourceTaskId: string;
    status: string;
    usageTokens: number | null;
    usageCostUsd: number | null;
    details?: Record<string, unknown>;
  }>;
}) {
  const mutableRunTasks = runTasks.map((runTask) => ({ ...runTask }));
  const prisma = {
    cloudSourceTask: {
      findUniqueCalls: [] as unknown[],
      updateCalls: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
      async findUnique(args: unknown) {
        this.findUniqueCalls.push(args);
        return task;
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        this.updateCalls.push(args);
        return { ...task, ...args.data };
      },
    },
    cloudFetchRunTask: {
      updateManyCalls: [] as Array<{
        where: { runId: string; cloudSourceTaskId: string; status?: string };
        data: Record<string, unknown>;
      }>,
      async updateMany(args: {
        where: { runId: string; cloudSourceTaskId: string; status?: string };
        data: Record<string, unknown>;
      }) {
        this.updateManyCalls.push(args);
        const row = mutableRunTasks.find(
          (runTask) =>
            runTask.runId === args.where.runId &&
            runTask.cloudSourceTaskId === args.where.cloudSourceTaskId &&
            (args.where.status === undefined || runTask.status === args.where.status),
        );
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
      async findMany(args: { where: { runId: string } }) {
        return mutableRunTasks.filter((runTask) => runTask.runId === args.where.runId);
      },
    },
    cloudFetchQueueItem: {
      updateManyCalls: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        this.updateManyCalls.push(args);
        return { count: 1 };
      },
    },
    cloudFetchRun: {
      updateCalls: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        this.updateCalls.push(args);
        return { id: args.where.id, ...args.data };
      },
    },
  };
  return prisma;
}
