import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  buildFetchRunHistoryAgentJobQueryPlan,
  finalizeFetchRunHistoryAgentJobPage,
  getAgentJobRuns,
  getScheduledAgentJobRuns,
  serializeAgentJobRun,
} from "@/lib/agent-job-runs";
import { compactFetchRunDetailsForStorage } from "@/lib/fetch-run-details";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";
import { lockResetFenceForWorker, StaleWorkerWriteError } from "@/lib/reset-fence";

// Cap details payload at ~1000 KB serialized. A full library run legitimately
// stores a per-post outcome row for every planned task plus the per-source
// prompts panel (hundreds of KB); beyond 1000 KB we'd be storing crash dumps in
// Postgres for free — refuse politely.
const MAX_DETAILS_BYTES = 1_000_000;
const MAX_SUMMARY_CHARS = 280;
const FETCH_RUN_PAGE_SIZE = 10;
const FETCH_RUN_QUERY_SIZE = FETCH_RUN_PAGE_SIZE + 1;

export const dynamic = "force-dynamic";

const FetchRunInputSchema = z.object({
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  status: z.enum(["ok", "partial", "failed"]),
  source: z.enum(["manual", "cron"]),
  jobRunId: z.string().min(1).max(160).nullable().optional(),
  cliVersion: z.string().max(40).nullable().optional(),
  hostname: z.string().max(120).nullable().optional(),
  platform: z.string().max(120).nullable().optional(),
  buildersAttempted: z.number().int().min(0).max(10_000),
  itemsFetched: z.number().int().min(0).max(100_000),
  tasksGenerated: z.number().int().min(0).max(100_000),
  userActionsCount: z.number().int().min(0).max(10_000),
  errorCount: z.number().int().min(0).max(10_000),
  summary: z.string().min(1).max(MAX_SUMMARY_CHARS),
  // details is JSON; we re-serialize after parse to enforce the byte cap
  // and to normalize the value before passing to Prisma's Json column.
  details: z.unknown(),
})
  // Enforce the status↔errorCount invariant the CLI guarantees (ok ⟺ 0 errors;
  // partial/failed ⟹ ≥1) so a direct/buggy POST can't store a contradictory
  // row (e.g. status "ok" with errorCount 100). The route is bearer-accessible,
  // so the schema is the only gate.
  .refine((v) => (v.status === "ok" ? v.errorCount === 0 : v.errorCount >= 1), {
    message:
      "status/errorCount mismatch: 'ok' requires errorCount 0; 'partial' and 'failed' require errorCount >= 1",
    path: ["errorCount"],
  });

export type FetchRunInput = z.infer<typeof FetchRunInputSchema>;

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate-limit emit calls so a runaway CLI loop can't fill the DB
  // with thousands of rows per minute.
  const limit = rateLimit({
    key: `skill-fetch-runs:${user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return tooManyRequestsResponse(limit.retryAfterMs);
  }

  const raw = await request.json().catch(() => null);
  const parsed = FetchRunInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error) },
      { status: 400 },
    );
  }
  if (!parsed.data.jobRunId) {
    return NextResponse.json(
      { error: "jobRunId is required; start a new fetch with the current runner." },
      { status: 409 },
    );
  }
  const jobRunId = parsed.data.jobRunId;

  const rawDetailsValue = parsed.data.details ?? {};
  const compactedDetails = rawDetailsValue && typeof rawDetailsValue === "object" && !Array.isArray(rawDetailsValue)
    ? compactFetchRunDetailsForStorage(rawDetailsValue as Record<string, unknown>, MAX_DETAILS_BYTES)
    : { details: rawDetailsValue, bytes: 0, compacted: false };
  const detailsValue = compactedDetails.details;
  let detailsJson: string;
  try {
    detailsJson = JSON.stringify(detailsValue);
  } catch {
    return NextResponse.json(
      { error: "details must be JSON-serializable" },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(detailsJson, "utf8") > MAX_DETAILS_BYTES) {
    return NextResponse.json(
      { error: "details payload too large; cap at 1000 KB" },
      { status: 400 },
    );
  }

  const startedAt = new Date(parsed.data.startedAt);
  const finishedAt = new Date(parsed.data.finishedAt);
  // durationMs is computed server-side from the two timestamps so we
  // don't have to trust a separate field; clamp to 0 to keep the
  // column non-negative even if clocks moved backwards.
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  let record;
  try {
    record = await prisma.$transaction(async (tx) => {
      const jobRun = await tx.agentJobRun.findFirst({
        where: {
          userId: user.id,
          jobType: "library-fetch",
          instanceId: jobRunId,
        },
        select: { createdAt: true },
      });
      if (!jobRun) throw new StaleWorkerWriteError();
      await lockResetFenceForWorker(tx, jobRun.createdAt);
      return tx.libraryFetchRun.create({
        data: {
          userId: user.id,
          startedAt,
          finishedAt,
          durationMs,
          status: parsed.data.status,
          source: parsed.data.source,
          jobRunId,
          cliVersion: parsed.data.cliVersion ?? null,
          hostname: parsed.data.hostname ?? null,
          platform: parsed.data.platform ?? null,
          buildersAttempted: parsed.data.buildersAttempted,
          itemsFetched: parsed.data.itemsFetched,
          tasksGenerated: parsed.data.tasksGenerated,
          userActionsCount: parsed.data.userActionsCount,
          errorCount: parsed.data.errorCount,
          summary: parsed.data.summary,
          details: detailsValue as object,
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (error instanceof StaleWorkerWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  return NextResponse.json({ id: record.id });
}

export type LibraryFetchRunListItem = {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: string;
  source: string;
  jobRunId: string | null;
  cliVersion: string | null;
  hostname: string | null;
  platform: string | null;
  buildersAttempted: number;
  itemsFetched: number;
  tasksGenerated: number;
  userActionsCount: number;
  errorCount: number;
  summary: string;
  details: unknown;
};

export type LibraryCronJobStatus = {
  id: string;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  frequencyKey: string;
  frequencyLabel: string;
  schedule: string;
  intervalMinutes: number;
  runtime: string | null;
  overrideFetched: boolean;
  hostname: string | null;
  platform: string | null;
  updatedAt: string;
};

function serializeRun(row: {
  id: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  status: string;
  source: string;
  jobRunId: string | null;
  cliVersion: string | null;
  hostname: string | null;
  platform: string | null;
  buildersAttempted: number;
  itemsFetched: number;
  tasksGenerated: number;
  userActionsCount: number;
  errorCount: number;
  summary: string;
  details: unknown;
}): LibraryFetchRunListItem {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    durationMs: row.durationMs,
    status: row.status,
    source: row.source,
    jobRunId: row.jobRunId,
    cliVersion: row.cliVersion,
    hostname: row.hostname,
    platform: row.platform,
    buildersAttempted: row.buildersAttempted,
    itemsFetched: row.itemsFetched,
    tasksGenerated: row.tasksGenerated,
    userActionsCount: row.userActionsCount,
    errorCount: row.errorCount,
    summary: row.summary,
    details: row.details,
  };
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  const bearerUser = session?.user?.id ? null : await getUserFromBearer(request);
  const userId = session?.user?.id ?? bearerUser?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : null;
  if (beforeParam && (!before || Number.isNaN(before.getTime()))) {
    return NextResponse.json({ error: "Invalid before cursor." }, { status: 400 });
  }

  const [rows, cronRows, cronJob] = await Promise.all([
    prisma.libraryFetchRun.findMany({
      where: {
        userId,
        ...(before ? { startedAt: { lt: before } } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: FETCH_RUN_QUERY_SIZE,
    }),
    prisma.libraryFetchRun.findMany({
      where: {
        userId,
        source: "cron",
        ...(before ? { startedAt: { lt: before } } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: FETCH_RUN_QUERY_SIZE,
    }),
    prisma.libraryCronJob.findUnique({
      where: { userId },
    }),
  ]);
  const {
    runFloor,
    regularJobRunWhere,
    scheduledJobRunWhere,
  } = buildFetchRunHistoryAgentJobQueryPlan({
    rows,
    cronRows,
    before,
    pageSize: FETCH_RUN_PAGE_SIZE,
  });

  const runs = rows.slice(0, FETCH_RUN_PAGE_SIZE).map(serializeRun);
  const cronRuns = cronRows.slice(0, FETCH_RUN_PAGE_SIZE).map(serializeRun);

  // The client derives its "load more" cursor purely from the oldest visible
  // LibraryFetchRun (FetchLogPanel.oldestFetchHistoryCursor). AgentJobRuns are
  // denser than fetch runs — a run that fails before emitting a fetch log
  // (timeout, bootstrap failure) leaves an AgentJobRun row with no matching
  // LibraryFetchRun — so paging them independently at the same page size lets
  // the shared cursor step over the ones between two fetch-run pages, silently
  // dropping failed runs from the audited history. While fetch runs remain,
  // return every AgentJobRun down to this page's fetch-run floor so the next
  // cursor (that floor) cannot skip one. Once fetch runs are exhausted the client
  // pages by AgentJobRun time, so fall back to count-capped paging.
  const [jobRuns, scheduledJobRuns, moreJobRuns, moreScheduledJobRuns] = await Promise.all([
    runFloor && regularJobRunWhere
        ? prisma.agentJobRun
          .findMany({
            where: {
              userId,
              jobType: "library-fetch",
              ...regularJobRunWhere,
            },
            orderBy: { startedAt: "desc" },
          })
          .then((agentRuns) => agentRuns.map(serializeAgentJobRun))
      : // getAgentJobRuns wraps prisma.agentJobRun.findMany for all fetch runtime instances.
        getAgentJobRuns(userId, "library-fetch", FETCH_RUN_QUERY_SIZE, before),
    runFloor && scheduledJobRunWhere
        ? prisma.agentJobRun
          .findMany({
            where: {
              userId,
              scheduleJob: "library-cron",
              trigger: "scheduled",
              ...scheduledJobRunWhere,
            },
            orderBy: [{ expectedAt: "desc" }, { startedAt: "desc" }],
          })
          .then((agentRuns) => agentRuns.map(serializeAgentJobRun))
      : getScheduledAgentJobRuns(userId, "library-cron", FETCH_RUN_QUERY_SIZE, before),
    // Are there still older AgentJobRuns beyond this fetch-run floor left to page?
    runFloor
      ? prisma.agentJobRun
          .findFirst({
            where: { userId, jobType: "library-fetch", startedAt: { lt: runFloor } },
            select: { id: true },
          })
          .then((row) => row !== null)
      : Promise.resolve(false),
    runFloor
      ? prisma.agentJobRun
          .findFirst({
            where: {
              userId,
              scheduleJob: "library-cron",
              trigger: "scheduled",
              OR: [
                { expectedAt: { lt: runFloor } },
                { expectedAt: null, startedAt: { lt: runFloor } },
              ],
            },
            select: { id: true },
          })
          .then((row) => row !== null)
      : Promise.resolve(false),
  ]);

  const {
    visibleJobRuns,
    visibleScheduledJobRuns,
    hasMore,
  } = finalizeFetchRunHistoryAgentJobPage({
    runFloor,
    rowCount: rows.length,
    cronRowCount: cronRows.length,
    pageSize: FETCH_RUN_PAGE_SIZE,
    jobRuns,
    scheduledJobRuns,
    moreJobRuns,
    moreScheduledJobRuns,
  });

  const cron: LibraryCronJobStatus | null = cronJob
    ? {
        id: cronJob.id,
        status: cronJob.status,
        startedAt: cronJob.startedAt.toISOString(),
        stoppedAt: cronJob.stoppedAt?.toISOString() ?? null,
        frequencyKey: cronJob.frequencyKey,
        frequencyLabel: cronJob.frequencyLabel,
        schedule: cronJob.schedule,
        intervalMinutes: cronJob.intervalMinutes,
        runtime: cronJob.runtime,
        overrideFetched: cronJob.overrideFetched,
        hostname: cronJob.hostname,
        platform: cronJob.platform,
        updatedAt: cronJob.updatedAt.toISOString(),
      }
    : null;

  return NextResponse.json({
    runs,
    cronRuns,
    cronJob: cron,
    jobRuns: visibleJobRuns,
    scheduledJobRuns: visibleScheduledJobRuns,
    hasMore,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
