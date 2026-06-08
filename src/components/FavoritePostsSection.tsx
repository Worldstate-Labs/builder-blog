import { FavoritePostsList, type FavoritePostListItem } from "@/components/FavoritePostsList";
import { prisma } from "@/lib/prisma";

const favoritePostLimit = 100;

export async function FavoritePostsSection({ userId }: { userId: string }) {
  const favorites = await prisma.feedFavorite.findMany({
    where: {
      userId,
      feedItem: { isNot: null },
    },
    orderBy: { favoritedAt: "desc" },
    take: favoritePostLimit,
    include: {
      feedItem: {
        include: {
          builder: {
            include: {
              entity: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const readKeys = favorites.map((favorite) => ({
    entityId: favorite.entityId,
    externalId: favorite.externalId,
    kind: favorite.kind,
  }));
  const reads = readKeys.length
    ? await prisma.feedRead.findMany({
        where: {
          userId,
          OR: readKeys,
        },
        select: {
          entityId: true,
          externalId: true,
          kind: true,
          readAt: true,
        },
      })
    : [];
  const readAtByKey = new Map(
    reads.map((read) => [
      favoriteIdentityKey(read.entityId, read.kind, read.externalId),
      read.readAt.toISOString(),
    ]),
  );

  const items: FavoritePostListItem[] = favorites.flatMap((favorite) => {
    const item = favorite.feedItem;
    if (!item) return [];
    return [
      {
        feedItemId: item.id,
        favoritedAt: favorite.favoritedAt.toISOString(),
        readAt: readAtByKey.get(
          favoriteIdentityKey(favorite.entityId, favorite.kind, favorite.externalId),
        ) ?? null,
        post: {
          id: item.id,
          body: item.body,
          createdAt: item.createdAt.toISOString(),
          fetchTool: item.fetchTool,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          sourceName: item.sourceName,
          sourceType: item.builder?.sourceType ?? null,
          summary: item.summary,
          title: item.title,
          url: item.url,
          builder: item.builder
            ? {
                id: item.builder.id,
                entityId: item.builder.entity?.id ?? item.builder.entityId ?? null,
                avatarUrl: item.builder.avatarUrl,
                fetchUrl: item.builder.fetchUrl,
                kind: item.builder.kind,
                name: item.builder.name,
                sourceType: item.builder.sourceType,
                sourceUrl: item.builder.sourceUrl,
              }
            : null,
        },
      },
    ];
  });

  return <FavoritePostsList initialItems={items} />;
}

function favoriteIdentityKey(entityId: string, kind: string, externalId: string) {
  return `${entityId}:${kind}:${externalId}`;
}
