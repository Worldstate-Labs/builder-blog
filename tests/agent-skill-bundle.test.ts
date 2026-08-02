import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const installerPath = resolve("scripts/install-agent-skill-bundle.cjs");
const bundleModulePath = resolve("src/lib/agent-skill-bundle.ts");
const bundleRoutePath = resolve("src/app/api/skill/bundle/route.ts");

type BundleEntry = {
  name: string;
  target: string;
  mode: number;
  sha256: string;
  contentBase64: string;
};

function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function bundleId(files: BundleEntry[]): string {
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      files: files.map(({ name, target, mode, sha256: digest }) => ({
        name,
        target,
        mode,
        sha256: digest,
      })),
    }),
  );
}

function entry(name: string, target: string, content: string, mode = 0o644): BundleEntry {
  const bytes = Buffer.from(content);
  return {
    name,
    target,
    mode,
    sha256: sha256(bytes),
    contentBase64: bytes.toString("base64"),
  };
}

test("server builds one deterministic bundle covering the complete installed runtime", async () => {
  assert.ok(existsSync(bundleModulePath), "agent skill bundle module must exist");
  if (!existsSync(bundleModulePath)) return;

  const { buildAgentSkillBundle } = await import("../src/lib/agent-skill-bundle");
  const first = await buildAgentSkillBundle();
  const second = await buildAgentSkillBundle();

  assert.equal(first.schemaVersion, 1);
  assert.equal(first.bundleId, second.bundleId);
  assert.deepEqual(first.files, second.files);
  assert.equal(first.bundleId, bundleId(first.files));

  const targets = new Set(first.files.map((file: BundleEntry) => file.target));
  for (const target of [
    "builder-digest.mjs",
    "new-product-launches.mjs",
    "cloud-shard-budget.mjs",
    "builder-agent-runner.sh",
    "install-agent-skill-bundle.cjs",
    "sources.json",
    "local-agent-timeouts.json",
    "jobs/library-once.md",
    "jobs/digest-once.md",
    "jobs/library-cron-setup.md",
    "jobs/digest-cron-setup.md",
    "jobs/digest-cron.md",
    "jobs/cloud-library-cron.md",
    "jobs/cloud-library-host.md",
    "jobs/library-worker.md",
    "jobs/library-discovery.md",
  ]) {
    assert.ok(targets.has(target), `bundle must install ${target}`);
  }

  for (const file of first.files as BundleEntry[]) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    assert.ok(bytes.length > 0, `${file.name} must not be empty`);
    assert.equal(sha256(bytes), file.sha256, `${file.name} hash must match`);
  }

  for (const file of first.files as BundleEntry[]) {
    if (!/\.[cm]?js$/.test(file.target)) continue;
    const source = Buffer.from(file.contentBase64, "base64").toString("utf8");
    const relativeImports = [
      ...source.matchAll(/(?:from\s+|import\s+)["'](\.\.?\/[^"']+)["']/g),
    ];
    for (const [, relativeImport] of relativeImports) {
      const importedTarget = join(dirname(file.target), relativeImport);
      assert.ok(
        targets.has(importedTarget),
        `${file.target} imports ${importedTarget}, which must be installed in the same bundle`,
      );
    }
  }
});

test("bundle route is public, cacheable, and returns the validated bundle", async () => {
  assert.ok(existsSync(bundleRoutePath), "agent skill bundle route must exist");
  if (!existsSync(bundleRoutePath)) return;

  const { GET } = await import("../src/app/api/skill/bundle/route");
  const response = await GET();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(payload.bundleId, bundleId(payload.files));
});

test("installer retries transient failures and reports nested network causes", async () => {
  assert.ok(existsSync(installerPath), "bundle installer must exist");
  if (!existsSync(installerPath)) return;

  const {
    downloadBundle,
    formatErrorCause,
  }: {
    downloadBundle: (
      url: string,
      options: {
        fetchImpl: typeof fetch;
        sleep: (ms: number) => Promise<void>;
        retryBaseMs: number;
      },
    ) => Promise<{ ok: boolean }>;
    formatErrorCause: (error: unknown) => string;
  } = require(installerPath);

  let attempts = 0;
  const delays: number[] = [];
  const payload = { ok: true };
  const result = await downloadBundle("https://followbrief.example/api/skill/bundle", {
    fetchImpl: (async () => {
      attempts += 1;
      if (attempts < 3) return new Response("retry", { status: 503 });
      return Response.json(payload);
    }) as typeof fetch,
    sleep: async (ms) => {
      delays.push(ms);
    },
    retryBaseMs: 10,
  });

  assert.deepEqual(result, payload);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);

  const nested = new TypeError("fetch failed", {
    cause: Object.assign(new Error("connection timed out"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    }),
  });
  assert.match(formatErrorCause(nested), /UND_ERR_CONNECT_TIMEOUT/);
  assert.match(formatErrorCause(nested), /connection timed out/);
});

test("installer does not retry permanent HTTP errors", async () => {
  assert.ok(existsSync(installerPath), "bundle installer must exist");
  if (!existsSync(installerPath)) return;

  const { downloadBundle } = require(installerPath) as {
    downloadBundle: (
      url: string,
      options: {
        fetchImpl: typeof fetch;
        sleep: (ms: number) => Promise<void>;
        retryBaseMs: number;
      },
    ) => Promise<unknown>;
  };
  let attempts = 0;

  await assert.rejects(
    downloadBundle("https://followbrief.example/api/skill/bundle", {
      fetchImpl: (async () => {
        attempts += 1;
        return new Response("missing", { status: 404 });
      }) as typeof fetch,
      sleep: async () => {},
      retryBaseMs: 1,
    }),
    /HTTP 404[\s\S]*attempt 1\/4/,
  );
  assert.equal(attempts, 1);
});

test("installer validates every file before changing an existing installation", () => {
  assert.ok(existsSync(installerPath), "bundle installer must exist");
  if (!existsSync(installerPath)) return;

  const { REQUIRED_TARGETS, installBundlePayload } = require(installerPath) as {
    REQUIRED_TARGETS: readonly string[];
    installBundlePayload: (payload: unknown, agentDir: string) => void;
  };
  const agentDir = mkdtempSync(join(tmpdir(), "followbrief-bundle-corrupt-"));
  const existingPath = join(agentDir, "builder-digest.mjs");
  writeFileSync(existingPath, "old cli");

  try {
    const files = REQUIRED_TARGETS.map((target) =>
      entry(target.replaceAll("/", "-"), target, `new:${target}`, target.endsWith(".sh") ? 0o755 : 0o644),
    );
    files[files.length - 1] = {
      ...files[files.length - 1],
      sha256: "0".repeat(64),
    };
    const payload = {
      schemaVersion: 1,
      files,
      bundleId: bundleId(files),
    };

    assert.throws(() => installBundlePayload(payload, agentDir), /hash mismatch/i);
    assert.equal(readFileSync(existingPath, "utf8"), "old cli");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("installer rejects traversal and rolls back a failed local commit", () => {
  assert.ok(existsSync(installerPath), "bundle installer must exist");
  if (!existsSync(installerPath)) return;

  const { REQUIRED_TARGETS, installBundlePayload } = require(installerPath) as {
    REQUIRED_TARGETS: readonly string[];
    installBundlePayload: (
      payload: unknown,
      agentDir: string,
      options?: { renameFile?: (from: string, to: string) => void },
    ) => void;
  };
  const agentDir = mkdtempSync(join(tmpdir(), "followbrief-bundle-rollback-"));
  const oldCli = join(agentDir, "builder-digest.mjs");
  const oldRunner = join(agentDir, "builder-agent-runner.sh");
  writeFileSync(oldCli, "old cli");
  writeFileSync(oldRunner, "old runner");

  try {
    const unsafeFiles = [
      entry("escape", "../escape", "bad"),
      ...REQUIRED_TARGETS.map((target) => entry(target, target, `new:${target}`)),
    ];
    assert.throws(
      () =>
        installBundlePayload(
          {
            schemaVersion: 1,
            files: unsafeFiles,
            bundleId: bundleId(unsafeFiles),
          },
          agentDir,
        ),
      /unsafe.*target/i,
    );

    const files = REQUIRED_TARGETS.map((target) =>
      entry(target, target, `new:${target}`, target.endsWith(".sh") ? 0o755 : 0o644),
    );
    let injected = false;
    const renameFile = (from: string, to: string) => {
      if (!injected && from.includes("staged") && to === oldRunner) {
        injected = true;
        throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
      }
      mkdirSync(dirname(to), { recursive: true });
      require("node:fs").renameSync(from, to);
    };

    assert.throws(
      () =>
        installBundlePayload(
          {
            schemaVersion: 1,
            files,
            bundleId: bundleId(files),
          },
          agentDir,
          { renameFile },
        ),
      /injected rename failure/,
    );
    assert.equal(readFileSync(oldCli, "utf8"), "old cli");
    assert.equal(readFileSync(oldRunner, "utf8"), "old runner");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("bootstrap can execute the exact installer source through node stdin", () => {
  assert.ok(existsSync(installerPath), "bundle installer must exist");
  if (!existsSync(installerPath)) return;

  const { REQUIRED_TARGETS } = require(installerPath) as {
    REQUIRED_TARGETS: readonly string[];
  };
  const files = REQUIRED_TARGETS.map((target) =>
    entry(target, target, `stdin:${target}`, target.endsWith(".sh") ? 0o755 : 0o644),
  );
  const payload = {
    schemaVersion: 1,
    files,
    bundleId: bundleId(files),
  };
  const bundleUrl = `data:application/json;base64,${Buffer.from(
    JSON.stringify(payload),
  ).toString("base64")}`;
  const agentDir = mkdtempSync(join(tmpdir(), "followbrief-bundle-stdin-"));

  try {
    const result = spawnSync(process.execPath, ["-", bundleUrl, agentDir], {
      input: readFileSync(installerPath),
      encoding: "utf8",
      timeout: 10_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /FollowBrief agent skill bundle installed/);
    assert.equal(readFileSync(join(agentDir, "builder-digest.mjs"), "utf8"), "stdin:builder-digest.mjs");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("installer preserves transaction backups when rollback itself fails", () => {
  assert.ok(existsSync(installerPath), "bundle installer must exist");
  if (!existsSync(installerPath)) return;

  const { REQUIRED_TARGETS, installBundlePayload } = require(installerPath) as {
    REQUIRED_TARGETS: readonly string[];
    installBundlePayload: (
      payload: unknown,
      agentDir: string,
      options?: { renameFile?: (from: string, to: string) => void },
    ) => void;
  };
  const agentDir = mkdtempSync(join(tmpdir(), "followbrief-bundle-rollback-backup-"));
  const oldCli = join(agentDir, "builder-digest.mjs");
  const oldRunner = join(agentDir, "builder-agent-runner.sh");
  writeFileSync(oldCli, "old cli");
  writeFileSync(oldRunner, "old runner");

  try {
    const files = REQUIRED_TARGETS.map((target) =>
      entry(target, target, `new:${target}`, target.endsWith(".sh") ? 0o755 : 0o644),
    );
    let commitFailed = false;
    const renameFile = (from: string, to: string) => {
      if (!commitFailed && from.includes("staged") && to === oldRunner) {
        commitFailed = true;
        throw new Error("injected commit failure");
      }
      if (commitFailed && from.includes("backup") && to === oldCli) {
        throw new Error("injected rollback failure");
      }
      mkdirSync(dirname(to), { recursive: true });
      require("node:fs").renameSync(from, to);
    };

    assert.throws(
      () =>
        installBundlePayload(
          {
            schemaVersion: 1,
            files,
            bundleId: bundleId(files),
          },
          agentDir,
          { renameFile },
        ),
      /rollback was incomplete[\s\S]*backup/,
    );

    const transactions = readdirSync(join(agentDir, "tmp")).filter((name) =>
      name.startsWith(".skill-install-"),
    );
    assert.equal(transactions.length, 1, "failed rollback must preserve one transaction");
    assert.ok(
      existsSync(
        join(agentDir, "tmp", transactions[0], "backup", "builder-digest.mjs"),
      ),
      "the unrecovered prior CLI must remain available in the transaction backup",
    );
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});
