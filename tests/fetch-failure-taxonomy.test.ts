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
  "runtime_model_incompatible",
  "runtime_interrupted",
  "runtime_timeout",
  "runtime_timeout_no_fetch_result",
  "runtime_timeout_flush_failed",
  "runtime_timeout_flush_finished",
  "task_validation_failed",
  "task_sync_failed",
  "slice_sync_failed",
  "cloud_feed_sync_rejected",
  "media_download_forbidden",
  "media_download_pot_provider_missing",
  "media_download_rate_limited",
  "media_download_temporarily_unavailable",
  "media_download_access_required",
  "media_download_unavailable",
  "media_download_output_missing",
  "media_download_failed",
  "media_convert_failed",
  "media_transcription_failed",
  "worker_missing_result",
  "worker_runtime_failed",
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
  assert.equal(fetchFailureMessage("runtime_interrupted"), "Local Agent stopped before this post reached a terminal result");
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
  assert.equal(isContentFailureReason("runtime_model_incompatible"), false);
  assert.equal(isNotCompletedFailureReason("worker_no_progress_timeout"), true);
  assert.equal(isNotCompletedFailureReason("runtime_interrupted"), true);
  assert.equal(isNotCompletedFailureReason("runtime_timeout"), true);
  assert.equal(isNotCompletedFailureReason("runtime_timeout_flush_finished"), true);
  assert.equal(isNotCompletedFailureReason("worker_stalled_timeout"), true);
  assert.equal(isNotCompletedFailureReason("worker_stopped_before_task_started"), true);
  assert.equal(isNotCompletedFailureReason("worker_backgrounded_tool"), true);
  assert.equal(isNotCompletedFailureReason("worker_runtime_failed"), true);
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
    operatorMessage: "The planned extraction workload exceeded the supported six-hour execution ceiling, so the run stopped before attempting extraction.",
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

test("fetch failure taxonomy classifies interrupted runtime terminals as retryable runtime-stage outcomes", () => {
  assert.deepEqual(fetchFailureInfo("runtime_interrupted"), {
    code: "runtime_interrupted",
    known: true,
    category: "runtime",
    stage: "runtime",
    userMessage: "Local Agent stopped before this post reached a terminal result",
    operatorMessage: "The local runtime stopped before this post reached a terminal fetch outcome.",
    retryable: true,
    visibility: "user",
    notCompleted: true,
  });
});

test("fetch failure taxonomy classifies managed media read-stage failures with stable stage semantics", () => {
  assert.deepEqual(fetchFailureInfo("media_download_forbidden"), {
    code: "media_download_forbidden",
    known: true,
    category: "runtime",
    stage: "read",
    userMessage: "Media download returned 403 Forbidden",
    operatorMessage: "The managed media downloader received HTTP 403 without a durable access marker.",
    retryable: true,
    visibility: "user",
    notCompleted: true,
  });
  assert.deepEqual(fetchFailureInfo("media_download_pot_provider_missing"), {
    code: "media_download_pot_provider_missing",
    known: true,
    category: "runtime",
    stage: "read",
    userMessage: "Media download needs a one-time media setup on this machine",
    operatorMessage: "YouTube demanded a proof-of-origin token and this machine has no PO token provider installed. Re-run the FollowBrief media capability setup and consent to installing the PO token provider, then retry the fetch.",
    retryable: false,
    visibility: "user",
    notCompleted: true,
  });
  assert.deepEqual(fetchFailureInfo("media_download_access_required"), {
    code: "media_download_access_required",
    known: true,
    category: "content",
    stage: "read",
    userMessage: "Media download requires access",
    operatorMessage: "The managed media downloader reported that the source requires login, membership, a token, or another access grant that FollowBrief does not provide.",
    retryable: false,
    visibility: "user",
    contentFailure: true,
    notCompleted: true,
  });
  assert.deepEqual(fetchFailureInfo("media_download_unavailable"), {
    code: "media_download_unavailable",
    known: true,
    category: "content",
    stage: "read",
    userMessage: "Media is unavailable",
    operatorMessage: "The managed media downloader reported that the source media was removed, blocked, or did not expose a supported format.",
    retryable: false,
    visibility: "user",
    contentFailure: true,
    notCompleted: true,
  });
  assert.deepEqual(fetchFailureInfo("media_transcription_failed"), {
    code: "media_transcription_failed",
    known: true,
    category: "runtime",
    stage: "read",
    userMessage: "Media transcription failed",
    operatorMessage: "The managed media pipeline could not produce a transcript from the prepared audio artifact.",
    retryable: false,
    visibility: "user",
    notCompleted: true,
  });
  assert.equal(isNotCompletedFailureReason("media_download_rate_limited"), true);
  assert.equal(isNotCompletedFailureReason("media_convert_failed"), true);
  assert.equal(isContentFailureReason("media_download_forbidden"), false);
  assert.equal(isContentFailureReason("media_download_access_required"), true);
  assert.equal(isContentFailureReason("media_download_unavailable"), true);
  assert.equal(isNotCompletedFailureReason("asr_capability_missing"), true);
  assert.equal(fetchFailureMessage("managed_media_preparation_failed"), "Local media preparation failed");
});

test("fetch failure taxonomy normalizes only the approved legacy media failure strings", () => {
  assert.equal(fetchFailureInfo("audio_download_missing_file").code, "media_download_output_missing");
  assert.equal(
    fetchFailureInfo("audio_download: ERROR: unable to download video data: HTTP Error 403: Forbidden").code,
    "media_download_forbidden",
  );
  assert.equal(fetchFailureInfo("audio_download: javascript runtime unavailable").code, "media_download_failed");
  assert.equal(fetchFailureInfo("audio_convert: ffmpeg exited 1").code, "media_convert_failed");
  assert.equal(fetchFailureInfo("video_download: HTTP Error 403: Forbidden").code, "video_download: HTTP Error 403: Forbidden");
  assert.equal(fetchFailureInfo("audio download: HTTP Error 403: Forbidden").code, "audio download: HTTP Error 403: Forbidden");
});

test("FetchLogPanel uses the central failure taxonomy instead of local labels", async () => {
  const panel = await readFile("src/components/FetchLogPanel.tsx", "utf8");
  assert.match(panel, /from "@\/lib\/fetch-failure-taxonomy"/);
  assert.doesNotMatch(panel, /const FAILURE_REASON_LABEL/);
  assert.match(panel, /fetchFailureMessage\(task\.failureReason\)/);
});
