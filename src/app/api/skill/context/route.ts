import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getUserDigestConfig, getUserSourceConfigs } from "@/lib/source-config-store";
import { SOURCE_DEFINITIONS } from "@/lib/source-registry";
import { subscriptionBuilderIdsInPool } from "@/lib/digest-library";
import { projectBuildersToEntities } from "@/lib/builder-entities";
import { fetchDedupedFeedForEntities } from "@/lib/builder-channel-resolver";
import {
  digestMaxAgeCutoff,
  digestMaxPostAgeDays,
} from "@/lib/feed-preferences";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

const personalFetchedItemLimit = 5000;

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const includePrompts = url.searchParams.get("includePrompts") === "1";
  // Re-generate today's digest: ignore the "since last digest" cutoff so the
  // full fallback window is re-covered (otherwise a same-day re-run sees only
  // items created after the last digest — usually none — and produces an empty
  // digest). The create route separately replaces the existing same-day digest.
  const regenerate = url.searchParams.get("regenerate") === "1";
  const now = new Date();

  const poolBuilderIds = await activePoolBuilderIds(user.id);
  const [libraryBuilders, subscriptions, preference, lastDigest, sourceConfigs, digestConfig] = await Promise.all([
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
    getUserSourceConfigs(user.id),
    getUserDigestConfig(user.id),
  ]);

  // Account-wide summary language: when the user set one (cron dialog /
  // settings), it overrides every source's per-type summaryLanguage so all of
  // this user's summaries are generated in it. Null → per-source default.
  const userSummaryLanguage = preference?.summaryLanguage?.trim() || null;

  // Per-source skill context: merge static fields from sources.json
  // (id, builderKind, feedItemKinds, urlPatterns) with admin-edited
  // fields from the DB. This is the runtime source of truth the
  // once-skills (digest-once, library-once) read from.
  const sourcesContext: Record<string, {
    id: string;
    label: string;
    builderKind: string;
    feedItemKinds: string[];
    urlPatterns: string[];
    agentDefaultStatus: string;
    defaultFetchDays: number;
    defaultFetchLimit: number;
    contentQuality: unknown;
    summaryPrompt: {
      body: string;
      style: string;
      language: string;
      lengthHint: string | null;
    };
    fetchPrompt: {
      body: string | null;
    };
  }> = {};
  for (const def of SOURCE_DEFINITIONS) {
    const cfg = sourceConfigs.find((c) => c.sourceId === def.id);
    if (!cfg) continue;
    sourcesContext[def.id] = {
      id: def.id,
      label: cfg.label,
      builderKind: def.builderKind,
      feedItemKinds: def.feedItemKinds,
      urlPatterns: def.urlPatterns,
      agentDefaultStatus: cfg.agentDefaultStatus,
      defaultFetchDays: cfg.defaultFetchDays,
      defaultFetchLimit: cfg.defaultFetchLimit,
      contentQuality: cfg.contentQuality,
      summaryPrompt: {
        body: cfg.summaryPromptBody,
        style: cfg.summaryStyle,
        language: userSummaryLanguage ?? cfg.summaryLanguage,
        lengthHint: cfg.summaryLengthHint,
      },
      fetchPrompt: {
        body: cfg.fetchPromptBody,
      },
    };
  }

  const digestContext = {
    digestTopPrompt: digestConfig.digestTopPrompt,
    digestIntro: digestConfig.digestIntro,
    translate: digestConfig.translate,
    order: digestConfig.digestOrder as string[],
    commonSummaryRules: digestConfig.commonSummaryRules,
  };

  // TODO(deprecated): `context.prompts` is the legacy shape used by
  // older CLI binaries and the user-journeys back-compat test. New
  // callers should read `context.sources[id].summaryPrompt.body` and
  // `context.digest.*` instead.
  const legacyPrompts = {
    digest: digestContext.digestTopPrompt,
    summarizeTweets: sourcesContext.x?.summaryPrompt.body ?? "",
    summarizePodcast: sourcesContext.podcast?.summaryPrompt.body ?? "",
    summarizeBlogs: sourcesContext.blog?.summaryPrompt.body ?? "",
    digestIntro: digestContext.digestIntro,
    translate: digestContext.translate,
  };

  // Optional publishedAt lookback floor (replaces the old mandatory 90-day cap).
  // Null = no floor: consider every not-yet-digested post. The per-user
  // DigestedItem marker — not a time window — is now what prevents repeats.
  const lookbackCutoff = digestMaxAgeCutoff(now, preference);

  // Personal channels = builders the requesting user owns (their own fetches).
  const personalBuilderIds = libraryBuilders
    .filter((builder) => builder.ownerUserId === user.id)
    .map((builder) => builder.id);

  // Annotate the requesting user's own builders with scope="PERSONAL" so
  // the local agent CLI's personalBuildersForFetch filter can pick them up.
  // Imported builders (from other users' hub libraries) are left without
  // a scope — the codebase intentionally has no "CENTRAL" concept; the
  // owner-based check is the source of truth. Strip the original
  // `ownerUserId` from rows the requester does not own to avoid leaking
  // other users' internal IDs through the API.
  const personalBuilderIdSet = new Set(personalBuilderIds);
  const annotatedLibraryBuilders = libraryBuilders.map((builder) => {
    if (personalBuilderIdSet.has(builder.id)) {
      return { ...builder, scope: "PERSONAL" as const };
    }
    return { ...builder, ownerUserId: null };
  });

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

  // Fetch-state per channel lives inline on Builder.
  const personalFetchStates = libraryBuilders
    .filter((b) => personalBuilderIds.includes(b.id))
    .map((b) => ({
      builderId: b.id,
      entityId: b.entityId,
      lastFetchedAt: b.lastFetchedAt,
      lastForcedAt: b.lastForcedAt,
      itemCount: b.itemCount,
      status: b.status,
      lastError: b.lastError,
    }));

  // Digest candidates: deduped across channels of the subscribed entities,
  // excluding posts this user has already had digested — unless `regenerate`
  // (the override toggle), which re-includes already-digested posts so the user
  // can rebuild today's digest. Capped at 80; the cap self-drains because only
  // the returned rows get marked digested at sync, leaving the rest for later.
  const items = await fetchDedupedFeedForEntities({
    userId: user.id,
    entityIds: subscribedEntityIds,
    publishedAfter: lookbackCutoff,
    limit: 80,
    excludeDigestedForUserId: regenerate ? null : user.id,
  });

  const personalEntityIds = await projectBuildersToEntities(personalBuilderIds);
  const personalFetchedItems = await prisma.feedItem.findMany({
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
    take: personalFetchedItemLimit,
  });

  // Dedupe latestPersonalFetchedItems by entity rather than by builder, so we don't
  // double-report the same canonical creator just because the user has two channels for them.
  const latestByEntity = new Map<
    string,
    { entityId: string; builderId: string; latestPostAt: string; publishedAt: string | null; createdAt: string }
  >();
  for (const item of personalFetchedItems) {
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
    language: userSummaryLanguage ?? "zh",
    digestWindow: {
      until: now.toISOString(),
      // Optional publishedAt lookback floor (null = no floor). Candidate
      // selection is gated by the per-user digested marker, not a time window.
      lookbackCutoff: lookbackCutoff?.toISOString() ?? null,
      maxPostAgeDays: digestMaxPostAgeDays(preference),
      lastDigestGeneratedAt: lastDigest?.createdAt.toISOString() ?? null,
      regenerate,
      selectionRule:
        "include every subscribed-entity post the user has not yet had digested (within the optional lookback floor); regenerate=true re-includes already-digested posts",
    },
    libraryBuilders: annotatedLibraryBuilders,
    personalFetchStates,
    personalFetchedItems,
    personalEntityIds,
    latestPersonalFetchedItems: Array.from(latestByEntity.values()),
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
    sources: sourcesContext,
    commonSummaryRules: digestConfig.commonSummaryRules,
    digest: digestContext,
    ...(includePrompts ? { prompts: legacyPrompts } : {}),
  });
}
