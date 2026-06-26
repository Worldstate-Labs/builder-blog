import { NextResponse } from "next/server";
import { z } from "zod";
import { deriveFetchRunStatusFromDetails, mergeFetchRunDetails } from "@/lib/fetch-run-details";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { MAX_FETCH_TASK_ID } from "@/lib/skill-contracts";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

// Mirror of the POST route's cap — details still has to fit comfortably.
const MAX_DETAILS_BYTES = 50_000;

const PlannedTaskSchema = z.object({
  id: z.string().min(1).max(MAX_FETCH_TASK_ID),
}).passthrough();

// One per-post outcome, merged onto the matching planned task (details.fetchTasks
// entry whose `id` equals this fetchTaskId). All fields except the key are
// optional so the CLI can grow the per-post record without a schema change.
const TaskOutcomeSchema = z.object({
  fetchTaskId: z.string().min(1).max(MAX_FETCH_TASK_ID),
  plannedTask: z.record(z.string(), z.unknown()).optional(),
  bodyChars: z.number().int().min(0).max(100_000_000).nullable().optional(),
  bodyWords: z.number().int().min(0).max(100_000_000).nullable().optional(),
  summaryChars: z.number().int().min(0).max(100_000_000).nullable().optional(),
  summaryWords: z.number().int().min(0).max(100_000_000).nullable().optional(),
  agentRuntime: z.string().max(120).nullable().optional(),
  agentModel: z.string().max(120).nullable().optional(),
  workerId: z.string().max(120).nullable().optional(),
  status: z
    .enum(["fetched", "pending", "synced", "skipped", "failed", "action_needed"])
    .nullable()
    .optional(),
  // Why a task failed (e.g. "summary_missing", "not_summarized"). Shown in the
  // fetch log next to a failed summarize outcome.
  failureReason: z.string().max(300).nullable().optional(),
  // Per-task evidence for a skipped (no-content) outcome, e.g.
  // { meanVolumeDb: -91, hasCaptions: false }. Rendered in the fetch log.
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
});

const WorkerUsageSchema = z.object({
  workerId: z.string().min(1).max(120),
  usage: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const PatchSchema = z.object({
  plannedTasks: z.array(PlannedTaskSchema).max(500).optional(),
  taskOutcomes: z.array(TaskOutcomeSchema).max(500).optional(),
  workerUsages: z.array(WorkerUsageSchema).max(20).optional(),
}).refine(
  (value) =>
    (value.plannedTasks?.length ?? 0) +
    (value.taskOutcomes?.length ?? 0) +
    (value.workerUsages?.length ?? 0) > 0,
  { message: "plannedTasks, taskOutcomes, or workerUsages is required" },
);

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = rateLimit({
    key: `skill-fetch-runs-patch:${user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return tooManyRequestsResponse(limit.retryAfterMs);
  }

  const { id } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const run = await prisma.libraryFetchRun.findFirst({
    where: { id, userId: user.id },
    select: { id: true, details: true, errorCount: true, status: true },
  });
  if (!run) {
    return NextResponse.json({ error: "Fetch run not found" }, { status: 404 });
  }

  // mergeFetchRunDetails preserves terminal statuses from TERMINAL_FETCH_TASK_STATUSES
  // when a late plannedTasks patch arrives after synced/skipped/failed outcomes.
  const { details, matched, planned } = mergeFetchRunDetails(run.details, {
    plannedTasks: parsed.data.plannedTasks ?? [],
    taskOutcomes: parsed.data.taskOutcomes ?? [],
    workerUsages: parsed.data.workerUsages ?? [],
  });
  const nextStatus = deriveFetchRunStatusFromDetails(
    { status: run.status as "ok" | "partial" | "failed", errorCount: run.errorCount },
    details,
  );

  if (Buffer.byteLength(JSON.stringify(details), "utf8") > MAX_DETAILS_BYTES) {
    return NextResponse.json(
      { error: "details payload too large; cap at 50 KB" },
      { status: 400 },
    );
  }

  await prisma.libraryFetchRun.update({
    where: { id: run.id },
    data: {
      details: details as object,
      errorCount: nextStatus.errorCount,
      status: nextStatus.status,
    },
  });

  return NextResponse.json({ id: run.id, matched, planned, status: nextStatus.status });
}
