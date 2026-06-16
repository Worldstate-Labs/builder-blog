"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Activity, ChevronDown, ChevronRight, ChevronUp, Clock3 } from "lucide-react";
import { CountBadge, CountMeta, CountMetric, formatCount } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { useHydrated } from "@/components/ThemeToggle";
import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import { latestResolvedSlotStatus } from "@/lib/digest-update-status";
import { contentSyncStateChanged } from "@/lib/content-sync-events";
import { displayLanguagePreference } from "@/lib/language-preference";
import { addScheduleInterval, firstExpectedSchedule, floorToExpectedSchedule } from "@/lib/schedule-timing";
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

type FetchTaskLog = {
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
  summaryChars?: number | null;
  summaryWords?: number | null;
  agentRuntime?: string | null;
  agentModel?: string | null;
  workerId?: string | null;
  status?: string | null;
  // Why a task failed (e.g. "summary_missing", "not_summarized"). Present only
  // when status is "failed".
  failureReason?: string | null;
  // Per-task evidence for a skipped (no-content) outcome, e.g.
  // { meanVolumeDb: -91, hasCaptions: false }.
  evidence?: Record<string, unknown> | null;
};

type PromptBundle = {
  summary?: string | null;
  fetch?: string | null;
  // When true, the prompt above uses the common fetching rules without a
  // source-specific fetch prompt. UI flags this with a small "default" pill so
  // users know the source-specific optional field is empty.
  fetchIsDefault?: boolean;
};

type DetailsShape = {
  perBuilder?: PerBuilder[];
  userActions?: UserAction[];
  localErrors?: string[];
  cliFlags?: Record<string, unknown>;
  error?: { message?: string; stack?: string };
  fetchTasks?: FetchTaskLog[];
  prompts?: Record<string, PromptBundle>;
  // Which agent ran the fetch and the model it used. Recorded by the CLI at
  // emit time; absent on runs from before this was captured.
  agentRuntime?: string | null;
  agentModel?: string | null;
};

type FetchRunStats = {
  sourcesScanned: number;
  sourcesTotal: number;
  planned: number;
  read: number;
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
  sourceGroups: FetchTaskSourceGroup[];
  tasks: FetchTaskLog[];
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
  timeoutSeconds?: number | null;
  timeoutStage?: string | null;
  timedOutWorker?: string | null;
  timedOutWorkerPid?: number | null;
  termination?: string | null;
  skippedWaitPids?: string | null;
  progress?: FetchJobProgress | null;
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

type FetchTaskProgress = {
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
  summaryChars?: number | null;
  summaryWords?: number | null;
  updatedAt?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  partial: "Partial",
  failed: "Failed",
};

const RELATIVE_FORMATTER =
  typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl
    ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
    : null;

function formatRelative(iso: string): string {
  if (!RELATIVE_FORMATTER) return formatAbsolute(iso);
  const diffMs = Date.parse(iso) - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return RELATIVE_FORMATTER.format(Math.round(diffMs / 1000), "second");
  if (abs < hour) return RELATIVE_FORMATTER.format(Math.round(diffMs / minute), "minute");
  if (abs < day) return RELATIVE_FORMATTER.format(Math.round(diffMs / hour), "hour");
  return RELATIVE_FORMATTER.format(Math.round(diffMs / day), "day");
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

function formatMetaDate(iso: string, hydrated: boolean): string {
  try {
    if (!hydrated) return formatAbsolute(iso);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatLanguage(value: string) {
  return displayLanguagePreference(value);
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
        background: "var(--warm-soft)",
        color: "color-mix(in oklch, var(--warm) 68%, var(--ink))",
        border: "color-mix(in oklch, var(--warm) 30%, var(--line))",
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
  return (typeof task.summaryChars === "number" && task.summaryChars > 0) || status === "summarized" || status === "synced";
}

function fetchRunStats({
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
  const planned =
    counters.tasksPlanned ??
    (plannedTasks.length > 0 ? plannedTasks.length : run?.tasksGenerated ?? 0);
  const read = Math.max(
    plannedTasks.filter(isReadForStats).length,
    liveTasks.filter(liveTaskWasRead).length,
    run?.itemsFetched ?? 0,
  );
  const summarized = Math.max(
    plannedTasks.filter(isSummarizedForStats).length,
    liveTasks.filter(liveTaskWasSummarized).length,
  );
  const synced = counters.synced ?? plannedTasks.filter((task) => task.status === "synced").length;
  const skipped = counters.skipped ?? plannedTasks.filter((task) => task.status === "skipped").length;
  const failed = counters.failed ?? plannedTasks.filter((task) => task.status === "failed").length;
  const actionNeeded =
    counters.actionNeeded ??
    plannedTasks.filter((task) => task.status === "action_needed" || isBlocked(task)).length;

  return {
    sourcesScanned:
      counters.sourcesChecked ??
      (perBuilder.length > 0 ? perBuilder.length : run?.buildersAttempted ?? 0),
    sourcesTotal:
      counters.sourcesTotal ??
      (run?.buildersAttempted ?? perBuilder.length),
    planned,
    read,
    summarized,
    synced,
    skipped,
    failed,
    actionNeeded,
  };
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
): boolean {
  if (run.source === "cron" && cronJob && cronJob.status !== "active") return false;
  if (jobRun && !isActiveJobRun(jobRun)) return false;
  if (!jobRun) {
    const ageMs = Date.now() - Date.parse(run.startedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > INFLIGHT_MAX_AGE_MS) return false;
  }
  const tasks = readDetails(run.details).fetchTasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return false;
  return tasks.some((task) => task?.status === "pending" || task?.status === "fetched");
}

const VISIBLE_RUN_LIMIT = 2;
const CRON_SLOT_LIMIT = 12;

type CronSlotStatus = "ok" | "failed" | "missed" | "waiting" | "running" | "stalled";

type CronSlot = {
  expectedAt: string;
  windowEnd: string;
  status: CronSlotStatus;
  run: LibraryFetchRunListItem | null;
  jobRun: AgentJobRunListItem | null;
};

type FetchUpdateStatusKey =
  | "not-connected"
  | "stopped"
  | "syncing"
  | "waiting"
  | "healthy"
  | "needs-attention";

type FetchUpdateStatus = {
  key: FetchUpdateStatusKey;
  label: string;
  summary: string;
  style: ReturnType<typeof statusStyle>;
};

function slotDomId(slot: CronSlot): string {
  return `fetch-slot-${Date.parse(slot.expectedAt)}`;
}

function runDomId(runId: string): string {
  return `fetch-run-${runId}`;
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

function isStalledJobRun(jobRun: AgentJobRunListItem, nowMs = Date.now()): boolean {
  if (!isActiveJobRun(jobRun)) return false;
  const heartbeatMs = Date.parse(jobRun.heartbeatAt ?? jobRun.startedAt);
  return Number.isFinite(heartbeatMs) && nowMs - heartbeatMs > 2 * 60_000;
}

function jobRunSlotStatus(jobRun: AgentJobRunListItem, nowMs = Date.now()): CronSlotStatus {
  if (jobRun.status === "succeeded") return "ok";
  if (isStalledJobRun(jobRun, nowMs)) return "stalled";
  if (isActiveJobRun(jobRun)) return "running";
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
  for (let index = 0; index < CRON_SLOT_LIMIT * 3 && expected.length < CRON_SLOT_LIMIT; index += 1) {
    if (Number.isFinite(firstExpectedMs) && cursor.getTime() >= firstExpectedMs) {
      expected.unshift(new Date(cursor));
    }
    cursor = addScheduleInterval(cursor, cronJob, -1);
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
    const status: CronSlotStatus = jobRun
      ? jobRunSlotStatus(jobRun, nowMs)
      : match
      ? match.status === "ok"
        ? "ok"
        : "failed"
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

export function FetchLogPanel({
  initialRuns,
  initialCronRuns,
  initialJobRuns = [],
  initialScheduledJobRuns = [],
  initialCronJob,
  actions,
  actionsPlacement = "end",
  summaryLanguage,
}: {
  initialRuns: LibraryFetchRunListItem[];
  initialCronRuns: LibraryFetchRunListItem[];
  initialJobRuns?: AgentJobRunListItem[];
  initialScheduledJobRuns?: AgentJobRunListItem[];
  initialCronJob: LibraryCronJobStatus | null;
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
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"status" | "log">("status");
  const hydrated = useHydrated();
  const cronStatus = useMemo(
    () => buildCronStatus(cronJob, cronRuns, scheduledJobRuns),
    [cronJob, cronRuns, scheduledJobRuns],
  );
  const updateStatus = useMemo(
    () => getFetchUpdateStatus(cronJob, cronStatus.slots, runs, jobRuns),
    [cronJob, cronStatus.slots, runs, jobRuns],
  );
  const actionsNode = actions ? (
    <div className="digest-updates-actions">
      {actions}
    </div>
  ) : null;
  function handleTabKeyDown(event: KeyboardEvent<HTMLElement>) {
    const tabs = ["status", "log"] as const;
    const navigableKeys = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
    if (!navigableKeys.has(event.key)) return;

    const tabElements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (tabElements.length === 0) return;

    event.preventDefault();
    const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab === activeTab));
    const focusedIndex = tabElements.findIndex((tab) => tab === document.activeElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabElements.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabElements.length
            : (currentIndex - 1 + tabElements.length) % tabElements.length;

    tabElements[nextIndex]?.focus();
    setActiveTab(tabs[nextIndex]!);
  }

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

  const openRun = useCallback((runId: string) => {
    setDetailsOpen(true);
    setExpanded(true);
    setActiveTab("log");
    window.setTimeout(() => {
      document.getElementById(runDomId(runId))?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
  }, []);

  const refresh = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/skill/fetch-runs", {
          headers: { accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as
          | {
              runs?: LibraryFetchRunListItem[];
              cronRuns?: LibraryFetchRunListItem[];
              jobRuns?: AgentJobRunListItem[];
              scheduledJobRuns?: AgentJobRunListItem[];
              cronJob?: LibraryCronJobStatus | null;
              error?: string;
            }
          | null;
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setRuns(Array.isArray(body?.runs) ? body.runs : []);
        setCronRuns(Array.isArray(body?.cronRuns) ? body.cronRuns : []);
        setJobRuns(Array.isArray(body?.jobRuns) ? body.jobRuns : []);
        setScheduledJobRuns(Array.isArray(body?.scheduledJobRuns) ? body.scheduledJobRuns : []);
        setCronJob(body?.cronJob ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not refresh. Try again.");
      }
    });
  }, []);

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

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
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
            status={updateStatus}
            summaryLanguage={summaryLanguage}
            hydrated={hydrated}
          />
        </div>
        {actionsPlacement === "end" ? actionsNode : null}
      </div>

      {error ? (
        <p className="sync-panel-error">{error}</p>
      ) : null}

      {detailsOpen ? (
        <div id="fetch-sync-details">
          <div
            aria-label="Fetch sources views"
            className="fb-segmented-tabs sync-panel-tabs"
            onKeyDown={handleTabKeyDown}
            role="tablist"
          >
            <button
              aria-controls="fetch-sync-panel-status"
              aria-selected={activeTab === "status"}
              className={`fb-btn compact ${activeTab === "status" ? "" : "light"}`}
              id="fetch-sync-tab-status"
              onClick={() => setActiveTab("status")}
              role="tab"
              tabIndex={activeTab === "status" ? 0 : -1}
              type="button"
            >
              <Activity aria-hidden="true" />
              Fetch status
            </button>
            <button
              aria-controls="fetch-sync-panel-log"
              aria-selected={activeTab === "log"}
              className={`fb-btn compact ${activeTab === "log" ? "" : "light"}`}
              id="fetch-sync-tab-log"
              onClick={() => setActiveTab("log")}
              role="tab"
              tabIndex={activeTab === "log" ? 0 : -1}
              type="button"
            >
              <Clock3 aria-hidden="true" />
              Fetch log
              <span className="sr-only">Fetch sources run history</span>
            </button>
          </div>

          <section
            aria-labelledby="fetch-sync-tab-status"
            hidden={activeTab !== "status"}
            id="fetch-sync-panel-status"
            role="tabpanel"
          >
            {activeTab === "status" ? (
              <FetchStatusPanel
                cronJob={cronJob}
                nextExpectedAt={cronStatus.nextExpectedAt}
                onOpenRun={openRun}
                slots={cronStatus.slots}
              />
            ) : null}
          </section>
          <section
            aria-labelledby="fetch-sync-tab-log"
            hidden={activeTab !== "log"}
            id="fetch-sync-panel-log"
            role="tabpanel"
          >
            {activeTab === "log" ? (
              <FetchRunList
                cronJob={cronJob}
                expanded={expanded}
                jobRuns={jobRuns}
                runs={runs}
                setExpanded={setExpanded}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function getFetchUpdateStatus(
  cronJob: LibraryCronJobStatus | null,
  slots: CronSlot[],
  runs: LibraryFetchRunListItem[],
  jobRuns: AgentJobRunListItem[] = [],
): FetchUpdateStatus {
  if (!cronJob) {
    return {
      key: "not-connected",
      label: "Not connected",
      summary: "No Fetch sources schedule has reported yet.",
      style: statusStyle("partial"),
    };
  }
  if (cronJob.status !== "active") {
    return {
      key: "stopped",
      label: "Stopped",
      summary: "The recurring Fetch sources schedule is stopped.",
      style: statusStyle("partial"),
    };
  }
  const jobsByInstanceId = jobRunByInstanceId(jobRuns);
  const activeRun = runs.find((run) =>
    isRunInflight(run, run.jobRunId ? jobsByInstanceId.get(run.jobRunId) : null, cronJob),
  );
  if (activeRun) {
    return {
      key: "syncing",
      label: "Syncing",
      summary: "A Fetch sources run is still writing post outcomes.",
      style: statusStyle("partial"),
    };
  }

  const latestSlot = slots.at(-1) ?? null;
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
      summary: "The next scheduled Fetch sources run has not reached its grace window yet.",
      style: statusStyle("partial"),
    };
  }
  if (latestSlot?.status === "stalled") {
    return {
      key: "needs-attention",
      label: "Needs attention",
      summary: "The latest scheduled Fetch sources run stopped sending heartbeats.",
      style: statusStyle("failed"),
    };
  }

  const latestResolved = latestResolvedSlotStatus(slots);
  if (latestResolved === "missed" || latestResolved === "failed") {
    return {
      key: "needs-attention",
      label: "Needs attention",
      summary:
        latestResolved === "missed"
          ? "The latest scheduled window has no recorded fetch run."
          : "The latest scheduled fetch run did not finish successfully.",
      style: statusStyle("failed"),
    };
  }
  if (latestResolved === "ok") {
    return {
      key: "healthy",
      label: "Healthy",
      summary: "Recent scheduled fetch runs are completing successfully.",
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
      className="fb-chip digest-status-toggle"
      onClick={onToggle}
      style={{
        background: status.style.background,
        borderColor: status.style.border,
        color: status.style.color,
      }}
      title={detailsOpen ? "Hide Fetch sources details" : "Show Fetch sources details"}
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
  hydrated,
}: {
  cronJob: LibraryCronJobStatus | null;
  detailsOpen: boolean;
  latestRun: LibraryFetchRunListItem | null;
  onToggleDetails: () => void;
  status: FetchUpdateStatus;
  summaryLanguage?: string | null;
  hydrated: boolean;
}) {
  return (
    <dl className="fb-hub-digest-meta source-fetch-meta" aria-label="Fetch sources details">
      <SourceFetchMetaItem
        label="Fetch frequency"
        value={cronJob?.frequencyLabel ?? "Not scheduled"}
      />
      <SourceFetchMetaItem
        label="Language"
        value={formatLanguage(summaryLanguage ?? "zh")}
      />
      <SourceFetchMetaItem
        label="Latest fetch"
        value={latestRun ? formatMetaDate(latestRun.startedAt, hydrated) : "None yet"}
      />
      <div className="fb-hub-digest-meta-item source-fetch-status-item">
        <dt>Schedule status</dt>
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
  value: string;
}) {
  return (
    <div className="fb-hub-digest-meta-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FetchStatusPanel({
  cronJob,
  nextExpectedAt,
  onOpenRun,
  slots,
}: {
  cronJob: LibraryCronJobStatus | null;
  nextExpectedAt: string | null;
  onOpenRun: (runId: string) => void;
  slots: CronSlot[];
}) {
  const hydrated = useHydrated();
  if (!cronJob) {
    return (
      <EmptyState
        className="sync-panel-empty is-dashed"
        title="No Fetch sources schedule"
        body="No Fetch sources schedule has reported yet."
      />
    );
  }

  if (cronJob.status !== "active") {
    return (
      <div className="sync-panel-card">
        <div className="sync-panel-status-brief">
          <div className="sync-panel-chip-row">
            <span className="fb-chip">Stopped</span>
          </div>
          <p>The recurring Fetch sources schedule is off. Manual fetches can still appear in the log.</p>
          {cronJob.stoppedAt ? (
            <time
              className="sync-panel-stopped-time"
              dateTime={cronJob.stoppedAt}
              title={formatAbsolute(cronJob.stoppedAt)}
            >
              stopped {hydrated ? formatRelative(cronJob.stoppedAt) : formatAbsolute(cronJob.stoppedAt)}
            </time>
          ) : null}
        </div>
      </div>
    );
  }

  const okCount = slots.filter((slot) => slot.status === "ok").length;
  const missedCount = slots.filter((slot) => slot.status === "missed").length;
  const failedCount = slots.filter((slot) => slot.status === "failed").length;
  const stalledCount = slots.filter((slot) => slot.status === "stalled").length;
  const failedOrStalledCount = failedCount + stalledCount;
  const activeCount = slots.filter((slot) => slot.status === "waiting" || slot.status === "running").length;
  const latestSlot = slots.at(-1) ?? null;
  const latestIsPending = latestSlot?.status === "waiting" || latestSlot?.status === "running";
  const latestIsStalled = latestSlot?.status === "stalled";
  const latestResolved = latestResolvedSlotStatus(slots);
  const hasProblem = latestIsStalled || (!latestIsPending && (latestResolved === "missed" || latestResolved === "failed"));
  const problemDetail =
    latestIsStalled
      ? "The latest scheduled fetch run stopped sending heartbeats. Open the log to see where it stopped."
    : latestResolved === "missed"
      ? missedWindowDetail(slots)
      : "The latest scheduled fetch run reported a failure. Open the log for task-level details.";
  const statusTone = hasProblem
    ? statusStyle("failed")
    : latestSlot?.status === "running" || latestSlot?.status === "waiting"
      ? statusStyle("partial")
      : latestResolved === "ok"
      ? statusStyle("ok")
      : statusStyle("partial");
  const statusLabel = hasProblem
    ? "Needs attention"
    : latestSlot?.status === "running"
      ? "Running"
      : latestResolved === "ok"
        ? "Healthy"
        : "Waiting";
  const statusDetail =
    hasProblem
      ? problemDetail
      : latestSlot?.status === "running"
        ? "A scheduled fetch is active. The log should move from sources scanned to sync as the Local Agent reports progress."
        : latestResolved === "ok"
          ? "The latest scheduled window completed. The next run stays anchored to the configured cadence."
          : "The schedule is active. FollowBrief is waiting for the next scheduled window or the first completed run.";

  return (
    <div className="sync-panel-card">
      <div className="sync-panel-status-brief">
        <div className="sync-panel-chip-row">
          <span
            className="fb-chip"
            style={{
              background: statusTone.background,
              borderColor: statusTone.border,
              color: statusTone.color,
            }}
          >
            {statusLabel}
          </span>
          <span className="fb-chip">{cronJob.frequencyLabel}</span>
          {cronJob.overrideFetched ? <span className="fb-chip">refreshes library posts</span> : null}
        </div>
        <p style={hasProblem ? { color: statusTone.color } : undefined}>{statusDetail}</p>
      </div>
      <div className="sync-panel-layout">
        <div className="sync-panel-column">
          <dl className="sync-panel-meta">
            <div className="sync-panel-meta-row">
              <dt>Schedule enabled</dt>
              <dd>
                {hydrated ? formatRelative(cronJob.startedAt) : formatAbsolute(cronJob.startedAt)}
              </dd>
            </div>
            {nextExpectedAt ? (
              <div className="sync-panel-meta-row">
                <dt>Next scheduled run</dt>
                <dd>
                  {hydrated ? formatRelative(nextExpectedAt) : formatAbsolute(nextExpectedAt)}
                </dd>
              </div>
            ) : null}
            <div className="sync-panel-meta-row">
              <dt>Runner</dt>
              <dd className="sync-panel-truncate">
                {cronJob.runtime || "Local Agent"}
                {cronJob.hostname ? ` · ${cronJob.hostname.replace(/\.local$/, "")}` : ""}
              </dd>
            </div>
          </dl>
          <div className="sync-panel-metrics">
            <CountMetric label="OK" tone="ok" value={okCount} />
            <CountMetric label="Missed" tone="issue" value={missedCount} />
            <CountMetric label="Failed" tone="issue" value={failedOrStalledCount} />
            <CountMetric label="Active" tone="waiting" value={activeCount} />
          </div>
        </div>

        {slots.length > 0 ? (
          <div className="sync-panel-column">
            <div className="sync-panel-timeline-head">
              <span className="sync-panel-timeline-title">
                Last {slots.length} scheduled {slots.length === 1 ? "window" : "windows"}
              </span>
              <span>Recent outcomes by scheduled window.</span>
            </div>
            <div className="sync-panel-status-graph" aria-label="Fetch schedule status graph">
              {slots.map((slot) => (
                <CronSlotBar
                  key={slot.expectedAt}
                  onSelect={() => {
                    document.getElementById(slotDomId(slot))?.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    });
                  }}
                  slot={slot}
                />
              ))}
            </div>
            <div className="sync-panel-slot-rows">
              {slots.slice().reverse().slice(0, 6).map((slot) => (
                <CronSlotRow
                  key={slot.expectedAt}
                  hydrated={hydrated}
                  onOpenRun={onOpenRun}
                  slot={slot}
                />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            className="sync-panel-slot-empty"
            title="No elapsed schedule runs"
            body="The first scheduled run has not reached its expected time yet."
          />
        )}
      </div>
    </div>
  );
}

function cronSlotStyle(status: CronSlotStatus): { background: string; border: string; color: string } {
  return statusStyle(scheduledWindowStyleStatus(status));
}

function cronSlotRunNote(slot: CronSlot): string {
  const runSummary = slot.run
    ? `${slot.run.itemsFetched} read · ${formatDuration(slot.run.durationMs)}`
    : null;
  return scheduledWindowRunNote({
    jobRunStatus: slot.jobRun ? jobRunStatusLabel(slot.jobRun) : null,
    runSummary,
    runtime: slot.jobRun?.runtime,
  });
}

function slotFailureContext(slot: CronSlot): string | null {
  if (!slot.jobRun) return null;
  const details = readJobRunDetails(slot.jobRun.details);
  const parts = [
    details.timeoutSeconds ? `timeout ${formatDuration(details.timeoutSeconds * 1000)}` : null,
    details.timedOutWorker ? `worker ${details.timedOutWorker}` : null,
    details.timedOutWorkerPid ? `pid ${details.timedOutWorkerPid}` : null,
    details.termination === "still_alive_after_kill" ? "cleanup failed" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : details.reason ?? null;
}

function latestRecordedSlot(slots: CronSlot[]): CronSlot | null {
  return slots.slice().reverse().find((slot) => slot.jobRun || slot.run) ?? null;
}

function missedWindowDetail(slots: CronSlot[]): string {
  const previous = latestRecordedSlot(slots.slice(0, -1));
  const previousStatus = previous?.jobRun ? jobRunStatusLabel(previous.jobRun).toLowerCase() : previous?.run?.status;
  if (previous?.jobRun && previous.jobRun.status !== "succeeded") {
    const context = slotFailureContext(previous);
    return [
      "No Local Agent job reported for the latest scheduled window.",
      `The previous reported job ${previousStatus}${context ? ` (${context})` : ""}.`,
      "The local schedule may not have launched, or an older process may still be occupying it.",
    ].join(" ");
  }
  return "No Local Agent job reported for the latest scheduled window. The local schedule may not have launched.";
}

function CronSlotBar({ onSelect, slot }: { onSelect: () => void; slot: CronSlot }) {
  const style = cronSlotStyle(slot.status);
  const heightClass =
    slot.status === "ok"
      ? "is-tall"
      : slot.status === "waiting" || slot.status === "running"
        ? "is-short"
        : "is-medium";
  const label = scheduledWindowStatusLabel(slot.status);
  return (
    <button
      aria-label={`${label} scheduled fetch run at ${formatAbsolute(slot.expectedAt)}`}
      className={`sync-panel-slot-bar ${heightClass}`}
      onClick={onSelect}
      style={{
        background: style.background,
        borderColor: style.border,
        color: style.color,
      }}
      title={`${label} · ${formatAbsolute(slot.expectedAt)}`}
      type="button"
    />
  );
}

function CronSlotRow({
  hydrated,
  onOpenRun,
  slot,
}: {
  hydrated: boolean;
  onOpenRun: (runId: string) => void;
  slot: CronSlot;
}) {
  const style = cronSlotStyle(slot.status);
  const label = scheduledWindowStatusLabel(slot.status);
  const failureContext = slotFailureContext(slot);
  return (
    <div
      className="sync-panel-slot-row"
      id={slotDomId(slot)}
    >
      <div className="sync-panel-slot-row-main">
        <span
          className="fb-chip"
          style={{ background: style.background, borderColor: style.border, color: style.color }}
        >
          {label}
        </span>
        <time
          className="sync-panel-slot-row-time"
          dateTime={slot.expectedAt}
          title={formatAbsolute(slot.expectedAt)}
        >
          {hydrated ? formatRelative(slot.expectedAt) : formatAbsolute(slot.expectedAt)}
        </time>
      </div>
      <div className="sync-panel-slot-row-side">
        <span className="mono sync-panel-slot-row-note">{cronSlotRunNote(slot)}</span>
        {failureContext ? (
          <span className="mono sync-panel-slot-row-note">{failureContext}</span>
        ) : null}
        {slot.run ? (
          <button
            className="fb-btn light compact"
            onClick={() => onOpenRun(slot.run!.id)}
            type="button"
          >
            Open log
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FetchRunList({
  cronJob,
  expanded,
  jobRuns,
  runs,
  setExpanded,
}: {
  cronJob: LibraryCronJobStatus | null;
  expanded: boolean;
  jobRuns: AgentJobRunListItem[];
  runs: LibraryFetchRunListItem[];
  setExpanded: (value: (previous: boolean) => boolean) => void;
}) {
  const runJobIds = new Set(runs.map((run) => run.jobRunId).filter((id): id is string => Boolean(id)));
  const jobsByInstanceId = jobRunByInstanceId(jobRuns);
  const entries = [
    ...runs.map((run) => ({
      kind: "fetch" as const,
      id: run.id,
      startedAt: run.startedAt,
      run,
      jobRun: run.jobRunId ? jobsByInstanceId.get(run.jobRunId) : undefined,
    })),
    ...jobRuns
      .filter((jobRun) => !runJobIds.has(jobRun.instanceId))
      .map((jobRun) => ({
        kind: "job" as const,
        id: jobRun.id,
        startedAt: jobRun.startedAt,
        jobRun,
      })),
  ].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const visibleEntries = expanded ? entries : entries.slice(0, VISIBLE_RUN_LIMIT);

  return (
    <div className="sync-panel-run-list-shell">
      {entries.length === 0 ? (
        <EmptyState
          className="sync-panel-empty is-dashed"
          title="No Fetch sources runs"
          body="No Fetch sources runs yet. Runs appear after your Local Agent fetches sources."
        />
      ) : (
        <>
          <div
            aria-label="Fetch sources run history list"
            className="sync-panel-run-list sync-panel-run-list-scroll"
          >
            {visibleEntries.map((entry) => (
              entry.kind === "fetch"
                ? <RunCard key={entry.id} cronJob={cronJob} jobRun={entry.jobRun} run={entry.run} />
                : <JobRunCard key={entry.id} jobRun={entry.jobRun} />
            ))}
          </div>
          {entries.length > VISIBLE_RUN_LIMIT ? (
            <button
              aria-expanded={expanded}
              className="fb-btn light compact justify-center"
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              {expanded ? (
                "See less"
              ) : (
                <span className="sync-panel-see-more-label">
                  See more
                  <CountBadge value={entries.length - VISIBLE_RUN_LIMIT} />
                </span>
              )}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function jobRunLabel(jobRun: AgentJobRunListItem): string {
  return scheduledRunTriggerLabel(jobRun, "library-cron");
}

function jobRunStatusStyle(jobRun: AgentJobRunListItem): ReturnType<typeof statusStyle> {
  if (jobRun.status === "succeeded") return statusStyle("ok");
  if (jobRun.status === "running" || jobRun.status === "starting") return statusStyle("partial");
  return statusStyle("failed");
}

function jobRunStatusLabel(jobRun: AgentJobRunListItem): string {
  return scheduledJobRunStatusLabel(jobRun.status);
}

function interruptedFetchRunStatus(jobRun?: AgentJobRunListItem | null): {
  label: string;
  style: ReturnType<typeof statusStyle>;
} | null {
  if (!jobRun || isActiveJobRun(jobRun) || jobRun.status === "succeeded") return null;
  if (jobRun.status === "killed") {
    return { label: "Stopped", style: statusStyle("partial") };
  }
  if (jobRun.status === "replaced") {
    return { label: "Replaced", style: statusStyle("partial") };
  }
  return { label: jobRunStatusLabel(jobRun), style: statusStyle("failed") };
}

function jobRunDiagnostic(jobRun: AgentJobRunListItem): string | null {
  const details = readJobRunDetails(jobRun.details);
  const parts = [
    details.timeoutSeconds ? `timeout ${formatDuration(details.timeoutSeconds * 1000)}` : null,
    details.timeoutStage ? details.timeoutStage.replace(/_/g, " ") : null,
    details.timedOutWorker ? `worker ${details.timedOutWorker}` : null,
    details.timedOutWorkerPid ? `pid ${details.timedOutWorkerPid}` : null,
    details.termination === "still_alive_after_kill" ? "cleanup failed" : details.termination,
    details.reason && details.reason !== "timeout_seconds_for_job" ? details.reason.replace(/_/g, " ") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function ratioText(done: number, total: number, unit: string): string {
  if (total <= 0) return `${formatCount(done)} ${unit}${done === 1 ? "" : "s"}`;
  return `${formatCount(done)} / ${formatCount(total)} ${unit}${total === 1 ? "" : "s"}`;
}

function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

function fetchRunDisplaySummary(run: LibraryFetchRunListItem, stats: FetchRunStats, liveProgress: FetchJobProgress | null): string {
  if (!liveProgress) return run.summary;
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
  displayStatus,
  inflight,
  stats,
}: {
  displayStatus: { label: string };
  inflight: boolean;
  stats: FetchRunStats;
}): { tone: "ok" | "warn" | "fail"; text: string } {
  const accounted = stats.synced + stats.skipped + stats.failed + stats.actionNeeded;
  if (inflight) {
    return {
      tone: "warn",
      text: "Fetch is still running. Stage progress below updates as the Local Agent reports work.",
    };
  }
  if (stats.failed > 0 || ["Failed", "Stalled", "Timed out"].includes(displayStatus.label)) {
    return {
      tone: "fail",
      text: `${formatCount(stats.failed || 1)} planned post ${stats.failed === 1 ? "failed" : "failed"} before the run fully synced.`,
    };
  }
  if (stats.actionNeeded > 0) {
    return {
      tone: "warn",
      text: `${formatCount(stats.actionNeeded)} post ${stats.actionNeeded === 1 ? "needs" : "need"} Local Agent follow-up before it can be summarized.`,
    };
  }
  if (stats.planned > 0 && accounted >= stats.planned) {
    return {
      tone: "ok",
      text: "Completed. Planned posts were read, summarized, and synced or explicitly accounted for.",
    };
  }
  if (stats.planned > 0) {
    return {
      tone: "warn",
      text: "Run recorded planned posts, but not every post has a final sync outcome yet.",
    };
  }
  return {
    tone: "ok",
    text: "Completed. Sources were checked and no post work needed to continue.",
  };
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
            style={{ "--step-color": toneStyle(step.tone).color } as CSSProperties}
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
  const doneOrAccounted = stats.synced + stats.skipped + stats.failed + stats.actionNeeded;
  const steps: LifecycleStep[] = [
    {
      key: "sources",
      label: "Sources scanned",
      outcome: ratioText(stats.sourcesScanned, stats.sourcesTotal, "source"),
      tone: lifecycleTone(stats.sourcesScanned, stats.sourcesTotal),
      open: Boolean(current.source),
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Current source" value={<span>{current.source ?? "None"}</span>} />
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
          {current.task ? <FactRow label="Current task" value={<span>{current.task}</span>} /> : null}
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
          <FactRow label="Summarized posts" value={<span>{formatCount(stats.summarized)}</span>} />
          {stats.failed > 0 ? <FactRow label="Failed" value={<span className="sync-panel-task-danger">{formatCount(stats.failed)}</span>} /> : null}
        </dl>
      ),
    },
    {
      key: "sync",
      label: "Sync",
      outcome: ratioText(stats.synced, stats.planned, "post"),
      tone: lifecycleTone(doneOrAccounted, stats.planned, { failed: stats.failed }),
      open: Boolean(recentEvent?.message || stats.failed || stats.skipped || stats.actionNeeded),
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Synced" value={<span>{formatCount(stats.synced)}</span>} />
          {stats.skipped > 0 ? <FactRow label="Skipped" value={<span>{formatCount(stats.skipped)}</span>} /> : null}
          {stats.failed > 0 ? <FactRow label="Failed" value={<span className="sync-panel-task-danger">{formatCount(stats.failed)}</span>} /> : null}
          {stats.actionNeeded > 0 ? <FactRow label="Action needed" value={<span>{formatCount(stats.actionNeeded)}</span>} /> : null}
          {recentEvent?.message ? <FactRow label="Latest event" value={<span>{recentEvent.message}</span>} /> : null}
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

function JobRunCard({ jobRun }: { jobRun: AgentJobRunListItem }) {
  const hydrated = useHydrated();
  const style = jobRunStatusStyle(jobRun);
  const startedAtLabel = hydrated ? formatRelative(jobRun.startedAt) : formatAbsolute(jobRun.startedAt);
  const diagnostic = jobRunDiagnostic(jobRun);
  const liveProgress = readFetchJobProgress(jobRun.details);
  const fallbackSummary = isActiveJobRun(jobRun)
    ? "The Local Agent has started; no fetch log has been received yet."
    : "The Local Agent ended before FollowBrief received a fetch log.";
  return (
    <article className="sync-panel-run-card sync-panel-mobile-flat">
      <header className="sync-panel-run-card-head">
        <span
          className="fb-chip"
          style={{
            background: style.background,
            color: style.color,
            borderColor: style.border,
          }}
        >
          {jobRunStatusLabel(jobRun)}
        </span>
        <time
          className="sync-panel-run-card-time"
          dateTime={jobRun.startedAt}
          title={formatAbsolute(jobRun.startedAt)}
        >
          {startedAtLabel}
        </time>
        <span className="fb-chip">{jobRunLabel(jobRun)}</span>
        {jobRun.runtime ? (
          <span className="sync-panel-run-card-runtime">
            {jobRun.runtime}
            {jobRun.hostname ? ` · ${jobRun.hostname.replace(/\.local$/, "")}` : ""}
          </span>
        ) : null}
      </header>
      <p className="sync-panel-run-card-summary">
        {jobRun.summary || fallbackSummary}
      </p>
      <JobLifecycle details={{}} progress={liveProgress} />
      <div className="mono sync-panel-run-card-stage">
        {jobRun.stage || "runtime"} · {jobRun.finishedAt ? "finished" : "active"}
      </div>
      {diagnostic ? (
        <div className="mono sync-panel-run-card-stage">
          {diagnostic}
        </div>
      ) : null}
    </article>
  );
}

function RunCard({
  cronJob,
  jobRun,
  run,
}: {
  cronJob: LibraryCronJobStatus | null;
  jobRun?: AgentJobRunListItem;
  run: LibraryFetchRunListItem;
}) {
  const hydrated = useHydrated();
  const style = statusStyle(run.status);
  const label = STATUS_LABEL[run.status] ?? run.status;
  const details = readDetails(run.details);
  // Mid-sync: fetch-personal recorded the run but sync-builders hasn't patched
  // the per-post outcomes yet. The run-level status already reads "ok" here, so
  // show a live "Syncing…" badge to make the in-between state legible.
  const inflight = isRunInflight(run, jobRun, cronJob);
  const interruptedStatus = interruptedFetchRunStatus(jobRun);
  const displayStatus = !inflight && interruptedStatus
    ? interruptedStatus
    : { label, style };
  // Show the Local Agent that ran this fetch. Model names are kept out of the
  // run header because they are not useful for everyday readers.
  const agentLabel =
    details.agentRuntime || (run.cliVersion ? "Local Agent" : "");
  const startedAtLabel = hydrated ? formatRelative(run.startedAt) : formatAbsolute(run.startedAt);
  const diagnostic = jobRun ? jobRunDiagnostic(jobRun) : null;
  const liveProgress = jobRun ? readFetchJobProgress(jobRun.details) : null;
  const stats = fetchRunStats({ details, liveProgress, run });
  const displaySummary = fetchRunDisplaySummary(run, stats, liveProgress);
  const verdict = fetchRunVerdict({ displayStatus, inflight, stats });
  const sourceTotal = Math.max(stats.sourcesTotal, stats.sourcesScanned, run.buildersAttempted);

  return (
    <article
      className="sync-panel-run-card sync-panel-mobile-flat"
      id={runDomId(run.id)}
    >
      <header className="sync-panel-run-card-head">
        <span
          className="fb-chip"
          style={{
            background: displayStatus.style.background,
            color: displayStatus.style.color,
            borderColor: displayStatus.style.border,
          }}
        >
          {displayStatus.label}
        </span>
        {inflight ? (
          <span
            className="fb-chip sync-panel-live-chip"
            style={{
              background: "var(--warm-soft)",
              color: "color-mix(in oklch, var(--warm) 68%, var(--ink))",
              borderColor: "color-mix(in oklch, var(--warm) 30%, var(--line))",
            }}
          >
            <span
              aria-hidden="true"
              className="sync-panel-run-card-live-dot"
            />
            Updating…
          </span>
        ) : null}
        <time
          className="sync-panel-run-card-time"
          dateTime={run.startedAt}
          title={formatAbsolute(run.startedAt)}
        >
          {startedAtLabel}
        </time>
        <span className="fb-chip">{scheduledRunTriggerLabel(jobRun ?? null, "library-cron", run.source)}</span>
        {agentLabel ? (
          <span className="sync-panel-run-card-runtime">
            {agentLabel}
          </span>
        ) : null}
      </header>

      <p className="sync-panel-run-card-summary">
        {displaySummary}
      </p>

      <p className={`sync-panel-run-card-verdict is-${verdict.tone}`}>
        {verdict.text}
      </p>

      <div className="sync-panel-run-card-funnel">
        <span className="sync-panel-funnel-stat">
          <span className="mono sync-panel-funnel-stat-value">{formatCount(stats.sourcesScanned)}</span>
          <span className="sync-panel-funnel-stat-label">/{formatCount(sourceTotal)} sources</span>
        </span>
        <span aria-hidden="true" className="sync-panel-funnel-arrow">→</span>
        <span className="sync-panel-funnel-stat">
          <span className="mono sync-panel-funnel-stat-value">{formatCount(stats.planned)}</span>
          <span className="sync-panel-funnel-stat-label">planned</span>
        </span>
        <span aria-hidden="true" className="sync-panel-funnel-arrow">→</span>
        <span className="sync-panel-funnel-stat">
          <span className="mono sync-panel-funnel-stat-value">{formatCount(stats.read)}</span>
          <span className="sync-panel-funnel-stat-label">read</span>
        </span>
        <span aria-hidden="true" className="sync-panel-funnel-arrow">→</span>
        <span className="sync-panel-funnel-stat">
          <span className="mono sync-panel-funnel-stat-value">{formatCount(stats.summarized)}</span>
          <span className="sync-panel-funnel-stat-label">summarized</span>
        </span>
        <span aria-hidden="true" className="sync-panel-funnel-arrow">→</span>
        <span className="sync-panel-funnel-stat">
          <span className="mono sync-panel-funnel-stat-value">{formatCount(stats.synced)}</span>
          <span className="sync-panel-funnel-stat-label">synced</span>
        </span>
      </div>

      <div className="mono sync-panel-run-card-meta">
        <CountMeta
          label={stats.read === 1 ? "post read" : "posts read"}
          value={stats.read}
        /> ·{" "}
        <CountMeta label="posts planned" value={stats.planned} /> ·{" "}
        <CountMeta label={stats.actionNeeded === 1 ? "action needed" : "actions needed"} value={stats.actionNeeded} /> ·{" "}
        {formatDuration(run.durationMs)}
      </div>
      <JobLifecycle details={details} progress={liveProgress} run={run} />
      {diagnostic ? (
        <div className="mono sync-panel-run-card-stage">
          {diagnostic}
        </div>
      ) : null}

      <details className="sync-panel-run-card-details">
        <summary className="sync-panel-run-card-details-summary">
          Show details
        </summary>
        <div className="sync-panel-run-card-details-body">
          <DetailsBody details={details} liveProgress={liveProgress} />
        </div>
      </details>
    </article>
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

function isReadForStats(task: FetchTaskLog): boolean {
  if (!isPlannedPostTask(task) || isBlocked(task)) return false;
  if (typeof task.bodyChars === "number" && task.bodyChars > 0) return true;
  if (task.contentStatus === "ready" && task.status !== "failed" && task.status !== "skipped") {
    return true;
  }
  return task.status === "synced";
}

function isSummarizedForStats(task: FetchTaskLog): boolean {
  return isPlannedPostTask(task) && !isBlocked(task) && (isSummarized(task) || task.status === "synced");
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
      name: task.builder || "Unknown source",
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
): string | null {
  const liveWorker = liveTask?.workerId;
  if (typeof liveWorker === "string" && liveWorker.trim()) return liveWorker.trim();
  if (typeof task.workerId === "string" && task.workerId.trim()) return task.workerId.trim();
  return fallbackWorkerId(task);
}

function taskWorkerGroups(
  fetchTasks: FetchTaskLog[],
  liveTasks: Map<string, FetchTaskProgress>,
): FetchTaskWorkerGroup[] {
  const groups = new Map<string, FetchTaskWorkerGroup>();
  for (const task of fetchTasks) {
    const liveTask = task.id ? liveTasks.get(task.id) ?? null : null;
    const workerId = taskWorkerId(task, liveTask);
    const key = workerId ? `worker:${workerId}` : "worker:main";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: workerId ?? "Main worker",
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

function groupedTaskStats(tasks: FetchTaskLog[]) {
  return {
    discovery: tasks.filter(isCandidateDiscoveryTask).length,
    planned: tasks.filter(isPlannedPostTask).length,
    read: tasks.filter(isReadForStats).length,
    summarized: tasks.filter(isSummarizedForStats).length,
    synced: tasks.filter((task) => task.status === "synced").length,
  };
}

function DetailsBody({
  details,
  liveProgress,
}: {
  details: DetailsShape;
  liveProgress: FetchJobProgress | null;
}) {
  const userActions = Array.isArray(details.userActions) ? details.userActions : [];
  const localErrors = Array.isArray(details.localErrors) ? details.localErrors : [];
  const fetchTasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  const postTasks = fetchTasks.filter(isPlannedPostTask);
  const liveTasks = fetchTaskProgressMap(liveProgress);
  const taskGroups = taskWorkerGroups(postTasks, liveTasks);
  const prompts =
    details.prompts && typeof details.prompts === "object" && !Array.isArray(details.prompts)
      ? details.prompts
      : {};
  const promptEntries = Object.entries(prompts);

  return (
    <div className="sync-panel-run-card-details-stack">
      {postTasks.length > 0 ? (
        <div>
          <h3 className="sync-panel-run-card-detail-heading">
            Post tasks ({postTasks.length})
          </h3>
          <ul className="sync-panel-task-worker-group-list">
            {taskGroups.map((workerGroup) => {
              const workerStats = groupedTaskStats(workerGroup.tasks);
              return (
                <li className="sync-panel-task-worker-group" key={workerGroup.key}>
                  <details className="sync-panel-task-worker-details" open>
                    <summary className="sync-panel-task-worker-summary">
                      <span className="sync-panel-task-worker-name">{workerGroup.name}</span>
                      <span
                        aria-label={`${workerGroup.name}: ${workerGroup.tasks.length} tasks, ${workerStats.planned} planned, ${workerStats.read} read, ${workerStats.summarized} summarized, ${workerStats.synced} synced`}
                        className="mono sync-panel-task-worker-meta"
                      >
                        <span className="sync-panel-task-source-stat">
                          <strong>{formatCount(workerGroup.tasks.length)}</strong> tasks
                        </span>
                        <span className="sync-panel-task-source-stat">
                          <strong>{formatCount(workerStats.planned)}</strong> planned
                        </span>
                        <span className="sync-panel-task-source-stat">
                          <strong>{formatCount(workerStats.read)}</strong> read
                        </span>
                        <span className="sync-panel-task-source-stat">
                          <strong>{formatCount(workerStats.summarized)}</strong> summarized
                        </span>
                        <span className="sync-panel-task-source-stat">
                          <strong>{formatCount(workerStats.synced)}</strong> synced
                        </span>
                      </span>
                    </summary>
                    <ul className="sync-panel-task-source-group-list">
                      {workerGroup.sourceGroups.map((group) => {
                        const stats = groupedTaskStats(group.tasks);
                        return (
                          <li className="sync-panel-task-source-group" key={group.key}>
                            <details className="sync-panel-task-source-details" open>
                              <summary className="sync-panel-task-source-summary">
                                <span className="sync-panel-task-source-name">{group.name}</span>
                                <span
                                  aria-label={`${group.sourceType}: ${stats.discovery} discovery tasks, ${stats.planned} post tasks, ${stats.read} read, ${stats.summarized} summarized, ${stats.synced} synced`}
                                  className="mono sync-panel-task-source-meta"
                                >
                                  <span className="sync-panel-task-source-type">{group.sourceType}</span>
                                  {stats.discovery > 0 ? (
                                    <span className="sync-panel-task-source-stat">
                                      <strong>{formatCount(stats.discovery)}</strong> discovery
                                    </span>
                                  ) : null}
                                  <span className="sync-panel-task-source-stat">
                                    <strong>{formatCount(stats.planned)}</strong> posts
                                  </span>
                                  <span className="sync-panel-task-source-stat">
                                    <strong>{formatCount(stats.read)}</strong> read
                                  </span>
                                  <span className="sync-panel-task-source-stat">
                                    <strong>{formatCount(stats.summarized)}</strong> summarized
                                  </span>
                                  <span className="sync-panel-task-source-stat">
                                    <strong>{formatCount(stats.synced)}</strong> synced
                                  </span>
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

      {promptEntries.length > 0 ? (
        <div>
          <h3 className="sync-panel-run-card-detail-heading">
            Helper instructions
          </h3>
          <p className="sync-panel-detail-note">
            The instructions used to read and summarize each source type on
            this update.
          </p>
          <div className="sync-panel-detail-card-list">
            {promptEntries.map(([sourceType, bundle]) => (
              <details
                key={sourceType}
                className="sync-panel-detail-card"
              >
                <summary
                  className="sync-panel-detail-card-summary"
                  style={{ fontFamily: "var(--font-geist-mono)" }}
                >
                  {sourceType}
                </summary>
                <div className="sync-panel-detail-card-body">
                  <div>
                    <p
                      className="sync-panel-detail-kicker"
                      style={{ color: "var(--muted)" }}
                    >
                      Summary instructions
                    </p>
                    <pre
                      className="mono sync-panel-detail-code"
                      style={{ color: "var(--muted-strong)" }}
                    >
                      {bundle.summary ?? "(none)"}
                    </pre>
                  </div>
                  <div>
                    <p
                      className="sync-panel-detail-kicker-row"
                      style={{ color: "var(--muted)" }}
                    >
                      <span>Read instructions</span>
                      {bundle.fetchIsDefault ? (
                        <span
                          className="sync-panel-detail-default-pill"
                          style={{
                            background: "var(--paper)",
                            border: "1px solid var(--line)",
                            color: "var(--muted-strong)",
                            letterSpacing: "0.05em",
                          }}
                          title="No source-specific fetch prompt is configured for this source; the agent used the common fetching rules."
                        >
                          default
                        </span>
                      ) : null}
                    </p>
                    <pre
                      className="mono sync-panel-detail-code"
                      style={{ color: "var(--muted-strong)" }}
                    >
                      {bundle.fetch ?? "(none)"}
                    </pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
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
                <span className="sync-panel-detail-action-builder">{action.builder ?? ""}</span>
                {action.message ? (
                  <span className="sync-panel-detail-action-message">: {action.message}</span>
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
                      learn more
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
                style={{ color: "var(--danger)" }}
              >
                {message}
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
            style={{ color: "var(--danger)" }}
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
      promptEntries.length === 0 &&
      !details.cliFlags &&
      !details.error ? (
        <p className="sync-panel-detail-empty">
          No Fetch sources details were recorded for this run.
        </p>
      ) : null}
    </div>
  );
}

type Tone = "ok" | "warn" | "fail" | "idle";

function toneStyle(tone: Tone): { background: string; color: string } {
  switch (tone) {
    case "ok":
      return {
        background: "var(--signal-soft)",
        color: "color-mix(in oklch, var(--signal) 72%, var(--ink))",
      };
    case "warn":
      return {
        background: "var(--warm-soft)",
        color: "color-mix(in oklch, var(--warm) 68%, var(--ink))",
      };
    case "fail":
      return { background: "var(--danger-soft)", color: "var(--danger)" };
    default:
      return { background: "var(--paper)", color: "var(--muted-strong)" };
  }
}

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
  const code = (task.agentWorkType ?? task.fetchTool ?? "").trim();
  switch (code) {
    case "candidate_discovery_fallback":
      return {
        label: "Candidate discovery",
        blurb: "Direct discovery was blocked, so the Local Agent found candidate posts.",
        fix: null,
      };
    case "x_token_missing":
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
    (code.startsWith("user_action_") || code.includes("token_missing"))
  );
}

function isContentFailure(task: FetchTaskLog): boolean {
  return (
    task.status === "failed" &&
    (task.failureReason === "content_missing" ||
      task.failureReason === "content_too_short")
  );
}

function isCandidateDiscoveryTask(task: FetchTaskLog): boolean {
  return task.agentWorkType === "candidate_discovery_fallback";
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
    task.failureReason === "worker_missing_result" &&
    typeof task.bodyChars !== "number"
  ) {
    return { label: "Not completed", tone: "fail" };
  }
  if (typeof task.bodyChars === "number" && task.bodyChars > 0)
    return { label: "Read", tone: "ok" };
  if (task.contentStatus === "ready") return { label: "Read", tone: "ok" };
  return { label: "Needs Local Agent", tone: "idle" };
}

// Human-readable labels for the server/CLI failure reasons.
const FAILURE_REASON_LABEL: Record<string, string> = {
  summary_missing: "No summary was produced",
  not_summarized: "Read but no summary was created",
  not_synced: "Not synced",
  content_missing: "No readable content was found",
  content_too_short: "The readable content was too short",
  // Parallel-run outcomes backfilled by merge-task-results when a shard
  // worker never reported a task (crash/timeout) or discovery never expanded.
  worker_missing_result: "A parallel worker stopped before reporting this task",
  discovery_not_expanded: "Candidate discovery did not complete",
};

function failureReasonText(task: FetchTaskLog): string | null {
  if (!task.failureReason) return null;
  return FAILURE_REASON_LABEL[task.failureReason] ?? task.failureReason;
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
  return typeof task.summaryChars === "number" && task.summaryChars > 0;
}

function liveTaskHasBody(liveTask: FetchTaskProgress | null | undefined): boolean {
  return typeof liveTask?.bodyChars === "number" && liveTask.bodyChars > 0;
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
  if (!hasReadSignal(task, liveTask)) return { label: "Not reached", tone: "idle" };
  return { label: "Pending", tone: "warn" };
}

function taskStatusPill(
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
  if (liveStatus === "reading" || livePhase === "read") return { label: "reading", tone: "warn" };
  if (!hasReadSignal(task, liveTask)) return { label: "reading", tone: "idle" };
  if (liveStatus === "summarizing" || livePhase === "summarize") {
    return { label: "summarizing", tone: "warn" };
  }
  if (isSummarized(task) || liveStatus === "summarized") return { label: "syncing", tone: "warn" };
  return { label: "summarizing", tone: "warn" };
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
  if (isSummarized(task)) return { label: "Read & summarized", tone: "ok" };
  if (task.status === "failed") return { label: "Failed", tone: "fail" };
  if (task.status === "action_needed") return { label: "Action needed", tone: "fail" };
  if (isBlocked(task)) return { label: "Action needed", tone: "fail" };
  if (!hasReadSignal(task, liveTask)) {
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
  return `Worker ${status}`;
}

function liveFetchOutcome(
  task: FetchTaskLog,
  liveTask: FetchTaskProgress | null | undefined,
): { label: string; tone: Tone } {
  const phase = String(liveTask?.phase ?? "").toLowerCase();
  const status = String(liveTask?.status ?? "").toLowerCase();
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
  const missingShard = task.evidence?.missingShard;
  if (!missingShard || typeof missingShard !== "object") return null;
  const shard = "shard" in missingShard ? String(missingShard.shard) : null;
  const resultFile = "resultFile" in missingShard ? String(missingShard.resultFile) : null;
  if (!shard && !resultFile) return null;
  const parts = [];
  if (shard) parts.push(shard);
  if (resultFile) parts.push(`missing ${resultFile}`);
  return parts.join(" · ");
}

function workerLogText(task: FetchTaskLog): string | null {
  const missingShard = task.evidence?.missingShard;
  if (!missingShard || typeof missingShard !== "object") return null;
  if (!("workerLogTail" in missingShard)) return null;
  const tail = missingShard.workerLogTail;
  return typeof tail === "string" && tail.trim() ? tail.trim() : null;
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

function TaskRow({
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
  const bannerStyle = toneStyle(banner.tone);
  const liveLabel = liveTaskLabel(liveTask);
  const liveTone = liveTaskTone(liveTask);
  const pill = discoveryState?.expanded
    ? discoveryState.synced
      ? { label: "synced", tone: "ok" as Tone }
      : { label: "syncing", tone: "warn" as Tone }
    : taskStatusPill(task, liveTask);

  const agentLabel = [task.agentRuntime, task.agentModel].filter(Boolean).join(" · ");
  const bodySize = sizeText(task.bodyChars, task.bodyWords);
  const summarySize = sizeText(task.summaryChars, task.summaryWords);
  const liveBodySize = sizeText(liveTask?.bodyChars, liveTask?.bodyWords);
  const liveSummarySize = sizeText(liveTask?.summaryChars, liveTask?.summaryWords);
  const compression = compressionText(task.bodyChars, task.summaryChars);
  const bannerBlurb =
    banner.tone === "fail"
      ? failureReasonText(task) ?? work.blurb
      : work.blurb;
  const missingShard = missingShardText(task);
  const workerLog = workerLogText(task);
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
    discoveryExpansion ||
    summarySize ||
    liveSummarySize ||
    compression ||
    failureReasonText(task) ||
    missingShard ||
    workerLog;
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
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Source type" value={<span>{task.sourceType ?? "Unknown source type"}</span>} />
          {task.builder ? <FactRow label="Source" value={<span>{task.builder}</span>} /> : null}
          {task.contentStatus ? <FactRow label="Content status" value={<span>{task.contentStatus.replace(/_/g, " ")}</span>} /> : null}
        </dl>
      ),
    },
    {
      key: "read",
      label: isDiscovery ? "Discover" : "Read",
      outcome: fetchRes.label,
      tone: fetchRes.tone,
      open: fetchRes.tone === "fail" || (!isSummarized(task) && !isDiscovery && fetchRes.tone === "idle"),
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
                  {task.url}
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
          {discoveryExpansion ? (
            <FactRow label="Expanded into" value={<span>{discoveryExpansion}</span>} />
          ) : null}
          {summarySize ? <FactRow label="Summary size" value={summarySize} /> : null}
          {!summarySize && liveSummarySize ? <FactRow label="Live summary size" value={liveSummarySize} /> : null}
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
          {workerLog ? (
            <FactRow
              label="Worker log"
              value={<span className="mono">{workerLog}</span>}
            />
          ) : null}
          {!hasSummaryDetail ? (
            <FactRow
              label="Status"
              value={
                <span className="sync-panel-task-muted">
                  {isDiscovery
                    ? "The Local Agent hasn't expanded this discovery task yet."
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
          {liveTask?.message ? <FactRow label="Latest event" value={<span>{liveTask.message}</span>} /> : null}
          {liveTask?.workerId ? <FactRow label="Worker" value={<span>{liveTask.workerId}</span>} /> : null}
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
          {task.sourceType ? (
            <span className="mono sync-panel-task-source-type">
              {task.sourceType}
            </span>
          ) : null}
          <span
            className="sync-panel-task-status-pill"
            style={{ ...toneStyle(pill.tone), fontFamily: "var(--font-geist-mono)" }}
          >
            {pill.label}
          </span>
          <span className="sync-panel-task-title">
            {task.title ?? task.url ?? "Untitled task"}
          </span>
          {task.builder ? (
            <span className="sync-panel-task-builder">· {task.builder}</span>
          ) : null}
        </summary>

        <div className="sync-panel-task-body">
          <div
            className="sync-panel-task-banner"
            style={bannerStyle}
          >
            {banner.label}
            {bannerBlurb ? (
              <span className="sync-panel-task-banner-blurb">: {bannerBlurb}</span>
            ) : null}
          </div>

          {liveLabel ? (
            <div
              className="sync-panel-task-banner"
              style={toneStyle(liveTone)}
            >
              {liveLabel}
              {liveTask?.message ? (
                <span className="sync-panel-task-banner-blurb">: {liveTask.message}</span>
              ) : null}
              {liveTask?.workerId ? (
                <span className="sync-panel-task-banner-blurb"> · {liveTask.workerId}</span>
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

          <details className="sync-panel-task-technical">
            <summary className="sync-panel-task-technical-summary">
              Technical details
            </summary>
            <pre className="mono sync-panel-task-technical-code">
              {JSON.stringify(task, null, 2)}
            </pre>
          </details>
        </div>
      </details>
    </li>
  );
}
