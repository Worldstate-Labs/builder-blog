import type { FeedItem, FeedItemKind } from "@prisma/client";

import { pickPrimaryVariant } from "@/lib/builder-entities";
import { prisma } from "@/lib/prisma";

export type FeedItemWithBuilder = FeedItem & {
  builder: {
    id: string;
    entityId: string | null;
    ownerUserId: string | null;
    lastFetchedAt: Date | null;
    name: string;
    handle: string | null;
    sourceType: string;
    sourceUrl: string | null;
    fetchUrl: string | null;
    bio: string | null;
  } | null;
};

export type DedupedFeedItem = FeedItemWithBuilder & {
  entityId: string;
  alternateChannelCount: number;
};

/**
 * Group raw FeedItems by canonical content (entityId + kind + externalId) and pick one
 * variant per group based on the user's primary-channel preference.
 *
 * Items with no entityId are skipped (should not happen post-M2 backfill).
 */
export async function dedupeFeedItemsByEntity(params: {
  userId: string;
  items: FeedItemWithBuilder[];
}): Promise<DedupedFeedItem[]> {
  const groups = new Map<string, FeedItemWithBuilder[]>();
  const entitiesSeen = new Set<string>();
  for (const item of params.items) {
    const entityId = item.builder?.entityId;
    if (!entityId) continue;
    entitiesSeen.add(entityId);
    const key = `${entityId}:${item.kind}:${item.externalId}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const pinMap = await loadPinnedChannels(params.userId, [...entitiesSeen]);

  const deduped: DedupedFeedItem[] = [];
  for (const variants of groups.values()) {
    const entityId = variants[0]!.builder!.entityId!;
    const pinned = pinMap.get(entityId) ?? null;
    const picked = pickPrimaryVariant(
      variants.map((v) => ({
        builderId: v.builderId!,
        ownerUserId: v.builder?.ownerUserId ?? "",
        lastFetchedAt: v.builder?.lastFetchedAt ?? null,
        publishedAt: v.publishedAt,
        createdAt: v.createdAt,
        __raw: v,
      })),
      params.userId,
      pinned,
    );
    const pickedItem = picked.__raw;
    deduped.push({
      ...pickedItem,
      entityId,
      alternateChannelCount: variants.length - 1,
    });
  }
  return deduped;
}

export async function loadPinnedChannels(
  userId: string,
  entityIds: string[],
): Promise<Map<string, string>> {
  if (entityIds.length === 0) return new Map();
  const prefs = await prisma.userChannelPreference.findMany({
    where: { userId, entityId: { in: entityIds } },
    select: { entityId: true, primaryBuilderId: true },
  });
  return new Map(prefs.map((p) => [p.entityId, p.primaryBuilderId]));
}

/**
 * Given a user and a list of subscribed entity ids, fetch the candidate FeedItem rows
 * (channels) for those entities and return them deduped per (entityId, kind, externalId).
 */
export async function fetchDedupedFeedForEntities(params: {
  userId: string;
  entityIds: string[];
  publishedAfter?: Date | null;
  limit?: number;
}): Promise<DedupedFeedItem[]> {
  if (params.entityIds.length === 0) return [];
  const rawItems = (await prisma.feedItem.findMany({
    where: {
      builder: { entityId: { in: params.entityIds } },
      ...(params.publishedAfter ? { publishedAt: { gte: params.publishedAfter } } : {}),
    },
    include: {
      builder: {
        select: {
          id: true,
          entityId: true,
          ownerUserId: true,
          lastFetchedAt: true,
          name: true,
          handle: true,
          sourceType: true,
          sourceUrl: true,
          fetchUrl: true,
          bio: true,
        },
      },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    // overscan to ensure dedup has enough variants per group
    take: params.limit ? params.limit * 3 : undefined,
  })) as FeedItemWithBuilder[];
  const deduped = await dedupeFeedItemsByEntity({ userId: params.userId, items: rawItems });
  if (params.limit) return deduped.slice(0, params.limit);
  return deduped;
}

/**
 * Read state helper: mark canonical content read.
 * Keyed by (userId, entityId, kind, externalId) — reads on any channel mark the post read
 * across all channels of the same creator.
 */
export async function markFeedReadByEntity(params: {
  userId: string;
  entityId: string;
  kind: FeedItemKind;
  externalId: string;
  feedItemId: string;
  source?: string;
}) {
  const existing = await prisma.feedRead.findFirst({
    where: {
      userId: params.userId,
      entityId: params.entityId,
      kind: params.kind,
      externalId: params.externalId,
    },
    select: { id: true },
  });
  const data = {
    userId: params.userId,
    feedItemId: params.feedItemId,
    entityId: params.entityId,
    kind: params.kind,
    externalId: params.externalId,
    source: params.source ?? "recommendation",
    readAt: new Date(),
  };
  return existing
    ? prisma.feedRead.update({ where: { id: existing.id }, data })
    : prisma.feedRead.create({ data });
}

/**
 * Look up which entities have been "read" by the user (any channel variant counts).
 */
export async function getReadEntityKeys(
  userId: string,
  entityIds: string[],
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();
  const reads = await prisma.feedRead.findMany({
    where: { userId, entityId: { in: entityIds } },
    select: { entityId: true, kind: true, externalId: true },
  });
  return new Set(reads.map((r) => `${r.entityId}:${r.kind}:${r.externalId}`));
}
