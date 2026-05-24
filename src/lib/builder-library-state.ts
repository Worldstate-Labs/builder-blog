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
  const [poolState, subscriptionState, builderState, crawlState, feedState] = await Promise.all([
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
  ].join("|");

  return {
    crawledItems: feedState._count,
    inLibrary: sortedBuilderIds.length,
    subscribed: subscriptionState._count,
    version,
  };
}
