import { FavoritePostsList, type FavoritePostListItem } from "@/components/FavoritePostsList";
import { prisma } from "@/lib/prisma";

const favoritePostLimit = 100;

export async function FavoritePostsSection({ userId }: { userId: string }) {
  const favorites = await prisma.feedFavorite.findMany({
    where: {
      userId,
      feedItem: { isNot: null },
    },
    orderBy: [
      { markedReadAt: { sort: "asc", nulls: "first" } },
      { favoritedAt: "desc" },
    ],
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

  const items: FavoritePostListItem[] = favorites.flatMap((favorite) => {
    const item = favorite.feedItem;
    if (!item) return [];
    return [
      {
        feedItemId: item.id,
        favoritedAt: favorite.favoritedAt.toISOString(),
        markedReadAt: favorite.markedReadAt?.toISOString() ?? null,
        post: {
          id: item.id,
          body: item.body,
          createdAt: item.createdAt.toISOString(),
          fetchTool: item.fetchTool,
          headline: item.headline,
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
                avatarDataUrl: item.builder.avatarDataUrl,
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

  return <FavoritePostsList initialItems={sortFavoriteItems(items)} />;
}

function sortFavoriteItems(items: FavoritePostListItem[]) {
  return [...items].sort((a, b) => {
    const aMarkedRead = Boolean(a.markedReadAt);
    const bMarkedRead = Boolean(b.markedReadAt);
    if (aMarkedRead !== bMarkedRead) return aMarkedRead ? 1 : -1;
    return Date.parse(b.favoritedAt) - Date.parse(a.favoritedAt);
  });
}
