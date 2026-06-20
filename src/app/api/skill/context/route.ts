import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import {
  getDigestConfig,
  getAllSourceConfigs,
  getUserDigestConfig,
  getUserSourceConfigs,
} from "@/lib/source-config-store";
import { SOURCE_DEFINITIONS } from "@/lib/source-registry";
import { projectBuildersToEntities } from "@/lib/builder-entities";
import { fetchDedupedFeedForEntities } from "@/lib/builder-channel-resolver";
import {
  digestCandidateLimitForLastRun,
  digestMaxAgeCutoff,
  digestMaxPostAgeDays,
} from "@/lib/feed-preferences";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";
import {
  displayLanguagePreference,
  isOriginalContentLanguagePreference,
  normalizeSummaryLanguagePreference,
} from "@/lib/language-preference";

const personalFetchedItemLimit = 5000;

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  // `regenerate` re-includes posts the user has already had digested: it nulls
  // the per-user DigestedItem gate below so already-digested posts become
  // candidates again. Without it, candidate selection is gated purely by that
  // marker (not by any "since last digest" time cutoff), so a re-run sees only
  // not-yet-digested posts — usually none. It never deletes history; the create
  // route is purely additive.
  const regenerate = url.searchParams.get("regenerate") === "1";
  const dryRun = url.searchParams.get("dryRun") === "1";
  const sourceParam = url.searchParams.get("source");
  const runSource = sourceParam === "cron" || sourceParam === "manual" ? sourceParam : "skill";
  const jobRunId = url.searchParams.get("jobRunId")?.slice(0, 160) || null;

  // Two independent callers share this endpoint: the digest `prepare` command
  // and the library `fetch-personal` command. They declare which via `intent`,
  // so each only does its own work — a library fetch must never compute digest
  // candidates or record a DigestRun (that polluted the digest history with
  // "prepared, never synced" rows), and a digest prepare must never run the
  // library fetch-state queries. Fallback for pre-`intent` CLIs (replaced on the
  // next run, since the runner re-downloads the CLI before each run): a `days`
  // param means a library fetch.
  const intent = url.searchParams.get("intent");
  const isDigest = intent ? intent === "digest" : !url.searchParams.has("days");
  const isLibrary = !isDigest;
  const now = new Date();

  const poolBuilderIds = await activePoolBuilderIds(user.id);
  const [
    libraryBuilders,
    subscriptions,
    preference,
    lastDigest,
    sourceConfigs,
    defaultSourceConfigs,
    digestConfig,
    defaultDigestConfig,
  ] = await Promise.all([
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
    getAllSourceConfigs(),
    getUserDigestConfig(user.id),
    getDigestConfig(),
  ]);
  const defaultSourceConfigById = new Map(defaultSourceConfigs.map((c) => [c.sourceId, c]));

  // Account-wide summary language selected by the one-time or cron prompt.
  // Skill context always uses this run-level language, never a per-source
  // language override.
  const summaryLanguage = normalizeSummaryLanguagePreference(preference?.summaryLanguage);
  const languageMode = isOriginalContentLanguagePreference(summaryLanguage) ? "source" : "fixed";
  const languageInstruction =
    languageMode === "source"
      ? "Use the original content language. For fetch-task summaries, write each summary in the same language as that task's final raw body. For digest tasks, write each post summary in the same language as the supplied post summary; write source summaries in the dominant language of that source group's supplied post summaries; write the headline in the dominant language of all supplied post summaries. If there are no post summaries to infer from, use English."
      : `Use ${displayLanguagePreference(summaryLanguage)}.`;

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
      contentQuality: defaultSourceConfigById.get(def.id)?.contentQuality ?? cfg.contentQuality,
      summaryPrompt: {
        body: cfg.summaryPromptBody,
        style: cfg.summaryStyle,
        language: summaryLanguage,
      },
      fetchPrompt: {
        body: cfg.fetchPromptBody,
      },
    };
  }

  const digestContext = {
    headlinePrompt: digestConfig.headlinePrompt,
    perSourceSummaryPrompt: digestConfig.perSourceSummaryPrompt,
    translate: digestConfig.translate,
    order: digestConfig.digestOrder as string[],
    commonFetchRules: defaultDigestConfig.commonFetchRules,
    commonSummaryRules: defaultDigestConfig.commonSummaryRules,
  };

  // PublishedAt lookback floor. Unset preferences resolve to the 30-day default.
  // The per-user DigestedItem marker — not a time window — is what prevents repeats.
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
  // can rebuild today's digest. Candidate limit scales with days since the
  // previous successfully synced digest: 20 per elapsed day, clamped to 20-100. The cap
  // self-drains because only
  // the returned rows get marked digested at sync, leaving the rest for later.
  // Digest-only: the subscribed-entity candidate pool. Skipped for a library
  // fetch, which never reads `items`.
  const digestCandidateLimit = digestCandidateLimitForLastRun(now, lastDigest?.createdAt);
  const items = isDigest
    ? await fetchDedupedFeedForEntities({
        userId: user.id,
        entityIds: subscribedEntityIds,
        publishedAfter: lookbackCutoff,
        limit: digestCandidateLimit,
        excludeDigestedForUserId: regenerate ? null : user.id,
      })
    : [];

  // Library-only: the user's own fetched-item state (for dedup + recency).
  // Skipped for a digest prepare, which never reads these.
  const personalEntityIds = isLibrary ? await projectBuildersToEntities(personalBuilderIds) : [];
  const personalFetchedItems = isLibrary
    ? await prisma.feedItem.findMany({
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
      })
    : [];

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

  // Diagnostic funnel snapshot. Record this preparation as a DigestRun so the
  // digest log can later show the candidate pool, window, and source coverage
  // the agent was handed — the input that the produced digest is judged
  // against. The subsequent `sync` call links back via this run id. Best-effort:
  // a logging failure must never break the digest the user actually wants.
  const entityDisplayNameById = new Map<string, string>();
  for (const sub of subscriptions) {
    const ent = sub.builder?.entity;
    if (!ent || entityDisplayNameById.has(ent.id)) continue;
    const builderName = sub.builder?.name?.trim();
    entityDisplayNameById.set(ent.id, builderName || ent.name);
  }
  const candidateSnapshot = items.map((it) => ({
    entityId: it.entityId,
    kind: it.kind,
    externalId: it.externalId,
    feedItemId: it.id ?? null,
    sourceType: it.builder?.sourceType ?? null,
    title: it.title ?? null,
    url: it.url ?? null,
    source: it.builder?.name ?? it.sourceName ?? entityDisplayNameById.get(it.entityId) ?? null,
    publishedAt: it.publishedAt ? new Date(it.publishedAt).toISOString() : null,
  }));
  const subscriptionSnapshot = subscribedEntityIds.map((id) => ({
    entityId: id,
    name: entityDisplayNameById.get(id) ?? "Unknown source",
  }));
  let runId: string | null = null;
  if (isDigest && !dryRun) {
    try {
      const digestRun = await prisma.digestRun.create({
        data: {
          userId: user.id,
          status: "prepared",
          source: runSource,
          jobRunId,
          preparedAt: now,
          lookbackCutoff,
          maxPostAgeDays: digestMaxPostAgeDays(preference),
          lastDigestAt: lastDigest?.createdAt ?? null,
          regenerate,
          subscriptionCount: subscribedEntityIds.length,
          candidateCount: items.length,
          candidates: candidateSnapshot,
          subscriptions: subscriptionSnapshot,
        },
        select: { id: true },
      });
      runId = digestRun.id;
    } catch (error) {
      console.error("Failed to record DigestRun for digest prepare", error);
    }
  }

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    runId,
    jobRunId,
    dryRun,
    generatedAt: now.toISOString(),
    language: summaryLanguage,
    languageMode,
    languageInstruction,
    digestWindow: {
      until: now.toISOString(),
      // PublishedAt lookback floor. Candidate selection is gated by the per-user
      // digested marker inside this window.
      lookbackCutoff: lookbackCutoff?.toISOString() ?? null,
      maxPostAgeDays: digestMaxPostAgeDays(preference),
      lastDigestGeneratedAt: lastDigest?.createdAt.toISOString() ?? null,
      candidateLimit: digestCandidateLimit,
      regenerate,
      selectionRule:
        "include every subscribed-entity post the user has not yet had digested within the configured lookback window; regenerate=true re-includes already-digested posts",
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
      .map((s) => {
        const entity = s.builder?.entity ?? null;
        if (!entity) return null;
        return {
          ...entity,
          name: s.builder?.name?.trim() || entity.name,
        };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e)),
    subscribedEntityIds,
    subscriptionCount: subscribedEntityIds.length,
    items,
    sources: sourcesContext,
    commonFetchRules: defaultDigestConfig.commonFetchRules,
    commonSummaryRules: defaultDigestConfig.commonSummaryRules,
    digest: digestContext,
  });
}
