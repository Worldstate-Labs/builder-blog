import assert from "node:assert/strict";
import test from "node:test";

import { serializeCloudFetchRun } from "../src/lib/cloud-fetch-run-log";

test("serializeCloudFetchRun maps a run and its source tasks to a JSON-safe shape", () => {
  const result = serializeCloudFetchRun({
    id: "run_1",
    startedAt: new Date("2026-06-28T10:00:00.000Z"),
    finishedAt: new Date("2026-06-28T10:05:00.000Z"),
    status: "PARTIAL",
    requestedLimit: 5,
    tasksClaimed: 3,
    tasksSucceeded: 2,
    tasksFailed: 1,
    usageTokens: 12000,
    usageCostUsd: 0.42,
    summary: "2 ok, 1 failed",
    tasks: [
      {
        id: "rt_1",
        builderId: "cb_1",
        summaryLanguage: "zh",
        status: "SUCCEEDED",
        plannedPosts: 4,
        syncedPosts: 4,
        failedPosts: 0,
        actualDurationSeconds: 120,
        failureReason: null,
        builder: { name: "Example Feed", sourceType: "blog" },
      },
      {
        id: "rt_2",
        builderId: "cb_2",
        summaryLanguage: "zh",
        status: "FAILED",
        plannedPosts: 2,
        syncedPosts: 0,
        failedPosts: 2,
        actualDurationSeconds: 30,
        failureReason: "summary_missing",
        builder: null,
      },
    ],
  });

  assert.equal(result.id, "run_1");
  assert.equal(result.startedAt, "2026-06-28T10:00:00.000Z");
  assert.equal(result.finishedAt, "2026-06-28T10:05:00.000Z");
  assert.equal(result.durationMs, 5 * 60_000);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.requestedLimit, 5);
  assert.equal(result.tasksClaimed, 3);
  assert.equal(result.tasksSucceeded, 2);
  assert.equal(result.tasksFailed, 1);
  assert.equal(result.usageTokens, 12000);
  assert.equal(result.usageCostUsd, 0.42);
  assert.equal(result.summary, "2 ok, 1 failed");
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(result.tasks[0], {
    id: "rt_1",
    builderId: "cb_1",
    sourceName: "Example Feed",
    sourceType: "blog",
    summaryLanguage: "zh",
    status: "SUCCEEDED",
    plannedPosts: 4,
    syncedPosts: 4,
    failedPosts: 0,
    actualDurationSeconds: 120,
    failureReason: null,
  });
  assert.equal(result.tasks[1].sourceName, null);
  assert.equal(result.tasks[1].sourceType, null);
  assert.equal(result.tasks[1].failureReason, "summary_missing");
});

test("serializeCloudFetchRun handles a still-running run with null finish and usage", () => {
  const result = serializeCloudFetchRun({
    id: "run_2",
    startedAt: new Date("2026-06-28T11:00:00.000Z"),
    finishedAt: null,
    status: "RUNNING",
    requestedLimit: 2,
    tasksClaimed: 2,
    tasksSucceeded: 0,
    tasksFailed: 0,
    usageTokens: null,
    usageCostUsd: null,
    summary: null,
    tasks: [],
  });

  assert.equal(result.finishedAt, null);
  assert.equal(result.durationMs, null);
  assert.equal(result.usageTokens, null);
  assert.equal(result.usageCostUsd, null);
  assert.equal(result.summary, null);
  assert.deepEqual(result.tasks, []);
});

test("serializeCloudFetchRun converts a Prisma Decimal cost via Number()", () => {
  const result = serializeCloudFetchRun({
    id: "run_3",
    startedAt: new Date("2026-06-28T12:00:00.000Z"),
    finishedAt: new Date("2026-06-28T12:01:00.000Z"),
    status: "SUCCEEDED",
    requestedLimit: 1,
    tasksClaimed: 1,
    tasksSucceeded: 1,
    tasksFailed: 0,
    usageTokens: 100,
    // Mimic a Prisma.Decimal: an object that Number()-coerces via toString.
    usageCostUsd: { toString: () => "1.25" },
    summary: "ok",
    tasks: [],
  });

  assert.equal(result.usageCostUsd, 1.25);
});
