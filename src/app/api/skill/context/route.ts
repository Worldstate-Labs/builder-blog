import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { DIGEST_PROMPTS } from "@/lib/digest-prompts";
import { subscriptionBuilderIdsInPool } from "@/lib/digest-library";
import { projectBuildersToEntities } from "@/lib/builder-entities";
import { fetchDedupedFeedForEntities } from "@/lib/builder-channel-resolver";
import {
  digestFallbackSince,
  digestMaxAgeCutoff,
  digestMaxPostAgeDays,
  digestFrequencyDays,
} from "@/lib/feed-preferences";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

const personalCrawledItemLimit = 5000;

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const includePrompts = url.searchParams.get("includePrompts") === "1";
  const now = new Date();

  const poolBuilderIds = await activePoolBuilderIds(user.id);
  const [libraryBuilders, subscriptions, preference, lastDigest] = await Promise.all([
    prisma.builder.findMany({
      where: { id: { in: poolBuilderIds } },
      include: { entity: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.subscription.findMany({
      where: { userId: user.id },
      include: { builder: { include: { entity: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.userFeedPreference.findUnique({
      where: { userId: user.id },
    }),
    prisma.digest.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const since = lastDigest?.createdAt ?? digestFallbackSince(now, preference);
  const maxAgeCutoff = digestMaxAgeCutoff(now, preference);

  // Personal channels = builders the requesting user owns (their own crawls).
  const personalBuilderIds = libraryBuilders
    .filter((builder) => builder.ownerUserId === user.id)
    .map((builder) => builder.id);

  // Annotate the requesting user's own builders with scope="PERSONAL" so
  // the local agent CLI's personalBuildersForCrawl filter can pick them up.
  // Imported builders (from other users' hub libraries) are left without
  // a scope — the codebase intentionally has no "CENTRAL" concept; the
  // owner-based check is the source of truth.
  const personalBuilderIdSet = new Set(personalBuilderIds);
  const annotatedLibraryBuilders = libraryBuilders.map((builder) =>
    personalBuilderIdSet.has(builder.id)
      ? { ...builder, scope: "PERSONAL" as const }
      : builder,
  );

  // Subscriptions are per-channel; derive the entity set from the builder's entityId.
  const subscribedEntityIds = [
    ...new Set(
      subscriptions
        .map((sub) => sub.builder?.entityId ?? null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  // Backward-compat field: derive a per-pool builder list for any callers reading the
  // legacy `subscribedBuilderIds` shape. Resolution: pool builders whose entity is followed.
  const subscribedBuilderIds = subscriptionBuilderIdsInPool(
    poolBuilderIds,
    libraryBuilders
      .filter((b) => b.entityId && subscribedEntityIds.includes(b.entityId))
      .map((b) => b.id),
  );

  // Crawl-state per channel lives inline on Builder.
  const personalCrawlStates = libraryBuilders
    .filter((b) => personalBuilderIds.includes(b.id))
    .map((b) => ({
      builderId: b.id,
      entityId: b.entityId,
      lastCrawledAt: b.lastCrawledAt,
      lastForcedAt: b.lastForcedAt,
      itemCount: b.itemCount,
      status: b.status,
      lastError: b.lastError,
    }));

  // Digest candidates: deduped across channels of the subscribed entities.
  const items = await fetchDedupedFeedForEntities({
    userId: user.id,
    entityIds: subscribedEntityIds,
    publishedAfter: maxAgeCutoff,
    limit: 80,
  });

  const personalEntityIds = await projectBuildersToEntities(personalBuilderIds);
  const personalCrawledItems = await prisma.feedItem.findMany({
    where: {
      builderId: { in: personalBuilderIds },
    },
    select: {
      builderId: true,
      kind: true,
      externalId: true,
      publishedAt: true,
      createdAt: true,
      builder: { select: { entityId: true } },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: personalCrawledItemLimit,
  });

  // Dedupe latestPersonalCrawledItems by entity rather than by builder, so we don't
  // double-report the same canonical creator just because the user has two channels for them.
  const latestByEntity = new Map<
    string,
    { entityId: string; builderId: string; latestPostAt: string; publishedAt: string | null; createdAt: string }
  >();
  for (const item of personalCrawledItems) {
    const entityId = item.builder?.entityId;
    if (!entityId || !item.builderId) continue;
    const latestPostAtDate = item.publishedAt ?? item.createdAt;
    const current = latestByEntity.get(entityId);
    if (!current || new Date(current.latestPostAt) < latestPostAtDate) {
      latestByEntity.set(entityId, {
        entityId,
        builderId: item.builderId,
        latestPostAt: latestPostAtDate.toISOString(),
        publishedAt: item.publishedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      });
    }
  }

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    generatedAt: now.toISOString(),
    language: "zh",
    digestWindow: {
      since: since.toISOString(),
      until: now.toISOString(),
      fallbackFrequencyDays: digestFrequencyDays(preference),
      maxPostAgeDays: digestMaxPostAgeDays(preference),
      lastDigestGeneratedAt: lastDigest?.createdAt.toISOString() ?? null,
      timestampRule:
        "include items published after the last digest, plus newly crawled items created after the last digest when their publishedAt is still within max post age",
    },
    libraryBuilders: annotatedLibraryBuilders,
    personalCrawlStates,
    personalCrawledItems,
    personalEntityIds,
    latestPersonalCrawledItems: Array.from(latestByEntity.values()),
    subscriptions: subscriptions
      .map((s) => s.builder)
      .filter((b): b is NonNullable<typeof b> => Boolean(b)),
    subscriptionEntities: subscriptions
      .map((s) => s.builder?.entity ?? null)
      .filter((e): e is NonNullable<typeof e> => Boolean(e)),
    subscribedBuilderIds,
    subscribedEntityIds,
    subscriptionCount: subscribedEntityIds.length,
    items,
    ...(includePrompts ? { prompts: DIGEST_PROMPTS } : {}),
  });
}
