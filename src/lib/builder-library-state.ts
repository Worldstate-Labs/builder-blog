import { projectBuildersToEntities } from "@/lib/builder-entities";
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
 * Subscription count is entity-deduped (since the user follows creators, not channels).
 */
export async function builderLibraryState(
  userId: string,
  builderIds: string[],
): Promise<BuilderLibraryState> {
  const sortedBuilderIds = [...new Set(builderIds)].sort();
  const entityIds = await projectBuildersToEntities(sortedBuilderIds);

  const [poolState, subscriptionState, builderState, feedState] = await Promise.all([
    prisma.builderPoolEntry.aggregate({
      where: { userId },
      _count: true,
      _max: { updatedAt: true },
    }),
    entityIds.length
      ? prisma.subscription.aggregate({
          where: { userId, entityId: { in: entityIds } },
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

  const version = [
    sortedBuilderIds.join(","),
    entityIds.join(","),
    poolState._count,
    poolState._max.updatedAt?.toISOString() ?? "",
    subscriptionState._count,
    subscriptionState._max.createdAt?.toISOString() ?? "",
    builderState._count,
    builderState._max.updatedAt?.toISOString() ?? "",
    builderState._max.lastCrawledAt?.toISOString() ?? "",
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
