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

  const canFavorite = await canFavoriteFeedItem(userId, item.id, item.builderId);
  if (!canFavorite) {
    return { error: "Post is outside your Sources or AI Briefs" as const, status: 403 as const };
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

export async function canFavoritePost(userId: string, feedItemId: string) {
  const item = await prisma.feedItem.findUnique({
    where: { id: feedItemId },
    select: {
      id: true,
      builderId: true,
      builder: { select: { entityId: true } },
    },
  });
  if (!item?.builderId || !item.builder?.entityId) return false;
  return canFavoriteFeedItem(userId, item.id, item.builderId);
}

async function canFavoriteFeedItem(userId: string, feedItemId: string, builderId: string) {
  const poolIds = await activePoolBuilderIds(userId);
  if (poolIds.includes(builderId)) return true;

  return feedItemAppearsInAccessibleDigest(userId, feedItemId);
}

async function feedItemAppearsInAccessibleDigest(userId: string, feedItemId: string) {
  const digestedItems = await prisma.digestedItem.findMany({
    where: {
      feedItemId,
      digestId: { not: null },
    },
    select: {
      digestId: true,
      userId: true,
    },
  });
  const digestIds = digestedItems.flatMap((item) => (item.digestId ? [item.digestId] : []));
  if (digestIds.length === 0) return false;

  const digests = await prisma.digest.findMany({
    where: { id: { in: digestIds } },
    select: { id: true, userId: true },
  });
  const digestOwnersById = new Map(digests.map((digest) => [digest.id, digest.userId]));
  if ([...digestOwnersById.values()].some((ownerUserId) => ownerUserId === userId)) return true;

  const ownerUserIds = [...new Set([...digestOwnersById.values()].filter((owner) => owner !== userId))];
  if (ownerUserIds.length === 0) return false;

  const imports = await prisma.digestPipelineImport.findMany({
    where: {
      userId,
      pipeline: {
        isPublic: true,
        ownerUserId: { in: ownerUserIds },
      },
    },
    select: {
      pipeline: { select: { ownerUserId: true } },
    },
  });
  const importedOwners = new Set(imports.map((row) => row.pipeline.ownerUserId));
  return [...digestOwnersById.values()].some((ownerUserId) => importedOwners.has(ownerUserId));
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

export async function markFavoritePostRead(
  userId: string,
  identity: FavoritePostIdentity,
  markedRead: boolean,
) {
  const markedReadAt = markedRead ? new Date() : null;
  const result = await prisma.feedFavorite.updateMany({
    where: {
      userId,
      entityId: identity.entityId,
      kind: identity.kind,
      externalId: identity.externalId,
    },
    data: {
      feedItemId: identity.feedItemId,
      markedReadAt,
    },
  });
  return result.count > 0 ? markedReadAt : undefined;
}
