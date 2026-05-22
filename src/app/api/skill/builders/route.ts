import { BuilderKind, BuilderPoolOrigin, BuilderScope, FeedItemKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { addBuilderToPool } from "@/lib/builder-pool";
import { upsertBuilder } from "@/lib/builders";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

const FeedItemSchema = z.object({
  kind: z.enum(FeedItemKind),
  externalId: z.string().min(1),
  title: z.string().nullable().optional(),
  body: z.string().min(1),
  url: z.string().url(),
  publishedAt: z.string().datetime().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  rawJson: z.unknown().optional(),
});

const BuilderSchema = z.object({
  kind: z.enum(BuilderKind),
  name: z.string().min(1),
  handle: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  crawlUrl: z.string().url().nullable().optional(),
  bio: z.string().nullable().optional(),
  subscribe: z.boolean().default(false),
  items: z.array(FeedItemSchema).default([]),
});

const SyncSchema = z.object({
  builders: z.array(BuilderSchema).min(1),
});

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = SyncSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let builders = 0;
  let feedItems = 0;
  let subscriptions = 0;
  for (const input of parsed.data.builders) {
    const builder = await upsertBuilder({
      scope: BuilderScope.PERSONAL,
      ownerUserId: user.id,
      addedByUserId: user.id,
      kind: input.kind,
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

    for (const item of input.items) {
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
          rawJson: item.rawJson === undefined ? undefined : JSON.stringify(item.rawJson),
        },
      });
      feedItems += 1;
    }
  }

  return NextResponse.json({
    status: "ok",
    builders,
    feedItems,
    subscriptions,
    generatedAt: new Date().toISOString(),
  });
}
