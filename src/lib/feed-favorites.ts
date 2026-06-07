import type { FeedItemKind } from "@prisma/client";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";

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
