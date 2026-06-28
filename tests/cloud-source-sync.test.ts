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
  assert.deepEqual(prisma.cloudFetchRunTask.updateCalls[0], {
    where: {
      runId_cloudSourceTaskId: {
        runId: "run_1",
        cloudSourceTaskId: "task_1",
      },
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
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.mustSucceedBy.toISOString(), "2026-06-28T10:00:00.000Z");
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.nextAttemptAt.toISOString(), "2026-06-28T08:00:00.000Z");
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
  assert.equal(prisma.cloudFetchRunTask.updateCalls[0].data.status, "FAILED");
  assert.equal(prisma.cloudFetchQueueItem.updateManyCalls[0].data.status, "FAILED");
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.consecutiveFailures, 2);
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.lastFailureReason, "summary_missing");
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.nextAttemptAt.toISOString(), "2026-06-27T11:00:00.000Z");
  assert.equal(prisma.cloudSourceTask.updateCalls[0].data.circuitBreakerUntil, null);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.status, "PARTIAL");
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.tasksSucceeded, 1);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.tasksFailed, 1);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.usageTokens, 3000);
  assert.equal(prisma.cloudFetchRun.updateCalls[0].data.usageCostUsd, 0.3);
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
    successSampleCount: number;
  };
  runTasks: Array<{
    runId: string;
    cloudSourceTaskId: string;
    status: string;
    usageTokens: number | null;
    usageCostUsd: number | null;
  }>;
}) {
  const mutableRunTasks = runTasks.map((runTask) => ({ ...runTask }));
  const prisma = {
    cloudSourceTask: {
      findUniqueCalls: [] as unknown[],
      updateCalls: [] as unknown[],
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
      updateCalls: [] as Array<{
        where: { runId_cloudSourceTaskId: { runId: string; cloudSourceTaskId: string } };
        data: Record<string, unknown>;
      }>,
      async update(args: {
        where: { runId_cloudSourceTaskId: { runId: string; cloudSourceTaskId: string } };
        data: Record<string, unknown>;
      }) {
        this.updateCalls.push(args);
        const row = mutableRunTasks.find(
          (runTask) =>
            runTask.runId === args.where.runId_cloudSourceTaskId.runId &&
            runTask.cloudSourceTaskId === args.where.runId_cloudSourceTaskId.cloudSourceTaskId,
        );
        if (row) Object.assign(row, args.data);
        return row;
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
