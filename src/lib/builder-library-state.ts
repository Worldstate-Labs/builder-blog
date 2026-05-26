import { prisma } from "@/lib/prisma";

export type BuilderLibraryState = {
  crawledItems: number;
  inLibrary: number;
  subscribed: number;
  version: string;
};

/**
 * Cache version + counts for the user's source view.
 *
 * Counts are computed against the user's reachable channels (own + imported library facets).
 * Subscription count is per-channel (userId, builderId).
 */
export async function builderLibraryState(
  userId: string,
  builderIds: string[],
): Promise<BuilderLibraryState> {
  const sortedBuilderIds = [...new Set(builderIds)].sort();

  const [poolState, subscriptionState, builderState, feedState] = await Promise.all([
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

  const subCount = subscriptionState._count as number;
  const feedCount = feedState._count as number;
  const poolCount = poolState._count as number;
  const builderCount = builderState._count as number;

  const version = [
    sortedBuilderIds.join(","),
    poolCount,
    poolState._max.updatedAt?.toISOString() ?? "",
    subCount,
    subscriptionState._max.createdAt?.toISOString() ?? "",
    builderCount,
    builderState._max.updatedAt?.toISOString() ?? "",
    builderState._max.lastCrawledAt?.toISOString() ?? "",
    feedCount,
    feedState._max.createdAt?.toISOString() ?? "",
    feedState._max.publishedAt?.toISOString() ?? "",
  ].join("|");

  return {
    crawledItems: feedCount,
    inLibrary: sortedBuilderIds.length,
    subscribed: subCount,
    version,
  };
}
