#!/usr/bin/env node
"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- This installer must run as standalone CommonJS from `node -`. */

const { createHash } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { dirname, isAbsolute, join, posix, resolve, sep } = require("node:path");

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const ALLOWED_MODES = new Set([0o644, 0o755]);
const REQUIRED_TARGETS = Object.freeze([
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
]);

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function createBundleId(files) {
  return sha256(
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      files: files.map(({ name, target, mode, sha256: digest }) => ({
        name,
        target,
        mode,
        sha256: digest,
      })),
    }),
  );
}

function formatErrorCause(error) {
  const parts = [];
  const seen = new Set();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = typeof current.code === "string" ? current.code : "";
    const message =
      typeof current.message === "string" && current.message.trim()
        ? current.message.trim()
        : "";
    const label = [code, message].filter(Boolean).join(": ");
    if (label && !parts.includes(label)) parts.push(label);
    current = current.cause;
  }

  if (parts.length > 0) return parts.reverse().join(" <- ");
  return String(error || "unknown error");
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function downloadFailure(error, attempt, maxAttempts, startedAt) {
  return new Error(
    `FollowBrief bundle download failed: ${formatErrorCause(error)}; ` +
      `attempt ${attempt}/${maxAttempts}; elapsed ${Date.now() - startedAt}ms`,
    { cause: error },
  );
}

async function downloadBundle(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleepImpl = options.sleep || sleep;
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  if (typeof fetchImpl !== "function") {
    throw new Error("Node.js 20 or newer is required: global fetch is unavailable.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        const error = Object.assign(new Error(`HTTP ${response.status}`), {
          status: response.status,
        });
        if (!isRetryableStatus(response.status)) {
          throw downloadFailure(error, attempt, maxAttempts, startedAt);
        }
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("FollowBrief bundle download failed:")
      ) {
        throw error;
      }
      if (attempt === maxAttempts) {
        throw downloadFailure(error, attempt, maxAttempts, startedAt);
      }
      await sleepImpl(retryBaseMs * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("FollowBrief bundle download failed without an attempt.");
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeTarget(target) {
  if (
    typeof target !== "string" ||
    target.length === 0 ||
    target.includes("\\") ||
    isAbsolute(target) ||
    posix.normalize(target) !== target ||
    !/^[A-Za-z0-9._/-]+$/.test(target)
  ) {
    return false;
  }
  return target.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function decodeBase64(value, name) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error(`Bundle file ${name} has invalid base64 content.`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) {
    throw new Error(`Bundle file ${name} is empty.`);
  }
  return bytes;
}

function validateBundle(payload) {
  if (!isPlainObject(payload) || payload.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Unsupported or malformed FollowBrief bundle schema.");
  }
  if (!Array.isArray(payload.files) || payload.files.length === 0) {
    throw new Error("FollowBrief bundle files must be a non-empty array.");
  }
  if (typeof payload.bundleId !== "string" || !/^[a-f0-9]{64}$/.test(payload.bundleId)) {
    throw new Error("FollowBrief bundle id is invalid.");
  }

  const targets = new Set();
  const files = payload.files.map((file, index) => {
    if (!isPlainObject(file)) {
      throw new Error(`Bundle file ${index + 1} is malformed.`);
    }
    if (typeof file.name !== "string" || file.name.length === 0) {
      throw new Error(`Bundle file ${index + 1} has an invalid name.`);
    }
    if (!isSafeTarget(file.target)) {
      throw new Error(`Bundle file ${file.name} has an unsafe target.`);
    }
    if (targets.has(file.target)) {
      throw new Error(`Bundle target is duplicated: ${file.target}.`);
    }
    targets.add(file.target);
    if (!ALLOWED_MODES.has(file.mode)) {
      throw new Error(`Bundle file ${file.name} has an invalid mode.`);
    }
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Bundle file ${file.name} has an invalid hash.`);
    }

    const bytes = decodeBase64(file.contentBase64, file.name);
    if (sha256(bytes) !== file.sha256) {
      throw new Error(`Bundle file ${file.name} hash mismatch.`);
    }
    return {
      name: file.name,
      target: file.target,
      mode: file.mode,
      sha256: file.sha256,
      contentBase64: file.contentBase64,
      bytes,
    };
  });

  for (const required of REQUIRED_TARGETS) {
    if (!targets.has(required)) {
      throw new Error(`FollowBrief bundle is missing required target: ${required}.`);
    }
  }
  if (createBundleId(files) !== payload.bundleId) {
    throw new Error("FollowBrief bundle id mismatch.");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    bundleId: payload.bundleId,
    files,
  };
}

function resolveInsideAgentDir(agentDir, target) {
  const root = resolve(agentDir);
  const destination = resolve(root, target);
  if (destination !== root && !destination.startsWith(`${root}${sep}`)) {
    throw new Error(`Bundle file has an unsafe target: ${target}.`);
  }
  return destination;
}

function installBundlePayload(payload, agentDir, options = {}) {
  const bundle = validateBundle(payload);
  const renameFile = options.renameFile || renameSync;
  const root = resolve(agentDir);
  const tmpRoot = join(root, "tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const transactionRoot = mkdtempSync(join(tmpRoot, ".skill-install-"));
  const stagedRoot = join(transactionRoot, "staged");
  const backupRoot = join(transactionRoot, "backup");
  const committed = [];
  let preserveTransaction = false;

  try {
    for (const file of bundle.files) {
      const staged = resolveInsideAgentDir(stagedRoot, file.target);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, file.bytes);
      chmodSync(staged, file.mode);
    }

    for (const file of bundle.files) {
      const staged = resolveInsideAgentDir(stagedRoot, file.target);
      const target = resolveInsideAgentDir(root, file.target);
      const backup = resolveInsideAgentDir(backupRoot, file.target);
      mkdirSync(dirname(target), { recursive: true });

      const record = {
        target,
        backup,
        hadExisting: existsSync(target),
        installed: false,
      };
      if (record.hadExisting) {
        if (lstatSync(target).isDirectory()) {
          throw new Error(`Installed runtime target is a directory: ${file.target}.`);
        }
        mkdirSync(dirname(backup), { recursive: true });
        renameFile(target, backup);
      }
      committed.push(record);
      renameFile(staged, target);
      record.installed = true;
      chmodSync(target, file.mode);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const record of committed.reverse()) {
      try {
        if (record.installed && existsSync(record.target)) {
          rmSync(record.target, { force: true });
        }
        if (record.hadExisting && existsSync(record.backup)) {
          renameFile(record.backup, record.target);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      preserveTransaction = true;
      throw new AggregateError(
        [error, ...rollbackErrors],
        `FollowBrief bundle install failed and rollback was incomplete; ` +
          `backup preserved at ${backupRoot}: ${formatErrorCause(error)}`,
      );
    }
    throw error;
  } finally {
    if (!preserveTransaction) {
      rmSync(transactionRoot, { recursive: true, force: true });
    }
  }

  return {
    bundleId: bundle.bundleId,
    fileCount: bundle.files.length,
  };
}

async function main() {
  const bundleUrl = process.argv[2];
  const agentDir = process.argv[3];
  if (!bundleUrl || !agentDir) {
    console.error("Usage: install-agent-skill-bundle.cjs <bundle-url> <agent-dir>");
    process.exitCode = 64;
    return;
  }

  try {
    const payload = await downloadBundle(bundleUrl);
    const result = installBundlePayload(payload, agentDir);
    console.log(
      `FollowBrief agent skill bundle installed: ${result.bundleId} (${result.fileCount} files)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_TARGETS,
  createBundleId,
  downloadBundle,
  formatErrorCause,
  installBundlePayload,
  isRetryableStatus,
  validateBundle,
};

if (require.main === module || process.argv[1] === "-") {
  void main();
}
