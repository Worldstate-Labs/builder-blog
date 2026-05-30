import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

// Mirror of the POST route's cap — details still has to fit comfortably.
const MAX_DETAILS_BYTES = 50_000;

// One per-post outcome, merged onto the matching planned task (details.fetchTasks
// entry whose `id` equals this fetchTaskId). All fields except the key are
// optional so the CLI can grow the per-post record without a schema change.
const TaskOutcomeSchema = z.object({
  fetchTaskId: z.string().min(1).max(200),
  bodyChars: z.number().int().min(0).max(100_000_000).nullable().optional(),
  bodyWords: z.number().int().min(0).max(100_000_000).nullable().optional(),
  summaryChars: z.number().int().min(0).max(100_000_000).nullable().optional(),
  summaryWords: z.number().int().min(0).max(100_000_000).nullable().optional(),
  agentRuntime: z.string().max(120).nullable().optional(),
  agentModel: z.string().max(120).nullable().optional(),
  status: z
    .enum(["fetched", "pending", "synced", "skipped", "failed", "action_needed"])
    .nullable()
    .optional(),
  // Why a task failed (e.g. "summary_missing", "not_summarized"). Shown in the
  // fetch log next to a failed summarize outcome.
  failureReason: z.string().max(300).nullable().optional(),
});

const PatchSchema = z.object({
  taskOutcomes: z.array(TaskOutcomeSchema).max(500),
});

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
    select: { id: true, details: true },
  });
  if (!run) {
    return NextResponse.json({ error: "Fetch run not found" }, { status: 404 });
  }

  const details =
    run.details && typeof run.details === "object" && !Array.isArray(run.details)
      ? { ...(run.details as Record<string, unknown>) }
      : {};

  const byTaskId = new Map(parsed.data.taskOutcomes.map((o) => [o.fetchTaskId, o]));

  // Merge each outcome onto the planned task with the same id. Only defined
  // values overwrite, so stage-1 fetch facts are never clobbered.
  const existingTasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  let matched = 0;
  details.fetchTasks = existingTasks.map((task) => {
    const t = task && typeof task === "object" ? (task as Record<string, unknown>) : {};
    const outcome = typeof t.id === "string" ? byTaskId.get(t.id) : undefined;
    if (!outcome) return task;
    matched += 1;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(outcome)) {
      if (key === "fetchTaskId" || value === undefined) continue;
      patch[key] = value;
    }
    return { ...t, ...patch };
  });

  // Roll the distinct models/runtimes actually used up to the run header so the
  // log line reflects reality (one model → "gpt-5-codex"; several → "a / b").
  const uniq = (vals: (string | null | undefined)[]) => [
    ...new Set(vals.map((v) => (v ?? "").trim()).filter(Boolean)),
  ];
  const models = uniq(parsed.data.taskOutcomes.map((o) => o.agentModel));
  const runtimes = uniq(parsed.data.taskOutcomes.map((o) => o.agentRuntime));
  if (models.length) details.agentModel = models.length === 1 ? models[0] : models.join(" / ");
  if (runtimes.length) {
    details.agentRuntime = runtimes.length === 1 ? runtimes[0] : runtimes.join(" / ");
  }

  if (Buffer.byteLength(JSON.stringify(details), "utf8") > MAX_DETAILS_BYTES) {
    return NextResponse.json(
      { error: "details payload too large; cap at 50 KB" },
      { status: 400 },
    );
  }

  await prisma.libraryFetchRun.update({
    where: { id: run.id },
    data: { details: details as object },
  });

  return NextResponse.json({ id: run.id, matched });
}
