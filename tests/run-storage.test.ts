import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

test("completed managed-media cleanup removes only the current owned run's heavy artifacts", async () => {
  const storage = await import(`../scripts/run-storage.mjs?cleanup=${Date.now()}`);
  const root = await mkdtemp(join(tmpdir(), "followbrief-managed-media-cleanup-"));
  const runDir = join(root, "20260810T120000Z-host-123");
  try {
    await mkdir(join(runDir, "managed-media", "refill-1", "task-a"), { recursive: true });
    await writeFile(
      join(runDir, ".run-owner.json"),
      JSON.stringify({ app: "followbrief", instanceId: basename(runDir) }),
      "utf8",
    );
    await writeFile(join(runDir, "managed-media", "refill-1", "task-a", "audio.wav"), "heavy", "utf8");
    await writeFile(join(runDir, "managed-media-refill-1.json"), "{}", "utf8");
    await writeFile(join(runDir, "library-fetch-result.json"), "keep", "utf8");
    await writeFile(join(runDir, "debug.json"), "keep", "utf8");

    const result = await storage.cleanupCompletedManagedMediaArtifacts(runDir);

    assert.equal(result.removedManagedMedia, true);
    assert.equal(result.removedSummaryFiles, 1);
    assert.equal(existsSync(join(runDir, "managed-media")), false);
    assert.equal(existsSync(join(runDir, "managed-media-refill-1.json")), false);
    assert.equal(await readFile(join(runDir, "library-fetch-result.json"), "utf8"), "keep");
    assert.equal(await readFile(join(runDir, "debug.json"), "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("completed managed-media cleanup refuses unowned directories", async () => {
  const storage = await import(`../scripts/run-storage.mjs?ownership=${Date.now()}`);
  const runDir = await mkdtemp(join(tmpdir(), "followbrief-unowned-run-"));
  try {
    await mkdir(join(runDir, "managed-media"), { recursive: true });
    await writeFile(join(runDir, "managed-media", "audio.wav"), "must remain", "utf8");

    await assert.rejects(
      storage.cleanupCompletedManagedMediaArtifacts(runDir),
      /owned FollowBrief run directory/,
    );
    assert.equal(existsSync(join(runDir, "managed-media", "audio.wav")), true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("managed-media disk guard reserves headroom for the app and the pending working set", async () => {
  const storage = await import(`../scripts/run-storage.mjs?disk=${Date.now()}`);
  const reserveBytes = 2 * 1024 ** 3;
  const anticipatedBytes = 1024 ** 3;

  assert.deepEqual(
    storage.managedMediaDiskSpaceDecision({
      availableBytes: reserveBytes + anticipatedBytes - 1,
      anticipatedBytes,
      reserveBytes,
    }),
    {
      ok: false,
      reason: "insufficient_disk_space",
      availableBytes: reserveBytes + anticipatedBytes - 1,
      requiredBytes: reserveBytes + anticipatedBytes,
      reserveBytes,
      anticipatedBytes,
    },
  );
  assert.equal(storage.managedMediaDiskSpaceDecision({
    availableBytes: reserveBytes + anticipatedBytes,
    anticipatedBytes,
    reserveBytes,
  }).ok, true);
});
