import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("CLI uses one deterministic HTTP sync helper with timeout and retry policy", () => {
  const cli = source("scripts/builder-digest.mjs");

  assert.match(cli, /DEFAULT_HTTP_SYNC_TIMEOUT_MS = 30_000/);
  assert.match(cli, /DEFAULT_LARGE_HTTP_SYNC_TIMEOUT_MS = 120_000/);
  assert.match(cli, /BUILDER_BLOG_HTTP_SYNC_TIMEOUT_MS/);
  assert.match(cli, /BUILDER_BLOG_HTTP_SYNC_RETRY_DELAYS_MS/);
  assert.match(cli, /async function requestJson/);
  assert.match(cli, /async function requestJsonOnce/);
  assert.match(cli, /isRetryableHttpSyncError/);
  assert.match(cli, /\[FollowBrief sync\]/);

  assert.match(cli, /label: "job run update"[\s\S]*retries: HTTP_SYNC_RETRY_DELAYS_MS\.length/);
  assert.match(cli, /label: "digest context"/);
  assert.match(cli, /label: "library context"/);
  assert.match(cli, /label: "fetch log task patch"/);
  assert.match(cli, /label: "cron status sync"[\s\S]*retries: HTTP_SYNC_RETRY_DELAYS_MS\.length/);
  assert.match(cli, /label: "builder sync"[\s\S]*timeoutMs: HTTP_SYNC_LARGE_TIMEOUT_MS[\s\S]*retries: 1/);

  assert.match(cli, /label: "exchange code"[\s\S]*retries: 0/);
  assert.match(cli, /label: "fetch log upload"[\s\S]*retries: 0/);
  assert.match(cli, /label: "digest sync"[\s\S]*timeoutMs: HTTP_SYNC_LARGE_TIMEOUT_MS[\s\S]*retries: 0/);
});
