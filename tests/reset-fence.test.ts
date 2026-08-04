import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GLOBAL_RESET_FENCE_ID,
  lockResetFenceForReset,
  lockResetFenceForWorker,
  lockResetFenceForNewWorker,
  StaleWorkerWriteError,
  userResetFenceId,
} from "../src/lib/reset-fence";

test("personal reset fence IDs are stable and cannot collapse to an empty user", () => {
  assert.equal(userResetFenceId("user_a"), "user:user_a");
  assert.equal(userResetFenceId(" user_a "), "user:user_a");
  assert.throws(() => userResetFenceId("   "), /user ID is required/i);
});

test("personal fences initialize lazily and remain isolated from each other", async () => {
  const initial = new Date(0);
  const fences = new Map<string, Date>();
  const upserts: string[] = [];
  const locks: string[] = [];
  const client = {
    async $queryRawUnsafe<T>(query: string, fenceId?: unknown) {
      if (query.includes("FOR SHARE")) {
        locks.push(String(fenceId));
        return [{ lastResetAt: fences.get(String(fenceId)) }] as T;
      }
      return [] as T;
    },
    resetFence: {
      async upsert(args: {
        where: { id: string };
        create: { id: string; lastResetAt: Date };
      }) {
        upserts.push(args.where.id);
        if (!fences.has(args.where.id)) {
          fences.set(args.where.id, args.create.lastResetAt);
        }
        return { lastResetAt: fences.get(args.where.id) ?? initial };
      },
      async update() {
        throw new Error("not used");
      },
    },
  };

  assert.equal(
    (await lockResetFenceForNewWorker(client, userResetFenceId("user_a"))).getTime(),
    initial.getTime(),
  );
  assert.equal(
    (await lockResetFenceForNewWorker(client, userResetFenceId("user_b"))).getTime(),
    initial.getTime(),
  );
  assert.deepEqual(upserts, ["user:user_a", "user:user_b"]);
  assert.deepEqual(locks, ["user:user_a", "user:user_b"]);
});

test("the default global fence remains compatible and is never lazily recreated", async () => {
  const lastResetAt = new Date("2026-07-14T04:00:00.000Z");
  const client = fenceClient(lastResetAt);

  assert.equal(await lockResetFenceForNewWorker(client), lastResetAt);
  assert.equal(client.upserts.length, 0);
  assert.equal(client.fenceIds[0], GLOBAL_RESET_FENCE_ID);
});

test("personal reset advances only its selected fence", async () => {
  const personalFence = userResetFenceId("user_a");
  const client = scopedResetClient();

  await lockResetFenceForReset(client, personalFence);

  assert.deepEqual(client.upserts, [personalFence]);
  assert.deepEqual(client.locks, [personalFence]);
  assert.deepEqual(client.updates, [personalFence]);
});

test("RESET timestamps the fence only after acquiring its exclusive lock", async () => {
  let lockResolvedAt = 0;
  let writtenAt = 0;
  const client = {
    async $queryRawUnsafe(query: string) {
      if (query.includes("clock_timestamp")) {
        return [{ now: new Date(lockResolvedAt + 1) }];
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      lockResolvedAt = Date.now();
      return [{ id: "global" }];
    },
    resetFence: {
      async update(args: { data: { lastResetAt: Date } }) {
        writtenAt = args.data.lastResetAt.getTime();
        return { lastResetAt: args.data.lastResetAt };
      },
    },
  };

  const lastResetAt = await lockResetFenceForReset(client);

  assert.ok(writtenAt >= lockResolvedAt);
  assert.equal(lastResetAt.getTime(), writtenAt);
});

test("reset fence rejects a worker whose run started at or before RESET", async () => {
  const lastResetAt = new Date("2026-07-14T04:00:00.000Z");
  const client = fenceClient(lastResetAt);

  await assert.rejects(
    lockResetFenceForWorker(client, new Date("2026-07-14T03:59:59.000Z")),
    StaleWorkerWriteError,
  );
  await assert.rejects(
    lockResetFenceForWorker(client, lastResetAt),
    StaleWorkerWriteError,
  );
  await lockResetFenceForWorker(client, new Date("2026-07-14T04:00:00.001Z"));
  assert.match(client.queries[0], /FOR SHARE/);
});

test("new worker creation can lock the current fence without trusting a client clock", async () => {
  const lastResetAt = new Date("2026-07-14T04:00:00.000Z");
  const client = fenceClient(lastResetAt);

  assert.equal(await lockResetFenceForNewWorker(client), lastResetAt);
  assert.match(client.queries[0], /FOR SHARE/);
});

test("stale worker write errors expose the reset-fenced API contract", () => {
  const error = new StaleWorkerWriteError();

  assert.equal(error.statusCode, 409);
  assert.equal(error.responseCode, "agent_job_reset_fenced");
  assert.equal(error.retryable, false);
  assert.match(error.message, /latest reset/);
  assert.doesNotMatch(error.message, /global reset/);
});

test("cloud scheduler and digest writers serialize every generated-state mutation with RESET", () => {
  const scheduler = source("src/lib/cloud-source-scheduler.ts");
  const leaseRoute = source("src/app/api/admin/cloud-fetch/lease/route.ts");
  const cli = source("scripts/builder-digest.mjs");
  const context = source("src/app/api/skill/context/route.ts");
  const digests = source("src/app/api/skill/digests/route.ts");

  assert.match(scheduler, /materializeDueCloudFetchQueue[\s\S]*\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*cloudFetchQueueItem\.create/);
  assert.match(scheduler, /leaseCloudFetchTasks[\s\S]*\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*cloudFetchRun\.create[\s\S]*cloudFetchRunTask\.create/);
  assert.match(scheduler, /workerStartedAt\?: Date/);
  assert.match(scheduler, /const workerStartedAt = await databaseClockNow\(prisma\);[\s\S]*\$transaction/);
  assert.match(scheduler, /lockResetFenceForWorker\(prisma, params\.workerStartedAt\)/);
  assert.match(leaseRoute, /jobRunId is required/);
  assert.match(leaseRoute, /jobType: "cloud-library-fetch"/);
  assert.match(leaseRoute, /instanceId: jobRunId/);
  assert.match(leaseRoute, /workerStartedAt: jobRun\.createdAt/);
  assert.match(cli, /cloud fetch lease[\s\S]*jobRunId: envJobRunId\(\)/);
  assert.match(context, /\$transaction[\s\S]*jobType:\s*"digest-build"[\s\S]*createdAt:\s*true[\s\S]*lockResetFenceForWorker\(tx, jobRun\.createdAt, userResetFenceId\(user\.id\)\)[\s\S]*digestRun\.create/);
  assert.match(context, /Failed to record DigestRun for digest prepare[\s\S]*Could not prepare a durable Brief run[\s\S]*status:\s*500/);
  assert.match(digests, /digestRun\.findFirst[\s\S]*jobRunId[\s\S]*agentJobRun\.findFirst[\s\S]*createdAt:\s*true/);
  assert.match(digests, /lockResetFenceForWorker\(tx, jobRun\.createdAt, userResetFenceId\(user\.id\)\)/);
  assert.match(digests, /\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*digest\.create[\s\S]*digestedItem\.upsert[\s\S]*digestRun\.updateMany/);
  // The prepared->synced transition is an atomic guarded claim: only the sync
  // that still sees status "prepared" wins, so concurrent syncs of the same
  // run cannot both create a Digest.
  assert.match(digests, /digestRun\.updateMany\([\s\S]*status:\s*"prepared"[\s\S]*\}\);\s*if \(synced\.count === 0\) throw new StaleWorkerWriteError\(\)/);
  assert.doesNotMatch(scheduler, /userResetFenceId/);
  assert.doesNotMatch(leaseRoute, /userResetFenceId/);
});

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function fenceClient(lastResetAt: Date) {
  const client = {
    queries: [] as string[],
    fenceIds: [] as string[],
    upserts: [] as string[],
    async $queryRawUnsafe<T>(query: string, fenceId?: unknown) {
      this.queries.push(query);
      if (fenceId) this.fenceIds.push(String(fenceId));
      return [{ lastResetAt }] as T;
    },
    resetFence: {
      async upsert(args: { where: { id: string } }) {
        client.upserts.push(args.where.id);
        return { lastResetAt };
      },
      async update() {
        return { lastResetAt };
      },
    },
  };
  return client;
}

function scopedResetClient() {
  const now = new Date("2026-07-14T04:00:00.000Z");
  const client = {
    upserts: [] as string[],
    locks: [] as string[],
    updates: [] as string[],
    async $queryRawUnsafe<T>(query: string, fenceId?: unknown) {
      if (query.includes("clock_timestamp")) return [{ now }] as T;
      client.locks.push(String(fenceId));
      return [{ id: fenceId }] as T;
    },
    resetFence: {
      async upsert(args: { where: { id: string } }) {
        client.upserts.push(args.where.id);
        return { lastResetAt: new Date(0) };
      },
      async update(args: { where: { id: string }; data: { lastResetAt: Date } }) {
        client.updates.push(args.where.id);
        return { lastResetAt: args.data.lastResetAt };
      },
    },
  };
  return client;
}
