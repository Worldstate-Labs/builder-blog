import { revalidateTag } from "next/cache";
import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import {
  emptyBuilderFeedSyncResult,
  rawJsonRecord,
  readFetchTaskId,
  syncBuilderFeedItems,
  syncTextStats,
  type BuilderFeedSyncItemResult,
} from "@/lib/builder-feed-sync";
import { mergeFetchRunDetails, type FetchRunTaskOutcomePatch } from "@/lib/fetch-run-details";
import { syncPersonalLibraryHubForUser } from "@/lib/library-hub";
import { normalizeSummaryLanguagePreference } from "@/lib/language-preference";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { parseSkillBuilderSyncPayload } from "@/lib/skill-contracts";
import { getUserFromBearer } from "@/lib/tokens";

type ItemResult = BuilderFeedSyncItemResult;

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

  // Per-fetchTask outcome the CLI patches onto the fetch log. A task succeeds
  // only when its item is persisted with a non-empty summary; anything else is
  // a failure with a reason. This is the authoritative success/failure record —
  // the client-side validate step is advisory, so the gate that actually writes
  // to the DB is the one that must classify each post.
  const syncResult = emptyBuilderFeedSyncResult();
  const itemResults: ItemResult[] = syncResult.itemResults;
  const userIsAdmin = isAdminEmail(user.email);
  const preference = await prisma.userFeedPreference.findUnique({
    where: { userId: user.id },
    select: { summaryLanguage: true },
  });
  const syncSummaryLanguage = normalizeSummaryLanguagePreference(
    parsed.data.summaryLanguage ?? preference?.summaryLanguage,
  );

  try {
    await syncBuilderFeedItems({
      prisma,
      builders: parsed.data.builders,
      force: parsed.data.force,
      fetchTool: parsed.data.fetchTool,
      summaryLanguage: syncSummaryLanguage,
      mode: {
        type: "personal",
        user,
        userIsAdmin,
      },
      result: syncResult,
    });

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
      builders: syncResult.builders,
      feedItems: syncResult.feedItems,
      skippedFeedItems: syncResult.skippedFeedItems,
      subscriptions: syncResult.subscriptions,
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
      counters: {
        builders: syncResult.builders,
        feedItems: syncResult.feedItems,
        skippedFeedItems: syncResult.skippedFeedItems,
        subscriptions: syncResult.subscriptions,
      },
      force: parsed.data.force,
      error,
    });
  }
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
