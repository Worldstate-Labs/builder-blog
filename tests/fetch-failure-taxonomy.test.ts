import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  fetchFailureInfo,
  fetchFailureMessage,
  isContentFailureReason,
  isHiddenFailureReason,
  isNotCompletedFailureReason,
  KNOWN_FETCH_FAILURE_CODES,
} from "../src/lib/fetch-failure-taxonomy";

const REQUIRED_CODES = [
  "summary_missing",
  "not_summarized",
  "not_synced",
  "content_missing",
  "no_primary_content",
  "content_too_short",
  "content_validation_failed",
  "primary_content_unavailable",
  "workload_exceeds_max_budget",
  "extraction_exceeds_shard_timeout",
  "runtime_auth_failed",
  "runtime_timeout",
  "runtime_timeout_no_fetch_result",
  "runtime_timeout_flush_failed",
  "runtime_timeout_flush_finished",
  "task_validation_failed",
  "task_sync_failed",
  "slice_sync_failed",
  "cloud_feed_sync_rejected",
  "worker_missing_result",
  "worker_shard_timeout",
  "worker_no_progress_timeout",
  "worker_stalled_timeout",
  "worker_stopped_before_task_started",
  "worker_incomplete_result",
  "worker_backgrounded_tool",
  "discovery_not_expanded",
];

test("fetch failure taxonomy covers known CLI and sync failure codes", () => {
  for (const code of REQUIRED_CODES) {
    const info = fetchFailureInfo(code);
    assert.equal(info.code, code);
    assert.notEqual(info.category, "unknown", `${code} should have a category`);
    assert.ok(info.userMessage.length > 0, `${code} should have a user message`);
    assert.ok(info.operatorMessage.length > 0, `${code} should have an operator message`);
    assert.equal(typeof info.retryable, "boolean", `${code} should declare retryability`);
  }

  assert.deepEqual(
    REQUIRED_CODES.filter((code) => !KNOWN_FETCH_FAILURE_CODES.includes(code)),
    [],
  );
});

test("fetch failure taxonomy exposes stage helpers used by the fetch log UI", () => {
  assert.equal(fetchFailureMessage("worker_backgrounded_tool"), "Local Agent started a background tool before this post finished");
  assert.equal(fetchFailureMessage("runtime_timeout"), "Local Agent runtime timed out before this post finished");
  assert.equal(
    fetchFailureMessage("runtime_timeout_flush_finished"),
    "Local Agent runtime timed out after syncing terminal fetch results",
  );
  assert.equal(
    fetchFailureMessage("worker_no_progress_timeout"),
    "Worker watchdog stopped this post before any checkpoint progress",
  );
  assert.equal(
    fetchFailureMessage("worker_stalled_timeout"),
    "Worker watchdog stopped this post after checkpoint progress stalled",
  );
  assert.equal(
    fetchFailureMessage("worker_stopped_before_task_started"),
    "Local Agent stopped before starting this post",
  );
  assert.equal(fetchFailureMessage("unknown_new_code"), "Unknown failure: unknown new code");
  assert.equal(isContentFailureReason("content_missing"), true);
  assert.equal(isContentFailureReason("worker_missing_result"), false);
  assert.equal(isNotCompletedFailureReason("worker_no_progress_timeout"), true);
  assert.equal(isNotCompletedFailureReason("runtime_timeout"), true);
  assert.equal(isNotCompletedFailureReason("runtime_timeout_flush_finished"), true);
  assert.equal(isNotCompletedFailureReason("worker_stalled_timeout"), true);
  assert.equal(isNotCompletedFailureReason("worker_stopped_before_task_started"), true);
  assert.equal(isNotCompletedFailureReason("worker_backgrounded_tool"), true);
  assert.equal(isNotCompletedFailureReason("summary_missing"), false);
  assert.equal(isHiddenFailureReason("heartbeat"), true);
  assert.equal(isHiddenFailureReason("worker_backgrounded_tool"), false);
});

test("fetch failure taxonomy classifies budgeted extraction terminals as content-stage read outcomes", () => {
  assert.deepEqual(fetchFailureInfo("workload_exceeds_max_budget"), {
    code: "workload_exceeds_max_budget",
    known: true,
    category: "content",
    stage: "read",
    userMessage: "This source exceeded the maximum supported extraction workload",
    operatorMessage: "The planned extraction workload exceeded the supported four-hour execution ceiling, so the run stopped before attempting extraction.",
    retryable: false,
    visibility: "user",
    contentFailure: true,
  });
  assert.deepEqual(fetchFailureInfo("extraction_exceeds_shard_timeout"), {
    code: "extraction_exceeds_shard_timeout",
    known: true,
    category: "content",
    stage: "read",
    userMessage: "This source could not finish extraction within the current shard budget",
    operatorMessage: "The extraction plan could not safely complete within the shard's remaining execution budget, so the run stopped before starting extraction.",
    retryable: true,
    visibility: "user",
    contentFailure: true,
  });
  assert.equal(isContentFailureReason("workload_exceeds_max_budget"), true);
  assert.equal(isContentFailureReason("extraction_exceeds_shard_timeout"), true);
  assert.equal(isNotCompletedFailureReason("workload_exceeds_max_budget"), false);
  assert.equal(isNotCompletedFailureReason("extraction_exceeds_shard_timeout"), false);
});

test("FetchLogPanel uses the central failure taxonomy instead of local labels", async () => {
  const panel = await readFile("src/components/FetchLogPanel.tsx", "utf8");
  assert.match(panel, /from "@\/lib\/fetch-failure-taxonomy"/);
  assert.doesNotMatch(panel, /const FAILURE_REASON_LABEL/);
  assert.match(panel, /fetchFailureMessage\(task\.failureReason\)/);
});
