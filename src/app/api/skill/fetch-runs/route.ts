import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

// Cap details payload at ~50 KB serialized. Bigger than that and we'd
// be storing crash dumps in Postgres for free — refuse politely.
const MAX_DETAILS_BYTES = 50_000;
const MAX_SUMMARY_CHARS = 280;
const RUN_HISTORY_LIMIT = 25;

const FetchRunInputSchema = z.object({
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  status: z.enum(["ok", "partial", "failed"]),
  source: z.enum(["manual", "cron"]),
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

  const detailsValue = parsed.data.details ?? {};
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
      { error: "details payload too large; cap at 50 KB" },
      { status: 400 },
    );
  }

  const startedAt = new Date(parsed.data.startedAt);
  const finishedAt = new Date(parsed.data.finishedAt);
  // durationMs is computed server-side from the two timestamps so we
  // don't have to trust a separate field; clamp to 0 to keep the
  // column non-negative even if clocks moved backwards.
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  const record = await prisma.libraryFetchRun.create({
    data: {
      userId: user.id,
      startedAt,
      finishedAt,
      durationMs,
      status: parsed.data.status,
      source: parsed.data.source,
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

  return NextResponse.json({ id: record.id });
}

export type LibraryFetchRunListItem = {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: string;
  source: string;
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

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.libraryFetchRun.findMany({
    where: { userId: session.user.id },
    orderBy: { startedAt: "desc" },
    take: RUN_HISTORY_LIMIT,
  });

  const runs: LibraryFetchRunListItem[] = rows.map((row) => ({
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    durationMs: row.durationMs,
    status: row.status,
    source: row.source,
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
  }));

  return NextResponse.json({ runs });
}
