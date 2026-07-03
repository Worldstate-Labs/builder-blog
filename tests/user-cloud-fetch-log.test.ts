import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeUserCloudFetchLog,
  type UserCloudFetchSubmissionRow,
} from "../src/lib/user-cloud-fetch-log";

function submission(
  overrides: Partial<UserCloudFetchSubmissionRow["cloudBuilder"]["cloudSourceTask"]> = {},
): UserCloudFetchSubmissionRow {
  return {
    id: "sub_1",
    userBuilderId: "user_builder_1",
    cloudBuilderId: "cloud_builder_1",
    summaryLanguage: "zh",
    frequency: "DAILY",
    submittedAt: new Date("2026-07-02T10:00:00.000Z"),
    userBuilder: {
      id: "user_builder_1",
      entityId: "entity_1",
      kind: "BLOG",
      name: "Example Source",
      sourceType: "blog",
      sourceUrl: "https://example.com",
      fetchUrl: "https://example.com/feed.xml",
      avatarUrl: null,
      avatarDataUrl: null,
    },
    cloudBuilder: {
      id: "cloud_builder_1",
      entityId: "entity_1",
      kind: "BLOG",
      name: "Example Source",
      sourceType: "blog",
      sourceUrl: "https://example.com",
      fetchUrl: "https://example.com/feed.xml",
      avatarUrl: null,
      avatarDataUrl: null,
      _count: { feedItems: 7 },
      cloudSourceTask: {
        id: "cloud_task_1",
        builderId: "cloud_builder_1",
        status: "ACTIVE",
        effectiveFrequency: "DAILY",
        lastSuccessAt: new Date("2026-07-03T10:00:00.000Z"),
        lastFailureAt: null,
        lastFailureReason: null,
        nextAttemptAt: new Date("2026-07-04T08:00:00.000Z"),
        mustSucceedBy: new Date("2026-07-04T10:00:00.000Z"),
        consecutiveFailures: 0,
        runTasks: [
          {
            id: "run_task_1",
            builderId: "cloud_builder_1",
            summaryLanguage: "zh",
            status: "succeeded",
            plannedPosts: 1,
            syncedPosts: 1,
            failedPosts: 0,
            startedAt: new Date("2026-07-03T09:58:00.000Z"),
            finishedAt: new Date("2026-07-03T10:00:00.000Z"),
            actualDurationSeconds: 120,
            estimatedDurationSeconds: 180,
            successProbabilitySnapshot: 0.95,
            usageTokens: 1200,
            usageCostUsd: null,
            failureReason: null,
            details: {
              fetchTasks: [
                {
                  id: "post_task_1",
                  title: "Fetched post",
                  url: "https://example.com/post",
                  status: "synced",
                  bodyWords: 500,
                  summaryWords: 80,
                },
              ],
            },
            builder: { name: "Example Source", sourceType: "blog" },
          },
        ],
        ...overrides,
      },
    },
  };
}

test("serializeUserCloudFetchLog marks a daily source on time inside its current deadline window", () => {
  const result = serializeUserCloudFetchLog(
    [submission()],
    new Date("2026-07-03T12:00:00.000Z"),
  );

  assert.equal(result.submittedSourceCount, 1);
  assert.equal(result.frequency, "DAILY");
  assert.equal(result.summaryLanguage, "zh");
  assert.equal(result.sources[0]?.deadlineStatus, "ON_TIME");
  assert.equal(result.sources[0]?.latestRunTask?.posts[0]?.title, "Fetched post");
  assert.equal(result.sources[0]?.postCount, 7);
});

test("serializeUserCloudFetchLog marks a source missed after its deadline passes without success", () => {
  const result = serializeUserCloudFetchLog(
    [
      submission({
        lastSuccessAt: null,
        mustSucceedBy: new Date("2026-07-02T10:00:00.000Z"),
        runTasks: [],
      }),
    ],
    new Date("2026-07-03T12:00:00.000Z"),
  );

  assert.equal(result.sources[0]?.deadlineStatus, "MISSED");
  assert.equal(result.sources[0]?.latestRunTask, null);
});
