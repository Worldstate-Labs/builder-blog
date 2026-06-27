import { BuilderPoolOrigin, FeedItemKind } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { isAdminFetchOnlySourceType } from "@/lib/admin-fetch-only-sources";
import { addBuilderToPool } from "@/lib/builder-pool";
import { upsertBuilder } from "@/lib/builders";
import { canonicalPostUrl } from "@/lib/canonical-url";
import { checkBodyContentQuality } from "@/lib/content-quality";
import { mergeFetchRunDetails, type FetchRunTaskOutcomePatch } from "@/lib/fetch-run-details";
import { getAllSourceConfigs } from "@/lib/source-config-store";
import { syncPersonalLibraryHubForUser } from "@/lib/library-hub";
import { normalizeSummaryLanguagePreference } from "@/lib/language-preference";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { validatePublicHttpUrl } from "@/lib/safe-url";
import { parseSkillBuilderSyncPayload } from "@/lib/skill-contracts";
import { prepareFeedItemStorage } from "@/lib/source-content-policy";
import { getUserFromBearer } from "@/lib/tokens";

type ItemResult = {
  fetchTaskId: string;
  kind: FeedItemKind;
  externalId: string;
  status: "synced" | "failed";
  reason?: string;
};

type BuilderSyncFetchRunPatch = {
  id: string;
  plannedTasks?: Array<{ id: string } & Record<string, unknown>>;
} | null | undefined;

type BuilderSyncTaskOutcome = {
  fetchTaskId: string;
  status: "skipped" | "failed" | "blocked";
  reason: string;
  evidence?: Record<string, unknown>;
  builderId?: string | null;
  externalId?: string | null;
};

function builderSyncError(message: string, statusCode = 500) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

function builderSyncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function builderSyncErrorStatus(error: unknown): number {
  const statusCode = error instanceof Error ? (error as Error & { statusCode?: unknown }).statusCode : null;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 600 ? statusCode : 500;
}

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
  const itemResults: ItemResult[] = [];

  // Per-source content-quality floors (minChars/minContentUnits) — the same standards
  // the client validate step uses. We enforce them server-side too so a post
  // with no real crawled content can't slip in when validate is bypassed.
  const sourceConfigs = await getAllSourceConfigs();
  const standardsBySourceId = new Map(
    sourceConfigs.map((c) => [c.sourceId, c.contentQuality]),
  );
  const resolveStandards = (sourceType: string | null | undefined) =>
    standardsBySourceId.get((sourceType ?? "").trim()) ??
    standardsBySourceId.get("website") ??
    null;
  const userIsAdmin = isAdminEmail(user.email);
  const preference = await prisma.userFeedPreference.findUnique({
    where: { userId: user.id },
    select: { summaryLanguage: true },
  });
  const syncSummaryLanguage = normalizeSummaryLanguagePreference(
    parsed.data.summaryLanguage ?? preference?.summaryLanguage,
  );

  try {
    const now = new Date();
    for (const input of parsed.data.builders) {
      // SSRF: agents must not register sources whose URLs target the internal
      // network. The web fetch + future server-side fetches would otherwise
      // touch private endpoints.
      for (const candidate of [input.sourceUrl, input.fetchUrl]) {
        if (!candidate) continue;
        const check = validatePublicHttpUrl(candidate);
        if (!check.ok) {
          throw builderSyncError(
            `Source URL is not allowed (${input.name}): ${check.reason}.`,
            400,
          );
        }
      }
      const referencedBuilder = await findExistingPersonalBuilderForSync(user.id, input);
      if (referencedBuilder.status === "invalid") {
        throw builderSyncError(referencedBuilder.error, 400);
      }
      if (!userIsAdmin && isAdminFetchOnlySourceType(input.sourceType)) {
        skippedFeedItems += input.items.length;
        for (const item of input.items) {
          const fetchTaskId = readFetchTaskId(item.rawJson);
          if (fetchTaskId) {
            itemResults.push({
              fetchTaskId,
              kind: item.kind,
              externalId: item.externalId,
              status: "failed",
              reason: "admin_fetch_only_source",
            });
          }
        }
        continue;
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
      const contentStandards = resolveStandards(input.sourceType);
      for (const item of input.items) {
        const key = feedItemKey(builder.id, item.kind, item.externalId);
        if (payloadItemKeys.has(key)) {
          skippedFeedItems += 1;
          continue;
        }
        payloadItemKeys.add(key);
        const fetchTaskId = readFetchTaskId(item.rawJson);
        const summary = typeof item.summary === "string" ? item.summary.trim() : "";
        // A post without a summary is not useful to the reader and must not
        // occupy a DB row. This is recorded as a FAILURE, not a silent skip.
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
        const storage = prepareFeedItemStorage({
          sourceType: input.sourceType,
          body: item.body,
          summary,
          rawJson: rawJsonWithSummaryLanguage(item.rawJson, syncSummaryLanguage, summary),
        });
        // Gate 1 — real crawled content. A post with no body (or junk/too-short
        // text below the source's floor) is a FAILURE: the agent didn't actually
        // fetch usable content. Mirrors the client validate length check so it
        // can't be bypassed by skipping validate. Recorded, not silently dropped.
        if (storage.policy.durableRawMode === "full" || storage.policy.durableRawMode === "excerpt") {
          const contentVerdict = checkBodyContentQuality(item.body, contentStandards);
          if (!contentVerdict.ok) {
            skippedFeedItems += 1;
            if (fetchTaskId) {
              itemResults.push({
                fetchTaskId,
                kind: item.kind,
                externalId: item.externalId,
                status: "failed",
                reason: contentVerdict.reason,
              });
            }
            continue;
          }
        }
        const fetchTool =
          item.fetchTool ?? fetchToolFromRawJson(item.rawJson) ?? parsed.data.fetchTool;
        const canonicalPostId = await ensureCanonicalPostId(item.url);
        if (!parsed.data.force && existingItemKeys.has(key)) {
          const updateData = {
            summary,
            body: storage.body,
            rawJson: JSON.stringify(storage.rawJson),
            ...(canonicalPostId ? { canonicalPostId } : {}),
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
            body: storage.body,
            summary,
            url: item.url,
            ...(canonicalPostId ? { canonicalPostId } : {}),
            // Only overwrite when the source supplied a real date. Otherwise
            // leave the existing value untouched (it was backfilled to fetch
            // time on insert) so re-syncs don't clobber or bump it.
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined,
            sourceName: item.sourceName ?? input.name,
            fetchTool,
            rawJson: JSON.stringify(storage.rawJson),
          },
          create: {
            builderId: builder.id,
            kind: item.kind,
            externalId: item.externalId,
            title: item.title,
            body: storage.body,
            summary,
            url: item.url,
            ...(canonicalPostId ? { canonicalPostId } : {}),
            // Fall back to fetch time when the source has no parseable date.
            // A null publishedAt would be silently excluded from digests (the
            // candidate query requires publishedAt >= cutoff), so every post
            // must carry a usable timestamp.
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
            sourceName: item.sourceName ?? input.name,
            fetchTool,
            rawJson: JSON.stringify(storage.rawJson),
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

    const fetchRunPatch = await patchFetchRunForBuilderSync({
      userId: user.id,
      fetchRun: parsed.data.fetchRun,
      itemResults,
      builders: parsed.data.builders,
      taskOutcomes: parsed.data.taskOutcomes,
    });

    let hubSync: { status: "ok" } | { status: "failed"; reason: string } = { status: "ok" };
    try {
      await syncPersonalLibraryHubForUser({
        userId: user.id,
        email: user.email,
        name: user.name,
      });
    } catch (hubError) {
      const reason = builderSyncErrorMessage(hubError);
      console.error(`Builder sync completed, but library hub sync failed: ${reason}`);
      hubSync = { status: "failed", reason: reason.slice(0, 300) };
    }

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
      fetchRunPatch,
      hubSync,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return builderSyncFailureResponse({
      userId: user.id,
      fetchRun: parsed.data.fetchRun,
      itemResults,
      builders: parsed.data.builders,
      taskOutcomes: parsed.data.taskOutcomes,
      counters: { builders, feedItems, skippedFeedItems, subscriptions },
      force: parsed.data.force,
      error,
    });
  }
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

// Attribution for an agent-extracted item. The fetch-task contract has agents
// record the real runtime/model in rawJson (not item.fetchTool), so derive the
// fetchTool label from those before falling back to the payload-level default
// (which is the generic "manual JSON sync" string).
function fetchToolFromRawJson(rawJson: unknown): string | null {
  if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
    const o = rawJson as Record<string, unknown>;
    const runtime = typeof o.agentRuntime === "string" ? o.agentRuntime.trim() : "";
    const model = typeof o.agentModel === "string" ? o.agentModel.trim() : "";
    if (runtime) return model ? `${runtime} (model ${model})` : runtime;
  }
  return null;
}

async function builderSyncFailureResponse({
  userId,
  fetchRun,
  itemResults,
  builders,
  taskOutcomes,
  counters,
  force,
  error,
}: {
  userId: string;
  fetchRun: BuilderSyncFetchRunPatch;
  itemResults: ItemResult[];
  builders: Array<{ items: Array<{ body?: string; summary?: string | null; rawJson?: unknown }> }>;
  taskOutcomes: BuilderSyncTaskOutcome[];
  counters: {
    builders: number;
    feedItems: number;
    skippedFeedItems: number;
    subscriptions: number;
  };
  force: boolean;
  error: unknown;
}) {
  const message = builderSyncErrorMessage(error);
  console.error(`Builder sync failed after partial progress: ${message}`);
  const fetchRunPatch = await patchFetchRunForBuilderSync({
    userId,
    fetchRun,
    itemResults,
    builders,
    taskOutcomes,
  });
  return NextResponse.json(
    {
      status: "failed",
      error: message,
      builders: counters.builders,
      feedItems: counters.feedItems,
      skippedFeedItems: counters.skippedFeedItems,
      subscriptions: counters.subscriptions,
      force,
      itemResults,
      fetchRunPatch,
      generatedAt: new Date().toISOString(),
    },
    { status: builderSyncErrorStatus(error) },
  );
}

function itemResultsToFetchRunOutcomes(
  itemResults: ItemResult[],
  builders: Array<{ items: Array<{ body?: string; summary?: string | null; rawJson?: unknown }> }>,
): FetchRunTaskOutcomePatch[] {
  const statsByTaskId = new Map<string, Record<string, unknown>>();
  for (const input of builders) {
    for (const item of input.items) {
      const fetchTaskId = readFetchTaskId(item.rawJson);
      if (!fetchTaskId) continue;
      const rawJson = rawJsonRecord(item.rawJson);
      const body = syncTextStats(item.body);
      const summary = syncTextStats(item.summary);
      statsByTaskId.set(fetchTaskId, {
        bodyChars: body.chars,
        bodyWords: body.words,
        summaryChars: summary.chars,
        summaryWords: summary.words,
        agentRuntime: typeof rawJson.agentRuntime === "string" ? rawJson.agentRuntime : null,
        agentModel: typeof rawJson.agentModel === "string" ? rawJson.agentModel : null,
        workerId: typeof rawJson.workerId === "string" ? rawJson.workerId : null,
      });
    }
  }

  return itemResults.map((result) => ({
    fetchTaskId: result.fetchTaskId,
    ...(statsByTaskId.get(result.fetchTaskId) ?? {}),
    status: result.status,
    ...(result.status === "failed" ? { failureReason: result.reason ?? "not_synced" } : {}),
  }));
}

function skillTaskOutcomeToFetchRunOutcome(outcome: BuilderSyncTaskOutcome): FetchRunTaskOutcomePatch {
  return {
    fetchTaskId: outcome.fetchTaskId,
    status:
      outcome.status === "skipped"
        ? "skipped"
        : outcome.status === "blocked"
          ? "action_needed"
          : "failed",
    failureReason: outcome.reason,
    ...(outcome.evidence ? { evidence: outcome.evidence } : {}),
    ...(outcome.builderId ? { builderId: outcome.builderId } : {}),
    ...(outcome.externalId ? { externalId: outcome.externalId } : {}),
  };
}

function fetchRunOutcomesForBuilderSync({
  itemResults,
  builders,
  taskOutcomes,
}: {
  itemResults: ItemResult[];
  builders: Array<{ items: Array<{ body?: string; summary?: string | null; rawJson?: unknown }> }>;
  taskOutcomes: BuilderSyncTaskOutcome[];
}) {
  const byTaskId = new Map<string, FetchRunTaskOutcomePatch>();
  for (const outcome of taskOutcomes) {
    byTaskId.set(outcome.fetchTaskId, skillTaskOutcomeToFetchRunOutcome(outcome));
  }
  for (const outcome of itemResultsToFetchRunOutcomes(itemResults, builders)) {
    byTaskId.set(outcome.fetchTaskId, outcome);
  }
  return [...byTaskId.values()];
}

async function patchFetchRunForBuilderSync({
  userId,
  fetchRun,
  itemResults,
  builders,
  taskOutcomes,
}: {
  userId: string;
  fetchRun: BuilderSyncFetchRunPatch;
  itemResults: ItemResult[];
  builders: Array<{ items: Array<{ body?: string; summary?: string | null; rawJson?: unknown }> }>;
  taskOutcomes: BuilderSyncTaskOutcome[];
}) {
  if (!fetchRun?.id) return null;

  const outcomes = fetchRunOutcomesForBuilderSync({ itemResults, builders, taskOutcomes });
  try {
    const run = await prisma.libraryFetchRun.findFirst({
      where: { id: fetchRun.id, userId },
      select: { id: true, details: true },
    });
    if (!run) return { status: "skipped", reason: "fetch_run_not_found" };

    const merged = mergeFetchRunDetails(run.details, {
      plannedTasks: fetchRun.plannedTasks ?? [],
      taskOutcomes: outcomes,
    });
    const detailsJson = JSON.stringify(merged.details);
    // Same column, same cap as the fetch-runs POST/PATCH writers (100 KB).
    if (Buffer.byteLength(detailsJson, "utf8") > 100_000) {
      console.error(`Fetch run ${fetchRun.id} details patch exceeded 100 KB; leaving log unpatched.`);
      return { status: "failed", reason: "details_too_large" };
    }

    await prisma.libraryFetchRun.update({
      where: { id: run.id },
      data: { details: merged.details as object },
    });
    return {
      status: "ok",
      planned: merged.planned,
      matched: merged.matched,
      outcomes: outcomes.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to patch fetch run ${fetchRun.id} during builder sync: ${message}`);
    return { status: "failed", reason: message.slice(0, 300) };
  }
}

function rawJsonRecord(rawJson: unknown): Record<string, unknown> {
  return rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)
    ? rawJson as Record<string, unknown>
    : {};
}

function rawJsonWithSummaryLanguage(rawJson: unknown, summaryLanguage: string, summary: string) {
  const record = rawJsonRecord(rawJson);
  if (!summary.trim()) return record;
  return {
    ...record,
    summaryLanguage: typeof record.summaryLanguage === "string" && record.summaryLanguage.trim()
      ? record.summaryLanguage
      : summaryLanguage,
  };
}

function syncTextStats(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return {
    chars: text.length,
    words: text ? text.split(/\s+/u).length : 0,
  };
}

async function ensureCanonicalPostId(url: string) {
  const canonicalUrl = canonicalPostUrl(url);
  if (!canonicalUrl) return null;
  const canonicalPost = await prisma.canonicalPost.upsert({
    where: { canonicalUrl },
    update: {},
    create: { canonicalUrl },
    select: { id: true },
  });
  return canonicalPost.id;
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
      error: "Referenced source was not found for this user.",
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
