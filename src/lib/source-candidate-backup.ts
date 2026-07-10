const ADMIN_SOURCE_CANDIDATE_LIMIT = 300;
const BACKUP_SOURCE_CANDIDATE_LIMIT = 300;

type ManualSourceCandidateBuilder = {
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

type SourceCandidateRow = {
  id: string;
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
  createdAt: Date;
  updatedAt: Date;
};

type BackupSourceCandidateRow = {
  id: string;
  sourceKey: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  firstBuilderId: string | null;
  lastBuilderId: string | null;
  firstAddedByUserId: string | null;
  lastAddedByUserId: string | null;
  seenCount: number;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type RecordBackupSourceCandidatePrisma = {
  sourceCandidate: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
  backupSourceCandidate: {
    upsert(args: unknown): Promise<unknown>;
  };
};

type ListSourceCandidateLibrariesPrisma = {
  sourceCandidate: {
    findMany(args: unknown): Promise<SourceCandidateRow[]>;
  };
  backupSourceCandidate: {
    findMany(args: unknown): Promise<BackupSourceCandidateRow[]>;
  };
};

export type AdminSourceCandidate = {
  id: string;
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
  createdAt: string;
  updatedAt: string;
};

export type AdminBackupSourceCandidate = {
  id: string;
  sourceKey: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  firstBuilderId: string | null;
  lastBuilderId: string | null;
  firstAddedByUserId: string | null;
  lastAddedByUserId: string | null;
  seenCount: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminSourceCandidateLibraries = {
  sourceCandidates: AdminSourceCandidate[];
  backupCandidates: AdminBackupSourceCandidate[];
};

export async function recordBackupSourceCandidateFromManualBuilder({
  builder,
  userId,
  prismaClient,
  now = new Date(),
}: {
  builder: ManualSourceCandidateBuilder;
  userId: string;
  prismaClient?: RecordBackupSourceCandidatePrisma;
  now?: Date;
}) {
  const prisma = prismaClient ?? (await getPrismaClient<RecordBackupSourceCandidatePrisma>());
  const existingCandidate = await prisma.sourceCandidate.findUnique({
    where: { sourceKey: builder.canonicalKey },
    select: { id: true },
  });
  if (existingCandidate) {
    return { status: "already_candidate" as const };
  }

  const seed = {
    sourceKey: builder.canonicalKey,
    name: builder.name,
    sourceType: builder.sourceType,
    sourceUrl: builder.sourceUrl,
    fetchUrl: builder.fetchUrl,
    handle: builder.handle,
    avatarUrl: builder.avatarUrl,
    avatarDataUrl: builder.avatarDataUrl,
  };

  const candidate = await prisma.backupSourceCandidate.upsert({
    where: { sourceKey: seed.sourceKey },
    update: {
      name: seed.name,
      sourceType: seed.sourceType,
      sourceUrl: seed.sourceUrl,
      fetchUrl: seed.fetchUrl,
      handle: seed.handle,
      avatarUrl: seed.avatarUrl,
      avatarDataUrl: seed.avatarDataUrl,
      lastBuilderId: builder.id,
      lastAddedByUserId: userId,
      lastSeenAt: now,
      seenCount: { increment: 1 },
    },
    create: {
      ...seed,
      firstBuilderId: builder.id,
      lastBuilderId: builder.id,
      firstAddedByUserId: userId,
      lastAddedByUserId: userId,
      seenCount: 1,
      lastSeenAt: now,
    },
  });

  return { status: "recorded" as const, candidate };
}

export async function listAdminSourceCandidateLibraries(
  prismaClient?: ListSourceCandidateLibrariesPrisma,
): Promise<AdminSourceCandidateLibraries> {
  const prisma = prismaClient ?? (await getPrismaClient<ListSourceCandidateLibrariesPrisma>());
  const [sourceCandidateRows, backupCandidateRows] = await Promise.all([
    prisma.sourceCandidate.findMany({
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      take: ADMIN_SOURCE_CANDIDATE_LIMIT,
    }),
    prisma.backupSourceCandidate.findMany({
      orderBy: [{ lastSeenAt: "desc" }, { name: "asc" }],
      take: BACKUP_SOURCE_CANDIDATE_LIMIT,
    }),
  ]);

  const sourceKeys = new Set(sourceCandidateRows.map((candidate) => candidate.sourceKey));
  return {
    sourceCandidates: sourceCandidateRows.map(serializeSourceCandidate),
    backupCandidates: backupCandidateRows
      .filter((candidate) => !sourceKeys.has(candidate.sourceKey))
      .map(serializeBackupSourceCandidate),
  };
}

async function getPrismaClient<T>(): Promise<T> {
  const { prisma } = await import("@/lib/prisma");
  return prisma as unknown as T;
}

function serializeSourceCandidate(candidate: SourceCandidateRow): AdminSourceCandidate {
  return {
    id: candidate.id,
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
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

function serializeBackupSourceCandidate(
  candidate: BackupSourceCandidateRow,
): AdminBackupSourceCandidate {
  return {
    id: candidate.id,
    sourceKey: candidate.sourceKey,
    name: candidate.name,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    fetchUrl: candidate.fetchUrl,
    handle: candidate.handle,
    avatarUrl: candidate.avatarUrl,
    avatarDataUrl: candidate.avatarDataUrl,
    firstBuilderId: candidate.firstBuilderId,
    lastBuilderId: candidate.lastBuilderId,
    firstAddedByUserId: candidate.firstAddedByUserId,
    lastAddedByUserId: candidate.lastAddedByUserId,
    seenCount: candidate.seenCount,
    lastSeenAt: candidate.lastSeenAt.toISOString(),
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}
