import { builderLibraryState } from "@/lib/builder-library-state";
import { prisma } from "@/lib/prisma";

export type ContentSyncState = {
  version: string;
};

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? "";
}

function count(value: unknown) {
  return typeof value === "number" ? value : 0;
}

/**
 * Compact freshness fingerprint for user-visible workspace data.
 *
 * The UI uses this as a low-cost heartbeat: if any server-side data that can
 * change outside the current tab changes, client pages refresh quietly instead
 * of making the user reload the browser.
 */
export async function contentSyncState(userId: string): Promise<ContentSyncState> {
  const poolEntries = await prisma.builderPoolEntry.findMany({
    where: { userId, removedAt: null },
    select: { builderId: true },
  });
  const builderIds = poolEntries.map((entry) => entry.builderId);
  const [
    libraryState,
    digestState,
    digestRunState,
    fetchRunState,
    tokenState,
    feedPreference,
    sourceConfigState,
    digestConfig,
    libraryImportState,
    libraryHubState,
    digestPipelineShareState,
    digestPipelineImportState,
  ] = await Promise.all([
    builderLibraryState(userId, builderIds),
    prisma.digest.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true, updatedAt: true },
    }),
    prisma.digestRun.aggregate({
      where: { userId },
      _count: true,
      _max: { preparedAt: true, syncedAt: true },
    }),
    prisma.libraryFetchRun.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true, startedAt: true, finishedAt: true },
    }),
    prisma.agentToken.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true, lastUsedAt: true, revokedAt: true },
    }),
    prisma.userFeedPreference.findUnique({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.userSourceTypeConfig.aggregate({
      where: { userId },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.userDigestConfig.findUnique({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.libraryImport.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.libraryHubEntry.aggregate({
      _count: true,
      _max: { createdAt: true },
      _sum: { importCount: true },
    }),
    prisma.digestPipelineShare.aggregate({
      where: { isPublic: true },
      _count: true,
      _max: { createdAt: true },
      _sum: { importCount: true },
    }),
    prisma.digestPipelineImport.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
    }),
  ]);

  return {
    version: [
      libraryState.version,
      count(digestState._count),
      iso(digestState._max.createdAt),
      iso(digestState._max.updatedAt),
      count(digestRunState._count),
      iso(digestRunState._max.preparedAt),
      iso(digestRunState._max.syncedAt),
      count(fetchRunState._count),
      iso(fetchRunState._max.createdAt),
      iso(fetchRunState._max.startedAt),
      iso(fetchRunState._max.finishedAt),
      count(tokenState._count),
      iso(tokenState._max.createdAt),
      iso(tokenState._max.lastUsedAt),
      iso(tokenState._max.revokedAt),
      iso(feedPreference?.updatedAt),
      count(sourceConfigState._count),
      iso(sourceConfigState._max.updatedAt),
      iso(digestConfig?.updatedAt),
      count(libraryImportState._count),
      iso(libraryImportState._max.createdAt),
      count(libraryHubState._count),
      iso(libraryHubState._max.createdAt),
      count(libraryHubState._sum.importCount),
      count(digestPipelineShareState._count),
      iso(digestPipelineShareState._max.createdAt),
      count(digestPipelineShareState._sum.importCount),
      count(digestPipelineImportState._count),
      iso(digestPipelineImportState._max.createdAt),
    ].join("|"),
  };
}
