import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMediaToolFailure,
  mediaFailureEvidence,
  shouldRetryMediaToolFailure,
  ytDlpMaintenanceWarnings,
} from "../scripts/media-tool-failures.mjs";

const now = new Date("2026-08-12T12:00:00.000Z");

test("ambiguous YouTube 403 is retryable and keeps the stale downloader warning separate", () => {
  const failure = classifyMediaToolFailure({
    stage: "download",
    toolVersion: "2026.03.17",
    now,
    result: {
      ok: false,
      code: 1,
      stdout: "",
      stderr: [
        "WARNING: Your yt-dlp version (2026.03.17) is older than 90 days!",
        "ERROR: unable to download video data: HTTP Error 403: Forbidden",
        "https://www.youtube.com/watch?v=abc123&token=secret",
        "Cookie: SID=private-value",
        "/Users/jie/.config/yt-dlp/config",
      ].join("\n"),
      timedOut: false,
    },
  });

  assert.ok(failure);
  assert.equal(failure.code, "media_download_forbidden");
  assert.equal(failure.retryable, true);
  assert.equal(failure.httpStatus, 403);
  assert.deepEqual(failure.maintenanceWarnings, ["yt_dlp_outdated"]);
  assert.doesNotMatch(failure.diagnostic ?? "", /secret|private-value|\/Users\/jie/);
  assert.match(failure.diagnostic ?? "", /HTTP Error 403/);
  assert.equal(
    shouldRetryMediaToolFailure({ failure, attempt: 1, remainingBudgetMs: 30_000 }),
    true,
  );
});

test("a stale-version warning on a successful download is maintenance, not a fetch failure", () => {
  const result = {
    ok: true,
    code: 0,
    stdout: "",
    stderr: "WARNING: Your yt-dlp version (2026.03.17) is older than 90 days!",
    timedOut: false,
  };

  assert.equal(classifyMediaToolFailure({ stage: "download", result, now }), null);
  assert.deepEqual(
    ytDlpMaintenanceWarnings({ result, toolVersion: "2026.03.17", now }),
    ["yt_dlp_outdated"],
  );
});

test("durable access failures are not retried even when they also include HTTP 403", () => {
  const failure = classifyMediaToolFailure({
    stage: "download",
    result: {
      ok: false,
      code: 1,
      stdout: "",
      stderr: "ERROR: Sign in to confirm you're not a bot. A PO Token is required. HTTP Error 403",
      timedOut: false,
    },
  });

  assert.ok(failure);
  assert.equal(failure.code, "media_download_access_required");
  assert.equal(failure.retryable, false);
  assert.equal(
    shouldRetryMediaToolFailure({ failure, attempt: 1, remainingBudgetMs: 60_000 }),
    false,
  );
});

test("download classifier distinguishes rate limits, temporary failures, missing output, and unavailable media", () => {
  const cases = [
    ["HTTP Error 429: Too Many Requests", "media_download_rate_limited", true],
    ["HTTP Error 503: Service Unavailable", "media_download_temporarily_unavailable", true],
    ["The read operation timed out", "media_download_temporarily_unavailable", true],
    ["ERROR: This video has been removed by the uploader", "media_download_unavailable", false],
  ] as const;

  for (const [stderr, code, retryable] of cases) {
    const failure = classifyMediaToolFailure({
      stage: "download",
      result: { ok: false, code: 1, stdout: "", stderr, timedOut: false },
    });
    assert.ok(failure);
    assert.equal(failure.code, code);
    assert.equal(failure.retryable, retryable);
  }

  const missing = classifyMediaToolFailure({
    stage: "download",
    result: { ok: true, code: 0, stdout: "", stderr: "", outputMissing: true },
  });
  assert.ok(missing);
  assert.equal(missing.code, "media_download_output_missing");
  assert.equal(missing.retryable, true);
});

test("non-download stages use stable codes and bounded evidence", () => {
  const convert = classifyMediaToolFailure({
    stage: "prepare_audio",
    result: { ok: false, code: 1, stdout: "", stderr: "ffmpeg failed", timedOut: false },
  });
  const transcribe = classifyMediaToolFailure({
    stage: "transcribe",
    result: { ok: false, code: 1, stdout: "", stderr: "backend crashed", timedOut: false },
  });

  assert.ok(convert);
  assert.ok(transcribe);
  assert.equal(convert.code, "media_convert_failed");
  assert.equal(transcribe.code, "media_transcription_failed");
  assert.deepEqual(mediaFailureEvidence(convert), {
    code: "media_convert_failed",
    stage: "prepare_audio",
    retryable: false,
    exitCode: 1,
    diagnostic: "ffmpeg failed",
  });
});

test("retry policy allows only one retry and preserves thirty seconds for downstream work", () => {
  const failure = { retryable: true };
  assert.equal(
    shouldRetryMediaToolFailure({ failure, attempt: 1, remainingBudgetMs: 29_999 }),
    false,
  );
  assert.equal(
    shouldRetryMediaToolFailure({ failure, attempt: 2, remainingBudgetMs: 60_000 }),
    false,
  );
});
