import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudSourceResultIncompleteError,
  classifyCloudFetchTerminalWrite,
  reconcileCloudFetchTerminalResult,
} from "../src/lib/cloud-fetch-terminal-reconcile";

const planPosts = {
  post_1: {
    postTaskId: "post_1",
    title: "Accepted post",
    url: "https://example.com/accepted",
    workerId: "worker-0",
  },
  post_2: {
    postTaskId: "post_2",
    title: "Skipped post",
    url: "https://example.com/skipped",
    workerId: "worker-1",
  },
  post_3: {
    postTaskId: "post_3",
    title: "Rejected post",
    url: "https://example.com/rejected",
    workerId: "worker-2",
  },
  post_4: {
    postTaskId: "post_4",
    title: "Failed post",
    url: "https://example.com/failed",
    workerId: "worker-3",
  },
};

test("terminal reconciliation derives every post and aggregate from server-accepted facts", () => {
  const result = reconcileCloudFetchTerminalResult({
    cloudSourceTaskId: "source_1",
    executionPlanPosts: planPosts,
    clientResult: {
      cloudSourceTaskId: "source_1",
      status: "succeeded",
      plannedPosts: 1,
      syncedPosts: 1,
      failedPosts: 0,
      details: {
        posts: [
          {
            id: "post_1",
            status: "synced",
            summaryChars: 0,
            headlineChars: 0,
            agentRuntime: "codex",
            agentModel: "gpt-5.4-mini",
          },
        ],
      },
    },
    submittedItems: [
      {
        fetchTaskId: "post_1",
        title: "Accepted post",
        url: "https://example.com/accepted",
        body: "Original body",
        summary: "A complete accepted summary.",
        headline: "Accepted headline",
      },
      {
        fetchTaskId: "post_3",
        title: "Rejected post",
        url: "https://example.com/rejected",
        body: "Original rejected body",
        summary: "",
        headline: "",
      },
    ],
    itemResults: [
      {
        fetchTaskId: "post_1",
        kind: "BLOG_POST",
        externalId: "accepted",
        status: "synced",
      },
      {
        fetchTaskId: "post_3",
        kind: "BLOG_POST",
        externalId: "rejected",
        status: "failed",
        reason: "summary_missing",
      },
    ],
    taskOutcomes: [
      { fetchTaskId: "post_2", status: "skipped", reason: "older_than_cutoff" },
      { fetchTaskId: "post_4", status: "failed", reason: "worker_timeout" },
    ],
  });

  assert.equal(result.status, "partial");
  assert.equal(result.plannedPosts, 4);
  assert.equal(result.syncedPosts, 1);
  assert.equal(result.skippedPosts, 1);
  assert.equal(result.failedPosts, 2);
  assert.equal(result.details.posts.length, 4);
  assert.deepEqual(
    result.details.posts.map((post) => [post.id, post.status]),
    [
      ["post_1", "synced"],
      ["post_2", "skipped"],
      ["post_3", "failed"],
      ["post_4", "failed"],
    ],
  );
  assert.deepEqual(result.details.posts[0], {
    id: "post_1",
    title: "Accepted post",
    url: "https://example.com/accepted",
    workerId: "worker-0",
    status: "synced",
    failureReason: null,
    completedStage: "summarize",
    bodyChars: 13,
    bodyWords: 2,
    summaryChars: 28,
    summaryWords: 4,
    headlineChars: 17,
    headlineWords: 2,
    agentRuntime: "codex",
    agentModel: "gpt-5.4-mini",
  });
  assert.match(result.requestDigest, /^[a-f0-9]{64}$/);
});

test("terminal reconciliation preserves per-post validation evidence", () => {
  const result = reconcileCloudFetchTerminalResult({
    cloudSourceTaskId: "source_validation",
    executionPlanPosts: { post_1: planPosts.post_1 },
    clientResult: {
      cloudSourceTaskId: "source_validation",
      status: "failed",
      plannedPosts: 1,
      syncedPosts: 0,
      failedPosts: 1,
      failureReason: "task_validation_failed",
      details: {
        posts: [
          {
            id: "post_1",
            status: "failed",
            failureReason: "task_validation_failed",
            evidence: {
              validation: {
                builder: "Example source",
                item: "post_1",
                errors: ["missing_synced_item_for_fetch_task"],
              },
            },
          },
        ],
      },
    },
    submittedItems: [],
    itemResults: [],
    taskOutcomes: [
      { fetchTaskId: "post_1", status: "failed", reason: "task_validation_failed" },
    ],
  });

  assert.deepEqual(result.details.posts[0].evidence, {
    validation: {
      builder: "Example source",
      item: "post_1",
      errors: ["missing_synced_item_for_fetch_task"],
    },
  });
});

test("terminal reconciliation keeps a synced sibling plus media failure partial", () => {
  const result = reconcileCloudFetchTerminalResult({
    cloudSourceTaskId: "source_media_partial",
    executionPlanPosts: {
      post_1: planPosts.post_1,
      post_2: planPosts.post_2,
    },
    clientResult: {
      cloudSourceTaskId: "source_media_partial",
      status: "partial",
      plannedPosts: 2,
      syncedPosts: 1,
      failedPosts: 1,
      failureReason: "media_download_forbidden",
      details: {},
    },
    submittedItems: [{
      fetchTaskId: "post_1",
      title: "Accepted post",
      url: "https://example.com/accepted",
      body: "Original body",
      summary: "A complete accepted summary.",
      headline: "Accepted headline",
    }],
    itemResults: [{
      fetchTaskId: "post_1",
      kind: "BLOG_POST",
      externalId: "accepted",
      status: "synced",
    }],
    taskOutcomes: [{
      fetchTaskId: "post_2",
      status: "failed",
      reason: "media_download_forbidden",
      evidence: {
        mediaFailure: {
          code: "media_download_forbidden",
          stage: "download",
          processAttempts: 2,
          httpStatus: 403,
        },
      },
    }],
  });

  assert.equal(result.status, "partial");
  assert.equal(result.syncedPosts, 1);
  assert.equal(result.failedPosts, 1);
  assert.equal(result.deferredPosts, 0);
  assert.equal(result.failureReason, "media_download_forbidden");
  assert.deepEqual(result.details.posts.map((post) => post.status), ["synced", "failed"]);
  const failedEvidence = result.details.posts[1].evidence as {
    mediaFailure: { httpStatus: number };
  };
  assert.equal(failedEvidence.mediaFailure.httpStatus, 403);
});

test("terminal reconciliation defers an all-ASR-capability-blocked source", () => {
  const result = reconcileCloudFetchTerminalResult({
    cloudSourceTaskId: "source_asr",
    executionPlanPosts: {
      post_1: planPosts.post_1,
      post_2: planPosts.post_2,
    },
    clientResult: {
      cloudSourceTaskId: "source_asr",
      status: "failed",
      plannedPosts: 2,
      syncedPosts: 0,
      failedPosts: 2,
      failureReason: "asr_capability_missing",
      details: {},
    },
    submittedItems: [],
    itemResults: [],
    taskOutcomes: [
      { fetchTaskId: "post_1", status: "blocked", reason: "asr_capability_missing" },
      { fetchTaskId: "post_2", status: "blocked", reason: "asr_capability_missing" },
    ],
  });

  assert.equal(result.status, "deferred");
  assert.equal(result.failedPosts, 0);
  assert.equal(result.deferredPosts, 2);
  assert.equal(result.failureReason, "asr_capability_missing");
  assert.deepEqual(result.details.posts.map((post) => post.status), ["blocked", "blocked"]);
});

test("terminal reconciliation keeps a partly synced source deferred when ASR capability is missing", () => {
  const result = reconcileCloudFetchTerminalResult({
    cloudSourceTaskId: "source_mixed_asr",
    executionPlanPosts: {
      post_1: planPosts.post_1,
      post_2: planPosts.post_2,
    },
    clientResult: {
      cloudSourceTaskId: "source_mixed_asr",
      status: "partial",
      plannedPosts: 2,
      syncedPosts: 1,
      failedPosts: 1,
      failureReason: "asr_capability_missing",
      details: {},
    },
    submittedItems: [
      {
        fetchTaskId: "post_1",
        title: "Accepted post",
        url: "https://example.com/accepted",
        body: "Original body",
        summary: "A complete accepted summary.",
        headline: "Accepted headline",
      },
    ],
    itemResults: [
      {
        fetchTaskId: "post_1",
        kind: "BLOG_POST",
        externalId: "accepted",
        status: "synced",
      },
    ],
    taskOutcomes: [
      { fetchTaskId: "post_2", status: "blocked", reason: "asr_capability_missing" },
    ],
  });

  assert.equal(result.status, "deferred");
  assert.equal(result.syncedPosts, 1);
  assert.equal(result.deferredPosts, 1);
  assert.equal(result.failedPosts, 0);
  assert.equal(result.failureReason, "asr_capability_missing");
  assert.deepEqual(result.details.posts.map((post) => post.status), ["synced", "blocked"]);
});

test("terminal reconciliation rejects incomplete evidence before any feed write can begin", () => {
  assert.throws(
    () =>
      reconcileCloudFetchTerminalResult({
        cloudSourceTaskId: "source_1",
        executionPlanPosts: planPosts,
        clientResult: {
          cloudSourceTaskId: "source_1",
          status: "failed",
          plannedPosts: 3,
          syncedPosts: 0,
          failedPosts: 3,
          failureReason: "worker_timeout",
          details: {},
        },
        submittedItems: [],
        itemResults: [],
        taskOutcomes: [
          { fetchTaskId: "post_1", status: "failed", reason: "worker_timeout" },
          { fetchTaskId: "post_2", status: "failed", reason: "worker_timeout" },
          { fetchTaskId: "post_3", status: "failed", reason: "worker_timeout" },
        ],
      }),
    (error: unknown) => {
      assert.equal(error instanceof CloudSourceResultIncompleteError, true);
      assert.deepEqual((error as CloudSourceResultIncompleteError).missingPostTaskIds, ["post_4"]);
      return true;
    },
  );
});

test("terminal reconciliation request digest is stable across evidence ordering", () => {
  const base = {
    cloudSourceTaskId: "source_1",
    executionPlanPosts: { post_1: planPosts.post_1, post_2: planPosts.post_2 },
    clientResult: {
      cloudSourceTaskId: "source_1",
      status: "partial" as const,
      plannedPosts: 2,
      syncedPosts: 1,
      failedPosts: 1,
      failureReason: "worker_timeout",
      details: {},
    },
    submittedItems: [
      {
        fetchTaskId: "post_1",
        title: "Accepted post",
        url: "https://example.com/accepted",
        body: "Original body",
        summary: "A complete accepted summary.",
        headline: "Accepted headline",
      },
    ],
    itemResults: [
      {
        fetchTaskId: "post_1",
        kind: "BLOG_POST" as const,
        externalId: "accepted",
        status: "synced" as const,
      },
    ],
    taskOutcomes: [
      { fetchTaskId: "post_2", status: "failed" as const, reason: "worker_timeout" },
    ],
  };

  const first = reconcileCloudFetchTerminalResult(base);
  const second = reconcileCloudFetchTerminalResult({
    ...base,
    taskOutcomes: [...base.taskOutcomes].reverse(),
    itemResults: [...base.itemResults].reverse(),
  });
  assert.equal(first.requestDigest, second.requestDigest);
});

test("terminal finalization replays only the identical accepted request", () => {
  assert.deepEqual(
    classifyCloudFetchTerminalWrite({
      status: "RUNNING",
      storedRequestDigest: null,
      requestDigest: "digest_a",
    }),
    { action: "finalize" },
  );
  assert.deepEqual(
    classifyCloudFetchTerminalWrite({
      status: "SUCCEEDED",
      storedRequestDigest: "digest_a",
      requestDigest: "digest_a",
    }),
    { action: "replay" },
  );
  assert.throws(
    () =>
      classifyCloudFetchTerminalWrite({
        status: "FAILED",
        storedRequestDigest: "digest_a",
        requestDigest: "digest_b",
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "cloud_source_already_finalized");
      assert.equal((error as { retryable?: boolean }).retryable, false);
      return true;
    },
  );
});
