import assert from "node:assert/strict";
import test from "node:test";

import { serializeCloudFetchRun, serializeCloudWorkerHost } from "../src/lib/cloud-fetch-run-log";

const baseRun = {
  id: "run_1",
  leaseOwner: "local-cloud-worker:admin-mac",
  startedAt: new Date("2026-06-28T10:00:00.000Z"),
  finishedAt: new Date("2026-06-28T10:05:00.000Z"),
  status: "PARTIAL",
  requestedLimit: 5,
  tasksClaimed: 2,
  tasksSucceeded: 1,
  tasksFailed: 1,
  usageTokens: 12000,
  usageCostUsd: 0.42,
  summary: "1 ok, 1 failed",
};

test("serializeCloudFetchRun exposes per-source durations, usage, and per-post outcomes", () => {
  const result = serializeCloudFetchRun({
    ...baseRun,
    tasks: [
      {
        id: "rt_1",
        builderId: "cb_1",
        summaryLanguage: "zh",
        status: "SUCCEEDED",
        plannedPosts: 3,
        syncedPosts: 3,
        failedPosts: 0,
        startedAt: new Date("2026-06-28T10:00:10.000Z"),
        finishedAt: new Date("2026-06-28T10:02:10.000Z"),
        actualDurationSeconds: 120,
        estimatedDurationSeconds: 100,
        successProbabilitySnapshot: 0.9,
        usageTokens: 5000,
        usageCostUsd: 0.12,
        failureReason: null,
        details: {
          fetchTasks: [
            {
              id: "task_1",
              title: "Post One",
              url: "https://example.com/1",
              contentStatus: "ready",
              status: "synced",
              fetchTool: "x-api",
              agentRuntime: "codex",
              agentModel: "claude",
              bodyChars: 1200,
              bodyWords: 180,
              summaryChars: 300,
              summaryWords: 45,
              readMethod: "Copied body from a Hub-shared post with the same URL",
              summaryMethod: "Copied matching-language summary from a Hub-shared post",
              hubSharedReuse: { bodyReused: true, summaryReused: true },
              workerId: "worker-0",
            },
            { title: "Post Two", url: "https://example.com/2", status: "failed", failureReason: "summary_missing" },
          ],
          workerUsages: [
            {
              workerId: "worker-0",
              usage: { totalTokens: 1200, costUsd: 0.05, currency: "USD" },
              taskCount: 1,
              taskIds: ["task_1"],
            },
          ],
        },
        builder: { name: "Example Feed", sourceType: "x" },
      },
    ],
  });

  const task = result.tasks[0];
  assert.equal(result.leaseOwner, "local-cloud-worker:admin-mac");
  assert.equal(result.tasksRunning, 0);
  assert.equal(task.sourceName, "Example Feed");
  assert.equal(task.startedAt, "2026-06-28T10:00:10.000Z");
  assert.equal(task.finishedAt, "2026-06-28T10:02:10.000Z");
  assert.equal(task.pendingPosts, 0);
  assert.equal(task.skippedPosts, 0);
  assert.equal(task.durationMs, 120_000);
  assert.equal(task.usageTokens, 5000);
  assert.equal(task.usageCostUsd, 0.12);
  assert.equal(task.successProbability, 0.9);
  assert.equal(task.noGeneratedFetchTasks, false);
  assert.equal(task.posts.length, 2);
  assert.deepEqual(task.posts[0], {
    id: "task_1",
    title: "Post One",
    url: "https://example.com/1",
    contentStatus: "ready",
    agentWorkType: null,
    status: "synced",
    failureReason: null,
    fetchTool: "x-api",
    agentRuntime: "codex",
    model: "claude",
    bodyChars: 1200,
    bodyWords: 180,
    summaryChars: 300,
    summaryWords: 45,
    readMethod: "Copied body from a Hub-shared post with the same URL",
    summaryMethod: "Copied matching-language summary from a Hub-shared post",
    hubSharedReuse: { bodyReused: true, summaryReused: true },
    workerId: "worker-0",
  });
  assert.deepEqual(task.workerUsages, [
    {
      workerId: "worker-0",
      usage: { totalTokens: 1200, costUsd: 0.05, currency: "USD" },
      taskCount: 1,
      taskIds: ["task_1"],
    },
  ]);
  assert.equal(task.posts[1].failureReason, "summary_missing");
});

test("serializeCloudFetchRun aggregates planned/synced/failed/skipped posts across sources", () => {
  const result = serializeCloudFetchRun({
    ...baseRun,
    tasks: [
      { id: "a", builderId: "a", summaryLanguage: "zh", status: "SUCCEEDED", plannedPosts: 3, syncedPosts: 3, failedPosts: 0, actualDurationSeconds: 10, failureReason: null, builder: null },
      {
        id: "b",
        builderId: "b",
        summaryLanguage: "zh",
        status: "PARTIAL",
        plannedPosts: 4,
        syncedPosts: 0,
        failedPosts: 2,
        actualDurationSeconds: 5,
        failureReason: "x",
        builder: null,
        details: {
          fetchTasks: [
            { id: "skip_1", status: "skipped", failureReason: "older_than_cutoff" },
            { id: "pending_1", status: "queued" },
          ],
        },
      },
    ],
  });

  assert.equal(result.plannedPosts, 7);
  assert.equal(result.syncedPosts, 3);
  assert.equal(result.failedPosts, 2);
  assert.equal(result.skippedPosts, 1);
  assert.equal(result.pendingPosts, 1);
  assert.equal(result.tasks[1].skippedPosts, 1);
  assert.equal(result.durationMs, 5 * 60_000);
});

test("serializeCloudFetchRun does not double-count skipped-only source tasks as failed", () => {
  const result = serializeCloudFetchRun({
    ...baseRun,
    status: "FAILED",
    tasksSucceeded: 0,
    tasksFailed: 1,
    tasks: [
      {
        id: "rt_skipped",
        builderId: "cb_skipped",
        summaryLanguage: "zh",
        status: "FAILED",
        plannedPosts: 1,
        syncedPosts: 0,
        failedPosts: 1,
        startedAt: new Date("2026-07-03T15:01:42.181Z"),
        finishedAt: new Date("2026-07-03T15:07:23.665Z"),
        actualDurationSeconds: 341,
        estimatedDurationSeconds: 180,
        successProbabilitySnapshot: null,
        usageTokens: null,
        usageCostUsd: null,
        failureReason: "no_primary_content",
        details: {
          posts: [
            {
              id: "post_skip",
              url: "https://x.com/example/status/1",
              status: "skipped",
              contentStatus: "ready",
              failureReason: "no_primary_content",
            },
          ],
          serverTaskOutcomes: [
            {
              fetchTaskId: "post_skip",
              status: "skipped",
              reason: "no_primary_content",
            },
          ],
        },
        builder: { name: "Skipped Source", sourceType: "x" },
      },
    ],
  });

  assert.equal(result.failedPosts, 0);
  assert.equal(result.skippedPosts, 1);
  assert.equal(result.pendingPosts, 0);
  assert.equal(result.tasks[0]?.status, "SUCCEEDED");
  assert.equal(result.tasks[0]?.failedPosts, 0);
  assert.equal(result.tasks[0]?.skippedPosts, 1);
  assert.equal(result.tasks[0]?.pendingPosts, 0);
  assert.equal(result.tasks[0]?.failureReason, null);
});

test("task duration falls back to finished-started when actualDurationSeconds is null", () => {
  const result = serializeCloudFetchRun({
    ...baseRun,
    finishedAt: null,
    tasks: [
      {
        id: "a",
        builderId: "a",
        summaryLanguage: "zh",
        status: "SUCCEEDED",
        plannedPosts: 1,
        syncedPosts: 1,
        failedPosts: 0,
        startedAt: new Date("2026-06-28T10:00:00.000Z"),
        finishedAt: new Date("2026-06-28T10:00:30.000Z"),
        actualDurationSeconds: null,
        failureReason: null,
        builder: null,
      },
    ],
  });

  assert.equal(result.durationMs, null); // run still running
  assert.equal(result.tasks[0].durationMs, 30_000);
  assert.deepEqual(result.tasks[0].posts, []);
});

test("serializeCloudFetchRun handles a still-running run with no tasks or usage", () => {
  const result = serializeCloudFetchRun({
    ...baseRun,
    finishedAt: null,
    usageTokens: null,
    usageCostUsd: null,
    summary: null,
    tasks: [],
  });

  assert.equal(result.finishedAt, null);
  assert.equal(result.durationMs, null);
  assert.equal(result.plannedPosts, 0);
  assert.equal(result.usageCostUsd, null);
  assert.deepEqual(result.tasks, []);
});

test("serializeCloudFetchRun exposes source tasks that generated no post tasks", () => {
  const result = serializeCloudFetchRun({
    ...baseRun,
    tasksSucceeded: 1,
    tasksFailed: 0,
    tasks: [
      {
        id: "rt_empty",
        builderId: "cb_empty",
        summaryLanguage: "zh",
        status: "SUCCEEDED",
        plannedPosts: 0,
        syncedPosts: 0,
        failedPosts: 0,
        startedAt: new Date("2026-06-28T10:00:10.000Z"),
        finishedAt: new Date("2026-06-28T10:02:10.000Z"),
        actualDurationSeconds: 120,
        estimatedDurationSeconds: 100,
        successProbabilitySnapshot: null,
        usageTokens: null,
        usageCostUsd: null,
        failureReason: null,
        details: { posts: [], noGeneratedFetchTasks: true },
        builder: { name: "Empty Feed", sourceType: "blog" },
      },
    ],
  });

  assert.equal(result.tasks[0]?.plannedPosts, 0);
  assert.equal(result.tasks[0]?.posts.length, 0);
  assert.equal(result.tasks[0]?.noGeneratedFetchTasks, true);
});

test("serializeCloudFetchRun converts a Prisma Decimal cost via Number()", () => {
  const result = serializeCloudFetchRun({
    ...baseRun,
    usageCostUsd: { toString: () => "1.25" },
    tasks: [],
  });

  assert.equal(result.usageCostUsd, 1.25);
});

test("serializeCloudWorkerHost exposes live host progress and post task queue", () => {
  const result = serializeCloudWorkerHost(
    {
      status: "running",
      startedAt: "2026-06-28T10:00:00.000Z",
      heartbeatAt: "2026-06-28T10:01:30.000Z",
      updatedAt: "2026-06-28T10:01:30.000Z",
      runtime: "codex",
      runnerPid: 1234,
      workerPid: 1235,
      hostname: "admin-mac",
      platform: "darwin",
      stage: "workers_running",
      summary: "workers running · 1/2 tasks",
      details: {
        agentModel: "gpt-5.4-mini",
        localWorkers: 4,
        progress: {
          stage: "workers_running",
          updatedAt: "2026-06-28T10:01:29.000Z",
          counters: {
            sourcesTotal: 3,
            sourcesChecked: 2,
            tasksPlanned: 2,
            tasksDone: 1,
            synced: 1,
            failed: 0,
            skipped: 0,
            actionNeeded: 0,
          },
          current: { source: "Example Feed", task: "Post One" },
          tasks: [
            {
              id: "task_1",
              status: "synced",
              phase: "completed",
              message: "synced.",
              builder: "Example Feed",
              builderId: "cb_1",
              sourceType: "blog",
              title: "Post One",
              url: "https://example.com/1",
              workerId: "shard-0",
              bodyChars: 1200,
              bodyWords: 180,
              summaryChars: 300,
              summaryWords: 45,
              updatedAt: "2026-06-28T10:01:20.000Z",
            },
          ],
          recentEvents: [
            {
              at: "2026-06-28T10:01:20.000Z",
              type: "task_completed",
              taskId: "task_1",
              status: "synced",
              message: "task_1: synced.",
            },
          ],
        },
      },
    },
    new Date("2026-06-28T10:02:00.000Z"),
  );

  assert.equal(result.status, "online");
  assert.equal(result.statusLabel, "Online");
  assert.equal(result.hostname, "admin-mac");
  assert.equal(result.model, "gpt-5.4-mini");
  assert.equal(result.localWorkers, 4);
  assert.equal(result.progress?.stage, "workers_running");
  assert.equal(result.progress?.currentTask, "Post One");
  assert.equal(result.progress?.tasksPlanned, 2);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].workerId, "shard-0");
  assert.equal(result.tasks[0].bodyChars, 1200);
  assert.equal(result.tasks[0].bodyWords, 180);
  assert.equal(result.tasks[0].summaryChars, 300);
  assert.equal(result.tasks[0].summaryWords, 45);
  assert.equal(result.recentEvents[0].status, "synced");
});

test("serializeCloudWorkerHost normalizes completed post task counts and skipped reasons", () => {
  const result = serializeCloudWorkerHost(
    {
      status: "running",
      startedAt: "2026-06-28T10:00:00.000Z",
      heartbeatAt: "2026-06-28T10:01:30.000Z",
      runtime: "codex",
      details: {
        progress: {
          stage: "workers_running",
          counters: {
            tasksPlanned: 46,
            tasksDone: 50,
            synced: 39,
            failed: 7,
            skipped: 4,
            actionNeeded: 0,
          },
          tasks: [
            {
              id: "skip_1",
              status: "skipped",
              message: "skipped: no_content",
              reason: "no_content",
            },
          ],
        },
      },
    },
    new Date("2026-06-28T10:02:00.000Z"),
  );

  assert.equal(result.progress?.tasksDone, 50);
  assert.equal(result.progress?.tasksPlanned, 50);
  assert.equal(result.tasks[0].reason, "no_content");
});

test("serializeCloudWorkerHost marks stale and missing hosts clearly", () => {
  const stale = serializeCloudWorkerHost(
    {
      status: "running",
      startedAt: "2026-06-28T10:00:00.000Z",
      heartbeatAt: "2026-06-28T10:00:00.000Z",
      details: {},
    },
    new Date("2026-06-28T10:06:01.000Z"),
  );
  assert.equal(stale.status, "stale");
  assert.equal(stale.statusLabel, "Stale");

  const offline = serializeCloudWorkerHost(null);
  assert.equal(offline.status, "offline");
  assert.equal(offline.statusLabel, "No host heartbeat");
  assert.deepEqual(offline.tasks, []);
});
