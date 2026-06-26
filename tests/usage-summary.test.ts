import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatUsageCost, formatUsageTokens, readUsageSummary } from "../src/lib/usage-summary";

test("usage summary reads camelCase and snake_case runtime usage", () => {
  assert.deepEqual(readUsageSummary({
    usage: {
      input_tokens: 1200,
      outputTokens: "340",
      cache_read_input_tokens: 50,
      reasoning_tokens: 10,
      total_cost_usd: "0.0123",
    },
  }), {
    inputTokens: 1200,
    outputTokens: 340,
    cachedInputTokens: 50,
    reasoningTokens: 10,
    totalTokens: 1550,
    costUsd: 0.0123,
    currency: "USD",
    source: null,
  });
});

test("usage summary prefers the first available details payload", () => {
  const usage = readUsageSummary(
    null,
    { progress: { stage: "running" } },
    { usage: { total_tokens: 42, cost_usd: 0.0004 } },
  );

  assert.equal(usage?.totalTokens, 42);
  assert.equal(usage?.costUsd, 0.0004);
});

test("usage display format handles missing values and small USD costs", () => {
  assert.equal(formatUsageTokens(null), "Not reported");
  assert.equal(formatUsageTokens(1234567), "1,234,567");
  assert.equal(formatUsageCost({
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    costUsd: 0.01234,
    currency: "USD",
    source: null,
  }), "$0.0123");
});

test("CLI aggregates token usage and cost across worker logs", () => {
  const dir = mkdtempSync(join(tmpdir(), "builder-usage-"));
  const one = join(dir, "shard-1-worker.log");
  const two = join(dir, "shard-2-worker.log");
  const out = join(dir, "runtime-usage.jsonl");
  writeFileSync(one, "{\"usage\":{\"input_tokens\":100,\"output_tokens\":25,\"total_cost_usd\":\"0.003\"}}\n");
  writeFileSync(two, "{\"usage\":{\"input_tokens\":40,\"output_tokens\":10,\"total_cost_usd\":\"0.0012\"}}\n");

  execFileSync("node", [
    "scripts/builder-digest.mjs",
    "aggregate-runtime-usage",
    "--out",
    out,
    one,
    two,
  ], { cwd: process.cwd(), encoding: "utf8" });

  const payload = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(payload.usage.inputTokens, 140);
  assert.equal(payload.usage.outputTokens, 35);
  assert.equal(payload.usage.totalTokens, 175);
  assert.equal(payload.usage.costUsd, 0.0042);
});
