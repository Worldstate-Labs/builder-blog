import assert from "node:assert/strict";
import test from "node:test";

import { deriveCloudFetchOutcomeSummary } from "../src/lib/cloud-fetch-outcome-summary";

test("deriveCloudFetchOutcomeSummary treats skipped posts as terminal non-failures", () => {
  const summary = deriveCloudFetchOutcomeSummary({
    status: "failed",
    plannedPosts: 1,
    syncedPosts: 0,
    failedPosts: 1,
    failureReason: "no_primary_content",
    posts: [{ status: "skipped", failureReason: "no_primary_content" }],
  });

  assert.deepEqual(summary, {
    status: "SUCCEEDED",
    plannedPosts: 1,
    syncedPosts: 0,
    skippedPosts: 1,
    failedPosts: 0,
    pendingPosts: 0,
    failureReason: null,
  });
});

test("deriveCloudFetchOutcomeSummary preserves real failures in mixed skipped and failed outcomes", () => {
  const summary = deriveCloudFetchOutcomeSummary({
    status: "failed",
    plannedPosts: 2,
    syncedPosts: 0,
    failedPosts: 2,
    failureReason: "no_primary_content",
    posts: [
      { status: "skipped", failureReason: "no_primary_content" },
      { status: "failed", failureReason: "worker_missing_result" },
    ],
  });

  assert.equal(summary.status, "PARTIAL");
  assert.equal(summary.skippedPosts, 1);
  assert.equal(summary.failedPosts, 1);
  assert.equal(summary.pendingPosts, 0);
  assert.equal(summary.failureReason, "worker_missing_result");
});

test("deriveCloudFetchOutcomeSummary keeps unfinished source tasks pending", () => {
  const summary = deriveCloudFetchOutcomeSummary({
    status: "running",
    plannedPosts: 3,
    syncedPosts: 1,
    failedPosts: 0,
    posts: [{ status: "synced" }],
  });

  assert.equal(summary.status, "RUNNING");
  assert.equal(summary.syncedPosts, 1);
  assert.equal(summary.pendingPosts, 2);
});

test("deriveCloudFetchOutcomeSummary keeps zero-post running source tasks running", () => {
  const summary = deriveCloudFetchOutcomeSummary({
    status: "running",
    plannedPosts: 0,
    syncedPosts: 0,
    failedPosts: 0,
    posts: [],
  });

  assert.equal(summary.status, "RUNNING");
  assert.equal(summary.pendingPosts, 0);
});
