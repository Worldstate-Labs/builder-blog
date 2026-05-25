import { prisma } from "@/lib/prisma";

export type BuilderLibraryState = {
  crawledItems: number;
  inLibrary: number;
  subscribed: number;
  version: string;
};

export async function builderLibraryState(
  userId: string,
  builderIds: string[],
): Promise<BuilderLibraryState> {
  const sortedBuilderIds = [...new Set(builderIds)].sort();
  const [
    poolState,
    subscriptionState,
    builderState,
    crawlState,
    feedState,
    digestState,
    recommendationState,
    readState,
    feedPreference,
    personalHubState,
    libraryImportState,
  ] = await Promise.all([
    prisma.builderPoolEntry.aggregate({
      where: { userId },
      _count: true,
      _max: { updatedAt: true },
    }),
    sortedBuilderIds.length
      ? prisma.subscription.aggregate({
          where: { userId, builderId: { in: sortedBuilderIds } },
          _count: true,
          _max: { createdAt: true },
        })
      : Promise.resolve({ _count: 0, _max: { createdAt: null } }),
    sortedBuilderIds.length
      ? prisma.builder.aggregate({
          where: { id: { in: sortedBuilderIds } },
          _max: { updatedAt: true },
        })
      : Promise.resolve({ _max: { updatedAt: null } }),
    sortedBuilderIds.length
      ? prisma.userBuilderCrawl.aggregate({
          where: { userId, builderId: { in: sortedBuilderIds } },
          _count: true,
          _max: { updatedAt: true, lastCrawledAt: true },
        })
      : Promise.resolve({ _count: 0, _max: { updatedAt: null, lastCrawledAt: null } }),
    sortedBuilderIds.length
      ? prisma.feedItem.aggregate({
          where: { builderId: { in: sortedBuilderIds } },
          _count: true,
          _max: { createdAt: true, publishedAt: true },
        })
      : Promise.resolve({ _count: 0, _max: { createdAt: null, publishedAt: null } }),
    prisma.digest.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true, updatedAt: true },
    }),
    prisma.recommendationSnapshot.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.feedRead.aggregate({
      where: { userId },
      _count: true,
      _max: { readAt: true },
    }),
    prisma.userFeedPreference.findUnique({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.libraryHubEntry.aggregate({
      where: { ownerUserId: userId },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.libraryImport.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
    }),
  ]);

  const version = [
    sortedBuilderIds.join(","),
    poolState._count,
    poolState._max.updatedAt?.toISOString() ?? "",
    subscriptionState._count,
    subscriptionState._max.createdAt?.toISOString() ?? "",
    builderState._max.updatedAt?.toISOString() ?? "",
    crawlState._count,
    crawlState._max.updatedAt?.toISOString() ?? "",
    crawlState._max.lastCrawledAt?.toISOString() ?? "",
    feedState._count,
    feedState._max.createdAt?.toISOString() ?? "",
    feedState._max.publishedAt?.toISOString() ?? "",
    digestState._count,
    digestState._max.createdAt?.toISOString() ?? "",
    digestState._max.updatedAt?.toISOString() ?? "",
    recommendationState._count,
    recommendationState._max.createdAt?.toISOString() ?? "",
    readState._count,
    readState._max.readAt?.toISOString() ?? "",
    feedPreference?.updatedAt.toISOString() ?? "",
    personalHubState._count,
    personalHubState._max.updatedAt?.toISOString() ?? "",
    libraryImportState._count,
    libraryImportState._max.createdAt?.toISOString() ?? "",
  ].join("|");

  return {
    crawledItems: feedState._count,
    inLibrary: sortedBuilderIds.length,
    subscribed: subscriptionState._count,
    version,
  };
}
