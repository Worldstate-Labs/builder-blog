import { NextResponse } from "next/server";
import { z } from "zod";
import {
  compactFetchRunDetailsForStorage,
  countPlannedPostTasks,
  deriveFetchRunStatusFromDetails,
  mergeFetchRunDetails,
} from "@/lib/fetch-run-details";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { MAX_FETCH_TASK_ID } from "@/lib/skill-contracts";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

// Mirror of the POST route's cap — details still has to fit comfortably.
// A full library run's fetch log holds a per-post outcome row for every
// planned task plus the per-source prompts panel, so it legitimately reaches
// hundreds of KB; 1000 KB leaves headroom without inviting crash-dump payloads.
const MAX_DETAILS_BYTES = 1_000_000;

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
  contentStatus: z.string().max(80).nullable().optional(),
  agentWorkType: z.string().max(120).nullable().optional(),
  fetchTool: z.string().max(240).nullable().optional(),
  readMethod: z.string().max(300).nullable().optional(),
  summaryMethod: z.string().max(300).nullable().optional(),
  hubSharedReuse: z.record(z.string(), z.unknown()).nullable().optional(),
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

function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function fetchRunPatchSummary({
  buildersAttempted,
  errorCount,
  itemsFetched,
  plannedPosts,
  userActionsCount,
}: {
  buildersAttempted: number;
  errorCount: number;
  itemsFetched: number;
  plannedPosts: number;
  userActionsCount: number;
}): string {
  const sources = countNoun(buildersAttempted, "source");
  const readPart = itemsFetched > 0
    ? `Read ${countNoun(itemsFetched, "post")} from ${sources}`
    : `Checked ${sources}`;
  const parts = [readPart];
  if (plannedPosts > 0 && plannedPosts !== itemsFetched) {
    parts.push(`${countNoun(plannedPosts, "post")} planned`);
  }
  if (userActionsCount > 0) {
    parts.push(`${countNoun(userActionsCount, "action")} needed`);
  }
  if (errorCount > 0) {
    parts.push(`${countNoun(errorCount, "post")} failed`);
  }
  return parts.join(" · ");
}

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
    select: {
      id: true,
      buildersAttempted: true,
      details: true,
      errorCount: true,
      itemsFetched: true,
      status: true,
      userActionsCount: true,
    },
  });
  if (!run) {
    return NextResponse.json({ error: "Fetch run not found" }, { status: 404 });
  }

  // mergeFetchRunDetails preserves terminal statuses from TERMINAL_FETCH_TASK_STATUSES
  // when a late plannedTasks patch arrives after synced/skipped/failed outcomes.
  const { details: mergedDetails, matched, planned } = mergeFetchRunDetails(run.details, {
    plannedTasks: parsed.data.plannedTasks ?? [],
    taskOutcomes: parsed.data.taskOutcomes ?? [],
    workerUsages: parsed.data.workerUsages ?? [],
  });
  const compacted = compactFetchRunDetailsForStorage(mergedDetails, MAX_DETAILS_BYTES);
  const details = compacted.details;
  const nextStatus = deriveFetchRunStatusFromDetails(
    { status: run.status as "ok" | "partial" | "failed", errorCount: run.errorCount },
    details,
  );
  const plannedPosts = countPlannedPostTasks(details);
  const summary = fetchRunPatchSummary({
    buildersAttempted: run.buildersAttempted,
    errorCount: nextStatus.errorCount,
    itemsFetched: run.itemsFetched,
    plannedPosts,
    userActionsCount: run.userActionsCount,
  });

  if (compacted.bytes > MAX_DETAILS_BYTES) {
    return NextResponse.json(
      { error: "details payload too large; cap at 1000 KB" },
      { status: 400 },
    );
  }

  await prisma.libraryFetchRun.update({
    where: { id: run.id },
    data: {
      details: details as object,
      errorCount: nextStatus.errorCount,
      status: nextStatus.status,
      summary,
      tasksGenerated: plannedPosts,
    },
  });

  return NextResponse.json({ id: run.id, matched, planned, status: nextStatus.status });
}
