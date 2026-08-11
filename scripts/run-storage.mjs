#!/usr/bin/env node
import { lstat, readFile, readdir, rm, statfs } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GIB = 1024 ** 3;
export const DEFAULT_FREE_DISK_RESERVE_BYTES = 2 * GIB;
export const DEFAULT_MEDIA_WORKING_SET_BYTES = GIB;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredReserveBytes() {
  return positiveInteger(
    process.env.BUILDER_BLOG_MIN_FREE_DISK_BYTES,
    DEFAULT_FREE_DISK_RESERVE_BYTES,
  );
}

export function configuredMediaWorkingSetBytes() {
  return positiveInteger(
    process.env.BUILDER_BLOG_MEDIA_WORKING_SET_BYTES,
    DEFAULT_MEDIA_WORKING_SET_BYTES,
  );
}

export function managedMediaDiskSpaceDecision({
  availableBytes,
  anticipatedBytes = configuredMediaWorkingSetBytes(),
  reserveBytes = configuredReserveBytes(),
}) {
  const available = Math.max(0, Number(availableBytes) || 0);
  const anticipated = Math.max(0, Number(anticipatedBytes) || 0);
  const reserve = Math.max(0, Number(reserveBytes) || 0);
  const requiredBytes = reserve + anticipated;
  return {
    ok: available >= requiredBytes,
    ...(available >= requiredBytes ? {} : { reason: "insufficient_disk_space" }),
    availableBytes: available,
    requiredBytes,
    reserveBytes: reserve,
    anticipatedBytes: anticipated,
  };
}

export async function checkManagedMediaDiskSpace(path, options = {}) {
  const filesystem = await statfs(path, { bigint: true });
  const availableBigInt = filesystem.bavail * filesystem.bsize;
  const availableBytes = Number(
    availableBigInt > BigInt(Number.MAX_SAFE_INTEGER)
      ? BigInt(Number.MAX_SAFE_INTEGER)
      : availableBigInt,
  );
  return managedMediaDiskSpaceDecision({
    availableBytes,
    anticipatedBytes: options.anticipatedBytes,
    reserveBytes: options.reserveBytes,
  });
}

async function assertOwnedFollowBriefRun(runDir) {
  const resolvedRunDir = resolve(String(runDir || ""));
  const runStat = await lstat(resolvedRunDir).catch(() => null);
  if (!runStat?.isDirectory() || runStat.isSymbolicLink()) {
    throw new Error(`Refusing cleanup outside an owned FollowBrief run directory: ${resolvedRunDir}`);
  }

  const ownerPath = join(resolvedRunDir, ".run-owner.json");
  const ownerStat = await lstat(ownerPath).catch(() => null);
  let owner = null;
  if (ownerStat?.isFile() && !ownerStat.isSymbolicLink()) {
    try {
      owner = JSON.parse(await readFile(ownerPath, "utf8"));
    } catch {}
  }
  const instanceComponent = String(owner?.instanceId || "").replace(/[^a-zA-Z0-9_.@+-]/g, "_");
  if (owner?.app !== "followbrief" || !instanceComponent || instanceComponent !== basename(resolvedRunDir)) {
    throw new Error(`Refusing cleanup outside an owned FollowBrief run directory: ${resolvedRunDir}`);
  }
  return resolvedRunDir;
}

export async function cleanupCompletedManagedMediaArtifacts(runDir) {
  const ownedRunDir = await assertOwnedFollowBriefRun(runDir);
  const managedMediaDir = join(ownedRunDir, "managed-media");
  const managedMediaStat = await lstat(managedMediaDir).catch(() => null);
  if (managedMediaStat) {
    await rm(managedMediaDir, { recursive: true, force: true });
  }

  const entries = await readdir(ownedRunDir, { withFileTypes: true });
  const summaries = entries.filter(
    (entry) => entry.isFile() && /^managed-media(?:-[a-zA-Z0-9_.-]+)?\.json$/.test(entry.name),
  );
  await Promise.all(summaries.map((entry) => rm(join(ownedRunDir, entry.name), { force: true })));
  return {
    removedManagedMedia: Boolean(managedMediaStat),
    removedSummaryFiles: summaries.length,
  };
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "cleanup-managed-media") {
    throw new Error("Usage: run-storage.mjs cleanup-managed-media --run-dir <owned-run-dir>");
  }
  const runDir = argumentValue(args, "--run-dir");
  if (!runDir) throw new Error("Missing required --run-dir");
  process.stdout.write(`${JSON.stringify(await cleanupCompletedManagedMediaArtifacts(runDir))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
