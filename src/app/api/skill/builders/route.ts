import { BuilderPoolOrigin, BuilderScope, FeedItemKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { addBuilderToPool } from "@/lib/builder-pool";
import { upsertBuilder } from "@/lib/builders";
import { prisma } from "@/lib/prisma";
import { parseSkillBuilderSyncPayload } from "@/lib/skill-contracts";
import { getUserFromBearer } from "@/lib/tokens";

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseSkillBuilderSyncPayload(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let builders = 0;
  let feedItems = 0;
  let skippedFeedItems = 0;
  let subscriptions = 0;
  const now = new Date();
  for (const input of parsed.data.builders) {
    const builder = await upsertBuilder({
      scope: BuilderScope.PERSONAL,
      ownerUserId: user.id,
      addedByUserId: user.id,
      kind: input.kind,
      sourceType: input.sourceType,
      name: input.name,
      handle: input.handle,
      sourceUrl: input.sourceUrl,
      crawlUrl: input.crawlUrl,
      bio: input.bio,
    });
    await addBuilderToPool({
      userId: user.id,
      builderId: builder.id,
      origin: BuilderPoolOrigin.PERSONAL_SYNC,
    });
    if (input.subscribe) {
      await prisma.subscription.upsert({
        where: {
          userId_builderId: {
            userId: user.id,
            builderId: builder.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          builderId: builder.id,
        },
      });
      subscriptions += 1;
    }
    builders += 1;

    const existingItemKeys = parsed.data.force
      ? new Set<string>()
      : await existingFeedItemKeys(
          builder.id,
          input.items.map((item) => ({ kind: item.kind, externalId: item.externalId })),
        );
    let syncedItemCount = 0;
    const payloadItemKeys = new Set<string>();
    for (const item of input.items) {
      const key = feedItemKey(builder.id, item.kind, item.externalId);
      if (payloadItemKeys.has(key)) {
        skippedFeedItems += 1;
        continue;
      }
      payloadItemKeys.add(key);
      const crawlingTool = item.crawlingTool ?? parsed.data.crawlingTool;
      if (!parsed.data.force && existingItemKeys.has(key)) {
        await prisma.feedItem.updateMany({
          where: {
            builderId: builder.id,
            kind: item.kind,
            externalId: item.externalId,
            OR: [{ crawlingTool: null }, { crawlingTool: "Legacy crawl/import" }],
          },
          data: { crawlingTool },
        });
        skippedFeedItems += 1;
        continue;
      }
      await prisma.feedItem.upsert({
        where: {
          builderId_kind_externalId: {
            builderId: builder.id,
            kind: item.kind,
            externalId: item.externalId,
          },
        },
        update: {
          title: item.title,
          body: item.body,
          url: item.url,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          sourceName: item.sourceName ?? input.name,
          crawlingTool,
          rawJson: item.rawJson === undefined ? undefined : JSON.stringify(item.rawJson),
        },
        create: {
          builderId: builder.id,
          kind: item.kind,
          externalId: item.externalId,
          title: item.title,
          body: item.body,
          url: item.url,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          sourceName: item.sourceName ?? input.name,
          crawlingTool,
          rawJson: item.rawJson === undefined ? undefined : JSON.stringify(item.rawJson),
        },
      });
      feedItems += 1;
      syncedItemCount += 1;
    }
    await prisma.userBuilderCrawl.upsert({
      where: {
        userId_builderId: {
          userId: user.id,
          builderId: builder.id,
        },
      },
      update: {
        lastCrawledAt: now,
        lastForcedAt: parsed.data.force ? now : undefined,
        itemCount: syncedItemCount,
      },
      create: {
        userId: user.id,
        builderId: builder.id,
        lastCrawledAt: now,
        lastForcedAt: parsed.data.force ? now : null,
        itemCount: syncedItemCount,
      },
    });
  }

  return NextResponse.json({
    status: "ok",
    builders,
    feedItems,
    skippedFeedItems,
    subscriptions,
    force: parsed.data.force,
    generatedAt: new Date().toISOString(),
  });
}

async function existingFeedItemKeys(
  builderId: string,
  items: Array<{ kind: FeedItemKind; externalId: string }>,
) {
  if (items.length === 0) return new Set<string>();
  const existing = await prisma.feedItem.findMany({
    where: {
      builderId,
      OR: items.map((item) => ({
        kind: item.kind,
        externalId: item.externalId,
      })),
    },
    select: {
      kind: true,
      externalId: true,
    },
  });
  return new Set(existing.map((item) => feedItemKey(builderId, item.kind, item.externalId)));
}

function feedItemKey(builderId: string, kind: FeedItemKind, externalId: string) {
  return `${builderId}:${kind}:${externalId}`;
}
