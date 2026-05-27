import { BuilderPoolOrigin, FeedItemKind } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { addBuilderToPool } from "@/lib/builder-pool";
import { upsertBuilder } from "@/lib/builders";
import { syncPersonalLibraryHubForUser } from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { validatePublicHttpUrl } from "@/lib/safe-url";
import { parseSkillBuilderSyncPayload } from "@/lib/skill-contracts";
import { getUserFromBearer } from "@/lib/tokens";

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cap sync calls per user — these can carry several MB of feed content,
  // so bursts from a misbehaving or hostile agent are expensive.
  const r = rateLimit({
    key: `skill-builders:${user.id}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!r.ok) {
    return tooManyRequestsResponse(r.retryAfterMs);
  }

  const parsed = parseSkillBuilderSyncPayload(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  let builders = 0;
  let feedItems = 0;
  let skippedFeedItems = 0;
  let subscriptions = 0;
  const now = new Date();
  for (const input of parsed.data.builders) {
    // SSRF: agents must not register sources whose URLs target the internal
    // network. The web fetch + future server-side fetches would otherwise
    // touch private endpoints.
    for (const candidate of [input.sourceUrl, input.fetchUrl]) {
      if (!candidate) continue;
      const check = validatePublicHttpUrl(candidate);
      if (!check.ok) {
        return NextResponse.json(
          { error: `Source URL rejected (${input.name}): ${check.reason}` },
          { status: 400 },
        );
      }
    }
    const referencedBuilder = await findExistingPersonalBuilderForSync(user.id, input);
    if (referencedBuilder.status === "invalid") {
      return NextResponse.json({ error: referencedBuilder.error }, { status: 400 });
    }
    const builder =
      referencedBuilder.builder ??
      (await upsertBuilder({
        ownerUserId: user.id,
        addedByUserId: user.id,
        kind: input.kind,
        sourceType: input.sourceType,
        name: input.name,
        handle: input.handle,
        sourceUrl: input.sourceUrl,
        fetchUrl: input.fetchUrl,
        bio: input.bio,
      }));
    await addBuilderToPool({
      userId: user.id,
      builderId: builder.id,
      origin: BuilderPoolOrigin.PERSONAL_SYNC,
    });
    if (input.subscribe) {
      await prisma.subscription.upsert({
        where: { userId_builderId: { userId: user.id, builderId: builder.id } },
        update: {},
        create: { userId: user.id, builderId: builder.id },
      });
      // Establish primary channel preference if none exists yet (entity follows the channel
      // the user just synced from).
      const entityId = builder.entityId;
      if (entityId) {
        await prisma.userChannelPreference.upsert({
          where: { userId_entityId: { userId: user.id, entityId } },
          update: {},
          create: {
            userId: user.id,
            entityId,
            primaryBuilderId: builder.id,
            pinnedByUser: false,
          },
        });
      }
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
      const fetchTool = item.fetchTool ?? parsed.data.fetchTool;
      if (!parsed.data.force && existingItemKeys.has(key)) {
        const updateData = {
          ...(item.summary === undefined ? {} : { summary: item.summary }),
          ...(item.rawJson === undefined ? {} : { rawJson: JSON.stringify(item.rawJson) }),
        };
        if (Object.keys(updateData).length > 0) {
          await prisma.feedItem.updateMany({
            where: {
              builderId: builder.id,
              kind: item.kind,
              externalId: item.externalId,
            },
            data: updateData,
          });
        }
        await prisma.feedItem.updateMany({
          where: {
            builderId: builder.id,
            kind: item.kind,
            externalId: item.externalId,
            OR: [{ fetchTool: null }, { fetchTool: "Legacy fetch/import" }],
          },
          data: { fetchTool },
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
          summary: item.summary,
          url: item.url,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          sourceName: item.sourceName ?? input.name,
          fetchTool,
          rawJson: item.rawJson === undefined ? undefined : JSON.stringify(item.rawJson),
        },
        create: {
          builderId: builder.id,
          kind: item.kind,
          externalId: item.externalId,
          title: item.title,
          body: item.body,
          summary: item.summary,
          url: item.url,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          sourceName: item.sourceName ?? input.name,
          fetchTool,
          rawJson: item.rawJson === undefined ? undefined : JSON.stringify(item.rawJson),
        },
      });
      feedItems += 1;
      syncedItemCount += 1;
    }
    // Inline fetch-state update on the builder channel itself.
    await prisma.builder.update({
      where: { id: builder.id },
      data: {
        lastFetchedAt: now,
        ...(parsed.data.force ? { lastForcedAt: now } : {}),
        itemCount: syncedItemCount,
        status: "OK",
        lastError: null,
      },
    });
  }

  await syncPersonalLibraryHubForUser({
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  revalidateTag(`user:${user.id}:recs`, "default");
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

async function findExistingPersonalBuilderForSync(
  userId: string,
  input: {
    builderId?: string | null;
    items: Array<{ rawJson?: unknown }>;
  },
) {
  const builderId = input.builderId ?? builderIdFromItems(input.items);
  if (!builderId) return { status: "none" as const, builder: null };

  const builder = await prisma.builder.findFirst({
    where: { id: builderId, ownerUserId: userId },
  });
  if (!builder) {
    return {
      status: "invalid" as const,
      error: "Referenced personal builder was not found for this user.",
    };
  }
  return { status: "ok" as const, builder };
}

function builderIdFromItems(items: Array<{ rawJson?: unknown }>) {
  const ids = new Set<string>();
  for (const item of items) {
    const rawJson = item.rawJson;
    if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) continue;
    const builderId = "builderId" in rawJson ? rawJson.builderId : null;
    if (typeof builderId === "string" && builderId.trim()) ids.add(builderId.trim());
  }
  return ids.size === 1 ? [...ids][0] : null;
}
