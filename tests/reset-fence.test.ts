import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  lockResetFenceForReset,
  lockResetFenceForWorker,
  lockResetFenceForNewWorker,
  StaleWorkerWriteError,
} from "../src/lib/reset-fence";

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

test("RESET advances the durable fence before deleting generated state", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
  const { resetFetchDigestState } = await import("../src/lib/fetch-digest-reset");
  const calls: string[] = [];
  const tx = fakeResetTransaction(calls);
  const client = {
    async $transaction(callback: (value: typeof tx) => Promise<unknown>) {
      return callback(tx);
    },
  };

  const summary = await resetFetchDigestState(client as never);

  assert.deepEqual(calls.slice(0, 3), ["resetFence.lock", "resetFence.clock", "resetFence.update"]);
  assert.deepEqual(summary, {
    users: 3,
    resetBuilders: 11,
    deletedFeedItems: 12,
    deletedLibraryFetchRuns: 13,
    deletedDigests: 14,
    deletedDigestRuns: 15,
    deletedDigestedItems: 16,
    deletedAgentJobRuns: 17,
    resetCloudSourceTasks: 2,
    deletedCloudQueueItems: 18,
    deletedCloudRunTasks: 19,
    deletedCloudRuns: 20,
    deletedCloudAgentJobRuns: 21,
    lastResetAt: summary.lastResetAt,
  });
  assert.ok(Number.isFinite(Date.parse(summary.lastResetAt)));
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
  assert.match(context, /\$transaction[\s\S]*jobType:\s*"digest-build"[\s\S]*createdAt:\s*true[\s\S]*lockResetFenceForWorker\(tx, jobRun\.createdAt\)[\s\S]*digestRun\.create/);
  assert.match(context, /Failed to record DigestRun for digest prepare[\s\S]*Could not prepare a durable Brief run[\s\S]*status:\s*500/);
  assert.match(digests, /digestRun\.findFirst[\s\S]*jobRunId[\s\S]*agentJobRun\.findFirst[\s\S]*createdAt:\s*true/);
  assert.match(digests, /lockResetFenceForWorker\(tx, jobRun\.createdAt\)/);
  assert.match(digests, /\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*digest\.create[\s\S]*digestedItem\.upsert[\s\S]*digestRun\.updateMany/);
  // The prepared->synced transition is an atomic guarded claim: only the sync
  // that still sees status "prepared" wins, so concurrent syncs of the same
  // run cannot both create a Digest.
  assert.match(digests, /digestRun\.updateMany\([\s\S]*status:\s*"prepared"[\s\S]*\}\);\s*if \(synced\.count === 0\) throw new StaleWorkerWriteError\(\)/);
});

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function fenceClient(lastResetAt: Date) {
  return {
    queries: [] as string[],
    async $queryRawUnsafe<T>(query: string) {
      this.queries.push(query);
      return [{ lastResetAt }] as T;
    },
    resetFence: {
      async update() {
        return { lastResetAt };
      },
    },
  };
}

function fakeResetTransaction(calls: string[]) {
  const count = (name: string, value: number) => ({
    async deleteMany() {
      calls.push(`${name}.deleteMany`);
      return { count: value };
    },
  });
  return {
    async $queryRawUnsafe(query: string) {
      if (query.includes("clock_timestamp")) {
        calls.push("resetFence.clock");
        return [{ now: new Date("2026-07-14T04:00:00.000Z") }];
      }
      calls.push("resetFence.lock");
      return [{ id: "global" }];
    },
    resetFence: {
      async update(args: { data: { lastResetAt: Date } }) {
        calls.push("resetFence.update");
        return { lastResetAt: args.data.lastResetAt };
      },
    },
    user: { async count() { calls.push("user.count"); return 3; } },
    cloudSourceTask: {
      async findMany() {
        return [
          { id: "task_active", builderId: "builder_active", effectiveFrequency: "DAILY" },
          { id: "task_paused", builderId: "builder_paused", effectiveFrequency: "WEEKLY" },
        ];
      },
      updateIndex: 0,
      async updateMany(args: { where: { id: { in: string[] } } }) {
        if (args.where.id.in.length === 0) return { count: 0 };
        this.updateIndex += 1;
        calls.push("cloudSourceTask.updateMany");
        return { count: 1 };
      },
    },
    cloudSourceSubmission: {
      async groupBy() {
        return [{ cloudBuilderId: "builder_active", _count: { _all: 1 } }];
      },
    },
    feedItem: count("feedItem", 12),
    cloudFetchQueueItem: count("cloudFetchQueueItem", 18),
    cloudFetchRunTask: count("cloudFetchRunTask", 19),
    cloudFetchRun: count("cloudFetchRun", 20),
    libraryFetchRun: count("libraryFetchRun", 13),
    digest: count("digest", 14),
    digestRun: count("digestRun", 15),
    digestedItem: count("digestedItem", 16),
    agentJobRun: {
      deleteIndex: 0,
      async deleteMany() {
        this.deleteIndex += 1;
        calls.push("agentJobRun.deleteMany");
        return { count: this.deleteIndex === 1 ? 17 : 21 };
      },
    },
    builder: {
      async updateMany() {
        calls.push("builder.updateMany");
        return { count: 11 };
      },
    },
  };
}
