import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

test("account reset route replaces the global admin reset endpoint", () => {
  const root = process.cwd();
  const accountRoute = join(root, "src/app/api/account/generated-data/reset/route.ts");
  const adminRoute = join(root, "src/app/api/admin/maintenance/fetch-digest-reset/route.ts");

  assert.equal(existsSync(accountRoute), true);
  assert.equal(existsSync(adminRoute), false);
  const route = readFileSync(accountRoute, "utf8");
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export const POST =/);
  assert.doesNotMatch(route, /isAdminEmail|userId|email|scope/);
});

test("account reset handler requires authentication", async () => {
  const { createAccountGeneratedDataResetPost } = await import(
    "../src/lib/account-generated-data-reset-route"
  );
  let resetCalls = 0;
  const post = createAccountGeneratedDataResetPost({
    getSession: async () => null,
    reset: async () => {
      resetCalls += 1;
      throw new Error("must not run");
    },
    logError: () => undefined,
  });

  const response = await post(resetRequest({ confirmation: "RESET" }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(resetCalls, 0);
});

test("account reset handler requires exact RESET after trimming", async () => {
  const { createAccountGeneratedDataResetPost } = await import(
    "../src/lib/account-generated-data-reset-route"
  );
  let resetCalls = 0;
  const post = createAccountGeneratedDataResetPost({
    getSession: async () => ({ user: { id: "session-user" } }),
    reset: async () => {
      resetCalls += 1;
      throw new Error("must not run");
    },
    logError: () => undefined,
  });

  for (const confirmation of ["reset", "RESET!", "", null]) {
    const response = await post(resetRequest({ confirmation }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Type RESET to confirm." });
  }
  assert.equal(resetCalls, 0);
});

test("account reset handler derives the only target from the session", async () => {
  const { createAccountGeneratedDataResetPost } = await import(
    "../src/lib/account-generated-data-reset-route"
  );
  const targets: string[] = [];
  const summary = {
    resetBuilders: 1,
    deletedFeedItems: 2,
    deletedLibraryFetchRuns: 3,
    deletedDigests: 4,
    deletedDigestRuns: 5,
    deletedDigestedItems: 6,
    deletedRecommendationSnapshots: 7,
    deletedAgentJobRuns: 8,
    lastResetAt: "2026-08-04T12:00:00.000Z",
  };
  const post = createAccountGeneratedDataResetPost({
    getSession: async () => ({ user: { id: "session-user" } }),
    reset: async (userId) => {
      targets.push(userId);
      return summary;
    },
    logError: () => undefined,
  });

  const response = await post(resetRequest({
    confirmation: "  RESET  ",
    userId: "other-user",
    email: "other@example.com",
    ownerUserId: "other-owner",
    scope: "global",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(targets, ["session-user"]);
  assert.deepEqual(await response.json(), { status: "reset", summary });
});

test("account reset handler hides internal reset failures", async () => {
  const { createAccountGeneratedDataResetPost } = await import(
    "../src/lib/account-generated-data-reset-route"
  );
  const logged: unknown[] = [];
  const post = createAccountGeneratedDataResetPost({
    getSession: async () => ({ user: { id: "session-user" } }),
    reset: async () => {
      throw new Error("database password leaked");
    },
    logError: (...values) => logged.push(values),
  });

  const response = await post(resetRequest({ confirmation: "RESET" }));
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, { error: "Could not reset generated data." });
  assert.doesNotMatch(JSON.stringify(body), /password leaked/);
  assert.equal(logged.length, 1);
});

test("personal reset summary reports only current-account generated counts", async () => {
  const { generatedDataResetSummary } = await import(
    "../src/lib/generated-data-reset-summary"
  );

  const message = generatedDataResetSummary({
    resetBuilders: 8,
    deletedFeedItems: 21,
    deletedLibraryFetchRuns: 2,
    deletedDigests: 3,
    deletedDigestRuns: 1,
    deletedDigestedItems: 4,
    deletedRecommendationSnapshots: 5,
    deletedAgentJobRuns: 2,
    lastResetAt: "2026-08-04T12:00:00.000Z",
  });

  assert.equal(message, "Reset 8 sources. Deleted 21 posts, 3 briefs, and 5 logs.");
  assert.doesNotMatch(message, /users?|Cloud|queue|work records/i);
});

test("maintenance target parser requires exactly one explicit account selector", async () => {
  const { parseUserResetTarget } = await import(
    "../src/lib/user-generated-data-reset-target"
  );

  assert.deepEqual(parseUserResetTarget(["--user-id", "user_a"]), {
    kind: "userId",
    value: "user_a",
  });
  assert.deepEqual(parseUserResetTarget(["--email", "person@example.com"]), {
    kind: "email",
    value: "person@example.com",
  });
  for (const args of [
    [],
    ["--user-id"],
    ["--user-id", "user_a", "--email", "person@example.com"],
    ["--user-id", "user_a", "--user-id", "user_b"],
    ["--all"],
  ]) {
    assert.throws(() => parseUserResetTarget(args), /exactly one --user-id or --email/i);
  }
});

test("maintenance target resolver fails closed for unknown or ambiguous accounts", async () => {
  const { resolveUserResetTarget } = await import(
    "../src/lib/user-generated-data-reset-target"
  );

  await assert.rejects(
    resolveUserResetTarget(
      { kind: "userId", value: "missing" },
      userLookup([]) as never,
    ),
    /matched no account/i,
  );
  await assert.rejects(
    resolveUserResetTarget(
      { kind: "email", value: "duplicate@example.com" },
      userLookup([{ id: "a" }, { id: "b" }]) as never,
    ),
    /matched multiple accounts/i,
  );
  assert.equal(
    await resolveUserResetTarget(
      { kind: "email", value: "person@example.com" },
      userLookup([{ id: "user_a" }]) as never,
    ),
    "user_a",
  );
});

test("repository has no unattended all-user generated-data reset script", () => {
  const root = process.cwd();
  const oldScript = join(root, "scripts/clear-fetch-digest-state.mts");
  const script = join(root, "scripts/reset-user-fetch-digest-state.mts");

  assert.equal(existsSync(oldScript), false);
  assert.equal(existsSync(script), true);
  const source = readFileSync(script, "utf8");
  assert.match(source, /resetUserFetchDigestState\(userId/);
  assert.doesNotMatch(source, /resetFetchDigestState|for all users|--all/i);
});

test("maintenance script rejects a missing target before initializing the database", () => {
  const { DATABASE_URL: _databaseUrl, ...env } = process.env;
  const result = spawnSync(
    join(process.cwd(), "node_modules/.bin/tsx"),
    [join(process.cwd(), "scripts/reset-user-fetch-digest-state.mts")],
    { encoding: "utf8", env },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly one --user-id or --email/i);
  assert.doesNotMatch(result.stderr, /DATABASE_URL/);
});

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

function resetRequest(body: unknown) {
  return new Request("http://localhost/api/account/generated-data/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function userLookup(rows: Array<{ id: string }>) {
  return {
    user: {
      async findMany() {
        return rows;
      },
    },
  };
}
