import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  AGENT_PROMPT_LINK_PRIVACY_HEADERS,
  AGENT_PROMPT_LINK_TOKEN_PATTERN,
  AGENT_PROMPT_LINK_TTL_MS,
  createAgentPromptLinkToken,
  hashAgentPromptLinkToken,
  parseAgentPromptLinkOptions,
  type AgentPromptRenderOptions,
  type ExposedPromptJob,
} from "../src/lib/agent-prompt-links";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("parseAgentPromptLinkOptions accepts only the exposed jobs and their applicable options", () => {
  const acceptedCases: Array<{
    job: ExposedPromptJob;
    input: unknown;
    expected: AgentPromptRenderOptions;
  }> = [
    {
      job: "library-once",
      input: { runtime: "claude", force: true, fetchDays: 30, parallelWorkers: 10 },
      expected: { runtime: "claude", force: true, fetchDays: 30, parallelWorkers: 10 },
    },
    {
      job: "digest-once",
      input: { runtime: "codex", force: false, parallelWorkers: 4 },
      expected: { runtime: "codex", force: false, parallelWorkers: 4 },
    },
    {
      job: "library-cron-setup",
      input: { runtime: "codex", frequency: "daily", force: true, fetchDays: 7, parallelWorkers: 12 },
      expected: { runtime: "codex", frequency: "daily", force: true, fetchDays: 7, parallelWorkers: 12 },
    },
    {
      job: "digest-cron-setup",
      input: { runtime: "hermes", frequency: "weekly", force: true, parallelWorkers: 3 },
      expected: { runtime: "hermes", frequency: "weekly", force: true, parallelWorkers: 3 },
    },
    {
      job: "library-cron-stop",
      input: {},
      expected: {},
    },
    {
      job: "digest-cron-stop",
      input: {},
      expected: {},
    },
    {
      job: "cloud-library-cron-setup",
      input: { runtime: "openclaw", fetchDays: 14, parallelWorkers: 8 },
      expected: { runtime: "openclaw", fetchDays: 14, parallelWorkers: 8 },
    },
    {
      job: "cloud-library-cron-stop",
      input: { runtime: "claude" },
      expected: { runtime: "claude" },
    },
  ];

  for (const { job, input, expected } of acceptedCases) {
    assert.deepEqual(parseAgentPromptLinkOptions(job, input), expected);
  }

  assert.throws(
    () => parseAgentPromptLinkOptions("digest-cron" as ExposedPromptJob, {}),
    /job/i,
  );
});

test("parseAgentPromptLinkOptions rejects non-objects, arrays, unknown keys, and reserved fields", () => {
  assert.throws(() => parseAgentPromptLinkOptions("library-once", null), /object/i);
  assert.throws(() => parseAgentPromptLinkOptions("library-once", []), /object/i);
  assert.throws(() => parseAgentPromptLinkOptions("library-once", "runtime=codex"), /object/i);
  assert.throws(() => parseAgentPromptLinkOptions("library-once", { unknown: true }), /unknown/i);

  for (const reservedKey of ["url", "prompt", "tokenId", "exchangeCode", "ec"]) {
    assert.throws(
      () => parseAgentPromptLinkOptions("library-once", { [reservedKey]: "value" }),
      /unknown|not allowed/i,
    );
  }
});

test("parseAgentPromptLinkOptions enforces runtime and frequency closed sets", () => {
  for (const runtime of ["claude", "codex", "hermes", "openclaw"]) {
    assert.deepEqual(parseAgentPromptLinkOptions("digest-once", { runtime }), { runtime });
  }
  for (const frequency of ["1h", "daily", "weekly"]) {
    assert.deepEqual(parseAgentPromptLinkOptions("library-cron-setup", { frequency }), { frequency });
  }

  assert.throws(
    () => parseAgentPromptLinkOptions("digest-once", { runtime: "gpt5" }),
    /runtime/i,
  );
  assert.throws(
    () => parseAgentPromptLinkOptions("library-cron-setup", { frequency: "hourly" }),
    /frequency/i,
  );
});

test("parseAgentPromptLinkOptions rejects non-applicable options and malformed primitive values", () => {
  assert.throws(
    () => parseAgentPromptLinkOptions("library-cron-stop", { runtime: "codex" }),
    /runtime|option/i,
  );
  assert.throws(
    () => parseAgentPromptLinkOptions("digest-once", { frequency: "daily" }),
    /frequency|option/i,
  );
  assert.throws(
    () => parseAgentPromptLinkOptions("digest-cron-setup", { fetchDays: 5 }),
    /fetchDays|option/i,
  );
  assert.throws(
    () => parseAgentPromptLinkOptions("cloud-library-cron-stop", { parallelWorkers: 4 }),
    /parallelWorkers|option/i,
  );
  assert.throws(
    () => parseAgentPromptLinkOptions("library-once", { force: "true" }),
    /force|boolean/i,
  );
  assert.throws(
    () => parseAgentPromptLinkOptions("library-once", { fetchDays: "30" }),
    /fetchDays|number/i,
  );
  assert.throws(
    () => parseAgentPromptLinkOptions("library-once", { parallelWorkers: "3" }),
    /parallelWorkers|number/i,
  );
});

test("parseAgentPromptLinkOptions enforces integer bounds for fetchDays and parallelWorkers", () => {
  assert.deepEqual(parseAgentPromptLinkOptions("library-once", { fetchDays: 1 }), { fetchDays: 1 });
  assert.deepEqual(parseAgentPromptLinkOptions("library-once", { fetchDays: 90 }), { fetchDays: 90 });
  assert.deepEqual(parseAgentPromptLinkOptions("digest-once", { parallelWorkers: 1 }), {
    parallelWorkers: 1,
  });
  assert.deepEqual(parseAgentPromptLinkOptions("digest-once", { parallelWorkers: 20 }), {
    parallelWorkers: 20,
  });

  for (const value of [0, 91, 1.5]) {
    assert.throws(
      () => parseAgentPromptLinkOptions("library-once", { fetchDays: value }),
      /fetchDays/i,
    );
  }
  for (const value of [0, 21, 2.2]) {
    assert.throws(
      () => parseAgentPromptLinkOptions("digest-once", { parallelWorkers: value }),
      /parallelWorkers/i,
    );
  }
});

test("prompt link token uses the fixed URL-safe shape with the fbp_ prefix", () => {
  const token = createAgentPromptLinkToken();

  assert.match(token, AGENT_PROMPT_LINK_TOKEN_PATTERN);
  assert.match(token, /^fbp_/);
  assert.ok(token.length >= 26);
  assert.doesNotMatch(token, /[+/=]/);
});

test("prompt link token hashing is deterministic sha256 hex", () => {
  const token = "fbp_abcdefghijklmnopqrstuvwxyz012345";

  assert.equal(
    hashAgentPromptLinkToken(token),
    "7c07154aae961d39df810c985d738c0212545abbb1992bcda51d66e43759976d",
  );
  assert.match(hashAgentPromptLinkToken(token), /^[0-9a-f]{64}$/);
});

test("prompt link contract exposes ten-minute ttl and required privacy headers", () => {
  assert.equal(AGENT_PROMPT_LINK_TTL_MS, 10 * 60 * 1000);
  assert.deepEqual(AGENT_PROMPT_LINK_PRIVACY_HEADERS, {
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
});

test("Prisma schema declares a hashed AgentPromptLink capability tied one-to-one to ExchangeCode", () => {
  const schema = source("prisma/schema.prisma");

  assert.match(schema, /model AgentPromptLink \{/);
  assert.match(schema, /model AgentPromptLink \{[\s\S]*\n\s*id\s+String\s+@id @default\(cuid\(\)\)/);
  assert.match(schema, /model AgentPromptLink \{[\s\S]*\n\s*tokenHash\s+String\s+@unique/);
  assert.match(schema, /model AgentPromptLink \{[\s\S]*\n\s*exchangeCodeId\s+String\s+@unique/);
  assert.match(schema, /model AgentPromptLink \{[\s\S]*\n\s*job\s+String/);
  assert.match(schema, /model AgentPromptLink \{[\s\S]*\n\s*options\s+Json/);
  assert.match(schema, /model AgentPromptLink \{[\s\S]*\n\s*expiresAt\s+DateTime/);
  assert.match(schema, /model AgentPromptLink \{[\s\S]*\n\s*createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(
    schema,
    /model AgentPromptLink \{[\s\S]*exchangeCode\s+ExchangeCode\s+@relation\(fields: \[exchangeCodeId\], references: \[id\], onDelete: Cascade\)/,
  );
  assert.match(schema, /model ExchangeCode \{[\s\S]*agentPromptLink\s+AgentPromptLink\?/);
});

test("agent prompt link migration creates hashed capability storage with unique indexes and cascade deletion", () => {
  const migration = source("prisma/migrations/000089_agent_prompt_links/migration.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AgentPromptLink"/);
  assert.match(migration, /"id"\s+TEXT\s+NOT NULL/);
  assert.match(migration, /"tokenHash"\s+TEXT\s+NOT NULL/);
  assert.match(migration, /"exchangeCodeId"\s+TEXT\s+NOT NULL/);
  assert.match(migration, /"job"\s+TEXT\s+NOT NULL/);
  assert.match(migration, /"options"\s+JSONB\s+NOT NULL/);
  assert.match(migration, /"expiresAt"\s+TIMESTAMP\(3\)\s+NOT NULL/);
  assert.match(migration, /"createdAt"\s+TIMESTAMP\(3\)\s+NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "AgentPromptLink_tokenHash_key" ON "AgentPromptLink"\("tokenHash"\)/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "AgentPromptLink_exchangeCodeId_key" ON "AgentPromptLink"\("exchangeCodeId"\)/,
  );
  assert.match(migration, /AgentPromptLink_exchangeCodeId_fkey/);
  assert.match(
    migration,
    /FOREIGN KEY \("exchangeCodeId"\) REFERENCES "ExchangeCode"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/,
  );
});
