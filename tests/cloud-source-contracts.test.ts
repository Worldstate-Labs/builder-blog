import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCloudFetchFrequencyInput,
  normalizeCloudSourceSubmissionInput,
  parseCloudFetchSyncPayload,
} from "../src/lib/cloud-source-contracts";

test("cloud fetch frequency accepts only day and week inputs", () => {
  assert.equal(normalizeCloudFetchFrequencyInput("day"), "DAILY");
  assert.equal(normalizeCloudFetchFrequencyInput("week"), "WEEKLY");
  assert.throws(() => normalizeCloudFetchFrequencyInput("hour"), /frequency must be day or week/);
});

test("cloud source submission normalizes fixed summary language", () => {
  const normalized = normalizeCloudSourceSubmissionInput({
    frequency: "day",
    summaryLanguage: " Chinese ",
  });

  assert.deepEqual(normalized, {
    frequency: "DAILY",
    summaryLanguage: "Chinese",
  });
});

test("cloud source submission accepts original as its own language", () => {
  assert.deepEqual(
    normalizeCloudSourceSubmissionInput({ frequency: "week", summaryLanguage: "original" }),
    {
      frequency: "WEEKLY",
      summaryLanguage: "source",
    },
  );
});

test("cloud fetch sync payload requires a cloud run id and task results", () => {
  const parsed = parseCloudFetchSyncPayload({
    cloudRunId: "run_1",
    summaryLanguage: "zh",
    builders: [],
    taskOutcomes: [],
    taskResults: [
      {
        cloudSourceTaskId: "task_1",
        status: "succeeded",
        plannedPosts: 3,
        syncedPosts: 3,
        failedPosts: 0,
        actualDurationSeconds: 120,
        usageTokens: 1000,
        usageCostUsd: 0.25,
      },
    ],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.cloudRunId, "run_1");
  assert.equal(parsed.data.taskResults[0].status, "succeeded");
});

test("cloud fetch sync payload requires a failure reason for failed task results", () => {
  const parsed = parseCloudFetchSyncPayload({
    cloudRunId: "run_1",
    builders: [],
    taskResults: [
      {
        cloudSourceTaskId: "task_1",
        status: "failed",
        plannedPosts: 3,
        syncedPosts: 1,
        failedPosts: 2,
      },
    ],
  });

  assert.equal(parsed.success, false);
});

test("cloud fetch sync payload accepts partial task results with a failure reason", () => {
  const parsed = parseCloudFetchSyncPayload({
    cloudRunId: "run_1",
    builders: [],
    taskResults: [
      {
        cloudSourceTaskId: "task_1",
        status: "partial",
        plannedPosts: 3,
        syncedPosts: 2,
        failedPosts: 1,
        failureReason: "worker_missing_result",
      },
    ],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.taskResults[0].status, "partial");
});

test("cloud fetch sync payload normalizes string task outcome evidence", () => {
  const parsed = parseCloudFetchSyncPayload({
    cloudRunId: "run_1",
    builders: [],
    taskOutcomes: [
      {
        fetchTaskId: "fetch_post:nyt",
        status: "failed",
        reason: "fetch_error",
        evidence: "NYT paywall and Cloudflare blocked all extraction methods.",
      },
    ],
    taskResults: [
      {
        cloudSourceTaskId: "task_1",
        status: "failed",
        plannedPosts: 1,
        syncedPosts: 0,
        failedPosts: 1,
        failureReason: "fetch_error",
      },
    ],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data.taskOutcomes[0].evidence, {
    message: "NYT paywall and Cloudflare blocked all extraction methods.",
  });
});
