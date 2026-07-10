"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type UIEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";
import { formatCount } from "@/components/Count";
import { RelativeTime } from "@/components/RelativeTime";
import { relativeTime } from "@/lib/relative-time";
import { EmptyState } from "@/components/EmptyState";
import { useHydrated } from "@/components/ThemeToggle";
import { RunUsageSummary } from "@/components/RunUsageSummary";
import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import { latestResolvedSlotStatus } from "@/lib/digest-update-status";
import { contentSyncStateChanged } from "@/lib/content-sync-events";
import { decodeHtmlEntities } from "@/lib/decode-entities";
import {
  fetchFailureMessage,
  isContentFailureReason,
  isHiddenFailureReason,
  isNotCompletedFailureReason,
} from "@/lib/fetch-failure-taxonomy";
import { displayLanguagePreference } from "@/lib/language-preference";
import { addScheduleInterval, firstExpectedSchedule, floorToExpectedSchedule } from "@/lib/schedule-timing";
import {
  formatUsageCost,
  formatUsageTokens,
  readUsageSummary,
  type UsageSummary,
} from "@/lib/usage-summary";
import {
  scheduledJobRunStatusLabel,
  scheduledRunTriggerLabel,
  scheduledWindowRunNote,
  scheduledWindowStatusLabel,
  scheduledWindowStyleStatus,
} from "@/lib/scheduled-window-ui";

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

type PerBuilder = {
  builderId?: string;
  name?: string;
  sourceType?: string;
  itemsFetched?: number;
  tasksGenerated?: number;
  fallback?: {
    kind?: string;
    message?: string;
    reason?: string;
  };
  error?: string;
};

type UserAction = {
  kind?: string;
  builder?: string;
  message?: string;
  helpUrl?: string;
};

export type FetchTaskLog = {
  id?: string | null;
  builder?: string | null;
  builderId?: string | null;
  sourceType?: string | null;
  contentStatus?: string | null;
  agentWorkType?: string | null;
  title?: string | null;
  url?: string | null;
  // Per-post fetch/summary facts. Stage 1 (fetch-personal) fills fetchTool +
  // bodyChars for ready posts; sync-builders patches the agent-stage fields
  // (model, summary size, final status).
  fetchTool?: string | null;
  bodyChars?: number | null;
  bodyWords?: number | null;
  headlineChars?: number | null;
  headlineWords?: number | null;
  summaryChars?: number | null;
  summaryWords?: number | null;
  agentRuntime?: string | null;
  agentModel?: string | null;
  readMethod?: string | null;
  summaryMethod?: string | null;
  hubSharedReuse?: Record<string, unknown> | null;
  workerId?: string | null;
  status?: string | null;
  // Why a task failed (e.g. "summary_missing", "not_summarized"). Present only
  // when status is "failed".
  failureReason?: string | null;
  // Per-task evidence for a skipped (no-content) outcome, e.g.
  // { meanVolumeDb: -91, hasCaptions: false }.
  evidence?: Record<string, unknown> | null;
  usage?: unknown;
  tokenUsage?: unknown;
  token_usage?: unknown;
};

type DetailsShape = {
  perBuilder?: PerBuilder[];
  userActions?: UserAction[];
  localErrors?: string[];
  cliFlags?: Record<string, unknown>;
  error?: { message?: string; stack?: string };
  fetchTasks?: FetchTaskLog[];
  shardPlans?: FetchTaskShardPlan[];
  workerUsages?: FetchTaskWorkerUsage[];
  // Which agent ran the fetch and the model it used. Recorded by the CLI at
  // emit time; absent on runs from before this was captured.
  agentRuntime?: string | null;
  agentModel?: string | null;
  usage?: unknown;
};

type FetchRunStats = {
  sourcesScanned: number;
  sourcesTotal: number;
  planned: number;
  read: number;
  summaries: number;
  headlines: number;
  summarized: number;
  synced: number;
  skipped: number;
  failed: number;
  actionNeeded: number;
};

type FetchTaskSourceGroup = {
  key: string;
  name: string;
  sourceType: string;
  tasks: FetchTaskLog[];
};

type FetchTaskWorkerGroup = {
  key: string;
  name: string;
  usage: UsageSummary | null;
  sourceGroups: FetchTaskSourceGroup[];
  tasks: FetchTaskLog[];
};

type FetchTaskWorkerUsage = {
  workerId?: string | null;
  usage?: unknown;
};

type FetchTaskShardPlan = {
  shard?: string | null;
  tasks?: FetchTaskLog[];
};

type LifecycleStep = {
  key: string;
  label: string;
  outcome: string;
  tone: Tone;
  meta?: string;
  open?: boolean;
  children?: ReactNode;
};

type JobRunDetailsShape = {
  reason?: string | null;
  cliVersion?: string | null;
  providerError?: string | null;
  timeoutSeconds?: number | null;
  timeoutStage?: string | null;
  timedOutWorker?: string | null;
  timedOutWorkerPid?: number | null;
  termination?: string | null;
  skippedWaitPids?: string | null;
  progress?: FetchJobProgress | null;
  usage?: unknown;
};

type FetchJobProgress = {
  version?: number;
  stage?: string | null;
  updatedAt?: string | null;
  counters?: {
    sourcesTotal?: number;
    sourcesChecked?: number;
    candidatesFound?: number;
    tasksPlanned?: number;
    tasksDone?: number;
    synced?: number;
    skipped?: number;
    failed?: number;
    actionNeeded?: number;
  };
  current?: {
    source?: string | null;
    task?: string | null;
    workerId?: string | null;
  };
  sources?: Array<{
    builderId?: string | null;
    name?: string | null;
    sourceType?: string | null;
    status?: string | null;
    itemsFetched?: number | null;
    tasksGenerated?: number | null;
    error?: string | null;
    updatedAt?: string | null;
  }>;
  tasks?: FetchTaskProgress[];
  recentEvents?: Array<{
    at?: string | null;
    type?: string | null;
    message?: string | null;
    taskId?: string | null;
    builderId?: string | null;
    status?: string | null;
    reason?: string | null;
  }>;
};

export type FetchTaskProgress = {
  id?: string | null;
  taskId?: string | null;
  status?: string | null;
  phase?: string | null;
  message?: string | null;
  builder?: string | null;
  builderId?: string | null;
  sourceType?: string | null;
  title?: string | null;
  url?: string | null;
  workerId?: string | null;
  bodyChars?: number | null;
  bodyWords?: number | null;
  headlineChars?: number | null;
  headlineWords?: number | null;
  summaryChars?: number | null;
  summaryWords?: number | null;
  updatedAt?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  ok: "Succeeded",
  partial: "Partial",
  failed: "Failed",
};

function formatRelative(iso: string): string {
  return relativeTime(iso, Date.now());
}

function formatAbsolute(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatLanguage(value: string) {
  return displayLanguagePreference(value);
}

function displayText(value: string | null | undefined, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text ? decodeHtmlEntities(text) : fallback;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1_000) return `${ms}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remainSeconds}s`;
}

function statusStyle(status: string): {
  background: string;
  color: string;
  border: string;
} {
  switch (status) {
    case "ok":
      return {
        background: "var(--signal-soft)",
        color: "color-mix(in oklch, var(--signal) 72%, var(--ink))",
        border: "color-mix(in oklch, var(--signal) 28%, var(--line))",
      };
    case "partial":
      return {
        background: "var(--status-partial-soft)",
        color: "color-mix(in oklch, var(--status-partial) 76%, var(--ink))",
        border: "color-mix(in oklch, var(--status-partial) 34%, var(--line))",
      };
    case "failed":
      return {
        background: "var(--danger-soft)",
        color: "var(--danger)",
        border: "color-mix(in oklch, var(--danger) 30%, var(--line))",
      };
    default:
      return {
        background: "var(--paper-strong)",
        color: "var(--muted-strong)",
        border: "var(--line)",
      };
  }
}

type StatusTone = "ok" | "partial" | "failed" | "muted";

function statusTone(status: string): StatusTone {
  if (status === "ok") return "ok";
  if (status === "partial") return "partial";
  if (status === "failed") return "failed";
  return "muted";
}

function statusToneClass(tone: StatusTone): string {
  return `is-${tone}`;
}

function fetchUpdateStatusTone(status: FetchUpdateStatus): StatusTone {
  if (status.key === "healthy") return "ok";
  if (status.key === "needs-attention" && status.label !== "Partial") return "failed";
  return "partial";
}

function jobRunStatusTone(jobRun: AgentJobRunListItem): StatusTone {
  if (jobRun.status === "succeeded") return "ok";
  if (
    jobRun.status === "running" ||
    jobRun.status === "starting" ||
    jobRun.status === "killed" ||
    jobRun.status === "stale" ||
    jobRun.status === "replaced"
  ) return "partial";
  return "failed";
}

function readDetails(value: unknown): DetailsShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as DetailsShape;
}

function readJobRunDetails(value: unknown): JobRunDetailsShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JobRunDetailsShape;
}

function readFetchJobProgress(value: unknown): FetchJobProgress | null {
  const progress = readJobRunDetails(value).progress;
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return null;
  return progress;
}

function fetchTaskProgressMap(progress: FetchJobProgress | null): Map<string, FetchTaskProgress> {
  const map = new Map<string, FetchTaskProgress>();
  for (const task of progress?.tasks ?? []) {
    const id = String(task.id ?? task.taskId ?? "");
    if (id) map.set(id, task);
  }
  return map;
}

function liveTaskWasRead(task: FetchTaskProgress): boolean {
  const status = String(task.status ?? "").toLowerCase();
  const phase = String(task.phase ?? "").toLowerCase();
  return (
    typeof task.bodyChars === "number" && task.bodyChars > 0
  ) || phase === "summarize" || status === "summarizing" || status === "summarized" || status === "synced";
}

function liveTaskWasSummarized(task: FetchTaskProgress): boolean {
  const status = String(task.status ?? "").toLowerCase();
  return (liveTaskHasSummary(task) && liveTaskHasHeadline(task)) || status === "synced";
}

function isLivePostTask(task: FetchTaskProgress): boolean {
  const id = String(task.id ?? task.taskId ?? "");
  return id.startsWith("fetch_post:");
}

export function fetchRunStats({
  details,
  liveProgress,
  run,
}: {
  details: DetailsShape;
  liveProgress: FetchJobProgress | null;
  run?: LibraryFetchRunListItem;
}): FetchRunStats {
  const fetchTasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  const perBuilder = Array.isArray(details.perBuilder) ? details.perBuilder : [];
  const counters = liveProgress?.counters ?? {};
  const liveTasks = liveProgress?.tasks ?? [];
  const plannedTasks = fetchTasks.filter(isPlannedPostTask);
  const livePostTasks = liveTasks.filter(isLivePostTask);
  const hasDetailedPostTasks = plannedTasks.length > 0;
  const hasLivePostTasks = livePostTasks.length > 0;
  const fallbackPlanned = Math.max(counters.tasksPlanned ?? 0, run?.tasksGenerated ?? 0);
  const planned = Math.max(
    hasDetailedPostTasks ? plannedTasks.length : 0,
    hasLivePostTasks ? livePostTasks.length : 0,
    hasLivePostTasks ? 0 : fallbackPlanned,
  );
  const read = hasDetailedPostTasks
    ? plannedTasks.filter(isReadForStats).length
    : hasLivePostTasks
    ? livePostTasks.filter(liveTaskWasRead).length
    : Math.max(liveTasks.filter(liveTaskWasRead).length, run?.itemsFetched ?? 0);
  const summaries = hasDetailedPostTasks
    ? plannedTasks.filter(isSummaryReadyForStats).length
    : hasLivePostTasks
    ? livePostTasks.filter(liveTaskHasSummary).length
    : liveTasks.filter(liveTaskHasSummary).length;
  const headlines = hasDetailedPostTasks
    ? plannedTasks.filter(isHeadlineReadyForStats).length
    : hasLivePostTasks
    ? livePostTasks.filter(liveTaskHasHeadline).length
    : liveTasks.filter(liveTaskHasHeadline).length;
  const summarized = hasDetailedPostTasks
    ? plannedTasks.filter(isSummarizedForStats).length
    : hasLivePostTasks
    ? livePostTasks.filter(liveTaskWasSummarized).length
    : liveTasks.filter(liveTaskWasSummarized).length;
  const synced = hasDetailedPostTasks
    ? plannedTasks.filter((task) => task.status === "synced").length
    : hasLivePostTasks
    ? livePostTasks.filter((task) => task.status === "synced").length
    : counters.synced ?? 0;
  const skipped = hasDetailedPostTasks
    ? plannedTasks.filter((task) => task.status === "skipped").length
    : hasLivePostTasks
    ? livePostTasks.filter((task) => task.status === "skipped").length
    : counters.skipped ?? 0;
  const failed = hasDetailedPostTasks
    ? plannedTasks.filter((task) => task.status === "failed").length
    : hasLivePostTasks
    ? livePostTasks.filter((task) => task.status === "failed").length
    : counters.failed ?? 0;
  const actionNeeded = hasDetailedPostTasks
    ? plannedTasks.filter((task) => task.status === "action_needed" || isBlocked(task)).length
    : hasLivePostTasks
    ? livePostTasks.filter((task) => task.status === "action_needed").length
    : counters.actionNeeded ?? 0;

  return {
    sourcesScanned:
      counters.sourcesChecked ??
      (perBuilder.length > 0 ? perBuilder.length : run?.buildersAttempted ?? 0),
    sourcesTotal:
      counters.sourcesTotal ??
      (run?.buildersAttempted ?? perBuilder.length),
    planned,
    read,
    summaries,
    headlines,
    summarized,
    synced,
    skipped,
    failed,
    actionNeeded,
  };
}

function fetchRunHasCompletedOutcomes(stats: FetchRunStats): boolean {
  const accounted = stats.synced + stats.skipped + stats.failed + stats.actionNeeded;
  if (stats.planned <= 0) return true;
  return accounted >= stats.planned;
}

function fetchRunOutcomeStatus(runStatus: string, stats: FetchRunStats): string {
  if (stats.planned <= 0) return runStatus;
  if (stats.failed >= stats.planned) return "failed";
  if (stats.failed > 0 || stats.actionNeeded > 0) return "partial";
  return runStatus;
}

function hasFailedFetchJob(jobRun?: AgentJobRunListItem | null, nowMs = Date.now()): boolean {
  return Boolean(jobRun && (isStalledJobRun(jobRun, nowMs) || !["starting", "running", "succeeded"].includes(jobRun.status)));
}

function isNoUpdateFetchRun(run?: LibraryFetchRunListItem | null, jobRun?: AgentJobRunListItem | null): boolean {
  if (!run || run.status !== "ok" || hasFailedFetchJob(jobRun)) return false;
  const details = readDetails(run.details);
  const liveProgress = jobRun ? readFetchJobProgress(jobRun.details) : null;
  const stats = fetchRunStats({ details, liveProgress, run });
  return (
    stats.planned === 0 &&
    stats.read === 0 &&
    stats.synced === 0 &&
    stats.skipped === 0 &&
    stats.failed === 0 &&
    stats.actionNeeded === 0 &&
    run.itemsFetched === 0 &&
    run.tasksGenerated === 0 &&
    run.errorCount === 0
  );
}

function hasActiveFetchProgress(jobRuns: AgentJobRunListItem[]): boolean {
  return jobRuns.some((jobRun) => isActiveJobRun(jobRun) && readFetchJobProgress(jobRun.details));
}

// A run is "in flight" between the two writes: fetch-personal POSTed the row
// (tasks fetched/pending) but sync-builders hasn't PATCHed the per-post
// outcomes yet (which flip them to synced/skipped/failed). If the linked
// runtime job is still active, trust that over the run row's age. The age bound
// is only for unlinked/older rows so a crash mid-work stops being chased after
// a while instead of polling forever.
const INFLIGHT_MAX_AGE_MS = 30 * 60_000;
function isRunInflight(
  run: LibraryFetchRunListItem,
  jobRun?: AgentJobRunListItem | null,
  cronJob?: LibraryCronJobStatus | null,
  suppressStalled = false,
  nowMs = Date.now(),
): boolean {
  if (run.source === "cron" && cronJob && cronJob.status !== "active") return false;
  if (jobRun && (!isActiveJobRun(jobRun) || (!suppressStalled && isStalledJobRun(jobRun, nowMs)))) return false;
  if (!jobRun) {
    const ageMs = nowMs - Date.parse(run.startedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > INFLIGHT_MAX_AGE_MS) return false;
  }
  const tasks = readDetails(run.details).fetchTasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return false;
  const postTasks = tasks.filter(isPlannedPostTask);
  return postTasks.some((task) => task?.status === "pending" || task?.status === "fetched");
}

const FETCH_LOG_PAGE_SIZE = 10;
const SCHEDULED_SLOT_CONTEXT_SIZE = 12;
const LIVE_LOG_STALL_GRACE_MS = 10_000;

type CronSlotStatus = "ok" | "partial" | "failed" | "missed" | "waiting" | "running" | "stalled" | "stopped" | "replaced";

type CronSlot = {
  expectedAt: string;
  windowEnd: string;
  status: CronSlotStatus;
  run: LibraryFetchRunListItem | null;
  jobRun: AgentJobRunListItem | null;
};

type FetchLogRef =
  | { kind: "run"; runId: string }
  | { kind: "job"; instanceId: string };

export type FetchTimelineEntry = {
  key: string;
  time: string;
  status: CronSlotStatus;
  label: string;
  note: string;
  syncSummary: string | null;
  run: LibraryFetchRunListItem | null;
  jobRun: AgentJobRunListItem | null;
  slot: CronSlot | null;
  logRef: FetchLogRef | null;
};

type FetchUpdateStatusKey =
  | "not-connected"
  | "stopped"
  | "syncing"
  | "waiting"
  | "healthy"
  | "needs-attention"
  | "replaced";

type FetchUpdateStatus = {
  key: FetchUpdateStatusKey;
  label: string;
  summary: string;
  style: ReturnType<typeof statusStyle>;
};

export function fetchCronFrequencyLabel(cronJob: LibraryCronJobStatus | null): string {
  if (!cronJob) return "Not scheduled";
  if (cronJob.status !== "active") return "Stopped";
  return cronJob.frequencyLabel || "Scheduled";
}

function slotDomId(slot: CronSlot): string {
  return `fetch-slot-${Date.parse(slot.expectedAt)}`;
}

function runDomId(runId: string): string {
  return `fetch-run-${runId}`;
}

function jobRunDomId(instanceId: string): string {
  return `fetch-job-run-${instanceId}`;
}

function cronGraceMs(cronJob: LibraryCronJobStatus): number {
  const minutes = Math.min(30, Math.max(5, Math.round(cronJob.intervalMinutes * 0.1)));
  return minutes * 60_000;
}

function isActiveJobRun(jobRun: AgentJobRunListItem): boolean {
  return jobRun.status === "starting" || jobRun.status === "running";
}

function jobRunByInstanceId(jobRuns: AgentJobRunListItem[]): Map<string, AgentJobRunListItem> {
  return new Map(jobRuns.map((jobRun) => [jobRun.instanceId, jobRun]));
}

function mergeFetchRunLists(...runLists: LibraryFetchRunListItem[][]): LibraryFetchRunListItem[] {
  const byId = new Map<string, LibraryFetchRunListItem>();
  for (const run of runLists.flat()) {
    byId.set(run.id, run);
  }
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function mergeAgentJobRunLists(...runLists: AgentJobRunListItem[][]): AgentJobRunListItem[] {
  const byId = new Map<string, AgentJobRunListItem>();
  for (const run of runLists.flat()) {
    const existing = byId.get(run.id);
    const existingUpdatedMs = existing ? Date.parse(existing.updatedAt) : Number.NEGATIVE_INFINITY;
    const runUpdatedMs = Date.parse(run.updatedAt);
    if (!existing || !Number.isFinite(existingUpdatedMs) || !Number.isFinite(runUpdatedMs) || runUpdatedMs >= existingUpdatedMs) {
      byId.set(run.id, run);
    }
  }
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function oldestFetchHistoryCursor(
  runs: LibraryFetchRunListItem[],
  jobRuns: AgentJobRunListItem[],
  scheduledJobRuns: AgentJobRunListItem[],
): string | null {
  const runTimes = runs
    .map((run) => Date.parse(run.startedAt))
    .filter(Number.isFinite);
  const fallbackJobTimes = [...jobRuns, ...scheduledJobRuns]
    .map((run) => Date.parse(run.expectedAt ?? run.startedAt))
    .filter(Number.isFinite);
  const times = runTimes.length > 0 ? runTimes : fallbackJobTimes;
  if (times.length === 0) return null;
  return new Date(Math.min(...times)).toISOString();
}

function shouldLoadMoreHistory(container: HTMLDivElement): boolean {
  return container.scrollTop + container.clientHeight >= container.scrollHeight - 48;
}

function isStalledJobRun(jobRun: AgentJobRunListItem, nowMs = Date.now()): boolean {
  if (!isActiveJobRun(jobRun)) return false;
  const heartbeatMs = Date.parse(jobRun.heartbeatAt ?? jobRun.startedAt);
  return Number.isFinite(heartbeatMs) && nowMs - heartbeatMs > 2 * 60_000;
}

function isStoppedJobRun(jobRun: AgentJobRunListItem): boolean {
  return jobRun.status === "killed" || jobRun.status === "stale";
}

function jobRunSlotStatus(jobRun: AgentJobRunListItem, nowMs = Date.now()): CronSlotStatus {
  if (jobRun.status === "succeeded") return "ok";
  if (isStalledJobRun(jobRun, nowMs)) return "stalled";
  if (isActiveJobRun(jobRun)) return "running";
  if (isStoppedJobRun(jobRun)) return "stopped";
  if (jobRun.status === "replaced") return "replaced";
  return "failed";
}

function buildCronStatus(
  cronJob: LibraryCronJobStatus | null,
  runs: LibraryFetchRunListItem[],
  scheduledJobRuns: AgentJobRunListItem[] = [],
  nowMs = Date.now(),
): { slots: CronSlot[]; nextExpectedAt: string | null } {
  if (!cronJob || cronJob.status !== "active" || cronJob.intervalMinutes <= 0) {
    return { slots: [], nextExpectedAt: null };
  }

  const now = new Date(nowMs);
  const firstExpectedAt = firstExpectedSchedule(cronJob);
  const firstExpectedMs = firstExpectedAt?.getTime() ?? Number.NaN;
  const graceMs = cronGraceMs(cronJob);
  const cronRuns = runs
    .filter((run) => run.source === "cron")
    .map((run) => ({ run, startedMs: Date.parse(run.startedAt) }))
    .filter(({ startedMs }) => Number.isFinite(startedMs))
    .sort((a, b) => a.startedMs - b.startedMs);

  let cursor = floorToExpectedSchedule(now, cronJob);
  const nextExpected = addScheduleInterval(cursor, cronJob);
  const expected: Date[] = [];
  for (
    let index = 0;
    index < SCHEDULED_SLOT_CONTEXT_SIZE * 3 && expected.length < SCHEDULED_SLOT_CONTEXT_SIZE;
    index += 1
  ) {
    if (Number.isFinite(firstExpectedMs) && cursor.getTime() >= firstExpectedMs) {
      expected.unshift(new Date(cursor));
    }
    cursor = addScheduleInterval(cursor, cronJob, -1);
  }
  const nextExpectedMs = nextExpected.getTime();
  const expectedTimes = new Set(expected.map((date) => date.getTime()));
  if (
    Number.isFinite(firstExpectedMs) &&
    Number.isFinite(nextExpectedMs) &&
    nextExpectedMs >= firstExpectedMs &&
    nextExpectedMs > nowMs &&
    !expectedTimes.has(nextExpectedMs)
  ) {
    expected.push(nextExpected);
  }

  const slots = expected.map((expectedAt) => {
    const windowEnd = addScheduleInterval(expectedAt, cronJob);
    const expectedMs = expectedAt.getTime();
    const endMs = windowEnd.getTime();
    const match = cronRuns.find(
      ({ startedMs }) => startedMs >= expectedMs - graceMs && startedMs < endMs,
    )?.run ?? null;
    const jobRun = scheduledJobRuns.find((candidate) => {
      if (candidate.trigger !== "scheduled") return false;
      const candidateMs = Date.parse(candidate.expectedAt ?? candidate.startedAt);
      return Number.isFinite(candidateMs) && candidateMs >= expectedMs - graceMs && candidateMs < endMs;
    }) ?? null;
    const matchedJobRun = match && runMatchesJobRun(match, jobRun) ? jobRun : null;
    const status: CronSlotStatus = match
      ? fetchRunSlotStatus(match, matchedJobRun, nowMs)
      : jobRun
        ? jobRunSlotStatus(jobRun, nowMs)
        : nowMs - expectedMs <= graceMs
          ? "waiting"
          : "missed";
    return {
      expectedAt: expectedAt.toISOString(),
      windowEnd: windowEnd.toISOString(),
      status,
      run: match,
      jobRun,
    };
  });

  return { slots, nextExpectedAt: nextExpected.toISOString() };
}

function fetchRunSlotStatus(run: LibraryFetchRunListItem, jobRun?: AgentJobRunListItem | null, nowMs = Date.now()): CronSlotStatus {
  if (run.status === "failed") return "failed";
  const details = readDetails(run.details);
  const liveProgress = jobRun ? readFetchJobProgress(jobRun.details) : null;
  const stats = fetchRunStats({ details, liveProgress, run });
  const completedOutcomes = fetchRunHasCompletedOutcomes(stats);
  if (jobRun && isStalledJobRun(jobRun, nowMs) && !completedOutcomes) return "stalled";
  if (isRunInflight(run, jobRun, null, false, nowMs)) return jobRun ? jobRunSlotStatus(jobRun, nowMs) : "running";
  if (jobRun && !isActiveJobRun(jobRun) && jobRun.status !== "succeeded" && !completedOutcomes) return jobRunSlotStatus(jobRun, nowMs);
  const outcomeStatus = fetchRunOutcomeStatus(run.status, stats);
  if (outcomeStatus === "partial") return "partial";
  if (outcomeStatus !== "ok") return "failed";
  if (run.status === "ok") return "ok";
  return "failed";
}

function runMatchesJobRun(run: LibraryFetchRunListItem | null, jobRun: AgentJobRunListItem | null): boolean {
  return Boolean(run?.jobRunId && jobRun?.instanceId && run.jobRunId === jobRun.instanceId);
}

function timelineSlotRun(slot: CronSlot): LibraryFetchRunListItem | null {
  return slot.run;
}

function timelineSlotLogRef(slot: CronSlot, run: LibraryFetchRunListItem | null): FetchLogRef | null {
  if (slot.run) return { kind: "run", runId: slot.run.id };
  if (run) return { kind: "run", runId: run.id };
  if (slot.jobRun) return { kind: "job", instanceId: slot.jobRun.instanceId };
  return null;
}

function timelineSlotRunNote(slot: CronSlot, run: LibraryFetchRunListItem | null): string {
  const runSummary = run
    ? `${run.itemsFetched} read · ${formatDuration(run.durationMs)}`
    : null;
  return scheduledWindowRunNote({
    jobRunStatus: slot.jobRun ? jobRunStatusLabel(slot.jobRun) : null,
    runSummary,
    runtime: slot.jobRun?.runtime,
  });
}

function formatRunSyncSummary(done: number | undefined, total: number | undefined): string {
  const synced = Math.max(0, done ?? 0);
  const planned = Math.max(0, total ?? 0, synced);
  return `${formatCount(synced)}/${formatCount(planned)} synced`;
}

function hasFinalFetchTaskOutcomes(details: DetailsShape): boolean {
  const fetchTasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  return fetchTasks.filter(isPlannedPostTask).some((task) =>
    task.status === "synced" ||
    task.status === "skipped" ||
    task.status === "failed" ||
    task.status === "action_needed",
  );
}

function fetchRunSyncSummary(
  run: LibraryFetchRunListItem | null,
  jobRun: AgentJobRunListItem | null,
): string {
  const liveProgress = jobRun ? readFetchJobProgress(jobRun.details) : null;
  if (run) {
    const details = readDetails(run.details);
    const stats = fetchRunStats({
      details,
      liveProgress,
      run,
    });
    const hasDetailedPostTasks = Array.isArray(details.fetchTasks) && details.fetchTasks.filter(isPlannedPostTask).length > 0;
    const planned = hasDetailedPostTasks
      ? Math.max(stats.planned, stats.synced)
      : Math.max(stats.planned, run.tasksGenerated, run.itemsFetched, stats.synced);
    const hasLiveSyncedCounter = typeof liveProgress?.counters?.synced === "number";
    const synced =
      stats.synced > 0 ||
      hasLiveSyncedCounter ||
      hasFinalFetchTaskOutcomes(details) ||
      run.status !== "ok"
        ? stats.synced
        : planned;
    return formatRunSyncSummary(synced, planned);
  }
  return formatRunSyncSummary(liveProgress?.counters?.synced, liveProgress?.counters?.tasksPlanned);
}

function timelineSlotSyncSummary(
  run: LibraryFetchRunListItem | null,
  jobRun: AgentJobRunListItem | null,
): string | null {
  if (!run && !jobRun) return null;
  return fetchRunSyncSummary(run, jobRun);
}

export function buildFetchTimeline({
  jobRuns,
  runs,
  slots,
  nowMs = Date.now(),
}: {
  jobRuns: AgentJobRunListItem[];
  runs: LibraryFetchRunListItem[];
  slots: CronSlot[];
  nowMs?: number;
}): FetchTimelineEntry[] {
  const jobsByInstanceId = jobRunByInstanceId(jobRuns);
  const matchedRunIds = new Set<string>();
  const matchedJobInstances = new Set<string>();
  const entries: FetchTimelineEntry[] = slots.map((slot) => {
    const run = timelineSlotRun(slot);
    const runJob = runMatchesJobRun(run, slot.jobRun) ? slot.jobRun : null;
    const logRef = timelineSlotLogRef(slot, run);
    if (run) matchedRunIds.add(run.id);
    if (slot.run) matchedRunIds.add(slot.run.id);
    if (slot.jobRun) matchedJobInstances.add(slot.jobRun.instanceId);
    const triggerLabel = scheduledRunTriggerLabel(slot.jobRun ?? null, "library-cron", run?.source ?? "cron");
    return {
      key: `slot:${slot.expectedAt}`,
      time: slot.expectedAt,
      status: run ? fetchRunSlotStatus(run, runJob, nowMs) : slot.status,
      label: triggerLabel,
      note: timelineSlotRunNote(slot, run),
      syncSummary: timelineSlotSyncSummary(run, run ? runJob : slot.jobRun),
      run,
      jobRun: slot.jobRun,
      slot,
      logRef,
    };
  });

  for (const run of runs) {
    if (matchedRunIds.has(run.id)) continue;
    const jobRun = run.jobRunId ? jobsByInstanceId.get(run.jobRunId) ?? null : null;
    if (jobRun) matchedJobInstances.add(jobRun.instanceId);
    const triggerLabel = scheduledRunTriggerLabel(jobRun ?? null, "library-cron", run.source);
    entries.push({
      key: `run:${run.id}`,
      time: run.startedAt,
      status: fetchRunSlotStatus(run, jobRun, nowMs),
      label: triggerLabel,
      note: `${run.itemsFetched} read · ${formatDuration(run.durationMs)}`,
      syncSummary: fetchRunSyncSummary(run, jobRun),
      run,
      jobRun,
      slot: null,
      logRef: { kind: "run", runId: run.id },
    });
  }

  for (const jobRun of jobRuns) {
    if (matchedJobInstances.has(jobRun.instanceId)) continue;
    entries.push({
      key: `job:${jobRun.instanceId}`,
      time: jobRun.expectedAt ?? jobRun.startedAt,
      status: jobRunSlotStatus(jobRun, nowMs),
      label: scheduledRunTriggerLabel(jobRun, "library-cron"),
      note: scheduledWindowRunNote({
        jobRunStatus: jobRunStatusLabel(jobRun),
        runtime: jobRun.runtime,
      }),
      syncSummary: fetchRunSyncSummary(null, jobRun),
      run: null,
      jobRun,
      slot: null,
      logRef: { kind: "job", instanceId: jobRun.instanceId },
    });
  }

  return entries.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function getFetchActivityStatus(entries: FetchTimelineEntry[]): FetchUpdateStatus {
  const latestLogEntry = entries
    .slice()
    .reverse()
    .find((entry) => Boolean(entry.logRef));

  if (!latestLogEntry) {
    return {
      key: "waiting",
      label: "Idle",
      summary: "No Fetch sources job has started yet.",
      style: statusStyle("partial"),
    };
  }

  if (isNoUpdateFetchRun(latestLogEntry.run, latestLogEntry.jobRun)) {
    return {
      key: "healthy",
      label: "No update",
      summary: "The latest Fetch sources job completed with no new posts to sync.",
      style: statusStyle("ok"),
    };
  }

  const failed = latestLogEntry.status === "failed" ||
    latestLogEntry.status === "missed" ||
    latestLogEntry.status === "stalled";
  const running = latestLogEntry.status === "running";
  const partial = latestLogEntry.status === "partial";
  const label = latestLogEntry.run
    ? scheduledWindowStatusLabel(latestLogEntry.status)
    : latestLogEntry.jobRun
      ? jobRunStatusLabel(latestLogEntry.jobRun)
      : scheduledWindowStatusLabel(latestLogEntry.status);
  const runKind = latestLogEntry.label.toLowerCase();

  return {
    key: failed || partial ? "needs-attention" : running ? "syncing" : latestLogEntry.status === "ok" ? "healthy" : latestLogEntry.status === "stopped" ? "stopped" : latestLogEntry.status === "replaced" ? "replaced" : "waiting",
    label,
    summary: running
      ? `The latest ${runKind} Fetch sources job is running.`
      : `The latest ${runKind} Fetch sources job is ${label.toLowerCase()}.`,
    style: statusStyle(failed ? "failed" : latestLogEntry.status === "ok" ? "ok" : "partial"),
  };
}

export function FetchLogPanel({
  initialRuns,
  initialCronRuns,
  initialJobRuns = [],
  initialScheduledJobRuns = [],
  initialCronJob,
  initialHasMoreHistory = false,
  actions,
  actionsPlacement = "end",
  summaryLanguage,
}: {
  initialRuns: LibraryFetchRunListItem[];
  initialCronRuns: LibraryFetchRunListItem[];
  initialJobRuns?: AgentJobRunListItem[];
  initialScheduledJobRuns?: AgentJobRunListItem[];
  initialCronJob: LibraryCronJobStatus | null;
  initialHasMoreHistory?: boolean;
  actions?: ReactNode;
  actionsPlacement?: "start" | "end";
  summaryLanguage?: string | null;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [cronRuns, setCronRuns] = useState(initialCronRuns);
  const [jobRuns, setJobRuns] = useState(initialJobRuns);
  const [scheduledJobRuns, setScheduledJobRuns] = useState(initialScheduledJobRuns);
  const [cronJob, setCronJob] = useState(initialCronJob);
  const [error, setError] = useState<string | null>(null);
  const [hasMoreFetchHistory, setHasMoreFetchHistory] = useState(initialHasMoreHistory);
  const [isLoadingFetchHistory, setIsLoadingFetchHistory] = useState(false);
  const [, startTransition] = useTransition();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<FetchLogRef | null>(null);
  const [liveLogSuppressStalled, setLiveLogSuppressStalled] = useState(false);
  const cronStatus = useMemo(
    () => buildCronStatus(cronJob, cronRuns, scheduledJobRuns),
    [cronJob, cronRuns, scheduledJobRuns],
  );
  const timelineEntries = useMemo(
    () => buildFetchTimeline({ jobRuns, runs, slots: cronStatus.slots }),
    [cronStatus.slots, jobRuns, runs],
  );
  const dialogRuns = useMemo(() => mergeFetchRunLists(runs, cronRuns), [runs, cronRuns]);
  const activityStatus = useMemo(
    () => getFetchActivityStatus(timelineEntries),
    [timelineEntries],
  );
  const actionsNode = actions ? (
    <div className="digest-updates-actions">
      {actions}
    </div>
  ) : null;
  // Latest runs, readable inside the poll loop without re-arming the interval
  // on every refresh. Synced in an effect (not during render) so the poll loop
  // sees fresh data while keeping the [refresh]-only effect stable.
  const runsRef = useRef(runs);
  const jobRunsRef = useRef(jobRuns);
  const cronJobRef = useRef(cronJob);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  useEffect(() => {
    jobRunsRef.current = jobRuns;
  }, [jobRuns]);
  useEffect(() => {
    cronJobRef.current = cronJob;
  }, [cronJob]);

  const refresh = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/skill/fetch-runs", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as
          | {
              runs?: LibraryFetchRunListItem[];
              cronRuns?: LibraryFetchRunListItem[];
              jobRuns?: AgentJobRunListItem[];
              scheduledJobRuns?: AgentJobRunListItem[];
              cronJob?: LibraryCronJobStatus | null;
              hasMore?: boolean;
              error?: string;
            }
          | null;
        if (response.status === 401) {
          setError(null);
          return;
        }
        if (!response.ok) {
          setError(body?.error ?? "Could not refresh. Try again.");
          return;
        }
        const bodyRuns = Array.isArray(body?.runs) ? body.runs : [];
        const bodyCronRuns = Array.isArray(body?.cronRuns) ? body.cronRuns : [];
        const bodyJobRuns = Array.isArray(body?.jobRuns) ? body.jobRuns : [];
        const bodyScheduledJobRuns = Array.isArray(body?.scheduledJobRuns) ? body.scheduledJobRuns : [];
        setRuns((current) => mergeFetchRunLists(current, bodyRuns));
        setCronRuns((current) => mergeFetchRunLists(current, bodyCronRuns));
        setJobRuns((current) => mergeAgentJobRunLists(current, bodyJobRuns));
        setScheduledJobRuns((current) => mergeAgentJobRunLists(current, bodyScheduledJobRuns));
        setHasMoreFetchHistory(Boolean(body?.hasMore ?? bodyRuns.length === FETCH_LOG_PAGE_SIZE));
        setCronJob(body?.cronJob ?? null);
      } catch {
        setError("Could not refresh. Try again.");
      }
    });
  }, []);

  const openLog = useCallback((logRef: FetchLogRef) => {
    setDetailsOpen(true);
    setSelectedLog(logRef);
    setLiveLogSuppressStalled(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedLog) return;
    if (typeof window === "undefined") return;
    const id = window.setTimeout(() => setLiveLogSuppressStalled(false), LIVE_LOG_STALL_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [refresh, selectedLog]);

  const loadMoreHistory = useCallback(async () => {
    if (isLoadingFetchHistory || !hasMoreFetchHistory) return;
    const cursor = oldestFetchHistoryCursor(runs, jobRuns, scheduledJobRuns);
    if (!cursor) {
      setHasMoreFetchHistory(false);
      return;
    }
    setIsLoadingFetchHistory(true);
    setError(null);
    try {
      const response = await fetch(`/api/skill/fetch-runs?before=${encodeURIComponent(cursor)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body = (await response.json().catch(() => null)) as
        | {
            runs?: LibraryFetchRunListItem[];
            cronRuns?: LibraryFetchRunListItem[];
            jobRuns?: AgentJobRunListItem[];
            scheduledJobRuns?: AgentJobRunListItem[];
            cronJob?: LibraryCronJobStatus | null;
            hasMore?: boolean;
            error?: string;
          }
        | null;
      if (response.status === 401) {
        setHasMoreFetchHistory(false);
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "Could not load older logs. Try again.");
        return;
      }
      const bodyRuns = Array.isArray(body?.runs) ? body.runs : [];
      const bodyCronRuns = Array.isArray(body?.cronRuns) ? body.cronRuns : [];
      const bodyJobRuns = Array.isArray(body?.jobRuns) ? body.jobRuns : [];
      const bodyScheduledJobRuns = Array.isArray(body?.scheduledJobRuns) ? body.scheduledJobRuns : [];
      const loadedCount =
        bodyRuns.length + bodyCronRuns.length + bodyJobRuns.length + bodyScheduledJobRuns.length;
      setRuns((current) => mergeFetchRunLists(current, bodyRuns));
      setCronRuns((current) => mergeFetchRunLists(current, bodyCronRuns));
      setJobRuns((current) => mergeAgentJobRunLists(current, bodyJobRuns));
      setScheduledJobRuns((current) => mergeAgentJobRunLists(current, bodyScheduledJobRuns));
      setCronJob(body?.cronJob ?? null);
      setHasMoreFetchHistory(
        loadedCount > 0 && Boolean(body?.hasMore ?? bodyRuns.length === FETCH_LOG_PAGE_SIZE),
      );
    } catch {
      setError("Could not load older logs. Try again.");
    } finally {
      setIsLoadingFetchHistory(false);
    }
  }, [hasMoreFetchHistory, isLoadingFetchHistory, jobRuns, runs, scheduledJobRuns]);

  // Keep relative timestamps approximately fresh while the panel is
  // open without re-fetching. Honor reduced-motion by skipping the
  // interval — the value still updates on refresh / re-mount.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-refresh so a run's status flips (fetched/pending → synced) appear
  // without a manual click. Poll fast while a run is mid-sync, slowly otherwise,
  // and never while the tab is hidden (saves requests and respects rate limits).
  // Unlike the timestamp tick above, this is data, not motion — so it runs
  // regardless of prefers-reduced-motion.
  const POLL_ACTIVE_PROGRESS_MS = 3_000;
  const POLL_INFLIGHT_MS = 8_000;
  const POLL_IDLE_MS = 45_000;
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let timer = 0;

    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") refresh();
      schedule();
    };
    const schedule = () => {
      const jobsByInstanceId = jobRunByInstanceId(jobRunsRef.current);
      const inflight = runsRef.current.some((run) =>
          isRunInflight(run, run.jobRunId ? jobsByInstanceId.get(run.jobRunId) : null, cronJobRef.current),
        ) ||
        jobRunsRef.current.some((run) => isActiveJobRun(run));
      const activeProgress = hasActiveFetchProgress(jobRunsRef.current);
      timer = window.setTimeout(
        tick,
        activeProgress ? POLL_ACTIVE_PROGRESS_MS : inflight ? POLL_INFLIGHT_MS : POLL_IDLE_MS,
      );
    };
    // Refresh immediately when the user returns to the tab so they don't wait a
    // full interval to see what changed while it was hidden.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    const initialRefresh = window.setTimeout(() => {
      if (document.visibilityState === "visible") refresh();
    }, 0);
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(initialRefresh);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    function refreshWhenContentChanges() {
      if (document.visibilityState === "visible") refresh();
    }

    window.addEventListener(contentSyncStateChanged, refreshWhenContentChanges);
    return () => {
      window.removeEventListener(contentSyncStateChanged, refreshWhenContentChanges);
    };
  }, [refresh]);

  return (
    <section className="fb-panel digest-updates-panel">
      <div className="digest-updates-head">
        <div className="source-fetch-overview">
          {actionsPlacement === "start" ? actionsNode : null}
          <SourceFetchMetaGrid
            cronJob={cronJob}
            detailsOpen={detailsOpen}
            latestRun={runs[0] ?? null}
            onToggleDetails={() => setDetailsOpen((value) => !value)}
            status={activityStatus}
            summaryLanguage={summaryLanguage}
          />
        </div>
        {actionsPlacement === "end" ? actionsNode : null}
      </div>

      {error ? (
        <p className="sync-panel-error">{error}</p>
      ) : null}

      {detailsOpen ? (
        <div id="fetch-sync-details">
          <FetchStatusPanel
            entries={timelineEntries}
            hasMoreHistory={hasMoreFetchHistory}
            isLoadingHistory={isLoadingFetchHistory}
            onLoadMoreHistory={loadMoreHistory}
            onOpenLog={openLog}
          />
        </div>
      ) : null}
      {selectedLog ? (
        <FetchLogDialog
          cronJob={cronJob}
          jobRuns={jobRuns}
          logRef={selectedLog}
          onClose={() => {
            setSelectedLog(null);
            setLiveLogSuppressStalled(false);
          }}
          runs={dialogRuns}
          suppressStalled={liveLogSuppressStalled}
        />
      ) : null}
    </section>
  );
}

export function getFetchUpdateStatus(
  cronJob: LibraryCronJobStatus | null,
  slots: CronSlot[],
  runs: LibraryFetchRunListItem[],
  jobRuns: AgentJobRunListItem[] = [],
): FetchUpdateStatus {
  if (!cronJob) {
    const jobsByInstanceId = jobRunByInstanceId(jobRuns);
    const activeRun = runs.find((run) =>
      isRunInflight(run, run.jobRunId ? jobsByInstanceId.get(run.jobRunId) : null, null),
    );
    const activeJob = jobRuns.find(isActiveJobRun);
    if (activeRun || activeJob) {
      return {
        key: "syncing",
        label: "Running",
        summary: "A one-time Fetch sources run is active.",
        style: statusStyle("partial"),
      };
    }
    const latestRun = runs[0] ?? null;
    if (latestRun) {
      const latestJobRun = latestRun.jobRunId ? jobsByInstanceId.get(latestRun.jobRunId) ?? null : null;
      const latestRunStatus = fetchRunSlotStatus(latestRun, latestJobRun);
      if (latestRunStatus === "ok") {
        return {
          key: "healthy",
          label: "OK",
          summary: "The latest one-time Fetch sources run completed. No schedule is connected.",
          style: statusStyle("ok"),
        };
      }
      if (latestRunStatus === "partial") {
        return {
          key: "needs-attention",
          label: "Partial",
          summary: "The latest one-time Fetch sources run completed with some planned posts needing follow-up.",
          style: statusStyle("partial"),
        };
      }
      return {
        key: "needs-attention",
        label: "Needs attention",
        summary: "The latest one-time Fetch sources run did not finish successfully.",
        style: statusStyle("failed"),
      };
    }
    return {
      key: "not-connected",
      label: "Not connected",
      summary: "No Fetch sources run yet.",
      style: statusStyle("partial"),
    };
  }
  if (cronJob.status !== "active") {
    return {
      key: "stopped",
      label: "Stopped",
      summary: "The recurring schedule for Fetch sources is stopped.",
      style: statusStyle("partial"),
    };
  }
  const jobsByInstanceId = jobRunByInstanceId(jobRuns);
  const activeRun = runs.find((run) => {
    const jobRun = run.jobRunId ? jobsByInstanceId.get(run.jobRunId) ?? null : null;
    if (jobRun && jobRun.trigger !== "scheduled") return false;
    if (!jobRun && run.source !== "cron") return false;
    return isRunInflight(run, jobRun, cronJob);
  });
  if (activeRun) {
    return {
      key: "syncing",
      label: "Syncing",
      summary: "A Fetch sources run is still syncing post results.",
      style: statusStyle("partial"),
    };
  }

  const latestDueSlot = slots.slice().reverse().find((slot) => Date.parse(slot.expectedAt) <= Date.now()) ?? null;
  const latestSlot = latestDueSlot ?? null;
  if (latestSlot?.status === "running") {
    return {
      key: "syncing",
      label: "Running",
      summary: "The current scheduled Fetch sources run is still in progress.",
      style: statusStyle("partial"),
    };
  }
  if (latestSlot?.status === "waiting") {
    return {
      key: "waiting",
      label: "Waiting",
      summary: "The next scheduled Fetch sources run has not started yet.",
      style: statusStyle("partial"),
    };
  }
  if (latestSlot?.status === "stalled") {
    return {
      key: "needs-attention",
      label: "Needs attention",
      summary: "FollowBrief lost contact with the latest scheduled Fetch sources run.",
      style: statusStyle("failed"),
    };
  }
  if (latestSlot?.status === "partial") {
    return {
      key: "needs-attention",
      label: "Partial",
      summary: "The latest scheduled Fetch sources run completed with some planned posts needing follow-up.",
      style: statusStyle("partial"),
    };
  }
  if (latestSlot?.status === "stopped") {
    return {
      key: "stopped",
      label: "Stopped",
      summary: "The latest scheduled Fetch sources run was stopped before final sync outcomes arrived.",
      style: statusStyle("partial"),
    };
  }
  if (latestSlot?.status === "replaced") {
    return {
      key: "replaced",
      label: "Replaced",
      summary: "A newer Fetch sources run replaced the previous local job.",
      style: statusStyle("partial"),
    };
  }

  const latestResolved = latestResolvedSlotStatus(slots);
  if (latestResolved === "partial") {
    return {
      key: "needs-attention",
      label: "Partial",
      summary: "The latest scheduled Fetch sources run completed with some planned posts needing follow-up.",
      style: statusStyle("partial"),
    };
  }
  if (latestResolved === "missed" || latestResolved === "failed") {
    return {
      key: "needs-attention",
      label: "Needs attention",
      summary:
        latestResolved === "missed"
          ? "No Fetch sources run started in the latest scheduled window."
          : "The latest scheduled Fetch sources run did not finish successfully.",
      style: statusStyle("failed"),
    };
  }
  if (latestResolved === "ok") {
    return {
      key: "healthy",
      label: "Healthy",
      summary: "Recent scheduled Fetch sources runs are completing successfully.",
      style: statusStyle("ok"),
    };
  }

  return {
    key: "waiting",
    label: "Waiting",
    summary: "The schedule is active; the first expected run has not finished yet.",
    style: statusStyle("partial"),
  };
}

function FetchStatusToggle({
  detailsOpen,
  onToggle,
  status,
}: {
  detailsOpen: boolean;
  onToggle: () => void;
  status: FetchUpdateStatus;
}) {
  const Icon = detailsOpen ? ChevronUp : ChevronDown;
  return (
    <button
      aria-controls="fetch-sync-details"
      aria-expanded={detailsOpen}
      className={`fb-chip digest-status-toggle ${statusToneClass(fetchUpdateStatusTone(status))}`}
      onClick={onToggle}
      title={detailsOpen ? "Hide Fetch sources status log" : "Show Fetch sources status log"}
      type="button"
    >
      {status.label}
      <span aria-hidden="true" className="digest-status-toggle-hint">Details</span>
      <Icon aria-hidden="true" />
    </button>
  );
}

function SourceFetchMetaGrid({
  cronJob,
  detailsOpen,
  latestRun,
  onToggleDetails,
  status,
  summaryLanguage,
}: {
  cronJob: LibraryCronJobStatus | null;
  detailsOpen: boolean;
  latestRun: LibraryFetchRunListItem | null;
  onToggleDetails: () => void;
  status: FetchUpdateStatus;
  summaryLanguage?: string | null;
}) {
  const scheduleLanguage =
    cronJob?.status === "active" ? formatLanguage(summaryLanguage ?? "zh") : "N/A";

  return (
    <dl className="fb-hub-digest-meta source-fetch-meta" aria-label="Fetch sources details">
      <SourceFetchMetaItem
        label="Fetch frequency"
        value={fetchCronFrequencyLabel(cronJob)}
      />
      <SourceFetchMetaItem
        label="Language"
        value={scheduleLanguage}
      />
      <SourceFetchMetaItem
        label="Latest fetch"
        value={<RelativeTime value={latestRun?.startedAt} fallback="None yet" />}
      />
      <div className="fb-hub-digest-meta-item source-fetch-status-item">
        <dt>Status / log</dt>
        <dd>
          <FetchStatusToggle
            detailsOpen={detailsOpen}
            onToggle={onToggleDetails}
            status={status}
          />
        </dd>
      </div>
    </dl>
  );
}

function SourceFetchMetaItem({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="fb-hub-digest-meta-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FetchStatusPanel({
  entries,
  hasMoreHistory,
  isLoadingHistory,
  onLoadMoreHistory,
  onOpenLog,
}: {
  entries: FetchTimelineEntry[];
  hasMoreHistory: boolean;
  isLoadingHistory: boolean;
  onLoadMoreHistory: () => void;
  onOpenLog: (logRef: FetchLogRef) => void;
}) {
  const hydrated = useHydrated();
  const rowEntries = useMemo(() => entries.slice().reverse(), [entries]);
  const hasScrollCue = rowEntries.length > 3 || hasMoreHistory || isLoadingHistory;
  const handleLogScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (hasMoreHistory && !isLoadingHistory && shouldLoadMoreHistory(event.currentTarget)) {
      onLoadMoreHistory();
    }
  }, [hasMoreHistory, isLoadingHistory, onLoadMoreHistory]);
  if (entries.length === 0) {
    return (
      <EmptyState
        className="sync-panel-empty is-dashed"
        title="No Fetch sources history yet"
        body="Copy a Fetch sources prompt to create history."
      />
    );
  }

  return (
    <div className="sync-panel-card">
      <div className="sync-panel-layout is-log-only">

        {entries.length > 0 ? (
          <div className="sync-panel-column">
            <div className={`sync-panel-scroll-cue${hasScrollCue ? " has-more" : ""}`}>
              <div className="sync-panel-slot-rows is-scrollable is-timeline" onScroll={handleLogScroll}>
                {rowEntries.map((entry) => (
                  <FetchTimelineRow
                    entry={entry}
                    hydrated={hydrated}
                    key={entry.key}
                    onOpenLog={onOpenLog}
                  />
                ))}
                {isLoadingHistory ? (
                  <div className="sync-panel-slot-loading" role="status">
                    <span aria-hidden="true" className="sync-panel-slot-loading-line" />
                    <span>Loading older logs</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            className="sync-panel-slot-empty"
            title="No Fetch sources history yet"
            body="Copy a Fetch sources prompt to create history."
          />
        )}
      </div>
    </div>
  );
}

function FetchTimelineRow({
  entry,
  hydrated,
  onOpenLog,
}: {
  entry: FetchTimelineEntry;
  hydrated: boolean;
  onOpenLog: (logRef: FetchLogRef) => void;
}) {
  const tone = statusTone(scheduledWindowStyleStatus(entry.status));
  const noUpdate = isNoUpdateFetchRun(entry.run, entry.jobRun);
  const displayTone = noUpdate ? "ok" : tone;
  const statusLabel = noUpdate ? "No update" : scheduledWindowStatusLabel(entry.status);
  const id = entry.slot ? slotDomId(entry.slot) : entry.run ? runDomId(entry.run.id) : entry.jobRun ? jobRunDomId(entry.jobRun.instanceId) : undefined;
  return (
    <div
      className="sync-panel-slot-row"
      data-sync-log-row="true"
      id={id}
    >
      <div className="sync-panel-slot-row-main">
        <div className="sync-panel-slot-row-primary">
          <span className={`sync-panel-slot-row-status ${statusToneClass(displayTone)}`}>
            <span
              aria-hidden="true"
              className="sync-panel-slot-row-dot"
            />
            {statusLabel}
          </span>
          <span className="sync-panel-slot-row-kind">{entry.label}</span>
        </div>
        <div className="sync-panel-slot-row-secondary">
          <time
            className="sync-panel-slot-row-time"
            dateTime={entry.time}
            title={formatAbsolute(entry.time)}
          >
            {hydrated ? formatRelative(entry.time) : formatAbsolute(entry.time)}
          </time>
          {entry.syncSummary ? (
            <span className="mono sync-panel-slot-row-note">{entry.syncSummary}</span>
          ) : null}
        </div>
      </div>
      <div className="sync-panel-slot-row-side">
        {entry.logRef ? (
          <button
            className="fb-btn light compact"
            onClick={() => onOpenLog(entry.logRef!)}
            type="button"
          >
            Details
          </button>
        ) : null}
      </div>
    </div>
  );
}

function jobRunLabel(jobRun: AgentJobRunListItem): string {
  return scheduledRunTriggerLabel(jobRun, "library-cron");
}

function jobRunStatusLabel(jobRun: AgentJobRunListItem): string {
  if (jobRun.status === "killed" || jobRun.status === "stale") return "Stopped";
  return scheduledJobRunStatusLabel(jobRun.status);
}

function interruptedFetchRunStatus(jobRun?: AgentJobRunListItem | null, suppressStalled = false): {
  label: string;
  style: ReturnType<typeof statusStyle>;
  tone: StatusTone;
} | null {
  if (!jobRun || jobRun.status === "succeeded") return null;
  if (!suppressStalled && isStalledJobRun(jobRun)) {
    return { label: "Stalled", style: statusStyle("failed"), tone: "failed" };
  }
  if (isActiveJobRun(jobRun)) return null;
  if (isStoppedJobRun(jobRun)) {
    return { label: "Stopped", style: statusStyle("partial"), tone: "partial" };
  }
  if (jobRun.status === "replaced") {
    return { label: "Replaced", style: statusStyle("partial"), tone: "partial" };
  }
  return { label: jobRunStatusLabel(jobRun), style: statusStyle("failed"), tone: "failed" };
}

export function fetchRunDisplayState({
  completedOutcomes,
  inflight,
  jobRun,
  noUpdate = false,
  outcomeStatus,
  runStatus,
  suppressStalled = false,
}: {
  completedOutcomes: boolean;
  inflight: boolean;
  jobRun?: AgentJobRunListItem | null;
  noUpdate?: boolean;
  outcomeStatus?: string;
  runStatus: string;
  suppressStalled?: boolean;
}) {
  const interruptedStatus = interruptedFetchRunStatus(jobRun, suppressStalled);
  const completedInterruptedLabel = !inflight && completedOutcomes
    ? interruptedStatus?.label ?? null
    : null;
  const displayRunStatus = outcomeStatus ?? runStatus;
  const displayStatus = inflight
    ? { label: "Syncing", style: statusStyle("partial"), tone: "partial" as const }
    : noUpdate
      ? { label: "No update", style: statusStyle("ok"), tone: "ok" as const }
    : interruptedStatus && !completedOutcomes
      ? interruptedStatus
      : {
          label: STATUS_LABEL[displayRunStatus] ?? displayRunStatus,
          style: statusStyle(displayRunStatus),
          tone: statusTone(displayRunStatus),
        };

  return { completedInterruptedLabel, displayStatus };
}

function runHeaderHost(hostname: string | null | undefined): string | null {
  const trimmed = String(hostname ?? "").trim();
  return trimmed ? trimmed.replace(/\.local$/, "") : null;
}

function runHeaderMeta(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

function isInternalJobRunReason(reason: string | null | undefined): boolean {
  return isHiddenFailureReason(reason);
}

type JobRunDiagnosticItem = {
  label: string;
  value: string;
};

function humanizeJobRunCode(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.replace(/_/g, " ");
}

function jobRunDiagnostic(jobRun: AgentJobRunListItem): JobRunDiagnosticItem[] {
  if (jobRun.status === "succeeded") return [];
  const details = readJobRunDetails(jobRun.details);
  const timeoutStage = humanizeJobRunCode(details.timeoutStage);
  const providerError = String(details.providerError ?? "").trim();
  const reason = isInternalJobRunReason(details.reason) ? null : fetchFailureMessage(details.reason);
  return [
    details.timeoutSeconds
      ? { label: "Timeout", value: `Timed out after ${formatDuration(details.timeoutSeconds * 1000)}` }
      : null,
    timeoutStage ? { label: "Stage", value: timeoutStage } : null,
    providerError ? { label: "Provider", value: providerError } : null,
    details.timedOutWorker ? { label: "Worker", value: details.timedOutWorker } : null,
    details.termination === "still_alive_after_kill"
      ? { label: "Cleanup", value: "Cleanup did not finish" }
      : null,
    reason ? { label: "Reason", value: reason } : null,
  ].filter((item): item is JobRunDiagnosticItem => Boolean(item));
}

function jobRunStageLabel(stage: string | null): string | null {
  const normalized = String(stage ?? "").trim();
  if (!normalized || normalized === "heartbeat") return null;
  const labels: Record<string, string> = {
    fetch_sources: "Fetch sources",
    expand_discovery: "Expand discovery",
    shard_fetch_tasks: "Plan fetch tasks",
    run_fetch_workers: "Run fetch workers",
    merge_results: "Merge results",
    validate_results: "Validate results",
    sync_to_followbrief: "Sync to FollowBrief",
    no_update: "No update",
  };
  if (labels[normalized]) return labels[normalized];
  return normalized.replace(/_/g, " ");
}

function ratioText(done: number, total: number, unit: string): string {
  if (total <= 0) return `${formatCount(done)} ${unit}${done === 1 ? "" : "s"}`;
  return `${formatCount(done)} / ${formatCount(total)} ${unit}${total === 1 ? "" : "s"}`;
}

export function fetchRunLifecycleSyncProgress(
  stats: Pick<FetchRunStats, "planned" | "synced" | "skipped" | "failed" | "actionNeeded">,
) {
  const accounted = stats.synced + stats.skipped + stats.failed + stats.actionNeeded;
  return {
    synced: stats.synced,
    accounted,
    outcome: ratioText(stats.synced, stats.planned, "post"),
    accountedText: `${ratioText(accounted, stats.planned, "post")} accounted`,
  };
}

function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

function fetchRunDisplaySummary(run: LibraryFetchRunListItem, stats: FetchRunStats, liveProgress: FetchJobProgress | null): string {
  if (!liveProgress) return displayText(run.summary);
  const sourceCount = Math.max(stats.sourcesTotal, stats.sourcesScanned, run.buildersAttempted);
  const readPart = stats.read > 0
    ? `Read ${countNoun(stats.read, "post")} from ${countNoun(sourceCount, "source")}`
    : `Checked ${countNoun(sourceCount, "source")}`;
  const parts = [readPart];
  if (stats.planned > 0 && stats.planned !== stats.read) {
    parts.push(`${countNoun(stats.planned, "post")} planned`);
  }
  if (stats.actionNeeded > 0) {
    parts.push(`${countNoun(stats.actionNeeded, "action")} needed`);
  }
  if (stats.failed > 0) {
    parts.push(`${countNoun(stats.failed, "post")} failed`);
  }
  return parts.join(" · ");
}

function fetchRunVerdict({
  completedInterruptedLabel,
  displayStatus,
  inflight,
  stats,
}: {
  completedInterruptedLabel?: string | null;
  displayStatus: { label: string };
  inflight: boolean;
  stats: FetchRunStats;
}): { tone: "ok" | "warn" | "fail"; text: string } {
  const accounted = stats.synced + stats.skipped + stats.failed + stats.actionNeeded;
  const unfinished = Math.max(0, stats.planned - accounted);
  if (inflight) {
    return {
      tone: "warn",
      text: "Fetch is running. Stages update as Local Agent reports work.",
    };
  }
  if (displayStatus.label === "Stalled") {
    return {
      tone: "fail",
      text: "Local Agent stopped reporting before final sync outcomes arrived.",
    };
  }
  if (stats.failed > 0 || ["Failed", "Stalled", "Timed out"].includes(displayStatus.label)) {
    if (stats.failed > 0 && unfinished > 0) {
      return {
        tone: "fail",
        text: `${countNoun(stats.failed, "planned post")} failed; ${countNoun(unfinished, "planned post")} did not finish before sync finished.`,
      };
    }
    if (stats.failed > 0) {
      return {
        tone: "fail",
        text: `${countNoun(stats.failed, "planned post")} failed before sync finished.`,
      };
    }
    if (unfinished > 0) {
      return {
        tone: "fail",
        text: `${countNoun(unfinished, "planned post")} did not finish before sync finished.`,
      };
    }
    return {
      tone: "fail",
      text: "Local Agent stopped before FollowBrief received final sync outcomes.",
    };
  }
  if (completedInterruptedLabel) {
    const endedText = completedInterruptedLabel === "Timed out"
      ? "timed out before it exited"
      : `ended as ${completedInterruptedLabel.toLowerCase()}`;
    return {
      tone: "warn",
      text: `FollowBrief received final sync outcomes, but the Local Agent process ${endedText}.`,
    };
  }
  if (stats.actionNeeded > 0) {
    return {
      tone: "warn",
      text: `${formatCount(stats.actionNeeded)} ${stats.actionNeeded === 1 ? "post needs" : "posts need"} Local Agent follow-up before summarizing.`,
    };
  }
  if (displayStatus.label === "No update") {
    return {
      tone: "ok",
      text: "No update. Sources were checked and no new posts needed to be synced.",
    };
  }
  if (stats.planned > 0 && accounted >= stats.planned) {
    return {
      tone: "ok",
      text: "Completed. Planned posts were read, summarized, and synced or accounted for.",
    };
  }
  if (stats.planned > 0) {
    return {
      tone: "warn",
      text: "Planned posts recorded; some still lack final sync outcomes.",
    };
  }
  return {
    tone: "ok",
    text: "Completed. Sources were checked and no post work needed to continue.",
  };
}

function RunCardVerdict({
  details = [],
  text,
  tone,
}: {
  details?: JobRunDiagnosticItem[];
  text: string;
  tone: "ok" | "warn" | "fail";
}) {
  return (
    <div className={`sync-panel-run-card-verdict is-${tone}`}>
      <p className="sync-panel-run-card-verdict-text">{text}</p>
      {details.length > 0 ? (
        <dl className="sync-panel-run-card-diagnostics">
          {details.map((item) => (
            <div key={`${item.label}:${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function RunCardTaskDetails({
  assignmentMayStillBePending,
  details,
  liveProgress,
}: {
  assignmentMayStillBePending: boolean;
  details: DetailsShape;
  liveProgress: FetchJobProgress | null;
}) {
  const displayDetails = fetchDetailsForTaskDisplay(details, liveProgress);
  const postTaskCount = Array.isArray(displayDetails.fetchTasks)
    ? displayDetails.fetchTasks.filter(isPlannedPostTask).length
    : 0;

  return (
    <details className="sync-panel-run-card-details">
      <summary className="sync-panel-run-card-details-summary">
        <span>Post task details</span>
        {postTaskCount > 0 ? (
          <span className="sync-panel-run-card-details-count">
            {formatCount(postTaskCount)}
          </span>
        ) : null}
      </summary>
      <div className="sync-panel-run-card-details-body">
        <DetailsBody
          assignmentMayStillBePending={assignmentMayStillBePending}
          details={displayDetails}
          liveProgress={liveProgress}
        />
      </div>
    </details>
  );
}

function hasRunCardTaskDetails(details: DetailsShape, liveProgress: FetchJobProgress | null): boolean {
  const displayDetails = fetchDetailsForTaskDisplay(details, liveProgress);
  return (
    (Array.isArray(displayDetails.fetchTasks) && displayDetails.fetchTasks.length > 0) ||
    (Array.isArray(displayDetails.userActions) && displayDetails.userActions.length > 0) ||
    (Array.isArray(displayDetails.localErrors) && displayDetails.localErrors.length > 0) ||
    Boolean(displayDetails.cliFlags || displayDetails.error)
  );
}

function lifecycleTone(done: number, total: number, {
  failed = 0,
  warnWhenPartial = true,
}: {
  failed?: number;
  warnWhenPartial?: boolean;
} = {}): Tone {
  if (failed > 0) return "fail";
  if (total <= 0) return "idle";
  if (done >= total) return "ok";
  return warnWhenPartial && done > 0 ? "warn" : "idle";
}

function lifecycleSyncTone(stats: Pick<FetchRunStats, "planned" | "synced" | "skipped" | "failed" | "actionNeeded">): Tone {
  if (stats.failed > 0) return "fail";
  if (stats.planned <= 0) return "idle";
  if (stats.synced >= stats.planned) return "ok";
  if (stats.synced > 0 || stats.skipped > 0 || stats.actionNeeded > 0) return "warn";
  return "idle";
}

function LifecyclePipeline({
  ariaLabel,
  steps,
}: {
  ariaLabel: string;
  steps: LifecycleStep[];
}) {
  return (
    <ol aria-label={ariaLabel} className="sync-panel-lifecycle">
      {steps.map((step, index) => (
        <li key={step.key} className="sync-panel-lifecycle-item">
          <details
            className={`sync-panel-lifecycle-step is-${step.tone}`}
            open={step.open}
          >
            <summary className="sync-panel-lifecycle-summary">
              <span aria-hidden="true" className="sync-panel-lifecycle-dot" />
              <span className="sync-panel-lifecycle-copy">
                <span className="sync-panel-lifecycle-label">{step.label}</span>
                <span className="mono sync-panel-lifecycle-outcome">{step.outcome}</span>
              </span>
              {step.meta ? (
                <span className="mono sync-panel-lifecycle-meta">{step.meta}</span>
              ) : null}
            </summary>
            {step.children ? (
              <div className="sync-panel-lifecycle-detail">{step.children}</div>
            ) : null}
          </details>
          {index < steps.length - 1 ? <span aria-hidden="true" className="sync-panel-lifecycle-rail" /> : null}
        </li>
      ))}
    </ol>
  );
}

function JobLifecycle({
  details,
  progress,
  run,
}: {
  details: DetailsShape;
  progress: FetchJobProgress | null;
  run?: LibraryFetchRunListItem;
}) {
  const stats = fetchRunStats({ details, liveProgress: progress, run });
  const current = progress?.current ?? {};
  const recentEvent = Array.isArray(progress?.recentEvents)
    ? progress?.recentEvents.at(-1)
    : null;
  const stage = progress?.stage ? progress.stage.replace(/_/g, " ") : null;
  const syncProgress = fetchRunLifecycleSyncProgress(stats);
  const steps: LifecycleStep[] = [
    {
      key: "sources",
      label: "Sources scanned",
      outcome: ratioText(stats.sourcesScanned, stats.sourcesTotal, "source"),
      tone: lifecycleTone(stats.sourcesScanned, stats.sourcesTotal),
      open: Boolean(current.source),
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Current source" value={<span>{displayText(current.source, "None")}</span>} />
          {stage ? <FactRow label="Stage" value={<span>{stage}</span>} /> : null}
        </dl>
      ),
    },
    {
      key: "planned",
      label: "Posts planned",
      outcome: ratioText(stats.planned, stats.planned, "post"),
      tone: stats.planned > 0 ? "ok" : "idle",
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Planned posts" value={<span>{formatCount(stats.planned)}</span>} />
          {stats.actionNeeded > 0 ? <FactRow label="Action needed" value={<span>{formatCount(stats.actionNeeded)}</span>} /> : null}
        </dl>
      ),
    },
    {
      key: "read",
      label: "Read",
      outcome: ratioText(stats.read, stats.planned, "post"),
      tone: lifecycleTone(stats.read, stats.planned, { failed: stats.failed }),
      open: progress?.stage === "reading",
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Posts with body" value={<span>{formatCount(stats.read)}</span>} />
          {current.task ? <FactRow label="Current task" value={<span>{displayText(current.task)}</span>} /> : null}
        </dl>
      ),
    },
    {
      key: "summarize",
      label: "Summarize",
      outcome: ratioText(stats.summarized, stats.planned, "post"),
      tone: lifecycleTone(stats.summarized, stats.planned, { failed: stats.failed }),
      open: progress?.stage === "summarizing",
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Summaries ready" value={<span>{formatCount(stats.summaries)}</span>} />
          <FactRow label="Headlines ready" value={<span>{formatCount(stats.headlines)}</span>} />
          <FactRow label="Complete posts" value={<span>{formatCount(stats.summarized)}</span>} />
          {stats.failed > 0 ? <FactRow label="Failed" value={<span className="sync-panel-task-danger">{formatCount(stats.failed)}</span>} /> : null}
        </dl>
      ),
    },
    {
      key: "sync",
      label: "Sync",
      outcome: syncProgress.outcome,
      tone: lifecycleSyncTone(stats),
      open: Boolean(recentEvent?.message || stats.failed || stats.skipped || stats.actionNeeded),
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Synced" value={<span>{formatCount(stats.synced)}</span>} />
          {syncProgress.accounted !== syncProgress.synced ? <FactRow label="Accounted" value={<span>{syncProgress.accountedText}</span>} /> : null}
          {stats.skipped > 0 ? <FactRow label="Skipped" value={<span>{formatCount(stats.skipped)}</span>} /> : null}
          {stats.failed > 0 ? <FactRow label="Failed" value={<span className="sync-panel-task-danger">{formatCount(stats.failed)}</span>} /> : null}
          {stats.actionNeeded > 0 ? <FactRow label="Action needed" value={<span>{formatCount(stats.actionNeeded)}</span>} /> : null}
          {recentEvent?.message ? <FactRow label="Latest event" value={<span>{displayText(recentEvent.message)}</span>} /> : null}
        </dl>
      ),
    },
  ];

  return (
    <div className="sync-panel-live-progress">
      <LifecyclePipeline ariaLabel="Fetch sources job lifecycle" steps={steps} />
    </div>
  );
}

function JobRunCard({
  jobRun,
  domId = jobRunDomId(jobRun.instanceId),
  onOpenLog,
}: {
  jobRun: AgentJobRunListItem;
  domId?: string | null;
  onOpenLog?: () => void;
}) {
  const hydrated = useHydrated();
  const tone = jobRunStatusTone(jobRun);
  const startedAtLabel = hydrated ? formatRelative(jobRun.startedAt) : formatAbsolute(jobRun.startedAt);
  const diagnostic = jobRunDiagnostic(jobRun);
  const liveProgress = readFetchJobProgress(jobRun.details);
  const showRuntimeState = isActiveJobRun(jobRun) || jobRun.status !== "succeeded";
  const headerMeta = runHeaderMeta(
    jobRunLabel(jobRun),
    jobRun.runtime,
    runHeaderHost(jobRun.hostname),
  );
  const fallbackSummary = isActiveJobRun(jobRun)
    ? "The Local Agent has started; no fetch log has been received yet."
    : "The Local Agent ended before FollowBrief received a fetch log.";
  const runtimeStageLabel = jobRunStageLabel(jobRun.stage);
  const runtimeDetails = showRuntimeState && runtimeStageLabel
    ? [
        {
          label: jobRun.finishedAt ? "Last stage" : "Current stage",
          value: runtimeStageLabel,
        },
      ]
    : [];
  const statusDetails = [...runtimeDetails, ...diagnostic];
  const showTaskDetails = hasRunCardTaskDetails({}, liveProgress);
  return (
    <article className="sync-panel-run-card sync-panel-fetch-run-card sync-panel-mobile-flat" id={domId ?? undefined}>
      <header className="sync-panel-run-card-head">
        <div className="sync-panel-run-card-head-main">
          <span className={`fb-chip ${statusToneClass(tone)}`}>
            {jobRunStatusLabel(jobRun)}
          </span>
          <time
            className="sync-panel-run-card-time"
            dateTime={jobRun.startedAt}
            title={formatAbsolute(jobRun.startedAt)}
          >
            {startedAtLabel}
          </time>
        </div>
        {headerMeta ? <div className="sync-panel-run-card-head-meta">{headerMeta}</div> : null}
      </header>
      <p className="sync-panel-run-card-summary">
        {jobRun.summary || fallbackSummary}
      </p>
      <JobLifecycle details={{}} progress={liveProgress} />
      {showTaskDetails ? (
        <RunCardTaskDetails
          assignmentMayStillBePending={isActiveJobRun(jobRun)}
          details={{}}
          liveProgress={liveProgress}
        />
      ) : null}
      {statusDetails.length > 0 ? (
        <RunCardVerdict
          details={statusDetails}
          text={isActiveJobRun(jobRun)
            ? "Fetch is running. Stages update as Local Agent reports work."
            : "Local Agent stopped before FollowBrief received a fetch log."}
          tone={tone === "failed" ? "fail" : "warn"}
        />
      ) : null}
      {onOpenLog ? (
        <div className="sync-panel-run-card-actions">
          <button className="fb-btn light compact" onClick={onOpenLog} type="button">
            Details
          </button>
        </div>
      ) : null}
    </article>
  );
}

function RunCard({
  cronJob,
  jobRun,
  onOpenLog,
  run,
  domId = runDomId(run.id),
  suppressStalled = false,
}: {
  cronJob: LibraryCronJobStatus | null;
  jobRun?: AgentJobRunListItem;
  onOpenLog?: () => void;
  run: LibraryFetchRunListItem;
  domId?: string | null;
  suppressStalled?: boolean;
}) {
  const hydrated = useHydrated();
  const details = readDetails(run.details);
  const inflight = isRunInflight(run, jobRun, cronJob, suppressStalled);
  const liveProgress = jobRun ? readFetchJobProgress(jobRun.details) : null;
  const stats = fetchRunStats({ details, liveProgress, run });
  const completedOutcomes = fetchRunHasCompletedOutcomes(stats);
  const noUpdate = isNoUpdateFetchRun(run, jobRun);
  const outcomeStatus = fetchRunOutcomeStatus(run.status, stats);
  const { completedInterruptedLabel, displayStatus } = fetchRunDisplayState({
    completedOutcomes,
    inflight,
    jobRun,
    noUpdate,
    outcomeStatus,
    runStatus: run.status,
    suppressStalled,
  });
  // Show the Local Agent that ran this fetch. Model names are kept out of the
  // run header because they are not useful for everyday readers.
  const agentLabel =
    details.agentRuntime || jobRun?.runtime || (run.cliVersion ? "Local Agent" : "");
  const headerMeta = runHeaderMeta(
    scheduledRunTriggerLabel(jobRun ?? null, "library-cron", run.source),
    agentLabel,
    runHeaderHost(jobRun?.hostname ?? run.hostname),
  );
  const startedAtLabel = hydrated ? formatRelative(run.startedAt) : formatAbsolute(run.startedAt);
  const displaySummary = fetchRunDisplaySummary(run, stats, liveProgress);
  const verdict = fetchRunVerdict({
    completedInterruptedLabel,
    displayStatus,
    inflight,
    stats,
  });
  const diagnostic = jobRun ? jobRunDiagnostic(jobRun) : [];

  return (
    <article
      className="sync-panel-run-card sync-panel-fetch-run-card sync-panel-mobile-flat"
      id={domId ?? undefined}
    >
      <header className="sync-panel-run-card-head">
        <div className="sync-panel-run-card-head-main">
          <span
            className={`fb-chip ${statusToneClass(displayStatus.tone)}${inflight ? " sync-panel-live-chip" : ""}`}
          >
            {inflight ? (
              <span
                aria-hidden="true"
                className="sync-panel-run-card-live-dot"
              />
            ) : null}
            {displayStatus.label}
          </span>
          <time
            className="sync-panel-run-card-time"
            dateTime={run.startedAt}
            title={formatAbsolute(run.startedAt)}
          >
            {startedAtLabel}
          </time>
        </div>
        {headerMeta ? <div className="sync-panel-run-card-head-meta">{headerMeta}</div> : null}
      </header>

      <p className="sync-panel-run-card-summary">
        {displaySummary}
      </p>

      <RunCardVerdict details={diagnostic} text={verdict.text} tone={verdict.tone} />

      <JobLifecycle details={details} progress={liveProgress} run={run} />
      {onOpenLog ? (
        <div className="sync-panel-run-card-actions">
          <button className="fb-btn light compact" onClick={onOpenLog} type="button">
            Details
          </button>
        </div>
      ) : null}

      <RunCardTaskDetails
        assignmentMayStillBePending={inflight}
        details={details}
        liveProgress={liveProgress}
      />
    </article>
  );
}

function FetchLogDialog({
  cronJob,
  jobRuns,
  logRef,
  onClose,
  runs,
  suppressStalled = false,
}: {
  cronJob: LibraryCronJobStatus | null;
  jobRuns: AgentJobRunListItem[];
  logRef: FetchLogRef;
  onClose: () => void;
  runs: LibraryFetchRunListItem[];
  suppressStalled?: boolean;
}) {
  const jobsByInstanceId = jobRunByInstanceId(jobRuns);
  const jobRun = logRef.kind === "job"
    ? jobsByInstanceId.get(logRef.instanceId) ?? null
    : null;
  const run = logRef.kind === "run"
    ? runs.find((candidate) => candidate.id === logRef.runId) ?? null
    : runs.find((candidate) => candidate.jobRunId === logRef.instanceId) ?? null;
  const resolvedJobRun = jobRun ?? (run?.jobRunId ? jobsByInstanceId.get(run.jobRunId) ?? null : null);
  const usage = readUsageSummary(resolvedJobRun?.details, run?.details);

  return (
    <div className="sync-panel-log-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Fetch log"
        aria-modal="true"
        className="sync-panel-log-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="sync-panel-log-dialog-head">
          <h3>Fetch log</h3>
          <button className="post-action-btn" onClick={onClose} title="Close" type="button">
            <X aria-hidden="true" className="post-action-icon" />
            <span className="sr-only">Close</span>
          </button>
        </header>
        <div className="sync-panel-log-dialog-body">
          <RunUsageSummary usage={usage} />
          {run ? (
            <RunCard
              cronJob={cronJob}
              domId={null}
              jobRun={resolvedJobRun ?? undefined}
              run={run}
              suppressStalled={suppressStalled}
            />
          ) : resolvedJobRun ? (
            <JobRunCard domId={null} jobRun={resolvedJobRun} />
          ) : (
            <EmptyState
              className="sync-panel-empty is-dashed"
              title="Fetch log unavailable"
              body="This run is no longer in the current fetch history."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function taskSourceKey({
  builderId,
  name,
  sourceType,
}: {
  builderId?: string | null;
  name?: string | null;
  sourceType?: string | null;
}) {
  if (builderId) return `builder:${builderId}`;
  return `source:${sourceType ?? "unknown"}:${name ?? "Unknown source"}`;
}

function isPlannedPostTask(task: FetchTaskLog): boolean {
  // Planned means "this run had a post-level task to handle." User-action and
  // token-missing tasks still count here; they are execution blockers, not a
  // reason to erase the post from the run's planned work.
  if (isCandidateDiscoveryTask(task)) return false;
  if (typeof task.id === "string" && task.id.startsWith("fetch_post:")) return true;
  return task.contentStatus === "ready" || task.contentStatus === "requires_agent";
}

function liveProgressTaskDetailStatus(task: FetchTaskProgress): FetchTaskLog["status"] {
  const status = String(task.status ?? "").toLowerCase();
  if (
    status === "synced" ||
    status === "skipped" ||
    status === "failed" ||
    status === "action_needed"
  ) {
    return status;
  }
  return "pending";
}

function liveProgressPostTasks(liveProgress: FetchJobProgress | null): FetchTaskLog[] {
  return (liveProgress?.tasks ?? []).filter(isLivePostTask).map((task) => ({
    id: task.id ?? task.taskId ?? null,
    builder: task.builder ?? null,
    builderId: task.builderId ?? null,
    sourceType: task.sourceType ?? null,
    title: task.title ?? null,
    url: task.url ?? null,
    status: liveProgressTaskDetailStatus(task),
    workerId: task.workerId ?? null,
    bodyChars: task.bodyChars ?? null,
    bodyWords: task.bodyWords ?? null,
    headlineChars: task.headlineChars ?? null,
    headlineWords: task.headlineWords ?? null,
    summaryChars: task.summaryChars ?? null,
    summaryWords: task.summaryWords ?? null,
  }));
}

export function fetchDetailsForTaskDisplay(
  details: DetailsShape,
  liveProgress: FetchJobProgress | null,
): DetailsShape {
  const fetchTasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  if (fetchTasks.some(isPlannedPostTask)) return details;
  const liveTasks = liveProgressPostTasks(liveProgress);
  if (liveTasks.length === 0) return details;
  return {
    ...details,
    fetchTasks: [...fetchTasks, ...liveTasks],
  };
}

function isReadForStats(task: FetchTaskLog): boolean {
  if (!isPlannedPostTask(task) || isBlocked(task)) return false;
  if (typeof task.bodyChars === "number" && task.bodyChars > 0) return true;
  if (isSummaryTranslationTask(task)) return false;
  if (task.contentStatus === "ready" && task.status !== "failed" && task.status !== "skipped") {
    return true;
  }
  return task.status === "synced";
}

function isSummarizedForStats(task: FetchTaskLog): boolean {
  return isPlannedPostTask(task) && !isBlocked(task) && (isSummarized(task) || task.status === "synced");
}

function isSummaryReadyForStats(task: FetchTaskLog): boolean {
  return isPlannedPostTask(task) && !isBlocked(task) && (hasSummary(task) || task.status === "synced");
}

function isHeadlineReadyForStats(task: FetchTaskLog): boolean {
  return isPlannedPostTask(task) && !isBlocked(task) && (hasHeadline(task) || task.status === "synced");
}

function taskSourceGroups(fetchTasks: FetchTaskLog[]): FetchTaskSourceGroup[] {
  const groups = new Map<string, FetchTaskSourceGroup>();
  for (const task of fetchTasks) {
    const key = taskSourceKey({
      builderId: task.builderId,
      name: task.builder,
      sourceType: task.sourceType,
    });
    const existing = groups.get(key);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }
    groups.set(key, {
      key,
      name: displayText(task.builder, "Unknown source"),
      sourceType: task.sourceType || "Unknown source type",
      tasks: [task],
    });
  }
  return [...groups.values()];
}

function missingShardRecord(task: FetchTaskLog): Record<string, unknown> | null {
  const missingShard = task.evidence?.missingShard;
  return missingShard && typeof missingShard === "object"
    ? missingShard as Record<string, unknown>
    : null;
}

function fallbackWorkerId(task: FetchTaskLog): string | null {
  const missingShard = missingShardRecord(task);
  const shard = missingShard?.shard;
  if (typeof shard === "string" && shard.trim()) return shard.trim();
  const resultFile = missingShard?.resultFile;
  if (typeof resultFile === "string" && resultFile.trim()) {
    return resultFile.trim().replace(/-result\.json$/i, "");
  }
  return null;
}

function taskWorkerId(
  task: FetchTaskLog,
  liveTask?: FetchTaskProgress | null,
  shardAssignments?: Map<string, string>,
): string | null {
  const liveWorker = liveTask?.workerId;
  if (typeof liveWorker === "string" && liveWorker.trim()) return liveWorker.trim();
  if (typeof task.workerId === "string" && task.workerId.trim()) return task.workerId.trim();
  const id = typeof task.id === "string" ? task.id : "";
  if (id) {
    const shardWorker = shardAssignments?.get(id);
    if (typeof shardWorker === "string" && shardWorker.trim()) return shardWorker.trim();
  }
  return fallbackWorkerId(task);
}

function taskWorkerGroups(
  fetchTasks: FetchTaskLog[],
  liveTasks: Map<string, FetchTaskProgress>,
  fallbackWorkerName: string,
  workerUsages: Map<string, UsageSummary>,
  shardAssignments: Map<string, string>,
): FetchTaskWorkerGroup[] {
  const groups = new Map<string, FetchTaskWorkerGroup>();
  for (const task of fetchTasks) {
    const liveTask = task.id ? liveTasks.get(task.id) ?? null : null;
    const workerId = taskWorkerId(task, liveTask, shardAssignments);
    const key = workerId ? `worker:${workerId}` : "worker:main";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: workerId ?? fallbackWorkerName,
        usage: workerId ? workerUsages.get(workerId) ?? null : null,
        sourceGroups: [],
        tasks: [],
      };
      groups.set(key, group);
    }
    group.tasks.push(task);
  }

  for (const group of groups.values()) {
    group.sourceGroups = taskSourceGroups(group.tasks);
  }
  return [...groups.values()];
}

function liveProgressNeedsWorkerAssignment(liveProgress: FetchJobProgress | null): boolean {
  const stage = String(liveProgress?.stage ?? "").toLowerCase();
  return stage.includes("worker") || stage.includes("shard") || stage.includes("task");
}

export function fallbackTaskWorkerName(
  liveProgress: FetchJobProgress | null,
  assignmentMayStillBePending: boolean,
): string {
  return assignmentMayStillBePending && liveProgressNeedsWorkerAssignment(liveProgress)
    ? "Worker assignment pending"
    : "Worker unknown";
}

function shardAssignmentMap(shardPlans: FetchTaskShardPlan[] | undefined): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const plan of Array.isArray(shardPlans) ? shardPlans : []) {
    const shard = typeof plan?.shard === "string" ? plan.shard.trim() : "";
    if (!shard) continue;
    for (const task of Array.isArray(plan.tasks) ? plan.tasks : []) {
      const id = typeof task?.id === "string" ? task.id.trim() : "";
      if (id) assignments.set(id, shard);
    }
  }
  return assignments;
}

function groupedTaskStats(tasks: FetchTaskLog[]) {
  const synced = tasks.filter((task) => task.status === "synced").length;
  const skipped = tasks.filter((task) => task.status === "skipped").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const actionNeeded = tasks.filter((task) => task.status === "action_needed" || isBlocked(task)).length;
  return {
    discovery: tasks.filter(isCandidateDiscoveryTask).length,
    planned: tasks.filter(isPlannedPostTask).length,
    synced,
    accounted: synced + skipped + failed + actionNeeded,
    skipped,
    failed,
    actionNeeded,
  };
}

function mergeUsageSummary(left: UsageSummary | null, right: UsageSummary | null): UsageSummary | null {
  if (!left) return right;
  if (!right) return left;
  const sum = (key: "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens" | "totalTokens" | "costUsd") => {
    const leftValue = left[key];
    const rightValue = right[key];
    return leftValue === null && rightValue === null ? null : (leftValue ?? 0) + (rightValue ?? 0);
  };
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    costUsd: sum("costUsd"),
    costEstimated: Boolean(left.costEstimated || right.costEstimated),
    currency: left.currency ?? right.currency,
    provider: left.provider === right.provider ? left.provider : left.provider ?? right.provider,
    model: left.model === right.model ? left.model : left.model ?? right.model,
    source: left.source ?? right.source,
  };
}

function workerUsageMap(workerUsages: FetchTaskWorkerUsage[] | undefined): Map<string, UsageSummary> {
  const byWorkerId = new Map<string, UsageSummary>();
  for (const value of Array.isArray(workerUsages) ? workerUsages : []) {
    const workerId = typeof value?.workerId === "string" ? value.workerId.trim() : "";
    if (!workerId) continue;
    const usage = readUsageSummary(value.usage, value);
    if (!usage) continue;
    byWorkerId.set(workerId, mergeUsageSummary(byWorkerId.get(workerId) ?? null, usage) ?? usage);
  }
  return byWorkerId;
}

function formatInlineUsage(usage: UsageSummary | null): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.totalTokens !== null) parts.push(`${formatUsageTokens(usage.totalTokens)} tokens`);
  if (usage.costUsd !== null) parts.push(formatUsageCost(usage));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function DetailsBody({
  assignmentMayStillBePending,
  details,
  liveProgress,
}: {
  assignmentMayStillBePending: boolean;
  details: DetailsShape;
  liveProgress: FetchJobProgress | null;
}) {
  const userActions = Array.isArray(details.userActions) ? details.userActions : [];
  const localErrors = Array.isArray(details.localErrors) ? details.localErrors : [];
  const fetchTasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  const postTasks = fetchTasks.filter(isPlannedPostTask);
  const liveTasks = fetchTaskProgressMap(liveProgress);
  const taskGroups = taskWorkerGroups(
    postTasks,
    liveTasks,
    fallbackTaskWorkerName(liveProgress, assignmentMayStillBePending),
    workerUsageMap(details.workerUsages),
    shardAssignmentMap(details.shardPlans),
  );

  return (
    <div className="sync-panel-run-card-details-stack">
      {postTasks.length > 0 ? (
        <div>
          <ul className="sync-panel-task-worker-group-list">
            {taskGroups.map((workerGroup) => {
              const usageText = formatInlineUsage(workerGroup.usage);
              return (
                <li className="sync-panel-task-worker-group" key={workerGroup.key}>
                  <details className="sync-panel-task-worker-details" open>
                    <summary className="sync-panel-task-worker-summary">
                      <span className="sync-panel-task-worker-name">{displayText(workerGroup.name)}</span>
                      {usageText ? (
                        <span
                          aria-label={`${displayText(workerGroup.name)}: ${usageText}`}
                          className="sync-panel-task-worker-meta"
                        >
                          {usageText}
                        </span>
                      ) : null}
                    </summary>
                    <ul className="sync-panel-task-source-group-list">
                      {workerGroup.sourceGroups.map((group) => {
                        const stats = groupedTaskStats(group.tasks);
                        return (
                          <li className="sync-panel-task-source-group" key={group.key}>
                            <details className="sync-panel-task-source-details" open>
                              <summary className="sync-panel-task-source-summary">
                                <span className="sync-panel-task-source-name">{displayText(group.name)}</span>
                                <span
                                  aria-label={`${displayText(group.name)}: ${stats.planned} planned, ${stats.synced} synced${stats.failed > 0 ? `, ${stats.failed} failed` : ""}`}
                                  className="sync-panel-task-source-meta"
                                >
                                  <span className="sync-panel-task-source-stat">
                                    <strong>{formatCount(stats.planned)}</strong> planned
                                  </span>
                                  <span className="sync-panel-task-source-stat">
                                    <strong>{formatCount(stats.synced)}</strong> synced
                                  </span>
                                  {stats.failed > 0 ? (
                                    <span className="sync-panel-task-source-stat is-danger">
                                      <strong>{formatCount(stats.failed)}</strong> failed
                                    </span>
                                  ) : null}
                                </span>
                              </summary>
                              <ul className="sync-panel-run-card-candidate-list">
                                {group.tasks.map((task, index) => (
                                  <TaskRow
                                    key={task.id ?? `${task.builderId ?? "task"}-${index}`}
                                    groupTasks={group.tasks}
                                    liveTask={task.id ? liveTasks.get(task.id) ?? null : null}
                                    liveTasks={liveTasks}
                                    task={task}
                                  />
                                ))}
                              </ul>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {userActions.length > 0 ? (
        <div>
          <h3 className="sync-panel-run-card-detail-heading">
            Actions needed
          </h3>
          <ul className="sync-panel-detail-action-list">
            {userActions.map((action, index) => (
              <li key={`${action.kind ?? "action"}-${index}`} className="sync-panel-detail-action-row">
                <span className="fb-chip sync-panel-detail-action-chip">{action.kind ?? "action"}</span>
                <span className="sync-panel-detail-action-builder">{displayText(action.builder)}</span>
                {action.message ? (
                  <span className="sync-panel-detail-action-message">: {displayText(action.message)}</span>
                ) : null}
                {action.helpUrl ? (
                  <>
                    {" "}
                    <a
                      className="sync-panel-detail-link"
                      href={action.helpUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Learn more
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {localErrors.length > 0 ? (
        <div>
          <h3 className="sync-panel-run-card-detail-heading">
            Local errors
          </h3>
          <ul className="sync-panel-detail-error-list">
            {localErrors.map((message, index) => (
              <li
                key={`${message.slice(0, 32)}-${index}`}
                className="mono sync-panel-detail-error-row"
              >
                {displayText(message)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {details.cliFlags ? (
        <details className="sync-panel-detail-card">
          <summary className="sync-panel-detail-card-summary">
            CLI flags
          </summary>
          <pre className="mono sync-panel-detail-json">
            {JSON.stringify(details.cliFlags, null, 2)}
          </pre>
        </details>
      ) : null}

      {details.error ? (
        <details className="sync-panel-detail-card">
          <summary
            className="sync-panel-detail-card-summary is-danger"
          >
            Error stack
          </summary>
          <pre className="mono sync-panel-detail-json">
            {details.error.stack ?? details.error.message ?? ""}
          </pre>
        </details>
      ) : null}

      {userActions.length === 0 &&
      localErrors.length === 0 &&
      fetchTasks.length === 0 &&
      !details.cliFlags &&
      !details.error ? (
        <p className="sync-panel-detail-empty">
          No post task details were recorded for this run.
        </p>
      ) : null}
    </div>
  );
}

type Tone = "ok" | "warn" | "fail" | "idle";

type WorkInfo = {
  label: string;
  blurb: string | null;
  fix: string | null;
  fixHref?: string;
};

// Translate the machine work-type / fetch-tool code into a plain-language
// description (and remediation for failure codes) so the panel reassures the
// user about what actually happened, even when a fetch was blocked.
function describeWork(task: FetchTaskLog): WorkInfo {
  if (task.readMethod) {
    return { label: task.readMethod, blurb: null, fix: null };
  }
  const code = (task.agentWorkType ?? task.fetchTool ?? "").trim();
  switch (code) {
    case "candidate_discovery_fallback":
      return {
        label: "Candidate discovery",
        blurb: "Direct discovery was blocked, so the Local Agent found candidate posts.",
        fix: null,
      };
    case "x_token_missing":
    case "x_token_invalid":
      return {
        label: "Needs X access",
        blurb:
          "This X source needs personal access before its posts can be read.",
        fix: "Add X access in Settings, then run Fetch sources again.",
        fixHref: "/settings",
      };
    case "youtube_transcription":
      return {
        label: "YouTube transcript",
        blurb: "The Local Agent uses the video transcript for this task.",
        fix: null,
      };
    case "translate_summary_only":
      return {
        label: "Translate Hub summary",
        blurb: "The Local Agent translates an existing Hub summary without fetching the source again.",
        fix: null,
      };
    case "fetch_builder_fallback":
      return {
        label: "Local Agent",
        blurb:
          "The Local Agent read the primary content before summarizing it.",
        fix: null,
      };
    default:
      return { label: code || "Standard read", blurb: null, fix: null };
  }
}

function isBlocked(task: FetchTaskLog): boolean {
  const code = task.agentWorkType ?? task.fetchTool ?? "";
  return (
    typeof code === "string" &&
    (code.startsWith("user_action_") || code.includes("token_missing") || code.includes("token_invalid"))
  );
}

function isContentFailure(task: FetchTaskLog): boolean {
  return task.status === "failed" && isContentFailureReason(task.failureReason);
}

function isCandidateDiscoveryTask(task: FetchTaskLog): boolean {
  return task.agentWorkType === "candidate_discovery_fallback";
}

function isSummaryTranslationTask(task: FetchTaskLog): boolean {
  return (
    task.agentWorkType === "translate_summary_only" ||
    task.hubSharedReuse?.summaryTranslated === true ||
    task.summaryMethod === "Translated summary from a Hub-shared post"
  );
}

function fetchOutcome(task: FetchTaskLog): { label: string; tone: Tone } {
  if (isCandidateDiscoveryTask(task) && task.status === "synced") {
    return { label: "Discovered", tone: "ok" };
  }
  if (isBlocked(task)) return { label: "Blocked", tone: "fail" };
  // A content failure is a fetch-stage failure (no real crawled content).
  if (isContentFailure(task)) return { label: "Failed", tone: "fail" };
  if (
    task.status === "failed" &&
    isNotCompletedFailureReason(task.failureReason) &&
    typeof task.bodyChars !== "number"
  ) {
    return { label: "Not completed", tone: "fail" };
  }
  if (isSummaryTranslationTask(task)) return { label: "Not reached", tone: "idle" };
  if (typeof task.bodyChars === "number" && task.bodyChars > 0)
    return { label: "Read", tone: "ok" };
  if (task.contentStatus === "ready") return { label: "Read", tone: "ok" };
  return { label: "Needs Local Agent", tone: "idle" };
}

const VALIDATION_ERROR_MESSAGES: Record<string, string> = {
  "item.body_required": "post body was missing",
  "item.body_must_match_ready_fetch_task_body": "post body did not match the planned ready-task body",
  "rawJson.fetchTaskId_required": "sync item was missing fetchTaskId",
  "rawJson.fetchTaskId_must_match_task_id": "sync item fetchTaskId did not match this task",
  "rawJson_agent_execution_proof_required": "Local Agent execution proof was missing",
  "rawJson.agentRuntime_required": "Local Agent runtime was missing",
  "rawJson.agentExecutionProof_required": "Local Agent execution proof was missing",
  "rawJson.agentCompletedAt_required_iso_datetime": "Local Agent completion time was missing or invalid",
  "summary:summary_too_short": "summary was too short",
  "summary:summary_too_long": "summary was too long",
  "summary:summary_duplicates_title": "summary duplicated the title",
  "summary:summary_copies_body_prefix": "summary copied the start of the source body",
  "headline:headline_missing": "headline was missing",
  "headline:headline_too_long": "headline was too long",
  "headline:headline_duplicates_title": "headline duplicated the title",
  "headline:headline_duplicates_summary": "headline duplicated the summary",
  "content_quality:content_too_short": "post body was too short",
  "content_quality:content_duplicates_metadata": "post body duplicated title or description metadata instead of primary content",
  "youtube_content_quality:transcript_missing": "YouTube transcript was missing",
  "youtube_content_quality:metadata_masquerading_as_content": "YouTube content looked like metadata instead of transcript text",
  "youtube_content_quality:content_too_short": "YouTube content was too short",
  "youtube_content_quality:content_duplicates_metadata": "YouTube content duplicated title or description metadata",
  "outcome.status_must_be_skipped_failed_or_blocked": "task outcome status was invalid",
  "outcome.reason_required": "task outcome reason was missing",
  "outcome.skipped_requires_per_task_evidence": "skipped task did not include per-task evidence",
};

function validationEvidence(task: FetchTaskLog): Record<string, unknown> | null {
  const validation = task.evidence?.validation;
  return validation && typeof validation === "object" && !Array.isArray(validation)
    ? validation as Record<string, unknown>
    : null;
}

function validationErrorText(error: unknown): string | null {
  const code = String(error || "").trim();
  if (!code) return null;
  const message = VALIDATION_ERROR_MESSAGES[code];
  return message ? `${code} (${message})` : code;
}

function validationFailureDetailsText(task: FetchTaskLog): string | null {
  const validation = validationEvidence(task);
  if (!validation) return null;
  const errors = Array.isArray(validation.errors)
    ? validation.errors.map(validationErrorText).filter((text): text is string => Boolean(text))
    : [];
  if (errors.length > 0) return errors.join("; ");
  const item = typeof validation.item === "string" ? validation.item.trim() : "";
  return item ? `validation failed for ${item}` : null;
}

export function fetchTaskFailureReasonText(task: FetchTaskLog): string | null {
  if (!task.failureReason) return null;
  if (isHiddenFailureReason(task.failureReason)) return null;
  const message = fetchFailureMessage(task.failureReason);
  const validationDetails = validationFailureDetailsText(task);
  if (validationDetails && task.failureReason === "task_validation_failed") {
    return `${message}: ${validationDetails}`;
  }
  return message;
}

function failureReasonText(task: FetchTaskLog): string | null {
  return fetchTaskFailureReasonText(task);
}

// Compact one-line render of per-task skip evidence, e.g.
// "meanVolumeDb: -91 · hasCaptions: false".
function formatEvidence(evidence: Record<string, unknown> | null | undefined): string | null {
  if (!evidence || typeof evidence !== "object") return null;
  const parts = Object.entries(evidence).map(
    ([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
  );
  return parts.length ? parts.join(" · ") : null;
}

function isSummarized(task: FetchTaskLog): boolean {
  return hasSummary(task) && hasHeadline(task);
}

function liveTaskHasBody(liveTask: FetchTaskProgress | null | undefined): boolean {
  return typeof liveTask?.bodyChars === "number" && liveTask.bodyChars > 0;
}

function liveTaskHasSummary(liveTask: FetchTaskProgress | null | undefined): boolean {
  return typeof liveTask?.summaryChars === "number" && liveTask.summaryChars > 0;
}

function liveTaskHasHeadline(liveTask: FetchTaskProgress | null | undefined): boolean {
  return typeof liveTask?.headlineChars === "number" && liveTask.headlineChars > 0;
}

function hasSummary(task: FetchTaskLog): boolean {
  return typeof task.summaryChars === "number" && task.summaryChars > 0;
}

function hasHeadline(task: FetchTaskLog): boolean {
  return typeof task.headlineChars === "number" && task.headlineChars > 0;
}

function hasReadSignal(
  task: FetchTaskLog,
  liveTask?: FetchTaskProgress | null,
): boolean {
  const phase = String(liveTask?.phase ?? "").toLowerCase();
  const status = String(liveTask?.status ?? "").toLowerCase();
  return (
    isReadForStats(task) ||
    isSummarized(task) ||
    liveTaskHasBody(liveTask) ||
    phase === "summarize" ||
    status === "summarizing" ||
    status === "summarized" ||
    status === "synced"
  );
}

function hasSummarizeInputSignal(
  task: FetchTaskLog,
  liveTask?: FetchTaskProgress | null,
): boolean {
  return isSummaryTranslationTask(task) || hasReadSignal(task, liveTask);
}

function summarizeOutcome(
  task: FetchTaskLog,
  liveTask?: FetchTaskProgress | null,
): { label: string; tone: Tone } {
  if (isCandidateDiscoveryTask(task)) {
    if (task.status === "synced") return { label: "Expanded", tone: "ok" };
    if (task.status === "failed") return { label: "Failed", tone: "fail" };
    if (isBlocked(task)) return { label: "Not reached", tone: "idle" };
    return { label: "Pending", tone: "warn" };
  }
  if (isSummarized(task)) return { label: "Summarized", tone: "ok" };
  // Skipped (no content) or a content failure means summarize never ran.
  if (task.status === "skipped") return { label: "Skipped", tone: "idle" };
  if (isContentFailure(task)) return { label: "Not reached", tone: "idle" };
  // A task is successful only when it ends with a summary; a missing summary is
  // a failure, not a benign "pending".
  if (task.status === "failed") return { label: "Failed", tone: "fail" };
  if (isBlocked(task)) return { label: "Not reached", tone: "idle" };
  if (!hasSummarizeInputSignal(task, liveTask)) return { label: "Not reached", tone: "idle" };
  return { label: "Pending", tone: "warn" };
}

export function taskStatusPill(
  task: FetchTaskLog,
  liveTask?: FetchTaskProgress | null,
): { label: string; tone: Tone } {
  const liveStatus = String(liveTask?.status ?? "").toLowerCase();
  const livePhase = String(liveTask?.phase ?? "").toLowerCase();
  if (isCandidateDiscoveryTask(task)) {
    if (task.status === "synced" || liveStatus === "synced") return { label: "synced", tone: "ok" };
    if (task.status === "failed" || liveStatus === "failed") return { label: "failed", tone: "fail" };
    if (task.status === "action_needed" || liveStatus === "action_needed" || isBlocked(task)) {
      return { label: "action", tone: "fail" };
    }
    return { label: "discovering", tone: "warn" };
  }
  if (task.status === "synced" || liveStatus === "synced") return { label: "synced", tone: "ok" };
  if (task.status === "failed" || liveStatus === "failed") return { label: "failed", tone: "fail" };
  if (task.status === "skipped" || liveStatus === "skipped") return { label: "skipped", tone: "idle" };
  if (task.status === "action_needed" || liveStatus === "action_needed" || isBlocked(task)) {
    return { label: "action", tone: "fail" };
  }
  if (isSummaryTranslationTask(task)) {
    if (liveStatus === "summarizing" || livePhase === "summarize") {
      return { label: "summarizing", tone: "warn" };
    }
    if (isSummarized(task) || liveStatus === "summarized") return { label: "syncing", tone: "warn" };
    return { label: "queued", tone: "idle" };
  }
  if (liveStatus === "reading" || livePhase === "read") return { label: "reading", tone: "warn" };
  if (liveStatus === "summarizing" || livePhase === "summarize") {
    return { label: "summarizing", tone: "warn" };
  }
  if (isSummarized(task) || liveStatus === "summarized") return { label: "syncing", tone: "warn" };
  if (hasReadSignal(task, liveTask)) return { label: "ready", tone: "idle" };
  return { label: "queued", tone: "idle" };
}

function statusBanner(
  task: FetchTaskLog,
  liveTask?: FetchTaskProgress | null,
): { label: string; tone: Tone } {
  if (isCandidateDiscoveryTask(task)) {
    if (task.status === "synced") return { label: "Candidates discovered", tone: "ok" };
    if (task.status === "failed") return { label: "Discovery failed", tone: "fail" };
    if (task.status === "action_needed" || isBlocked(task)) {
      return { label: "Action needed", tone: "fail" };
    }
    return { label: "Awaiting discovery", tone: "warn" };
  }
  // A deliberate, evidence-backed skip (no primary content) is a clean terminal
  // state, not a failure.
  if (task.status === "skipped") return { label: "Skipped: no content", tone: "idle" };
  // Success is defined by a persisted summary — NOT by contentStatus="ready"
  // (that only means the body was fetched; the summarize step can still fail).
  if (isSummaryTranslationTask(task) && isSummarized(task)) return { label: "Summarized", tone: "ok" };
  if (isSummarized(task)) return { label: "Read & summarized", tone: "ok" };
  if (task.status === "failed") return { label: "Failed", tone: "fail" };
  if (task.status === "action_needed") return { label: "Action needed", tone: "fail" };
  if (isBlocked(task)) return { label: "Action needed", tone: "fail" };
  if (!hasSummarizeInputSignal(task, liveTask)) {
    const status = String(liveTask?.status ?? "").toLowerCase();
    const phase = String(liveTask?.phase ?? "").toLowerCase();
    if (status === "reading" || phase === "read") return { label: "Reading", tone: "warn" };
    return { label: "Waiting for Local Agent", tone: "idle" };
  }
  return { label: "Waiting to summarize", tone: "warn" };
}

function liveTaskTone(liveTask: FetchTaskProgress | null | undefined): Tone {
  const status = String(liveTask?.status ?? "").toLowerCase();
  if (!status) return "idle";
  if (status === "failed") return "fail";
  if (status === "skipped" || status === "action_needed") return "warn";
  if (status === "summarized" || status === "synced") return "ok";
  return "warn";
}

function liveTaskLabel(liveTask: FetchTaskProgress | null | undefined): string | null {
  const status = String(liveTask?.status ?? liveTask?.phase ?? "").replace(/_/g, " ");
  if (!status) return null;
  return `Local Agent ${status}`;
}

function liveFetchOutcome(
  task: FetchTaskLog,
  liveTask: FetchTaskProgress | null | undefined,
): { label: string; tone: Tone } {
  const phase = String(liveTask?.phase ?? "").toLowerCase();
  const status = String(liveTask?.status ?? "").toLowerCase();
  if (isSummaryTranslationTask(task)) return fetchOutcome(task);
  if (hasReadSignal(task, liveTask)) return { label: "Read", tone: "ok" };
  if (phase === "read" || status === "reading") return { label: "Reading", tone: "warn" };
  if (
    phase === "summarize" ||
    status === "summarizing" ||
    status === "summarized" ||
    status === "synced"
  ) {
    return { label: "Read", tone: "ok" };
  }
  return fetchOutcome(task);
}

function liveSummarizeOutcome(
  task: FetchTaskLog,
  liveTask: FetchTaskProgress | null | undefined,
): { label: string; tone: Tone } {
  const phase = String(liveTask?.phase ?? "").toLowerCase();
  const status = String(liveTask?.status ?? "").toLowerCase();
  if (status === "summarizing" || phase === "summarize") return { label: "Summarizing", tone: "warn" };
  if (status === "summarized") return { label: "Ready to sync", tone: "ok" };
  if (status === "failed") return { label: "Failed", tone: "fail" };
  if (status === "skipped") return { label: "Skipped", tone: "idle" };
  if (status === "action_needed") return { label: "Action needed", tone: "fail" };
  return summarizeOutcome(task, liveTask);
}

function missingShardText(task: FetchTaskLog): string | null {
  const missingShard = missingShardRecord(task);
  const shard = missingShard?.shard;
  const resultFile = missingShard?.resultFile;
  if (!shard && !resultFile) return null;
  const parts = [];
  if (typeof shard === "string" && shard.trim()) parts.push(shard.trim());
  if (typeof resultFile === "string" && resultFile.trim()) parts.push(`missing ${resultFile.trim()}`);
  return parts.join(" · ");
}

function workerLogText(task: FetchTaskLog): string | null {
  const missingShard = missingShardRecord(task);
  if (!missingShard || !("workerLogTail" in missingShard)) return null;
  const tail = missingShard.workerLogTail;
  return typeof tail === "string" && tail.trim() ? tail.trim() : null;
}

function agentOutputText(task: FetchTaskLog): string | null {
  const missingShard = missingShardRecord(task);
  if (!missingShard || !("agentOutputTail" in missingShard)) return null;
  const tail = missingShard.agentOutputTail;
  return typeof tail === "string" && tail.trim() ? tail.trim() : null;
}

function missingWorkerLogText(task: FetchTaskLog): string | null {
  if (task.failureReason !== "worker_missing_result") return null;
  if (workerLogText(task)) return null;
  if (!missingShardRecord(task)) return null;
  return "No worker log tail was captured for this shard.";
}

function shardTimeoutText(task: FetchTaskLog): string | null {
  const timeoutSeconds = Number(task.evidence?.shardTimeoutSeconds);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return null;
  return formatDuration(timeoutSeconds * 1000);
}

function workerWatchdogRecord(task: FetchTaskLog): Record<string, unknown> | null {
  const watchdog = task.evidence?.workerWatchdog;
  return watchdog && typeof watchdog === "object"
    ? watchdog as Record<string, unknown>
    : null;
}

function workerWatchdogText(task: FetchTaskLog): string | null {
  const watchdog = workerWatchdogRecord(task);
  if (!watchdog) return null;
  const reason = String(watchdog.reason ?? task.failureReason ?? "");
  const label =
    reason === "worker_no_progress_timeout"
      ? "No checkpoint progress"
      : reason === "worker_stalled_timeout"
        ? "Checkpoint progress stalled"
        : null;
  if (!label) return null;
  const timeoutSeconds = Number(watchdog.timeoutSeconds);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return label;
  return `${label} · ${formatDuration(timeoutSeconds * 1000)}`;
}

function shardSummaryText(task: FetchTaskLog): string | null {
  const summary = task.evidence?.runShardSummary;
  if (!Array.isArray(summary)) return null;
  const text = summary
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  return text || null;
}

function discoveryExpansionText(evidence: Record<string, unknown> | null | undefined): string | null {
  if (!evidence || evidence.discoveryExpanded !== true) return null;
  const candidates = typeof evidence.candidates === "number" ? evidence.candidates : null;
  const fetchTasks = typeof evidence.fetchTasks === "number" ? evidence.fetchTasks : null;
  if (candidates === null && fetchTasks === null) return "expanded into fetch tasks";
  const parts = [];
  if (candidates !== null) parts.push(`${candidates} candidate${candidates === 1 ? "" : "s"}`);
  if (fetchTasks !== null) parts.push(`${fetchTasks} fetch task${fetchTasks === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function taskLiveProgress(
  task: FetchTaskLog,
  liveTasks: Map<string, FetchTaskProgress>,
): FetchTaskProgress | null {
  return task.id ? liveTasks.get(task.id) ?? null : null;
}

function taskSyncedForDisplay(
  task: FetchTaskLog,
  liveTask?: FetchTaskProgress | null,
): boolean {
  const liveStatus = String(liveTask?.status ?? "").toLowerCase();
  return task.status === "synced" || liveStatus === "synced";
}

function discoveryTaskState({
  groupTasks,
  liveTask,
  liveTasks,
  task,
}: {
  groupTasks: FetchTaskLog[];
  liveTask?: FetchTaskProgress | null;
  liveTasks: Map<string, FetchTaskProgress>;
  task: FetchTaskLog;
}): {
  expanded: boolean;
  expansionText: string | null;
  postTaskCount: number;
  synced: boolean;
  syncedPostTaskCount: number;
} {
  const siblingPostTasks = groupTasks.filter((candidate) => candidate !== task && !isCandidateDiscoveryTask(candidate));
  const evidenceText = discoveryExpansionText(task.evidence);
  const expandedByEvidence =
    task.status === "synced" ||
    String(liveTask?.status ?? "").toLowerCase() === "synced" ||
    task.evidence?.discoveryExpanded === true;
  const expandedByPosts = siblingPostTasks.length > 0;
  const syncedPostTaskCount = siblingPostTasks.filter((postTask) =>
    taskSyncedForDisplay(postTask, taskLiveProgress(postTask, liveTasks)),
  ).length;
  const allPostTasksSynced = expandedByPosts && syncedPostTaskCount === siblingPostTasks.length;
  const postTaskCount =
    typeof task.evidence?.fetchTasks === "number"
      ? task.evidence.fetchTasks
      : siblingPostTasks.length;

  return {
    expanded: expandedByEvidence || expandedByPosts,
    expansionText:
      evidenceText ??
      (expandedByPosts
        ? `${formatCount(siblingPostTasks.length)} fetch task${siblingPostTasks.length === 1 ? "" : "s"}`
        : null),
    postTaskCount,
    synced: taskSyncedForDisplay(task, liveTask) || allPostTasksSynced,
    syncedPostTaskCount,
  };
}

function sizeText(chars: number | null | undefined, words: number | null | undefined): string | null {
  if (typeof chars !== "number") return null;
  const wordPart = typeof words === "number" ? ` · ~${words.toLocaleString()} words` : "";
  return `${chars.toLocaleString()} chars${wordPart}`;
}

// Compression by characters, not words. Whitespace word-splitting badly
// undercounts CJK text — a ~2,000-char Chinese body counts as a handful of
// "words" — which made summaries read as longer than their source and produced
// contradictory labels like "125 → 180 words (0.7× shorter)". Characters are
// language-agnostic, so the ratio reflects real shrinkage, and the direction
// word is derived from the sign so a longer summary never reads as "shorter".
function compressionText(
  bodyChars: number | null | undefined,
  summaryChars: number | null | undefined,
): string | null {
  if (typeof bodyChars !== "number" || bodyChars <= 0) return null;
  if (typeof summaryChars !== "number" || summaryChars <= 0) return null;
  const pct = Math.round((1 - summaryChars / bodyChars) * 100);
  const direction = pct > 0 ? `${pct}% shorter` : pct < 0 ? `${-pct}% longer` : "same length";
  return `${bodyChars.toLocaleString()} → ${summaryChars.toLocaleString()} chars (${direction})`;
}

function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sync-panel-task-fact-row">
      <dt className="sync-panel-task-fact-label">{label}</dt>
      <dd className="sync-panel-task-fact-value">{value}</dd>
    </div>
  );
}

export function TaskRow({
  groupTasks,
  liveTask,
  liveTasks,
  task,
}: {
  groupTasks: FetchTaskLog[];
  liveTask?: FetchTaskProgress | null;
  liveTasks: Map<string, FetchTaskProgress>;
  task: FetchTaskLog;
}) {
  const hydrated = useHydrated();
  const work = describeWork(task);
  const isDiscovery = isCandidateDiscoveryTask(task);
  const discoveryState = isDiscovery
    ? discoveryTaskState({ groupTasks, liveTask, liveTasks, task })
    : null;
  const fetchRes = discoveryState?.expanded
    ? { label: "Discovered", tone: "ok" as Tone }
    : liveFetchOutcome(task, liveTask);
  const sumRes = discoveryState?.expanded
    ? { label: "Expanded", tone: "ok" as Tone }
    : liveSummarizeOutcome(task, liveTask);
  const banner = discoveryState?.expanded
    ? { label: "Candidates discovered", tone: "ok" as Tone }
    : statusBanner(task, liveTask);
  const readDone = hasReadSignal(task, liveTask);
  const liveLabel = liveTaskLabel(liveTask);
  const liveTone = liveTaskTone(liveTask);
  const pill = discoveryState?.expanded
    ? discoveryState.synced
      ? { label: "synced", tone: "ok" as Tone }
      : { label: "syncing", tone: "warn" as Tone }
    : taskStatusPill(task, liveTask);

  const agentLabel = [task.agentRuntime, task.agentModel].filter(Boolean).join(" · ");
  const bodySize = sizeText(task.bodyChars, task.bodyWords);
  const headlineSize = sizeText(task.headlineChars, task.headlineWords);
  const summarySize = sizeText(task.summaryChars, task.summaryWords);
  const liveBodySize = sizeText(liveTask?.bodyChars, liveTask?.bodyWords);
  const liveHeadlineSize = sizeText(liveTask?.headlineChars, liveTask?.headlineWords);
  const liveSummarySize = sizeText(liveTask?.summaryChars, liveTask?.summaryWords);
  const compression = compressionText(task.bodyChars, task.summaryChars);
  const summaryMethod = displayText(task.summaryMethod) || null;
  const bannerBlurb =
    banner.tone === "fail"
      ? failureReasonText(task) ?? displayText(work.blurb)
      : displayText(work.blurb);
  const missingShard = missingShardText(task);
  const workerLog = workerLogText(task);
  const agentOutput = agentOutputText(task);
  const missingWorkerLog = missingWorkerLogText(task);
  const shardTimeout = shardTimeoutText(task);
  const workerWatchdog = workerWatchdogText(task);
  const shardSummary = shardSummaryText(task);
  const discoveryExpansion = discoveryState?.expansionText ?? discoveryExpansionText(task.evidence);
  const syncOutcome = (() => {
    const liveStatus = String(liveTask?.status ?? "").toLowerCase();
    if (discoveryState?.synced) return { label: "Synced", tone: "ok" as Tone };
    if (discoveryState?.expanded) return { label: "Waiting on posts", tone: "warn" as Tone };
    if (task.status === "synced" || liveStatus === "synced") return { label: "Synced", tone: "ok" as Tone };
    if (task.status === "failed" || liveStatus === "failed") return { label: "Failed", tone: "fail" as Tone };
    if (task.status === "skipped" || liveStatus === "skipped") return { label: "Skipped", tone: "idle" as Tone };
    if (task.status === "action_needed" || liveStatus === "action_needed" || isBlocked(task)) {
      return { label: "Action needed", tone: "fail" as Tone };
    }
    if (isSummarized(task) || liveStatus === "summarized") return { label: "Ready to sync", tone: "warn" as Tone };
    return { label: "Pending", tone: "idle" as Tone };
  })();
  const hasReadDetail =
    bodySize ||
    liveBodySize ||
    isContentFailure(task) ||
    task.status === "skipped" ||
    task.url;
  const hasSummaryDetail =
    agentLabel ||
    summaryMethod ||
    discoveryExpansion ||
    summarySize ||
    headlineSize ||
    liveSummarySize ||
    liveHeadlineSize ||
    compression ||
    failureReasonText(task) ||
    missingShard ||
    workerLog ||
    agentOutput ||
    missingWorkerLog ||
    shardTimeout ||
    workerWatchdog ||
    shardSummary;
  const syncStatusText = (() => {
    if (discoveryState?.synced) {
      return discoveryState.postTaskCount > 0
        ? `${formatCount(discoveryState.syncedPostTaskCount)} post task${discoveryState.syncedPostTaskCount === 1 ? "" : "s"} synced`
        : "synced";
    }
    if (discoveryState?.expanded) {
      return `${formatCount(discoveryState.syncedPostTaskCount)} of ${formatCount(discoveryState.postTaskCount)} post tasks synced`;
    }
    return task.status?.replace(/_/g, " ") ?? liveTask?.status?.replace(/_/g, " ") ?? "Pending";
  })();
  const lifecycleSteps: LifecycleStep[] = [
    {
      key: "planned",
      label: "Planned",
      outcome: isDiscovery ? "Discovery task" : "Post task",
      tone: "ok",
      children: task.contentStatus ? (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Content status" value={<span>{task.contentStatus.replace(/_/g, " ")}</span>} />
        </dl>
      ) : undefined,
    },
    {
      key: "read",
      label: isDiscovery ? "Discover" : "Read",
      outcome: fetchRes.label,
      tone: fetchRes.tone,
      open:
        fetchRes.tone === "fail" ||
        (!isSummarized(task) && !isDiscovery && !isSummaryTranslationTask(task) && fetchRes.tone === "idle"),
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Method" value={<span>{work.label}</span>} />
          {bodySize ? <FactRow label="Content size" value={bodySize} /> : null}
          {!bodySize && liveBodySize ? <FactRow label="Live content size" value={liveBodySize} /> : null}
          {isContentFailure(task) && failureReasonText(task) ? (
            <FactRow
              label="Reason"
              value={
                <span className="sync-panel-task-danger">{failureReasonText(task)}</span>
              }
            />
          ) : null}
          {task.status === "skipped" && failureReasonText(task) ? (
            <FactRow
              label="Skipped"
              value={
                <span className="sync-panel-task-muted">{failureReasonText(task)}</span>
              }
            />
          ) : null}
          {task.status === "skipped" && formatEvidence(task.evidence) ? (
            <FactRow
              label="Evidence"
              value={<span className="mono">{formatEvidence(task.evidence)}</span>}
            />
          ) : null}
          {task.url ? (
            <FactRow
              label="Source"
              value={
                <a
                  className="sync-panel-task-link is-breakable"
                  href={task.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {displayText(task.url)}
                </a>
              }
            />
          ) : null}
          {!hasReadDetail ? <FactRow label="Status" value={<span>{fetchRes.label}</span>} /> : null}
        </dl>
      ),
    },
    {
      key: "summarize",
      label: isDiscovery ? "Expand" : "Summarize",
      outcome: sumRes.label,
      tone: sumRes.tone,
      open: sumRes.tone === "fail" || (!isSummarized(task) && sumRes.tone === "warn"),
      children: (
        <dl className="sync-panel-task-fact-list">
          {agentLabel ? (
            <FactRow label="Local Agent" value={<span>{agentLabel}</span>} />
          ) : null}
          {summaryMethod ? (
            <FactRow label="Method" value={<span>{summaryMethod}</span>} />
          ) : null}
          {discoveryExpansion ? (
            <FactRow label="Expanded into" value={<span>{discoveryExpansion}</span>} />
          ) : null}
          {summarySize ? <FactRow label="Summary size" value={summarySize} /> : null}
          {!summarySize && liveSummarySize ? <FactRow label="Live summary size" value={liveSummarySize} /> : null}
          {headlineSize ? <FactRow label="Headline size" value={headlineSize} /> : null}
          {!headlineSize && liveHeadlineSize ? <FactRow label="Live headline size" value={liveHeadlineSize} /> : null}
          {compression ? <FactRow label="Compression" value={compression} /> : null}
          {!isSummarized(task) && !isContentFailure(task) && failureReasonText(task) ? (
            <FactRow
              label="Reason"
              value={
                <span className="sync-panel-task-danger">{failureReasonText(task)}</span>
              }
            />
          ) : null}
          {missingShard ? (
            <FactRow
              label="Missing result"
              value={<span className="mono">{missingShard}</span>}
            />
          ) : null}
          {shardTimeout ? (
            <FactRow
              label="Shard timeout"
              value={<span>{shardTimeout}</span>}
            />
          ) : null}
          {workerWatchdog ? (
            <FactRow
              label="Worker watchdog"
              value={<span>{workerWatchdog}</span>}
            />
          ) : null}
          {shardSummary ? (
            <FactRow
              label="Shard summary"
              value={<span className="mono">{shardSummary}</span>}
            />
          ) : null}
          {workerLog ? (
            <FactRow
              label="Local Agent log"
              value={<span className="mono">{workerLog}</span>}
            />
          ) : null}
          {agentOutput ? (
            <FactRow
              label="Local Agent output"
              value={<span className="mono">{agentOutput}</span>}
            />
          ) : null}
          {missingWorkerLog ? (
            <FactRow
              label="Local Agent log"
              value={<span className="sync-panel-task-muted">{missingWorkerLog}</span>}
            />
          ) : null}
          {!hasSummaryDetail ? (
            <FactRow
              label="Status"
              value={
                <span className="sync-panel-task-muted">
                  {isDiscovery
                    ? "The Local Agent hasn't expanded this discovery entry yet."
                    : sumRes.label === "Not reached"
                      ? readDone
                        ? "Summary has not started yet."
                        : "Read has not completed yet, so summary has not started."
                      : sumRes.label === "Failed"
                        ? "This post failed to summarize, so it was not synced."
                        : "The Local Agent hasn't summarized this post yet."}
                </span>
              }
            />
          ) : null}
        </dl>
      ),
    },
    {
      key: "sync",
      label: "Sync",
      outcome: syncOutcome.label,
      tone: syncOutcome.tone,
      open: syncOutcome.tone === "fail" || syncOutcome.label === "Action needed",
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Status" value={<span>{syncStatusText}</span>} />
          {failureReasonText(task) ? (
            <FactRow
              label="Reason"
              value={<span className={syncOutcome.tone === "fail" ? "sync-panel-task-danger" : "sync-panel-task-muted"}>{failureReasonText(task)}</span>}
            />
          ) : null}
          {liveTask?.message ? <FactRow label="Latest event" value={<span>{displayText(liveTask.message)}</span>} /> : null}
          {liveTask?.workerId ? <FactRow label="Local Agent" value={<span>{displayText(liveTask.workerId)}</span>} /> : null}
          {liveTask?.updatedAt ? (
            <FactRow
              label="Updated"
              value={<span>{hydrated ? formatRelative(liveTask.updatedAt) : formatAbsolute(liveTask.updatedAt)}</span>}
            />
          ) : null}
        </dl>
      ),
    },
  ];

  return (
    <li>
      <details className="sync-panel-task-card fb-task">
        <summary className="sync-panel-task-summary fb-task-summary">
          <ChevronRight
            aria-hidden="true"
            className="sync-panel-task-chev fb-task-chev"
          />
          <span
            className={`sync-panel-task-status-pill is-${pill.tone}`}
          >
            {pill.label}
          </span>
          <span className="sync-panel-task-title">
            {displayText(task.title ?? task.url, "Untitled task")}
          </span>
        </summary>

        <div className="sync-panel-task-body">
          <div
            className={`sync-panel-task-banner is-${banner.tone}`}
          >
            {banner.label}
            {bannerBlurb ? (
              <span className="sync-panel-task-banner-blurb">: {bannerBlurb}</span>
            ) : null}
          </div>

          {liveLabel ? (
            <div
              className={`sync-panel-task-banner is-${liveTone}`}
            >
              {liveLabel}
              {liveTask?.message ? (
                <span className="sync-panel-task-banner-blurb">: {displayText(liveTask.message)}</span>
              ) : null}
              {liveTask?.workerId ? (
                <span className="sync-panel-task-banner-blurb"> · {displayText(liveTask.workerId)}</span>
              ) : null}
              {liveTask?.updatedAt ? (
                <span className="sync-panel-task-banner-blurb">
                  {" · "}
                  {hydrated ? formatRelative(liveTask.updatedAt) : formatAbsolute(liveTask.updatedAt)}
                </span>
              ) : null}
            </div>
          ) : null}

          {work.fix ? (
            <div className="sync-panel-task-fix">
              <span className="sync-panel-task-fix-label">How to fix: </span>
              {work.fix}
              {work.fixHref ? (
                <>
                  {" "}
                  {work.fixHref.startsWith("/") ? (
                    <Link className="sync-panel-task-link" href={work.fixHref}>
                      Open Settings
                    </Link>
                  ) : (
                    <a className="sync-panel-task-link" href={work.fixHref}>
                      Open Settings
                    </a>
                  )}
                </>
              ) : null}
            </div>
          ) : null}

          <LifecyclePipeline
            ariaLabel={isDiscovery ? "Discovery task lifecycle" : "Post task lifecycle"}
            steps={lifecycleSteps}
          />
        </div>
      </details>
    </li>
  );
}
