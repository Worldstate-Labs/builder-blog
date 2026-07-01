import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

const MAX_DETAILS_BYTES = 50_000;
const MAX_SUMMARY_CHARS = 500;
const TERMINAL_AGENT_JOB_STATUSES = new Set(["succeeded", "failed", "timed_out", "killed", "replaced", "stale"]);

const AgentJobRunSchema = z.object({
  jobType: z.enum(["library-fetch", "cloud-library-fetch", "digest-build"]),
  trigger: z.enum(["scheduled", "one_time", "manual_cli"]),
  scheduleJob: z.enum(["library-cron", "digest-cron"]).nullable().optional(),
  instanceId: z.string().min(1).max(160),
  expectedAt: z.string().datetime().nullable().optional(),
  startedAt: z.string().datetime(),
  heartbeatAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional(),
  status: z.enum(["starting", "running", "succeeded", "failed", "timed_out", "killed", "replaced", "stale"]),
  exitCode: z.number().int().min(0).max(255).nullable().optional(),
  signal: z.string().max(40).nullable().optional(),
  runtime: z.string().max(80).nullable().optional(),
  runnerPid: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  workerPid: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  hostname: z.string().max(120).nullable().optional(),
  platform: z.string().max(120).nullable().optional(),
  stage: z.string().max(120).nullable().optional(),
  summary: z.string().max(MAX_SUMMARY_CHARS).nullable().optional(),
  details: z.unknown().optional(),
});

function detailsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function mergeAgentJobRunDetails(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const current = detailsRecord(existing);
  const next = detailsRecord(incoming);
  const merged = { ...current, ...next };
  if (
    Object.prototype.hasOwnProperty.call(current, "progress") &&
    !Object.prototype.hasOwnProperty.call(next, "progress")
  ) {
    merged.progress = current.progress;
  }
  return merged;
}

function isTerminalAgentJobStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_AGENT_JOB_STATUSES.has(status);
}

function mergeAgentJobRunLifecycle<
  T extends {
    status: string;
    finishedAt: Date | null;
    exitCode: number | null;
    signal: string | null;
    stage: string | null;
    summary: string | null;
  },
>(
  existingRun: {
    status: string;
    finishedAt: Date | null;
    exitCode: number | null;
    signal: string | null;
    stage: string | null;
    summary: string | null;
  },
  incoming: T,
): T {
  if (existingRun && isTerminalAgentJobStatus(existingRun.status)) {
    return {
      ...incoming,
      status: existingRun.status,
      finishedAt: existingRun.finishedAt ?? incoming.finishedAt,
      exitCode: existingRun.exitCode ?? incoming.exitCode,
      signal: existingRun.signal ?? incoming.signal,
      stage: existingRun.stage ?? incoming.stage,
      summary: existingRun.summary ?? incoming.summary,
    };
  }
  return incoming;
}

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = rateLimit({
    key: `skill-job-runs:${user.id}`,
    limit: 240,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return tooManyRequestsResponse(limit.retryAfterMs);
  }

  const parsed = AgentJobRunSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const existingRun = await prisma.agentJobRun.findFirst({
    where: {
      userId: user.id,
      jobType: parsed.data.jobType,
      instanceId: parsed.data.instanceId,
    },
    select: { id: true, details: true, status: true, finishedAt: true, exitCode: true, signal: true, stage: true, summary: true },
  });
  const detailsValue = mergeAgentJobRunDetails(existingRun?.details, parsed.data.details ?? {});
  let detailsJson = "";
  try {
    detailsJson = JSON.stringify(detailsValue);
  } catch {
    return NextResponse.json({ error: "details must be JSON-serializable" }, { status: 400 });
  }
  if (Buffer.byteLength(detailsJson, "utf8") > MAX_DETAILS_BYTES) {
    return NextResponse.json({ error: "details payload too large; cap at 50 KB" }, { status: 400 });
  }

  const now = new Date();
  const finishedAt = parsed.data.finishedAt ? new Date(parsed.data.finishedAt) : null;
  const incomingRunData = {
    status: parsed.data.status,
    scheduleJob: parsed.data.scheduleJob ?? null,
    expectedAt: parsed.data.expectedAt ? new Date(parsed.data.expectedAt) : null,
    heartbeatAt: parsed.data.heartbeatAt ? new Date(parsed.data.heartbeatAt) : now,
    finishedAt,
    exitCode: parsed.data.exitCode ?? null,
    signal: parsed.data.signal ?? null,
    runtime: parsed.data.runtime ?? null,
    runnerPid: parsed.data.runnerPid ?? null,
    workerPid: parsed.data.workerPid ?? null,
    hostname: parsed.data.hostname ?? request.headers.get("x-machine-hostname"),
    platform: parsed.data.platform ?? request.headers.get("x-machine-platform"),
    stage: parsed.data.stage ?? null,
    summary: parsed.data.summary ?? null,
    details: detailsValue as object,
  };
  const runData = existingRun && isTerminalAgentJobStatus(existingRun.status)
    ? mergeAgentJobRunLifecycle(existingRun, incomingRunData)
    : incomingRunData;

  const record = existingRun
    ? await prisma.agentJobRun.update({
        where: { id: existingRun.id },
        data: runData,
        select: { id: true, instanceId: true, status: true },
      })
    : await prisma.agentJobRun.create({
        data: {
          userId: user.id,
          jobType: parsed.data.jobType,
          trigger: parsed.data.trigger,
          instanceId: parsed.data.instanceId,
          startedAt: new Date(parsed.data.startedAt),
          ...runData,
        },
        select: { id: true, instanceId: true, status: true },
      });

  return NextResponse.json({ id: record.id, instanceId: record.instanceId, status: record.status });
}
