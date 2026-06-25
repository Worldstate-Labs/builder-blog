import { prisma } from "@/lib/prisma";
import type { SourceCandidate } from "@/lib/source-candidates";

const ADMIN_SOURCE_CANDIDATE_SEED = "admin_source_library";
const SOURCE_CANDIDATE_LIMIT = 300;

type BuilderSeedSource = {
  id: string;
  canonicalKey: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
};

export async function ensureSourceCandidateLibraryFromAdminSources() {
  await seedSourceCandidatesFromAdminLibrary();
  return listSourceCandidates();
}

export async function listSourceCandidates(): Promise<SourceCandidate[]> {
  const candidates = await prisma.sourceCandidate.findMany({
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    take: SOURCE_CANDIDATE_LIMIT,
  });
  return candidates.map(serializeSourceCandidate);
}

async function seedSourceCandidatesFromAdminLibrary() {
  const adminLibrary = await prisma.libraryHubEntry.findFirst({
    where: { isFeatured: true },
    include: {
      items: {
        include: { builder: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!adminLibrary) return;

  const seeds = adminLibrary.items.map((item) => seedFromBuilder(item.builder));
  const uniqueSeeds = Array.from(
    new Map(seeds.map((seed) => [seed.sourceKey, seed])).values(),
  );
  if (uniqueSeeds.length === 0) return;

  const existingCandidates = await prisma.sourceCandidate.findMany({
    where: { sourceKey: { in: uniqueSeeds.map((seed) => seed.sourceKey) } },
    select: { sourceKey: true, seededFrom: true },
  });
  const existingByKey = new Map(
    existingCandidates.map((candidate) => [candidate.sourceKey, candidate]),
  );

  await Promise.all(
    uniqueSeeds.map((seed) => {
      const existing = existingByKey.get(seed.sourceKey);
      if (existing && existing.seededFrom !== ADMIN_SOURCE_CANDIDATE_SEED) {
        return null;
      }
      return prisma.sourceCandidate.upsert({
        where: { sourceKey: seed.sourceKey },
        update: {
          name: seed.name,
          sourceType: seed.sourceType,
          sourceUrl: seed.sourceUrl,
          fetchUrl: seed.fetchUrl,
          handle: seed.handle,
          avatarUrl: seed.avatarUrl,
          avatarDataUrl: seed.avatarDataUrl,
          seedBuilderId: seed.seedBuilderId,
          seededFrom: ADMIN_SOURCE_CANDIDATE_SEED,
        },
        create: seed,
      });
    }),
  );
}

function seedFromBuilder(builder: BuilderSeedSource) {
  return {
    sourceKey: builder.canonicalKey,
    name: builder.name,
    sourceType: builder.sourceType,
    sourceUrl: builder.sourceUrl,
    fetchUrl: builder.fetchUrl,
    handle: builder.handle,
    avatarUrl: builder.avatarUrl,
    avatarDataUrl: builder.avatarDataUrl,
    seedBuilderId: builder.id,
    seededFrom: ADMIN_SOURCE_CANDIDATE_SEED,
  };
}

function serializeSourceCandidate(candidate: {
  id: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
}): SourceCandidate {
  return {
    id: candidate.id,
    name: candidate.name,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    fetchUrl: candidate.fetchUrl,
    handle: candidate.handle,
    avatarUrl: candidate.avatarUrl,
    avatarDataUrl: candidate.avatarDataUrl,
  };
}
