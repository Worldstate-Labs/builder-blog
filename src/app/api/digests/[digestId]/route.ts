import { NextResponse } from "next/server";
import type { FeedItemKind } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { parseDigest } from "@/lib/digest-markdown";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ digestId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { digestId } = await params;
  const digest = await prisma.digest.findUnique({
    where: { id: digestId },
    select: {
      id: true,
      content: true,
      headlineSummary: true,
      userId: true,
    },
  });

  if (!digest) {
    return NextResponse.json({ error: "Digest not found" }, { status: 404 });
  }

  if (digest.userId !== session.user.id) {
    const importedPipeline = await prisma.digestPipelineImport.findFirst({
      where: {
        userId: session.user.id,
        pipeline: {
          isPublic: true,
          ownerUserId: digest.userId,
        },
      },
      select: { pipelineId: true },
    });

    if (!importedPipeline) {
      return NextResponse.json({ error: "Digest not found" }, { status: 404 });
    }
  }

  return NextResponse.json({
    id: digest.id,
    content: digest.content,
    headlineSummary: digest.headlineSummary,
    favoriteStateByUrl: await favoriteStateByUrlForDigest({
      content: digest.content,
      userId: session.user.id,
    }),
    originalSummariesByUrl: await originalSummariesByUrlForDigest({
      content: digest.content,
      digestId: digest.id,
      userId: digest.userId,
    }),
  });
}

async function favoriteStateByUrlForDigest({
  content,
  userId,
}: {
  content: string;
  userId: string;
}) {
  const urls = digestPostUrls(content);
  if (urls.length === 0) return {};

  const poolBuilderIds = await activePoolBuilderIds(userId);
  if (poolBuilderIds.length === 0) return {};

  const feedItems = await prisma.feedItem.findMany({
    where: {
      url: { in: urls },
      builderId: { in: poolBuilderIds },
      builder: { is: { entityId: { not: "" } } },
    },
    select: {
      id: true,
      url: true,
      kind: true,
      externalId: true,
      builder: { select: { entityId: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (feedItems.length === 0) return {};

  const identities = new Map<string, { entityId: string; kind: FeedItemKind; externalId: string }>();
  for (const item of feedItems) {
    const entityId = item.builder?.entityId;
    if (!entityId) continue;
    const key = favoriteKey(entityId, item.kind, item.externalId);
    identities.set(key, { entityId, kind: item.kind, externalId: item.externalId });
  }

  const favorites = identities.size
    ? await prisma.feedFavorite.findMany({
        where: {
          userId,
          OR: [...identities.values()].map((identity) => ({
            entityId: identity.entityId,
            kind: identity.kind,
            externalId: identity.externalId,
          })),
        },
        select: {
          entityId: true,
          externalId: true,
          favoritedAt: true,
          kind: true,
        },
      })
    : [];
  const favoriteByKey = new Map(
    favorites.map((favorite) => [
      favoriteKey(favorite.entityId, favorite.kind, favorite.externalId),
      favorite.favoritedAt.toISOString(),
    ]),
  );

  const byUrl = new Map<string, { feedItemId: string; favoritedAt: string | null }>();
  for (const item of feedItems) {
    const entityId = item.builder?.entityId;
    if (!entityId) continue;
    const favoritedAt = favoriteByKey.get(favoriteKey(entityId, item.kind, item.externalId)) ?? null;
    const existing = byUrl.get(item.url);
    if (!existing || (!existing.favoritedAt && favoritedAt)) {
      byUrl.set(item.url, {
        feedItemId: item.id,
        favoritedAt,
      });
    }
  }

  return Object.fromEntries(byUrl);
}

async function originalSummariesByUrlForDigest({
  content,
  digestId,
  userId,
}: {
  content: string;
  digestId: string;
  userId: string;
}) {
  const urls = digestPostUrls(content);
  if (urls.length === 0) return {};

  const byUrl = new Map<string, string>();
  const digestedItems = await prisma.digestedItem.findMany({
    where: {
      digestId,
      userId,
      feedItem: {
        is: {
          url: { in: urls },
          summary: { not: null },
        },
      },
    },
    select: {
      feedItem: {
        select: {
          summary: true,
          url: true,
        },
      },
    },
  });

  for (const item of digestedItems) {
    const summary = item.feedItem?.summary?.trim();
    const url = item.feedItem?.url;
    if (url && summary && !byUrl.has(url)) byUrl.set(url, summary);
  }

  const missingUrls = urls.filter((url) => !byUrl.has(url));
  if (missingUrls.length > 0) {
    const fallbackItems = await prisma.feedItem.findMany({
      where: {
        url: { in: missingUrls },
        summary: { not: null },
        builder: { is: { ownerUserId: userId } },
      },
      select: {
        summary: true,
        url: true,
      },
    });

    for (const item of fallbackItems) {
      const summary = item.summary?.trim();
      if (summary && !byUrl.has(item.url)) byUrl.set(item.url, summary);
    }
  }

  return Object.fromEntries(byUrl);
}

function digestPostUrls(content: string) {
  const urls = new Set<string>();
  const doc = parseDigest(content);
  for (const section of doc.sections) {
    for (const group of section.groups) {
      for (const post of group.posts) {
        for (const media of post.media) {
          if (media.url) urls.add(media.url);
        }
      }
    }
  }
  return [...urls];
}

function favoriteKey(entityId: string, kind: string, externalId: string) {
  return `${entityId}:${kind}:${externalId}`;
}
