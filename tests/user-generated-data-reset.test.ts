import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";

type Operation = {
  model: string;
  action: string;
  args?: unknown;
};

const preservedModels = [
  "libraryCronJob",
  "digestCronJob",
  "agentToken",
  "subscription",
  "libraryImport",
  "digestPipelineImport",
  "libraryHubEntry",
  "libraryHubItem",
  "digestPipelineShare",
  "userFeedPreference",
  "userSourceTypeConfig",
  "userDigestConfig",
  "userChannelPreference",
  "userLibraryVisibility",
] as const;

const cloudModels = [
  "cloudSourceSubmission",
  "cloudSourceTask",
  "cloudFetchQueueItem",
  "cloudFetchRun",
  "cloudFetchRunTask",
  "cloudLanguageLibrary",
] as const;

test("personal reset advances its fence first and mutates only user-owned generated state", async () => {
  const { resetUserFetchDigestState } = await import("../src/lib/fetch-digest-reset");
  const fixture = resetClient();

  const summary = await resetUserFetchDigestState("user_a", fixture.client as never);

  assert.deepEqual(fixture.operations.slice(0, 4).map(operationName), [
    "resetFence.upsert",
    "resetFence.lock",
    "resetFence.clock",
    "resetFence.update",
  ]);
  assert.deepEqual(summary, {
    resetBuilders: 8,
    deletedFeedItems: 21,
    deletedLibraryFetchRuns: 2,
    deletedDigests: 3,
    deletedDigestRuns: 4,
    deletedDigestedItems: 5,
    deletedRecommendationSnapshots: 6,
    deletedAgentJobRuns: 7,
    lastResetAt: "2026-08-04T12:00:00.000Z",
  });

  assert.deepEqual(argsFor(fixture.operations, "recommendationSnapshot.deleteMany"), {
    where: { userId: "user_a" },
  });
  assert.deepEqual(argsFor(fixture.operations, "feedItem.deleteMany"), {
    where: { builder: { ownerUserId: "user_a" } },
  });
  for (const model of ["libraryFetchRun", "digest", "digestRun", "digestedItem"] as const) {
    assert.deepEqual(argsFor(fixture.operations, `${model}.deleteMany`), {
      where: { userId: "user_a" },
    });
  }
  assert.deepEqual(argsFor(fixture.operations, "agentJobRun.deleteMany"), {
    where: {
      userId: "user_a",
      jobType: { in: ["library-fetch", "digest-build"] },
    },
  });
  assert.deepEqual(argsFor(fixture.operations, "builder.updateMany"), {
    where: { ownerUserId: "user_a" },
    data: {
      itemCount: 0,
      lastFetchedAt: null,
      lastForcedAt: null,
      status: "IDLE",
      lastError: null,
    },
  });

  const forbiddenMutations = fixture.operations.filter((operation) =>
    [...preservedModels, ...cloudModels, "feedRead", "feedFavorite"].includes(
      operation.model as never,
    ) && ["deleteMany", "updateMany", "delete", "update"].includes(operation.action)
  );
  assert.deepEqual(forbiddenMutations, []);
});

test("personal reset checks every cross-user post reference before deleting", async () => {
  const { resetUserFetchDigestState } = await import("../src/lib/fetch-digest-reset");
  const fixture = resetClient();

  await resetUserFetchDigestState("user_a", fixture.client as never);

  const personalPostFilter = { feedItem: { builder: { ownerUserId: "user_a" } } };
  assert.deepEqual(argsFor(fixture.operations, "recommendationSnapshotItem.count"), {
    where: {
      ...personalPostFilter,
      snapshot: { userId: { not: "user_a" } },
    },
  });
  assert.deepEqual(argsFor(fixture.operations, "feedRead.count"), {
    where: {
      ...personalPostFilter,
      userId: { not: "user_a" },
    },
  });
  assert.deepEqual(argsFor(fixture.operations, "feedFavorite.count"), {
    where: {
      ...personalPostFilter,
      userId: { not: "user_a" },
    },
  });
});

for (const crossReference of ["recommendation", "read", "favorite"] as const) {
  test(`personal reset aborts atomically when another user has a ${crossReference} reference`, async () => {
    const { resetUserFetchDigestState } = await import("../src/lib/fetch-digest-reset");
    const fixture = resetClient({ [crossReference]: 1 });

    await assert.rejects(
      resetUserFetchDigestState("user_a", fixture.client as never),
      /another user references generated posts owned by this account/i,
    );

    const destructiveOperations = fixture.operations.filter((operation) =>
      ["deleteMany", "updateMany", "delete", "update"].includes(operation.action) &&
      operation.model !== "resetFence"
    );
    assert.deepEqual(destructiveOperations, []);
  });
}

test("personal reset requires a concrete user ID", async () => {
  const { resetUserFetchDigestState } = await import("../src/lib/fetch-digest-reset");
  const fixture = resetClient();

  await assert.rejects(
    resetUserFetchDigestState("   ", fixture.client as never),
    /user ID is required/i,
  );
  assert.deepEqual(fixture.operations, []);
});

function resetClient(
  crossReferences: Partial<Record<"recommendation" | "read" | "favorite", number>> = {},
) {
  const operations: Operation[] = [];
  const count = (model: string, value: number) => async (args: unknown) => {
    operations.push({ model, action: "count", args });
    return value;
  };
  const deleteMany = (model: string, value: number) => async (args: unknown) => {
    operations.push({ model, action: "deleteMany", args });
    return { count: value };
  };
  const forbiddenModel = (model: string) => ({
    async deleteMany(args: unknown) {
      operations.push({ model, action: "deleteMany", args });
      throw new Error(`Forbidden mutation: ${model}.deleteMany`);
    },
    async updateMany(args: unknown) {
      operations.push({ model, action: "updateMany", args });
      throw new Error(`Forbidden mutation: ${model}.updateMany`);
    },
  });

  const tx: Record<string, unknown> = {
    async $queryRawUnsafe(query: string, fenceId?: unknown) {
      if (query.includes("clock_timestamp")) {
        operations.push({ model: "resetFence", action: "clock" });
        return [{ now: new Date("2026-08-04T12:00:00.000Z") }];
      }
      operations.push({ model: "resetFence", action: "lock", args: fenceId });
      return [{ id: fenceId }];
    },
    resetFence: {
      async upsert(args: unknown) {
        operations.push({ model: "resetFence", action: "upsert", args });
        return { lastResetAt: new Date(0) };
      },
      async update(args: { data: { lastResetAt: Date } }) {
        operations.push({ model: "resetFence", action: "update", args });
        return { lastResetAt: args.data.lastResetAt };
      },
    },
    recommendationSnapshotItem: {
      count: count("recommendationSnapshotItem", crossReferences.recommendation ?? 0),
    },
    feedRead: {
      count: count("feedRead", crossReferences.read ?? 0),
      ...forbiddenModel("feedRead"),
    },
    feedFavorite: {
      count: count("feedFavorite", crossReferences.favorite ?? 0),
      ...forbiddenModel("feedFavorite"),
    },
    recommendationSnapshot: { deleteMany: deleteMany("recommendationSnapshot", 6) },
    feedItem: { deleteMany: deleteMany("feedItem", 21) },
    libraryFetchRun: { deleteMany: deleteMany("libraryFetchRun", 2) },
    digest: { deleteMany: deleteMany("digest", 3) },
    digestRun: { deleteMany: deleteMany("digestRun", 4) },
    digestedItem: { deleteMany: deleteMany("digestedItem", 5) },
    agentJobRun: { deleteMany: deleteMany("agentJobRun", 7) },
    builder: {
      async updateMany(args: unknown) {
        operations.push({ model: "builder", action: "updateMany", args });
        return { count: 8 };
      },
    },
  };

  for (const model of [...preservedModels, ...cloudModels]) {
    tx[model] = forbiddenModel(model);
  }

  return {
    operations,
    client: {
      async $transaction(callback: (value: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    },
  };
}

function operationName(operation: Operation) {
  return `${operation.model}.${operation.action}`;
}

function argsFor(operations: Operation[], name: string) {
  const operation = operations.find((candidate) => operationName(candidate) === name);
  assert.ok(operation, `Missing operation ${name}`);
  return operation.args;
}
