import type { FeedItemKind } from "@prisma/client";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";
import type { RecommendationSnapshotEntry } from "@/components/RecommendationFeed";

type FavoritePostIdentity = {
  entityId: string;
  externalId: string;
  feedItemId: string;
  kind: FeedItemKind;
};

export async function assertFavoritePostAccess(userId: string, feedItemId: string) {
  const item = await prisma.feedItem.findUnique({
    where: { id: feedItemId },
    select: {
      id: true,
      kind: true,
      externalId: true,
      builderId: true,
      builder: { select: { entityId: true } },
    },
  });
  if (!item) return { error: "Missing post" as const, status: 404 as const };
  if (!item.builderId || !item.builder?.entityId) {
    return { error: "Post is not linked to a source" as const, status: 409 as const };
  }

  const poolIds = await activePoolBuilderIds(userId);
  if (!poolIds.includes(item.builderId)) {
    return { error: "Post is not in your sources" as const, status: 403 as const };
  }

  return {
    identity: {
      entityId: item.builder.entityId,
      externalId: item.externalId,
      feedItemId: item.id,
      kind: item.kind,
    },
  };
}

export async function favoritePost(userId: string, identity: FavoritePostIdentity) {
  return prisma.feedFavorite.upsert({
    where: {
      userId_entityId_kind_externalId: {
        userId,
        entityId: identity.entityId,
        kind: identity.kind,
        externalId: identity.externalId,
      },
    },
    create: {
      userId,
      feedItemId: identity.feedItemId,
      entityId: identity.entityId,
      kind: identity.kind,
      externalId: identity.externalId,
    },
    update: {
      feedItemId: identity.feedItemId,
    },
  });
}

export async function unfavoritePost(userId: string, identity: FavoritePostIdentity) {
  await prisma.feedFavorite.deleteMany({
    where: {
      userId,
      entityId: identity.entityId,
      kind: identity.kind,
      externalId: identity.externalId,
    },
  });
}

export class FavoriteMissingError extends Error {
  constructor() {
    super("Post is not saved");
    this.name = "FavoriteMissingError";
  }
}

export async function setFavoriteMarkedRead(
  userId: string,
  identity: FavoritePostIdentity,
  markedRead: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const favorite = await tx.feedFavorite.findUnique({
      where: {
        userId_entityId_kind_externalId: {
          userId,
          entityId: identity.entityId,
          kind: identity.kind,
          externalId: identity.externalId,
        },
      },
      select: { id: true },
    });
    if (!favorite) throw new FavoriteMissingError();

    if (!markedRead) {
      await tx.feedFavorite.update({
        where: { id: favorite.id },
        data: { markedReadAt: null },
      });

      const read = await tx.feedRead.findUnique({
        where: {
          userId_entityId_kind_externalId: {
            userId,
            entityId: identity.entityId,
            kind: identity.kind,
            externalId: identity.externalId,
          },
        },
        select: { readAt: true },
      });
      return { readAt: read?.readAt ?? null, markedReadAt: null };
    }

    const markedReadAt = new Date();
    const readData = {
      userId,
      feedItemId: identity.feedItemId,
      entityId: identity.entityId,
      kind: identity.kind,
      externalId: identity.externalId,
      source: "favorite",
      readAt: markedReadAt,
    };
    const read = await tx.feedRead.upsert({
      where: {
        userId_entityId_kind_externalId: {
          userId,
          entityId: identity.entityId,
          kind: identity.kind,
          externalId: identity.externalId,
        },
      },
      create: readData,
      update: readData,
    });
    await tx.feedFavorite.update({
      where: { id: favorite.id },
      data: {
        feedItemId: identity.feedItemId,
        markedReadAt,
      },
    });

    return { readAt: read.readAt, markedReadAt };
  });
}

export async function getFavoriteSnapshot(userId: string): Promise<RecommendationSnapshotEntry | null> {
  const favorites = await prisma.feedFavorite.findMany({
    where: { userId },
    include: {
      feedItem: {
        include: {
          builder: true,
          favorites: {
            where: { userId },
            select: { favoritedAt: true },
            take: 1,
          },
          reads: {
            where: { userId },
            select: { readAt: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { favoritedAt: "desc" },
    take: 100,
  });
  const rows = favorites.filter((favorite) => favorite.feedItem);
  if (rows.length === 0) return null;

  return {
    id: "favorites",
    createdAt: (rows[0]?.favoritedAt ?? new Date()).toISOString(),
    reason: "favorites",
    items: rows.map((favorite, index) => ({
      item: {
        id: favorite.feedItem!.id,
        title: favorite.feedItem!.title,
        body: favorite.feedItem!.body,
        summary: favorite.feedItem!.summary,
        url: favorite.feedItem!.url,
        publishedAt: favorite.feedItem!.publishedAt?.toISOString() ?? null,
        createdAt: favorite.feedItem!.createdAt.toISOString(),
        sourceName: favorite.feedItem!.sourceName,
        fetchTool: favorite.feedItem!.fetchTool,
        builder: favorite.feedItem!.builder
          ? {
              id: favorite.feedItem!.builder.id,
              entityId: favorite.feedItem!.builder.entityId,
              avatarUrl: favorite.feedItem!.builder.avatarUrl,
              name: favorite.feedItem!.builder.name,
              sourceType: favorite.feedItem!.builder.sourceType,
              kind: favorite.feedItem!.builder.kind,
              sourceUrl: favorite.feedItem!.builder.sourceUrl,
              fetchUrl: favorite.feedItem!.builder.fetchUrl,
            }
          : null,
      },
      favoritedAt: favorite.favoritedAt.toISOString(),
      markedReadAt: favorite.markedReadAt?.toISOString() ?? null,
      rank: index + 1,
      readAt: favorite.feedItem!.reads?.[0]?.readAt.toISOString() ?? null,
      reasons: [],
      score: 0,
    })),
  };
}
