import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURATED_AI_SOURCE_CANDIDATE_SEED,
  REVIEWED_AI_SOURCE_CANDIDATES,
  seedFromCuratedCandidate,
} from "@/lib/source-candidate-library";

type SourceCandidateStructuralRow = {
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

type SourceCandidateFindManyArgs = {
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

type SourceCandidateUpsertArgs = {
  where: {
    sourceKey: string;
  };
  update: {
    name: string;
    sourceType: string;
    sourceUrl: string | null;
    fetchUrl: string | null;
    handle: string | null;
    avatarUrl: string | null;
    seedBuilderId: string | null;
    seededFrom: string | null;
  };
  create: SourceCandidateStructuralRow;
};

type SourceCandidateModelLike = {
  findMany(args: SourceCandidateFindManyArgs): Promise<SourceCandidateStructuralRow[]>;
  upsert(args: SourceCandidateUpsertArgs): Promise<unknown>;
};

type PrismaTransactionLike = {
  sourceCandidate: SourceCandidateModelLike;
};

type PrismaClientLike = {
  $transaction<T>(
    callback: (tx: PrismaTransactionLike) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
    },
  ): Promise<T>;
  $disconnect?(): Promise<void>;
};

type SyncSummary = {
  targetCount: number;
  insertedCount: number;
  existingCount: number;
  unchangedUnrelatedCount: number;
  structuralDigest: string;
};

const STRUCTURAL_SELECT = {
  sourceKey: true,
  name: true,
  sourceType: true,
  sourceUrl: true,
  fetchUrl: true,
  handle: true,
  avatarUrl: true,
  avatarDataUrl: true,
  seedBuilderId: true,
  seededFrom: true,
} satisfies Record<keyof SourceCandidateStructuralRow, true>;

type ManifestStructuralRow = {
  sourceKey: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  seededFrom: string | null;
};

export async function syncReviewedAiSourceCandidates(
  prismaClient: PrismaClientLike,
): Promise<SyncSummary> {
  try {
    return await prismaClient.$transaction(
      async (tx) => {
        const reviewedSeeds = REVIEWED_AI_SOURCE_CANDIDATES
          .map((candidate) =>
            seedFromCuratedCandidate(candidate, CURATED_AI_SOURCE_CANDIDATE_SEED),
          )
          .sort(compareBySourceKey);
        const targetKeys = reviewedSeeds.map((seed) => seed.sourceKey);
        const unrelatedBefore = await readStructuralRows(tx.sourceCandidate, {
          where: { sourceKey: { notIn: targetKeys } },
        });
        const existingTargets = await readStructuralRows(tx.sourceCandidate, {
          where: { sourceKey: { in: targetKeys } },
        });
        assertReviewedTargetOwnership(existingTargets);
        const existingByKey = new Map(
          existingTargets.map((candidate) => [candidate.sourceKey, candidate]),
        );

        for (const seed of reviewedSeeds) {
          await tx.sourceCandidate.upsert({
            where: { sourceKey: seed.sourceKey },
            update: updatePayloadForSeed(seed),
            create: createPayloadForSeed(seed),
          });
        }

        const targetAfter = await readStructuralRows(tx.sourceCandidate, {
          where: { sourceKey: { in: targetKeys } },
        });
        const unrelatedAfter = await readStructuralRows(tx.sourceCandidate, {
          where: { sourceKey: { notIn: targetKeys } },
        });

        assertReviewedTargetState(targetAfter, reviewedSeeds, existingByKey);
        assertStructuralMatch(
          unrelatedAfter.map(manifestStructuralRow),
          unrelatedBefore.map(manifestStructuralRow),
          "unrelated source candidate snapshot changed during reviewed sync",
        );

        return {
          targetCount: reviewedSeeds.length,
          insertedCount: reviewedSeeds.length - existingTargets.length,
          existingCount: existingTargets.length,
          unchangedUnrelatedCount: unrelatedBefore.length,
          structuralDigest: structuralDigest(targetAfter.map(manifestStructuralRow)),
        };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (error) {
    throw new Error(sanitizeErrorMessage(error));
  }
}

async function main() {
  const { prisma } = await import("@/lib/prisma");
  try {
    const summary = await syncReviewedAiSourceCandidates(prisma);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${sanitizeErrorMessage(error)}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

type ReadStructuralRowsInput = Pick<SourceCandidateFindManyArgs, "where">;

async function readStructuralRows(
  sourceCandidate: SourceCandidateModelLike,
  args: ReadStructuralRowsInput,
) {
  return sourceCandidate.findMany({
    where: args.where,
    orderBy: { sourceKey: "asc" },
    select: STRUCTURAL_SELECT,
  });
}

function assertStructuralMatch(
  actual: ManifestStructuralRow[],
  expected: ManifestStructuralRow[],
  message: string,
) {
  if (!structuralRowsEqual(actual, expected)) {
    throw new Error(message);
  }
}

function structuralRowsEqual(
  actual: ManifestStructuralRow[],
  expected: ManifestStructuralRow[],
) {
  return stableJson(actual) === stableJson(expected);
}

function assertReviewedTargetOwnership(
  existingTargets: SourceCandidateStructuralRow[],
) {
  const conflict = existingTargets.find(
    (candidate) =>
      candidate.seededFrom !== null &&
      candidate.seededFrom !== CURATED_AI_SOURCE_CANDIDATE_SEED,
  );
  if (!conflict) return;
  throw new Error(
    `reviewed AI source candidate sync conflict for sourceKey ${conflict.sourceKey}: existing row is owned by seededFrom ${conflict.seededFrom ?? "null"}`,
  );
}

function assertReviewedTargetState(
  actualTargets: SourceCandidateStructuralRow[],
  reviewedSeeds: SourceCandidateStructuralRow[],
  existingByKey: Map<string, SourceCandidateStructuralRow>,
) {
  const expectedManifestTargets = reviewedSeeds
    .map((seed) => manifestStructuralRow(createPayloadForSeed(seed)))
    .sort(compareBySourceKey);
  const actualManifestTargets = actualTargets
    .map(manifestStructuralRow)
    .sort(compareBySourceKey);

  assertStructuralMatch(
    actualManifestTargets,
    expectedManifestTargets,
    "reviewed target rows diverged from the expected structural sync result",
  );

  for (const target of actualTargets) {
    if (target.seedBuilderId !== null) {
      throw new Error(
        `reviewed AI source candidate sync left seedBuilderId on sourceKey ${target.sourceKey}`,
      );
    }
    const existing = existingByKey.get(target.sourceKey);
    if (existing?.avatarDataUrl && target.avatarDataUrl === null) {
      throw new Error(
        `reviewed AI source candidate sync cleared avatar cache for sourceKey ${target.sourceKey}`,
      );
    }
  }
}

function updatePayloadForSeed(seed: SourceCandidateStructuralRow) {
  return {
    name: seed.name,
    sourceType: seed.sourceType,
    sourceUrl: seed.sourceUrl,
    fetchUrl: seed.fetchUrl,
    handle: seed.handle,
    avatarUrl: seed.avatarUrl,
    seedBuilderId: null,
    seededFrom: CURATED_AI_SOURCE_CANDIDATE_SEED,
  };
}

function createPayloadForSeed(seed: SourceCandidateStructuralRow): SourceCandidateStructuralRow {
  return {
    ...seed,
    avatarDataUrl: null,
    seedBuilderId: null,
    seededFrom: CURATED_AI_SOURCE_CANDIDATE_SEED,
  };
}

function manifestStructuralRow(row: {
  sourceKey: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  seededFrom: string | null;
}): ManifestStructuralRow {
  return {
    sourceKey: row.sourceKey,
    name: row.name,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    fetchUrl: row.fetchUrl,
    handle: row.handle,
    avatarUrl: row.avatarUrl,
    seededFrom: row.seededFrom,
  };
}

function structuralDigest(rows: ManifestStructuralRow[]) {
  return createHash("sha256").update(stableJson(rows)).digest("hex");
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function compareBySourceKey(
  left: { sourceKey: string },
  right: { sourceKey: string },
) {
  return left.sourceKey.localeCompare(right.sourceKey);
}

function sanitizeErrorMessage(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : "reviewed AI source candidate sync failed";
  const withoutUrls = rawMessage.replace(
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/\S+/gi,
    "[redacted-connection-string]",
  );
  const withoutSecrets = withoutUrls
    .replace(/\b(password|token|secret|apikey|api_key)=\S+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]");
  if (!process.env.DATABASE_URL) {
    return withoutSecrets;
  }
  return withoutSecrets.replaceAll(process.env.DATABASE_URL, "[redacted-database-url]");
}

function isExecutedDirectly() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  void main();
}
