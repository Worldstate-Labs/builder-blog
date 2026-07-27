import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const SOURCE_CANDIDATE_LIBRARY_PATH = path.join(
  process.cwd(),
  "src/lib/source-candidate-library.ts",
);
const SYNC_SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts/sync-reviewed-ai-source-candidates.ts",
);

type StructuralSourceCandidate = {
  sourceKey: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  seedBuilderId: string | null;
  seededFrom: string | null;
};

type StoredSourceCandidate = StructuralSourceCandidate & {
  id: string;
};

type SyncSummary = {
  targetCount: number;
  insertedCount: number;
  existingCount: number;
  unchangedUnrelatedCount: number;
  structuralDigest: string;
};

type SyncModule = {
  syncReviewedAiSourceCandidates?: (prismaClient: FakePrismaClient) => Promise<SyncSummary>;
};

type SourceCandidateLibraryModule = {
  CURATED_AI_SOURCE_CANDIDATE_SEED?: string;
  REVIEWED_AI_SOURCE_CANDIDATES?: Array<{
    name: string;
    sourceType: string;
    sourceUrl: string;
    fetchUrl?: string | null;
    handle?: string | null;
    avatarUrl?: string | null;
  }>;
  seedFromCuratedCandidate?: (
    candidate: {
      name: string;
      sourceType: string;
      sourceUrl: string;
      fetchUrl?: string | null;
      handle?: string | null;
      avatarUrl?: string | null;
    },
    seededFrom?: string,
  ) => StructuralSourceCandidate;
};

type FindManyArgs = {
  where?: {
    sourceKey?: {
      in?: string[];
      notIn?: string[];
    };
    seededFrom?: string | null;
  };
  orderBy?:
    | {
        sourceKey?: "asc" | "desc";
      }
    | Array<{
        sourceKey?: "asc" | "desc";
      }>;
  select?: Record<string, boolean>;
};

type UpsertArgs = {
  where: {
    sourceKey: string;
  };
  update: Partial<StructuralSourceCandidate>;
  create: StructuralSourceCandidate;
};

type UpsertHook = (state: StoredSourceCandidate[], args: UpsertArgs, upsertCount: number) => void;

class FakePrismaClient {
  private rows: StoredSourceCandidate[];
  readonly transactionCalls: Array<{ interactive: boolean }> = [];
  readonly deleteManyCalls: unknown[] = [];
  readonly upsertedKeys: string[] = [];
  readonly upsertCalls: UpsertArgs[] = [];
  private readonly throwOnUpsertSourceKey?: string;
  private readonly upsertErrorMessage?: string;
  private readonly onUpsert?: UpsertHook;

  constructor(
    rows: StoredSourceCandidate[],
    options: {
      throwOnUpsertSourceKey?: string;
      upsertErrorMessage?: string;
      onUpsert?: UpsertHook;
    } = {},
  ) {
    this.rows = cloneRows(rows);
    this.throwOnUpsertSourceKey = options.throwOnUpsertSourceKey;
    this.upsertErrorMessage = options.upsertErrorMessage;
    this.onUpsert = options.onUpsert;
  }

  readonly sourceCandidate = {
    findMany: async (_args: FindManyArgs) => {
      throw new Error("reviewed candidate sync must use sourceCandidate reads inside $transaction");
    },
    upsert: async (_args: UpsertArgs) => {
      throw new Error("reviewed candidate sync must use sourceCandidate upserts inside $transaction");
    },
    deleteMany: async (args: unknown) => {
      this.deleteManyCalls.push(args);
      return { count: 0 };
    },
  };

  async $transaction<T>(
    callback: (tx: {
      sourceCandidate: {
        findMany: (args: FindManyArgs) => Promise<unknown[]>;
        upsert: (args: UpsertArgs) => Promise<StoredSourceCandidate>;
        deleteMany: (args: unknown) => Promise<{ count: number }>;
      };
    }) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls.push({ interactive: true });
    const state = cloneRows(this.rows);
    let upsertCount = 0;
    const tx = {
      sourceCandidate: {
        findMany: async (args: FindManyArgs) => selectRows(state, args),
        upsert: async (args: UpsertArgs) => {
          upsertCount += 1;
          this.upsertedKeys.push(args.where.sourceKey);
          this.upsertCalls.push(cloneRow(args));
          if (args.where.sourceKey === this.throwOnUpsertSourceKey) {
            throw new Error(
              this.upsertErrorMessage ??
                "target upsert failed for postgresql://user:password@db.example.test:5432/builder_blog",
            );
          }
          const index = state.findIndex((row) => row.sourceKey === args.where.sourceKey);
          if (index >= 0) {
            state[index] = {
              ...state[index],
              ...cloneRow({
                ...args.update,
                id: state[index].id,
              }),
            };
          } else {
            state.push({
              ...cloneRow(args.create),
              id: `candidate_${state.length + 1}`,
            });
          }
          this.onUpsert?.(state, args, upsertCount);
          return cloneRow(state.find((row) => row.sourceKey === args.where.sourceKey)!);
        },
        deleteMany: async (args: unknown) => {
          this.deleteManyCalls.push(args);
          return { count: 0 };
        },
      },
    };

    try {
      const result = await callback(tx);
      this.rows = state;
      return result;
    } catch (error) {
      throw error;
    }
  }

  exportRows() {
    return cloneRows(this.rows);
  }

  structuralRows() {
    return cloneRows(this.rows)
      .map(structuralCandidate)
      .sort(compareBySourceKey);
  }

  manifestStructuralRows() {
    return cloneRows(this.rows)
      .map(manifestStructuralCandidate)
      .sort(compareBySourceKey);
  }
}

test("package.json wires the reviewed AI candidate sync command", () => {
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.["sources:sync-reviewed-ai-candidates"],
    "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/sync-reviewed-ai-source-candidates.ts",
  );
});

test("sync runs in one transaction, upserts reviewed AI candidates, preserves avatars, and leaves unrelated rows unchanged", async () => {
  const library = await loadLibraryModule();
  const syncModule = await loadSyncModule();
  assert.equal(
    typeof syncModule.syncReviewedAiSourceCandidates,
    "function",
    "syncReviewedAiSourceCandidates must be exported",
  );

  const reviewedSeeds = expectedReviewedSeeds(library);
  const [firstSeed, secondSeed] = reviewedSeeds;
  const unrelatedRows = [
    storedCandidate("candidate_unrelated_admin", {
      sourceKey: "blog:https://builder.example.com/feed",
      name: "Builder Feed",
      sourceType: "blog",
      sourceUrl: "https://builder.example.com/feed",
      fetchUrl: "https://builder.example.com/feed.xml",
      handle: null,
      avatarUrl: "https://builder.example.com/favicon.png",
      avatarDataUrl: "data:image/png;base64,YnVpbGRlcg==",
      seedBuilderId: "builder_123",
      seededFrom: "admin_source_library",
    }),
    storedCandidate("candidate_unrelated_curated", {
      sourceKey: "blog:https://old.example.com/feed",
      name: "Legacy Curated Source",
      sourceType: "blog",
      sourceUrl: "https://old.example.com/feed",
      fetchUrl: "https://old.example.com/feed.xml",
      handle: null,
      avatarUrl: "https://old.example.com/og.png",
      avatarDataUrl: null,
      seedBuilderId: null,
      seededFrom: library.CURATED_AI_SOURCE_CANDIDATE_SEED ?? "curated_ai_sources",
    }),
  ];
  const prisma = new FakePrismaClient([
    storedCandidate("candidate_existing_1", {
      ...firstSeed,
      name: `${firstSeed.name} (stale)`,
      avatarDataUrl: "data:image/png;base64,cHJlc2VydmU=",
      avatarUrl: "https://stale.example.com/avatar.png",
    }),
    storedCandidate("candidate_existing_2", {
      ...secondSeed,
      sourceUrl: "https://stale.example.com/second",
      fetchUrl: null,
      avatarDataUrl: null,
      avatarUrl: "https://stale.example.com/second.png",
    }),
    ...unrelatedRows,
  ]);
  const unrelatedBefore = prisma
    .manifestStructuralRows()
    .filter((row) => row.sourceKey !== firstSeed.sourceKey && row.sourceKey !== secondSeed.sourceKey);

  process.env.DATABASE_URL =
    "postgresql://sync_user:super-secret-pass@db.example.test:5432/builder_blog?schema=public";

  const summary = await syncModule.syncReviewedAiSourceCandidates!(prisma);

  assert.equal(prisma.transactionCalls.length, 1);
  assert.equal(prisma.deleteManyCalls.length, 0);
  assert.equal(prisma.upsertedKeys.length, reviewedSeeds.length);
  assert.equal(new Set(prisma.upsertedKeys).size, reviewedSeeds.length);
  const updateCalls = prisma.upsertCalls.filter((call) =>
    call.where.sourceKey === firstSeed.sourceKey || call.where.sourceKey === secondSeed.sourceKey,
  );
  assert.equal(updateCalls.length, 2);
  for (const call of updateCalls) {
    assert.equal("avatarDataUrl" in call.update, false);
    assert.equal("seedBuilderId" in call.update, true);
    assert.equal(call.update.seedBuilderId, null);
  }

  const rowsByKey = new Map(prisma.structuralRows().map((row) => [row.sourceKey, row]));
  assert.equal(
    reviewedSeeds.every((seed) => rowsByKey.has(seed.sourceKey)),
    true,
    "every reviewed seed must exist after sync",
  );

  for (const seed of reviewedSeeds) {
    const actual = rowsByKey.get(seed.sourceKey);
    const expectedAvatarDataUrl =
      seed.sourceKey === firstSeed.sourceKey ? "data:image/png;base64,cHJlc2VydmU=" : seed.avatarDataUrl;
    assert.deepEqual(actual, {
      ...seed,
      avatarDataUrl: expectedAvatarDataUrl,
    });
    assert.equal(actual?.seededFrom, library.CURATED_AI_SOURCE_CANDIDATE_SEED ?? "curated_ai_sources");
    assert.equal(actual?.seedBuilderId, null);
  }

  const unrelatedAfter = prisma
    .manifestStructuralRows()
    .filter((row) => !reviewedSeeds.some((seed) => seed.sourceKey === row.sourceKey));
  assert.deepEqual(unrelatedAfter, unrelatedBefore);

  assert.deepEqual(summary, {
    targetCount: reviewedSeeds.length,
    insertedCount: reviewedSeeds.length - 2,
    existingCount: 2,
    unchangedUnrelatedCount: unrelatedBefore.length,
    structuralDigest: summary.structuralDigest,
  });
  assert.match(summary.structuralDigest, /^[a-f0-9]{64}$/);

  const serializedSummary = JSON.stringify(summary);
  assert.doesNotMatch(serializedSummary, /DATABASE_URL/i);
  assert.doesNotMatch(serializedSummary, /super-secret-pass/);
  assert.doesNotMatch(serializedSummary, /postgresql:\/\//i);
});

test("a target upsert failure rolls the full transaction back", async () => {
  const library = await loadLibraryModule();
  const syncModule = await loadSyncModule();
  const reviewedSeeds = expectedReviewedSeeds(library);
  const failingSeed = reviewedSeeds[3];
  const initialRows = [
    storedCandidate("candidate_existing", {
      ...reviewedSeeds[0],
      avatarDataUrl: "data:image/png;base64,cm9sbGJhY2s=",
    }),
    storedCandidate("candidate_unrelated", {
      sourceKey: "blog:https://outside.example.com/feed",
      name: "Outside Source",
      sourceType: "blog",
      sourceUrl: "https://outside.example.com/feed",
      fetchUrl: null,
      handle: null,
      avatarUrl: "https://outside.example.com/favicon.png",
      avatarDataUrl: null,
      seedBuilderId: null,
      seededFrom: "admin_source_library",
    }),
  ];
  const prisma = new FakePrismaClient(initialRows, {
    throwOnUpsertSourceKey: failingSeed.sourceKey,
    upsertErrorMessage:
      "upsert exploded while using postgresql://rollback-user:rollback-secret@db.example.test:5432/builder_blog",
  });

  await assert.rejects(
    syncModule.syncReviewedAiSourceCandidates!(prisma),
    /target upsert failed|sync failed|upsert exploded/i,
  );
  assert.deepEqual(prisma.exportRows(), initialRows);
  assert.equal(prisma.transactionCalls.length, 1);
});

test("two sync runs are idempotent and create no duplicate target rows", async () => {
  const library = await loadLibraryModule();
  const syncModule = await loadSyncModule();
  const reviewedSeeds = expectedReviewedSeeds(library);
  const prisma = new FakePrismaClient([
    storedCandidate("candidate_unrelated", {
      sourceKey: "blog:https://kept.example.com/feed",
      name: "Kept Source",
      sourceType: "blog",
      sourceUrl: "https://kept.example.com/feed",
      fetchUrl: null,
      handle: null,
      avatarUrl: "https://kept.example.com/favicon.png",
      avatarDataUrl: null,
      seedBuilderId: null,
      seededFrom: "admin_source_library",
    }),
  ]);

  const firstSummary = await syncModule.syncReviewedAiSourceCandidates!(prisma);
  const firstState = prisma.structuralRows();
  const secondSummary = await syncModule.syncReviewedAiSourceCandidates!(prisma);
  const secondState = prisma.structuralRows();

  assert.deepEqual(secondState, firstState);
  assert.equal(
    secondState.filter((row) => reviewedSeeds.some((seed) => seed.sourceKey === row.sourceKey)).length,
    reviewedSeeds.length,
  );
  assert.equal(
    new Set(secondState.map((row) => row.sourceKey)).size,
    secondState.length,
  );
  assert.equal(firstSummary.structuralDigest, secondSummary.structuralDigest);
  assert.equal(secondSummary.insertedCount, 0);
  assert.equal(secondSummary.existingCount, reviewedSeeds.length);
});

test("an unrelated-row snapshot mismatch rejects the transaction and preserves the original state", async () => {
  const library = await loadLibraryModule();
  const syncModule = await loadSyncModule();
  const reviewedSeeds = expectedReviewedSeeds(library);
  const initialRows = [
    storedCandidate("candidate_existing", reviewedSeeds[0]),
    storedCandidate("candidate_unrelated", {
      sourceKey: "blog:https://tamper.example.com/feed",
      name: "Tamper Target",
      sourceType: "blog",
      sourceUrl: "https://tamper.example.com/feed",
      fetchUrl: "https://tamper.example.com/feed.xml",
      handle: null,
      avatarUrl: "https://tamper.example.com/favicon.png",
      avatarDataUrl: null,
      seedBuilderId: null,
      seededFrom: "admin_source_library",
    }),
  ];
  const prisma = new FakePrismaClient(initialRows, {
    onUpsert(state, _args, upsertCount) {
      if (upsertCount !== 1) return;
      const unrelated = state.find(
        (row) => row.sourceKey === "blog:https://tamper.example.com/feed",
      );
      if (unrelated) {
        unrelated.name = "Tampered During Transaction";
      }
    },
  });

  await assert.rejects(
    syncModule.syncReviewedAiSourceCandidates!(prisma),
    /unrelated|snapshot|changed/i,
  );
  assert.deepEqual(prisma.exportRows(), initialRows);
});

test("sync ignores unrelated avatar cache and seedBuilderId churn during the transaction", async () => {
  const library = await loadLibraryModule();
  const syncModule = await loadSyncModule();
  const reviewedSeeds = expectedReviewedSeeds(library);
  const initialRows = [
    storedCandidate("candidate_existing", {
      ...reviewedSeeds[0],
      avatarDataUrl: "data:image/png;base64,cHJlc2VydmU=",
    }),
    storedCandidate("candidate_unrelated", {
      sourceKey: "blog:https://cache.example.com/feed",
      name: "Cache Target",
      sourceType: "blog",
      sourceUrl: "https://cache.example.com/feed",
      fetchUrl: "https://cache.example.com/feed.xml",
      handle: null,
      avatarUrl: "https://cache.example.com/favicon.png",
      avatarDataUrl: null,
      seedBuilderId: null,
      seededFrom: "admin_source_library",
    }),
  ];
  const prisma = new FakePrismaClient(initialRows, {
    onUpsert(state, _args, upsertCount) {
      if (upsertCount !== 1) return;
      const unrelated = state.find(
        (row) => row.sourceKey === "blog:https://cache.example.com/feed",
      );
      if (unrelated) {
        unrelated.avatarDataUrl = "data:image/png;base64,YmFja2ZpbGw=";
        unrelated.seedBuilderId = "builder_backfill";
      }
    },
  });

  const summary = await syncModule.syncReviewedAiSourceCandidates!(prisma);

  assert.equal(summary.targetCount, reviewedSeeds.length);
  const unrelated = prisma.exportRows().find(
    (row) => row.sourceKey === "blog:https://cache.example.com/feed",
  );
  assert.equal(unrelated?.avatarDataUrl, "data:image/png;base64,YmFja2ZpbGw=");
  assert.equal(unrelated?.seedBuilderId, "builder_backfill");
});

test("sync rejects when a reviewed target key is already owned by another seededFrom namespace", async () => {
  const library = await loadLibraryModule();
  const syncModule = await loadSyncModule();
  const reviewedSeeds = expectedReviewedSeeds(library);
  const foreignOwnedSeed = reviewedSeeds[0];
  const initialRows = [
    storedCandidate("candidate_conflict", {
      ...foreignOwnedSeed,
      name: "Foreign Owned Candidate",
      avatarDataUrl: "data:image/png;base64,Zm9yZWlnbg==",
      seededFrom: "cloud_source_library",
    }),
    storedCandidate("candidate_curated_existing", {
      ...reviewedSeeds[1],
      avatarDataUrl: "data:image/png;base64,Y3VyYXRlZA==",
      seededFrom: library.CURATED_AI_SOURCE_CANDIDATE_SEED ?? "curated_ai_sources",
    }),
    storedCandidate("candidate_unrelated", {
      sourceKey: "blog:https://manual.example.com/feed",
      name: "Manual Candidate",
      sourceType: "blog",
      sourceUrl: "https://manual.example.com/feed",
      fetchUrl: "https://manual.example.com/feed.xml",
      handle: null,
      avatarUrl: "https://manual.example.com/avatar.png",
      avatarDataUrl: null,
      seedBuilderId: null,
      seededFrom: "manual_builder",
    }),
  ];
  const prisma = new FakePrismaClient(initialRows);

  await assert.rejects(
    syncModule.syncReviewedAiSourceCandidates!(prisma),
    (error: unknown) => {
      assert.match(String(error), new RegExp(foreignOwnedSeed.sourceKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(String(error), /seededFrom|owned|conflict/i);
      assert.doesNotMatch(String(error), /postgres(?:ql)?:\/\//i);
      assert.doesNotMatch(String(error), /DATABASE_URL/i);
      return true;
    },
  );

  assert.deepEqual(prisma.exportRows(), initialRows);
  assert.equal(prisma.transactionCalls.length, 1);
  assert.deepEqual(prisma.upsertedKeys, []);
});

test("sync adopts null-owned reviewed targets and preserves their cached avatar without writing avatarDataUrl in update", async () => {
  const library = await loadLibraryModule();
  const syncModule = await loadSyncModule();
  const reviewedSeeds = expectedReviewedSeeds(library);
  const adoptingSeed = reviewedSeeds[0];
  const prisma = new FakePrismaClient([
    storedCandidate("candidate_legacy", {
      ...adoptingSeed,
      name: `${adoptingSeed.name} legacy`,
      avatarDataUrl: "data:image/png;base64,bGVnYWN5",
      seededFrom: null,
      seedBuilderId: "legacy_builder",
    }),
  ]);

  const summary = await syncModule.syncReviewedAiSourceCandidates!(prisma);

  assert.equal(summary.existingCount, 1);
  const adopted = prisma.exportRows().find((row) => row.sourceKey === adoptingSeed.sourceKey);
  assert.deepEqual(adopted, {
    id: "candidate_legacy",
    ...adoptingSeed,
    avatarDataUrl: "data:image/png;base64,bGVnYWN5",
    seededFrom: library.CURATED_AI_SOURCE_CANDIDATE_SEED ?? "curated_ai_sources",
    seedBuilderId: null,
  });
  const updateCall = prisma.upsertCalls.find((call) => call.where.sourceKey === adoptingSeed.sourceKey);
  assert.ok(updateCall);
  assert.equal("avatarDataUrl" in updateCall.update, false);
});

async function loadLibraryModule() {
  return import(`${pathToFileURL(SOURCE_CANDIDATE_LIBRARY_PATH).href}?t=${Date.now()}`) as Promise<SourceCandidateLibraryModule>;
}

async function loadSyncModule() {
  return import(`${pathToFileURL(SYNC_SCRIPT_PATH).href}?t=${Date.now()}`) as Promise<SyncModule>;
}

function expectedReviewedSeeds(library: SourceCandidateLibraryModule) {
  assert.equal(
    typeof library.seedFromCuratedCandidate,
    "function",
    "seedFromCuratedCandidate must be exported",
  );
  assert.ok(
    Array.isArray(library.REVIEWED_AI_SOURCE_CANDIDATES),
    "REVIEWED_AI_SOURCE_CANDIDATES must be exported",
  );

  return library.REVIEWED_AI_SOURCE_CANDIDATES.map((candidate) =>
    library.seedFromCuratedCandidate!(
      candidate,
      library.CURATED_AI_SOURCE_CANDIDATE_SEED ?? "curated_ai_sources",
    ),
  ).sort(compareBySourceKey);
}

function storedCandidate(id: string, row: StructuralSourceCandidate): StoredSourceCandidate {
  return { ...cloneRow(row), id };
}

function structuralCandidate(candidate: StoredSourceCandidate): StructuralSourceCandidate {
  return {
    sourceKey: candidate.sourceKey,
    name: candidate.name,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    fetchUrl: candidate.fetchUrl,
    handle: candidate.handle,
    avatarUrl: candidate.avatarUrl,
    avatarDataUrl: candidate.avatarDataUrl,
    seedBuilderId: candidate.seedBuilderId,
    seededFrom: candidate.seededFrom,
  };
}

function manifestStructuralCandidate(candidate: StoredSourceCandidate) {
  return {
    sourceKey: candidate.sourceKey,
    name: candidate.name,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    fetchUrl: candidate.fetchUrl,
    handle: candidate.handle,
    avatarUrl: candidate.avatarUrl,
    seededFrom: candidate.seededFrom,
  };
}

function compareBySourceKey(
  left: { sourceKey: string },
  right: { sourceKey: string },
) {
  return left.sourceKey.localeCompare(right.sourceKey);
}

function cloneRows(rows: StoredSourceCandidate[]) {
  return rows.map((row) => cloneRow(row));
}

function cloneRow<T>(row: T): T {
  return structuredClone(row);
}

function selectRows(rows: StoredSourceCandidate[], args: FindManyArgs) {
  const filtered = rows
    .filter((row) => matchesWhere(row, args.where))
    .sort((left, right) => {
      const orderBy = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
      if (!orderBy[0]?.sourceKey) return 0;
      return orderBy[0].sourceKey === "desc"
        ? right.sourceKey.localeCompare(left.sourceKey)
        : left.sourceKey.localeCompare(right.sourceKey);
    });

  if (!args.select) {
    return filtered.map((row) => cloneRow(row));
  }

  return filtered.map((row) => {
    const selected = Object.entries(args.select ?? {})
      .filter(([, enabled]) => enabled)
      .map(([key]) => [key, row[key as keyof StoredSourceCandidate]]);
    return Object.fromEntries(selected);
  });
}

function matchesWhere(row: StoredSourceCandidate, where: FindManyArgs["where"]) {
  if (!where) return true;
  if (
    where.seededFrom !== undefined &&
    row.seededFrom !== where.seededFrom
  ) {
    return false;
  }
  if (where.sourceKey?.in && !where.sourceKey.in.includes(row.sourceKey)) {
    return false;
  }
  if (where.sourceKey?.notIn && where.sourceKey.notIn.includes(row.sourceKey)) {
    return false;
  }
  return true;
}
