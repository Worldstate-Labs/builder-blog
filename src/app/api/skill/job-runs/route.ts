import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";
import { canonicalFetchTaskId } from "@/lib/fetch-task-id";
import {
  databaseClockNow,
  lockResetFenceForNewWorker,
  lockResetFenceForWorker,
  StaleWorkerWriteError,
} from "@/lib/reset-fence";

const MAX_DETAILS_BYTES = 50_000;
const MAX_SUMMARY_CHARS = 500;
const TERMINAL_AGENT_JOB_STATUSES = new Set(["succeeded", "failed", "timed_out", "killed", "replaced", "stale"]);
const FETCH_PROGRESS_SOURCE_LIMIT = 32;
const FETCH_PROGRESS_TASK_LIMIT = 24;
const FETCH_PROGRESS_RECENT_EVENT_LIMIT = 20;

class AgentJobWriteError extends Error {
  readonly statusCode = 400;
}

const AGENT_JOB_STAGE_RANK: Record<string, number> = {
  starting: 0,
  heartbeat: 1,
  fetch_sources: 10,
  scanning_sources: 10,
  expand_discovery: 15,
  shard_fetch_tasks: 20,
  tasks_planned: 20,
  run_fetch_workers: 30,
  workers_running: 30,
  checkpoint_syncing: 30,
  merge_results: 40,
  validate_results: 45,
  sync_to_followbrief: 55,
  syncing: 55,
  reconciled: 60,
  no_update: 60,
  completed: 70,
};

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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function compactText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max - 1) : text;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stageRank(stage: unknown): number {
  const key = String(stage ?? "").trim();
  if (!key) return -1;
  return AGENT_JOB_STAGE_RANK[key] ?? 5;
}

function mergeAgentJobRunStage(current: unknown, incoming: unknown): string | null {
  const currentStage = compactText(current, 120);
  const incomingStage = compactText(incoming, 120);
  if (!incomingStage) return currentStage;
  if (!currentStage) return incomingStage;
  return stageRank(incomingStage) >= stageRank(currentStage) ? incomingStage : currentStage;
}

function mergeAgentJobRunSummary(
  currentStage: unknown,
  currentSummary: string | null,
  incomingStage: unknown,
  incomingSummary: string | null,
): string | null {
  const nextSummary = compactText(incomingSummary, MAX_SUMMARY_CHARS);
  if (!nextSummary) return currentSummary ?? null;
  if (!compactText(incomingStage, 120) && currentSummary) return currentSummary;
  if (stageRank(incomingStage) < stageRank(currentStage) && currentSummary) return currentSummary;
  return nextSummary;
}

function sortByUpdatedAt<T extends Record<string, unknown>>(items: T[]): T[] {
  return items.slice().sort((left, right) =>
    String(left.updatedAt ?? left.at ?? "").localeCompare(String(right.updatedAt ?? right.at ?? "")),
  );
}

function compactProgressSource(value: unknown): Record<string, unknown> {
  const source = detailsRecord(value);
  return {
    ...(compactText(source.builderId, 120) ? { builderId: compactText(source.builderId, 120) } : {}),
    ...(compactText(source.name, 160) ? { name: compactText(source.name, 160) } : {}),
    ...(compactText(source.sourceType, 80) ? { sourceType: compactText(source.sourceType, 80) } : {}),
    ...(compactText(source.status, 80) ? { status: compactText(source.status, 80) } : {}),
    ...(finiteNumber(source.itemsFetched) !== null ? { itemsFetched: finiteNumber(source.itemsFetched) } : {}),
    ...(finiteNumber(source.tasksGenerated) !== null ? { tasksGenerated: finiteNumber(source.tasksGenerated) } : {}),
    ...(finiteNumber(source.discoveryTasksGenerated) !== null
      ? { discoveryTasksGenerated: finiteNumber(source.discoveryTasksGenerated) }
      : {}),
    ...(compactText(source.error, 180) ? { error: compactText(source.error, 180) } : {}),
    ...(compactText(source.updatedAt, 80) ? { updatedAt: compactText(source.updatedAt, 80) } : {}),
  };
}

function compactProgressTask(value: unknown): Record<string, unknown> {
  const task = detailsRecord(value);
  const id = canonicalFetchTaskId(task.id ?? task.taskId);
  return {
    ...(compactText(id, 500) ? { id: compactText(id, 500) } : {}),
    ...(compactText(task.status, 80) ? { status: compactText(task.status, 80) } : {}),
    ...(compactText(task.phase, 80) ? { phase: compactText(task.phase, 80) } : {}),
    ...(compactText(task.message, 180) ? { message: compactText(task.message, 180) } : {}),
    ...(compactText(task.reason, 160) ? { reason: compactText(task.reason, 160) } : {}),
    ...(compactText(task.builder, 160) ? { builder: compactText(task.builder, 160) } : {}),
    ...(compactText(task.builderId, 120) ? { builderId: compactText(task.builderId, 120) } : {}),
    ...(compactText(task.sourceType, 80) ? { sourceType: compactText(task.sourceType, 80) } : {}),
    ...(compactText(task.title, 180) ? { title: compactText(task.title, 180) } : {}),
    ...(compactText(task.url, 240) ? { url: compactText(task.url, 240) } : {}),
    ...(compactText(task.workerId, 80) ? { workerId: compactText(task.workerId, 80) } : {}),
    ...(finiteNumber(task.bodyChars) !== null ? { bodyChars: finiteNumber(task.bodyChars) } : {}),
    ...(finiteNumber(task.bodyWords) !== null ? { bodyWords: finiteNumber(task.bodyWords) } : {}),
    ...(finiteNumber(task.summaryChars) !== null ? { summaryChars: finiteNumber(task.summaryChars) } : {}),
    ...(finiteNumber(task.summaryWords) !== null ? { summaryWords: finiteNumber(task.summaryWords) } : {}),
    ...(compactText(task.updatedAt, 80) ? { updatedAt: compactText(task.updatedAt, 80) } : {}),
  };
}

function compactProgressEvent(value: unknown): Record<string, unknown> {
  const event = detailsRecord(value);
  return {
    ...(compactText(event.at, 80) ? { at: compactText(event.at, 80) } : {}),
    ...(compactText(event.type, 80) ? { type: compactText(event.type, 80) } : {}),
    ...(compactText(event.message, 220) ? { message: compactText(event.message, 220) } : {}),
    ...(compactText(event.taskId, 500) ? { taskId: compactText(event.taskId, 500) } : {}),
    ...(compactText(event.builderId, 120) ? { builderId: compactText(event.builderId, 120) } : {}),
    ...(compactText(event.status, 80) ? { status: compactText(event.status, 80) } : {}),
    ...(compactText(event.reason, 180) ? { reason: compactText(event.reason, 180) } : {}),
  };
}

function progressEventIdentity(event: Record<string, unknown>): string {
  return JSON.stringify([
    event.type ?? "",
    event.message ?? "",
    event.taskId ?? "",
    event.builderId ?? "",
    event.status ?? "",
    event.reason ?? "",
  ]);
}

function mergeProgressArray(
  current: unknown,
  incoming: unknown,
  keyFor: (value: Record<string, unknown>) => string,
  compact: (value: unknown) => Record<string, unknown>,
  limit: number,
): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of Array.isArray(current) ? current : []) {
    const compacted = compact(item);
    const key = keyFor(compacted);
    if (key) byKey.set(key, compacted);
  }
  for (const item of Array.isArray(incoming) ? incoming : []) {
    const compacted = compact(item);
    const key = keyFor(compacted);
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) ?? {}), ...compacted });
  }
  return sortByUpdatedAt([...byKey.values()]).slice(-limit);
}

function mergeProgressCounters(current: unknown, incoming: unknown): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const source of [detailsRecord(current), detailsRecord(incoming)]) {
    for (const [key, value] of Object.entries(source)) {
      const number = finiteNumber(value);
      if (number === null) continue;
      merged[key] = Math.max(merged[key] ?? Number.NEGATIVE_INFINITY, number);
    }
  }
  return merged;
}

function mergeAgentJobRunProgress(currentValue: unknown, incomingValue: unknown): Record<string, unknown> | null {
  const current = detailsRecord(currentValue);
  const incoming = detailsRecord(incomingValue);
  if (!hasOwn(current, "stage") && !hasOwn(incoming, "stage")) return null;
  const mergedStage = mergeAgentJobRunStage(current.stage, incoming.stage) ?? "running";
  const incomingIsCurrent = stageRank(incoming.stage) >= stageRank(current.stage);
  const currentValueRecord = detailsRecord(current.current);
  const incomingValueRecord = detailsRecord(incoming.current);
  const currentTask = incomingIsCurrent
    ? { ...incomingValueRecord }
    : { ...currentValueRecord };
  const recentEvents = [
    ...(Array.isArray(current.recentEvents) ? current.recentEvents : []),
    ...(Array.isArray(incoming.recentEvents) ? incoming.recentEvents : []),
  ]
    .map(compactProgressEvent)
    .filter((event) => compactText(event.at ?? event.message, 500));
  const eventsByIdentity = new Map<string, Record<string, unknown>>();
  for (const event of recentEvents) {
    // The fetch CLI can report the same semantic milestone from both its
    // planning and fetch-log patch phases. Keep the newest timestamp, but do
    // not show duplicate UI events merely because the reports arrived a few
    // seconds apart.
    eventsByIdentity.set(progressEventIdentity(event), event);
  }
  const dedupedEvents = [...eventsByIdentity.values()];

  return {
    version: finiteNumber(incoming.version) ?? finiteNumber(current.version) ?? 1,
    stage: mergedStage,
    updatedAt: compactText(incoming.updatedAt, 80) ?? compactText(current.updatedAt, 80) ?? new Date().toISOString(),
    counters: mergeProgressCounters(current.counters, incoming.counters),
    current: currentTask,
    sources: mergeProgressArray(
      current.sources,
      incoming.sources,
      (source) => String(source.builderId ?? source.name ?? ""),
      compactProgressSource,
      FETCH_PROGRESS_SOURCE_LIMIT,
    ),
    tasks: mergeProgressArray(
      current.tasks,
      incoming.tasks,
      (task) => canonicalFetchTaskId(task.id ?? task.taskId),
      compactProgressTask,
      FETCH_PROGRESS_TASK_LIMIT,
    ),
    recentEvents: sortByUpdatedAt(dedupedEvents).slice(-FETCH_PROGRESS_RECENT_EVENT_LIMIT),
  };
}

function compactAgentJobRunDetails(details: Record<string, unknown>): Record<string, unknown> {
  const compacted = { ...details };
  if (hasOwn(compacted, "progress")) {
    const progress = mergeAgentJobRunProgress({}, compacted.progress);
    if (progress) compacted.progress = progress;
    else delete compacted.progress;
  }
  return compacted;
}

function mergeAgentJobRunDetails(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const current = detailsRecord(existing);
  const next = detailsRecord(incoming);
  const merged = { ...current, ...next };
  if (hasOwn(current, "progress") || hasOwn(next, "progress")) {
    const progress = mergeAgentJobRunProgress(current.progress, next.progress);
    if (progress) merged.progress = progress;
  }
  return compactAgentJobRunDetails(merged);
}

function isTerminalAgentJobStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_AGENT_JOB_STATUSES.has(status);
}

function finalizeAgentJobRunProgress(
  details: Record<string, unknown>,
  status: string,
  stage: string | null | undefined,
  summary: string | null | undefined,
  at: string,
): Record<string, unknown> {
  const progress = detailsRecord(details.progress);
  if (!hasOwn(progress, "stage")) return details;
  const message = compactText(summary, 220) ?? `Runtime ${status.replace(/_/g, " ")}.`;
  const event = compactProgressEvent({
    at,
    type: "job_completed",
    status,
    message,
  });
  return {
    ...details,
    progress: {
      ...progress,
      stage: compactText(stage, 120) ?? status,
      updatedAt: at,
      current: {},
      recentEvents: sortByUpdatedAt([
        ...(Array.isArray(progress.recentEvents) ? progress.recentEvents : []),
        event,
      ]).slice(-FETCH_PROGRESS_RECENT_EVENT_LIMIT),
    },
  };
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

  const startedAt = new Date(parsed.data.startedAt);
  let record;
  try {
    record = await prisma.$transaction(async (tx) => {
      let newRunCreatedAt: Date | null = null;
      const existingRun = await tx.agentJobRun.findFirst({
        where: {
          userId: user.id,
          jobType: parsed.data.jobType,
          instanceId: parsed.data.instanceId,
        },
        select: { id: true, details: true, status: true, finishedAt: true, exitCode: true, signal: true, stage: true, summary: true, createdAt: true },
      });
      if (existingRun) {
        await lockResetFenceForWorker(tx, existingRun.createdAt);
      } else {
        if (parsed.data.status !== "starting") {
          throw new StaleWorkerWriteError();
        }
        await lockResetFenceForNewWorker(tx);
        newRunCreatedAt = await databaseClockNow(tx);
      }
      const now = new Date();
      const finishedAt = parsed.data.finishedAt ? new Date(parsed.data.finishedAt) : null;
      let detailsValue = mergeAgentJobRunDetails(existingRun?.details, parsed.data.details ?? {});
      if (isTerminalAgentJobStatus(parsed.data.status)) {
        detailsValue = finalizeAgentJobRunProgress(
          detailsValue,
          parsed.data.status,
          parsed.data.stage,
          parsed.data.summary,
          (finishedAt ?? now).toISOString(),
        );
      }
      let detailsJson = "";
      try {
        detailsJson = JSON.stringify(detailsValue);
      } catch {
        throw new AgentJobWriteError("details must be JSON-serializable");
      }
      if (Buffer.byteLength(detailsJson, "utf8") > MAX_DETAILS_BYTES) {
        throw new AgentJobWriteError("details payload too large; cap at 50 KB");
      }

      const mergedStage = mergeAgentJobRunStage(existingRun?.stage, parsed.data.stage ?? null);
      const mergedSummary = mergeAgentJobRunSummary(
        existingRun?.stage ?? null,
        existingRun?.summary ?? null,
        parsed.data.stage ?? null,
        parsed.data.summary ?? null,
      );
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
        stage: mergedStage,
        summary: mergedSummary,
        details: detailsValue as object,
      };
      const runData = existingRun && isTerminalAgentJobStatus(existingRun.status)
        ? mergeAgentJobRunLifecycle(existingRun, incomingRunData)
        : incomingRunData;

      return existingRun
        ? tx.agentJobRun.update({
            where: { id: existingRun.id },
            data: runData,
            select: { id: true, instanceId: true, status: true },
          })
        : tx.agentJobRun.create({
            data: {
              userId: user.id,
              jobType: parsed.data.jobType,
              trigger: parsed.data.trigger,
              instanceId: parsed.data.instanceId,
              startedAt,
              createdAt: newRunCreatedAt!,
              ...runData,
            },
            select: { id: true, instanceId: true, status: true },
          });
    });
  } catch (error) {
    if (error instanceof StaleWorkerWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof AgentJobWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  return NextResponse.json({ id: record.id, instanceId: record.instanceId, status: record.status });
}
