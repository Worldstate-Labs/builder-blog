import { NextResponse } from "next/server";
import type { FeedItemKind } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanStructuredDigestItems, type StructuredDigestItem } from "@/lib/structured-digest";

type Params = { params: Promise<{ digestId: string }> };
type DigestFavoriteState = { feedItemId: string; favoritedAt: string | null };

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
      headlineSummary: true,
      items: true,
      userId: true,
    },
  });

  if (!digest) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
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
      return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    }
  }

  const items = cleanStructuredDigestItems(digest.items);
  const favoriteStateByFeedItemId = await favoriteStateForDigestItems({
    items,
    userId: session.user.id,
  });

  return NextResponse.json({
    id: digest.id,
    headlineSummary: digest.headlineSummary,
    items,
    favoriteStateByFeedItemId,
  });
}

async function favoriteStateForDigestItems({
  items,
  userId,
}: {
  items: StructuredDigestItem[];
  userId: string;
}) {
  if (items.length === 0) return {};

  const identities = new Map<
    string,
    { entityId: string; kind: FeedItemKind; externalId: string; feedItemId: string }
  >();
  for (const item of items) {
    identities.set(favoriteKey(item.post.entityId, item.post.kind, item.post.externalId), {
      entityId: item.post.entityId,
      kind: item.post.kind,
      externalId: item.post.externalId,
      feedItemId: item.post.feedItemId,
    });
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

  const byFeedItemId = new Map<string, DigestFavoriteState>();
  for (const identity of identities.values()) {
    byFeedItemId.set(identity.feedItemId, {
      feedItemId: identity.feedItemId,
      favoritedAt: favoriteByKey.get(favoriteKey(identity.entityId, identity.kind, identity.externalId)) ?? null,
    });
  }
  return Object.fromEntries(byFeedItemId);
}

function favoriteKey(entityId: string, kind: string, externalId: string) {
  return `${entityId}:${kind}:${externalId}`;
}
