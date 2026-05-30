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
  // Per-fetchTask outcome the CLI patches onto the fetch log. A task succeeds
  // only when its item is persisted with a non-empty summary; anything else is
  // a failure with a reason. This is the authoritative success/failure record —
  // the client-side validate step is advisory, so the gate that actually writes
  // to the DB is the one that must classify each post.
  const itemResults: Array<{
    fetchTaskId: string;
    kind: FeedItemKind;
    externalId: string;
    status: "synced" | "failed";
    reason?: string;
  }> = [];
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
      const fetchTaskId = readFetchTaskId(item.rawJson);
      // Policy: a post without a summary is not useful to the reader and
      // must not occupy a DB row. Empty / whitespace-only summaries are
      // treated as "missing". This rule applies to both fresh inserts
      // and incremental updates — if a new payload arrives without a
      // valid summary, we skip the write instead of clobbering or
      // creating a half-baked row. Existing rows with stale summaries
      // are left alone here; the companion migration deletes them.
      // Crucially this is recorded as a FAILURE (not a silent skip) so the
      // fetch log can show why the post never landed.
      const summary = typeof item.summary === "string" ? item.summary.trim() : "";
      if (!summary) {
        skippedFeedItems += 1;
        if (fetchTaskId) {
          itemResults.push({
            fetchTaskId,
            kind: item.kind,
            externalId: item.externalId,
            status: "failed",
            reason: "summary_missing",
          });
        }
        continue;
      }
      const fetchTool = item.fetchTool ?? parsed.data.fetchTool;
      if (!parsed.data.force && existingItemKeys.has(key)) {
        const updateData = {
          summary,
          ...(item.rawJson === undefined ? {} : { rawJson: JSON.stringify(item.rawJson) }),
        };
        await prisma.feedItem.updateMany({
          where: {
            builderId: builder.id,
            kind: item.kind,
            externalId: item.externalId,
          },
          data: updateData,
        });
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
        // Re-summarizing an existing post is still a successful task outcome.
        if (fetchTaskId) {
          itemResults.push({
            fetchTaskId,
            kind: item.kind,
            externalId: item.externalId,
            status: "synced",
          });
        }
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
          summary,
          url: item.url,
          // Only overwrite when the source supplied a real date. Otherwise
          // leave the existing value untouched (it was backfilled to fetch
          // time on insert) so re-syncs don't clobber or bump it.
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined,
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
          summary,
          url: item.url,
          // Fall back to fetch time when the source has no parseable date.
          // A null publishedAt would be silently excluded from digests (the
          // candidate query requires publishedAt >= cutoff), so every post
          // must carry a usable timestamp.
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
          sourceName: item.sourceName ?? input.name,
          fetchTool,
          rawJson: item.rawJson === undefined ? undefined : JSON.stringify(item.rawJson),
        },
      });
      feedItems += 1;
      syncedItemCount += 1;
      if (fetchTaskId) {
        itemResults.push({
          fetchTaskId,
          kind: item.kind,
          externalId: item.externalId,
          status: "synced",
        });
      }
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
    // Authoritative per-task success/failure (keyed by fetchTaskId) so the CLI
    // can patch the fetch log to match what actually persisted.
    itemResults,
    generatedAt: new Date().toISOString(),
  });
}

// fetchTaskId travels on the synced item's rawJson (set by the agent per the
// fetch-task contract). It binds a persisted item back to its planned task.
function readFetchTaskId(rawJson: unknown): string | null {
  if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
    const value = (rawJson as Record<string, unknown>).fetchTaskId;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
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
