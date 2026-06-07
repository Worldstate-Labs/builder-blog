"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Activity, ChevronDown, ChevronRight, ChevronUp, Clock3 } from "lucide-react";
import { CountBadge, CountMeta, CountMetric, formatCount } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { useHydrated } from "@/components/ThemeToggle";
import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import { contentSyncStateChanged } from "@/lib/content-sync-events";
import { displayLanguagePreference } from "@/lib/language-preference";

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

// A run is "in flight" between the two writes: fetch-personal POSTed the row
// (tasks fetched/pending) but sync-builders hasn't PATCHed the per-post
// outcomes yet (which flip them to synced/skipped/failed). We bound this by run
// age so a run that ended without a PATCH (agent crashed mid-work) stops being
// chased after a while instead of polling forever.
const INFLIGHT_MAX_AGE_MS = 30 * 60_000;
function isRunInflight(run: LibraryFetchRunListItem): boolean {
  const ageMs = Date.now() - Date.parse(run.startedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > INFLIGHT_MAX_AGE_MS) return false;
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

function addScheduleInterval(date: Date, cronJob: LibraryCronJobStatus, steps = 1): Date {
  const next = new Date(date);
  switch (cronJob.frequencyKey) {
    case "daily":
      next.setDate(next.getDate() + steps);
      return next;
    case "weekly":
      next.setDate(next.getDate() + steps * 7);
      return next;
    default:
      return new Date(date.getTime() + cronJob.intervalMinutes * 60_000 * steps);
  }
}

function floorToExpectedSchedule(now: Date, cronJob: LibraryCronJobStatus): Date {
  const value = new Date(now);
  value.setSeconds(0, 0);

  switch (cronJob.frequencyKey) {
    case "30m":
      value.setMinutes(value.getMinutes() >= 30 ? 30 : 0);
      return value;
    case "1h":
      value.setMinutes(0);
      return value;
    case "3h":
    case "6h":
    case "12h": {
      const hours = cronJob.intervalMinutes / 60;
      value.setHours(Math.floor(value.getHours() / hours) * hours, 0, 0, 0);
      return value;
    }
    case "daily":
      value.setHours(8, 0, 0, 0);
      if (value.getTime() > now.getTime()) value.setDate(value.getDate() - 1);
      return value;
    case "weekly": {
      value.setHours(8, 0, 0, 0);
      const daysSinceMonday = (value.getDay() + 6) % 7;
      value.setDate(value.getDate() - daysSinceMonday);
      if (value.getTime() > now.getTime()) value.setDate(value.getDate() - 7);
      return value;
    }
    default: {
      const startedAt = Date.parse(cronJob.startedAt);
      const intervalMs = Math.max(1, cronJob.intervalMinutes) * 60_000;
      const elapsed = now.getTime() - startedAt;
      const slotIndex = Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / intervalMs) : 0;
      return new Date(startedAt + slotIndex * intervalMs);
    }
  }
}

function cronGraceMs(cronJob: LibraryCronJobStatus): number {
  const minutes = Math.min(30, Math.max(5, Math.round(cronJob.intervalMinutes * 0.1)));
  return minutes * 60_000;
}

function isActiveJobRun(jobRun: AgentJobRunListItem): boolean {
  return jobRun.status === "starting" || jobRun.status === "running";
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
  const startedAt = Date.parse(cronJob.startedAt);
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
    if (cursor.getTime() + graceMs >= startedAt) {
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
    () => getFetchUpdateStatus(cronJob, cronStatus.slots, runs),
    [cronJob, cronStatus.slots, runs],
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
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  useEffect(() => {
    jobRunsRef.current = jobRuns;
  }, [jobRuns]);

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
        setError(err instanceof Error ? err.message : "Refresh failed");
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
      const inflight = runsRef.current.some(isRunInflight) ||
        jobRunsRef.current.some((run) => isActiveJobRun(run));
      timer = window.setTimeout(tick, inflight ? POLL_INFLIGHT_MS : POLL_IDLE_MS);
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
            role="tablist"
          >
            <button
              aria-selected={activeTab === "status"}
              className={`fb-btn compact ${activeTab === "status" ? "" : "light"}`}
              onClick={() => setActiveTab("status")}
              role="tab"
              type="button"
            >
              <Activity aria-hidden="true" />
              Fetch status
            </button>
            <button
              aria-selected={activeTab === "log"}
              className={`fb-btn compact ${activeTab === "log" ? "" : "light"}`}
              onClick={() => setActiveTab("log")}
              role="tab"
              type="button"
            >
              <Clock3 aria-hidden="true" />
              Fetch log
              <span className="sr-only">Run history</span>
            </button>
          </div>

          {activeTab === "status" ? (
            <FetchStatusPanel
              cronJob={cronJob}
              nextExpectedAt={cronStatus.nextExpectedAt}
              onOpenRun={openRun}
              slots={cronStatus.slots}
            />
          ) : (
            <FetchRunList
              expanded={expanded}
              jobRuns={jobRuns}
              runs={runs}
              setExpanded={setExpanded}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

function getFetchUpdateStatus(
  cronJob: LibraryCronJobStatus | null,
  slots: CronSlot[],
  runs: LibraryFetchRunListItem[],
): FetchUpdateStatus {
  const activeRun = runs.find(isRunInflight);
  if (activeRun) {
    return {
      key: "syncing",
      label: "Syncing",
      summary: "A Fetch sources run is still writing post outcomes.",
      style: statusStyle("partial"),
    };
  }
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

  const problemCount = slots.filter((slot) => slot.status === "missed" || slot.status === "failed").length;
  const okCount = slots.filter((slot) => slot.status === "ok").length;
  if (problemCount > 0) {
    return {
      key: "needs-attention",
      label: "Needs attention",
      summary: `${problemCount} scheduled ${problemCount === 1 ? "run needs" : "runs need"} review.`,
      style: statusStyle("failed"),
    };
  }
  if (okCount > 0) {
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
        <div className="sync-panel-chip-row">
          <span className="fb-chip">Stopped</span>
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
  const problemCount = missedCount + failedCount;
  const waitingCount = slots.filter((slot) => slot.status === "waiting").length;
  const problemDetail =
    missedCount > 0 && failedCount > 0
      ? `${missedCount} scheduled ${missedCount === 1 ? "window has" : "windows have"} no recorded fetch run; ${failedCount} recorded ${failedCount === 1 ? "run did" : "runs did"} not finish successfully.`
      : missedCount > 0
        ? `${missedCount} scheduled ${missedCount === 1 ? "window has" : "windows have"} no recorded fetch run in ${missedCount === 1 ? "its" : "their"} expected time range.`
        : `${failedCount} recorded ${failedCount === 1 ? "run did" : "runs did"} not finish successfully.`;
  const statusTone =
    problemCount > 0
      ? statusStyle("failed")
      : okCount > 0
        ? statusStyle("ok")
        : statusStyle("partial");

  return (
    <div className="sync-panel-card">
      <div className="sync-panel-layout">
        <div className="sync-panel-column">
          <div className="sync-panel-chip-row">
            <span
              className="fb-chip"
              style={{
                background: statusTone.background,
                borderColor: statusTone.border,
                color: statusTone.color,
              }}
            >
              {problemCount > 0 ? "Needs attention" : okCount > 0 ? "Healthy" : "Waiting"}
            </span>
            <span className="fb-chip">{cronJob.frequencyLabel}</span>
            {cronJob.overrideFetched ? <span className="fb-chip">refreshes library posts</span> : null}
          </div>
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
            <CountMetric label="Issue" tone="issue" value={problemCount} />
            <CountMetric label="Waiting" tone="waiting" value={waitingCount} />
          </div>
          {problemCount > 0 ? (
            <p className="sync-panel-status-note" style={{ color: statusTone.color }}>
              {problemDetail}
            </p>
          ) : null}
        </div>

        {slots.length > 0 ? (
          <div className="sync-panel-column">
            <div className="sync-panel-timeline-head">
              <span className="sync-panel-timeline-title">
                Last {slots.length} scheduled {slots.length === 1 ? "window" : "windows"}
              </span>
              <span>Green OK · amber waiting · red issue.</span>
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
  if (status === "ok") return statusStyle("ok");
  if (status === "failed" || status === "missed") return statusStyle("failed");
  if (status === "stalled") return statusStyle("failed");
  return statusStyle("partial");
}

function cronSlotLabel(status: CronSlotStatus): string {
  if (status === "ok") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "missed") return "Missed";
  if (status === "running") return "Running";
  if (status === "stalled") return "Stalled";
  return "Waiting";
}

function CronSlotBar({ onSelect, slot }: { onSelect: () => void; slot: CronSlot }) {
  const style = cronSlotStyle(slot.status);
  const heightClass =
    slot.status === "ok"
      ? "is-tall"
      : slot.status === "waiting" || slot.status === "running"
        ? "is-short"
        : "is-medium";
  const label = cronSlotLabel(slot.status);
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
  const label = cronSlotLabel(slot.status);
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
        <span className="mono sync-panel-slot-row-note">
          {slot.jobRun && !slot.run
            ? `${jobRunStatusLabel(slot.jobRun)} · ${slot.jobRun.runtime || "Local Agent"}`
            : slot.run
            ? `${slot.run.itemsFetched} fetched · ${formatDuration(slot.run.durationMs)}`
            : "No run recorded"}
        </span>
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
  expanded,
  jobRuns,
  runs,
  setExpanded,
}: {
  expanded: boolean;
  jobRuns: AgentJobRunListItem[];
  runs: LibraryFetchRunListItem[];
  setExpanded: (value: (previous: boolean) => boolean) => void;
}) {
  const runJobIds = new Set(runs.map((run) => run.jobRunId).filter((id): id is string => Boolean(id)));
  const entries = [
    ...runs.map((run) => ({ kind: "fetch" as const, id: run.id, startedAt: run.startedAt, run })),
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
    <div className="sync-panel-run-list">
      {entries.length === 0 ? (
        <EmptyState
          className="sync-panel-empty is-dashed"
          title="No Fetch sources runs"
          body="No Fetch sources runs yet. Runs appear after your Local Agent fetches sources."
        />
      ) : (
        <>
          {visibleEntries.map((entry) => (
            entry.kind === "fetch"
              ? <RunCard key={entry.id} run={entry.run} />
              : <JobRunCard key={entry.id} jobRun={entry.jobRun} />
          ))}
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
  if (jobRun.trigger === "scheduled") return "Scheduled";
  if (jobRun.trigger === "one_time") return "One-time";
  return "Manual";
}

function jobRunStatusStyle(jobRun: AgentJobRunListItem): ReturnType<typeof statusStyle> {
  if (jobRun.status === "succeeded") return statusStyle("ok");
  if (jobRun.status === "running" || jobRun.status === "starting") return statusStyle("partial");
  return statusStyle("failed");
}

function jobRunStatusLabel(jobRun: AgentJobRunListItem): string {
  switch (jobRun.status) {
    case "succeeded":
      return "Succeeded";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "timed_out":
      return "Timed out";
    case "killed":
      return "Killed";
    case "stale":
      return "Stale";
    case "replaced":
      return "Replaced";
    case "failed":
      return "Failed";
    default:
      return jobRun.status.replace(/_/g, " ");
  }
}

function JobRunCard({ jobRun }: { jobRun: AgentJobRunListItem }) {
  const hydrated = useHydrated();
  const style = jobRunStatusStyle(jobRun);
  const startedAtLabel = hydrated ? formatRelative(jobRun.startedAt) : formatAbsolute(jobRun.startedAt);
  return (
    <article className="sync-panel-run-card">
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
        {jobRun.summary || "Runtime job did not create a fetch log entry."}
      </p>
      <div className="mono sync-panel-run-card-stage">
        {jobRun.stage || "runtime"} · {jobRun.finishedAt ? "finished" : "active"}
      </div>
    </article>
  );
}

function RunCard({ run }: { run: LibraryFetchRunListItem }) {
  const hydrated = useHydrated();
  const style = statusStyle(run.status);
  const label = STATUS_LABEL[run.status] ?? run.status;
  const details = readDetails(run.details);
  // Mid-sync: fetch-personal recorded the run but sync-builders hasn't patched
  // the per-post outcomes yet. The run-level status already reads "ok" here, so
  // show a live "Syncing…" badge to make the in-between state legible.
  const inflight = isRunInflight(run);
  // Show the Local Agent that ran this fetch. Model names are kept out of the
  // run header because they are not useful for everyday readers.
  const agentLabel =
    details.agentRuntime || (run.cliVersion ? "Local Agent" : "");
  const startedAtLabel = hydrated ? formatRelative(run.startedAt) : formatAbsolute(run.startedAt);

  return (
    <article
      className="sync-panel-run-card"
      id={runDomId(run.id)}
    >
      <header className="sync-panel-run-card-head">
        <span
          className="fb-chip"
          style={{
            background: style.background,
            color: style.color,
            borderColor: style.border,
          }}
        >
          {label}
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
        <span className="fb-chip">{run.source === "cron" ? "Scheduled" : "One-time"}</span>
        {agentLabel ? (
          <span className="sync-panel-run-card-runtime">
            {agentLabel}
          </span>
        ) : null}
      </header>

      <p className="sync-panel-run-card-summary">
        {run.summary}
      </p>

      <div className="mono sync-panel-run-card-meta">
        <CountMeta
          label={run.itemsFetched === 1 ? "post fetched" : "posts fetched"}
          value={run.itemsFetched}
        /> ·{" "}
        <CountMeta label="posts checked" value={run.tasksGenerated} /> ·{" "}
        <CountMeta label={run.userActionsCount === 1 ? "action needed" : "actions needed"} value={run.userActionsCount} /> ·{" "}
        {formatDuration(run.durationMs)}
      </div>

      <details className="sync-panel-run-card-details">
        <summary className="sync-panel-run-card-details-summary">
          Show details
        </summary>
        <div className="sync-panel-run-card-details-body">
          <DetailsBody details={details} />
        </div>
      </details>
    </article>
  );
}

function DetailsBody({ details }: { details: DetailsShape }) {
  const perBuilder = Array.isArray(details.perBuilder) ? details.perBuilder : [];
  const userActions = Array.isArray(details.userActions) ? details.userActions : [];
  const localErrors = Array.isArray(details.localErrors) ? details.localErrors : [];
  const fetchTasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  const prompts =
    details.prompts && typeof details.prompts === "object" && !Array.isArray(details.prompts)
      ? details.prompts
      : {};
  const promptEntries = Object.entries(prompts);

  return (
    <div className="sync-panel-run-card-details-stack">
      {perBuilder.length > 0 ? (
        <div>
          <h3 className="sync-panel-run-card-detail-heading">
            Sources
          </h3>
          <ul className="sync-panel-run-card-source-list">
            {perBuilder.map((entry, index) => (
              <li
                key={entry.builderId ?? `${entry.name ?? "builder"}-${index}`}
                className="sync-panel-fetch-source-row"
              >
                <span className="sync-panel-fetch-source-name">{entry.name ?? "Unknown source"}</span>
                <span className="mono sync-panel-fetch-source-meta">
                  {entry.sourceType ?? "Unknown source type"} ·{" "}
                  {formatCount(entry.itemsFetched ?? 0)}{" "}
                  {(entry.itemsFetched ?? 0) === 1 ? "post" : "posts"} ·{" "}
                  {formatCount(entry.tasksGenerated ?? 0)} posts checked
                </span>
                {entry.error ? (
                  <span className="sync-panel-fetch-source-error">{entry.error}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {fetchTasks.length > 0 ? (
        <div>
          <h3 className="sync-panel-run-card-detail-heading">
            Posts checked ({fetchTasks.length})
          </h3>
          <ul className="sync-panel-run-card-candidate-list">
            {fetchTasks.map((task, index) => (
              <TaskRow
                key={task.id ?? `${task.builderId ?? "task"}-${index}`}
                task={task}
              />
            ))}
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
                      <span>Fetch instructions</span>
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

      {perBuilder.length === 0 &&
      userActions.length === 0 &&
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
        blurb:
          "The video transcript was read and summarized.",
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

function fetchOutcome(task: FetchTaskLog): { label: string; tone: Tone } {
  if (isBlocked(task)) return { label: "Blocked", tone: "fail" };
  // A content failure is a fetch-stage failure (no real crawled content).
  if (isContentFailure(task)) return { label: "Failed", tone: "fail" };
  if (typeof task.bodyChars === "number" && task.bodyChars > 0)
    return { label: "Fetched", tone: "ok" };
  if (task.contentStatus === "ready") return { label: "Fetched", tone: "ok" };
  return { label: "Needs Local Agent", tone: "idle" };
}

// Human-readable labels for the server/CLI failure reasons.
const FAILURE_REASON_LABEL: Record<string, string> = {
  summary_missing: "No summary was produced",
  not_summarized: "Fetched but no summary was created",
  not_synced: "Not saved",
  content_missing: "No readable content was found",
  content_too_short: "The readable content was too short",
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

function summarizeOutcome(task: FetchTaskLog): { label: string; tone: Tone } {
  if (isSummarized(task)) return { label: "Summarized", tone: "ok" };
  // Skipped (no content) or a content failure means summarize never ran.
  if (task.status === "skipped") return { label: "Skipped", tone: "idle" };
  if (isContentFailure(task)) return { label: "Not reached", tone: "idle" };
  // A task is successful only when it ends with a summary; a missing summary is
  // a failure, not a benign "pending".
  if (task.status === "failed") return { label: "Failed", tone: "fail" };
  if (isBlocked(task)) return { label: "Not reached", tone: "idle" };
  return { label: "Pending", tone: "warn" };
}

function statusBanner(task: FetchTaskLog): { label: string; tone: Tone } {
  // A deliberate, evidence-backed skip (no primary content) is a clean terminal
  // state, not a failure.
  if (task.status === "skipped") return { label: "Skipped: no content", tone: "idle" };
  // Success is defined by a persisted summary — NOT by contentStatus="ready"
  // (that only means the body was fetched; the summarize step can still fail).
  if (isSummarized(task)) return { label: "Fetched & summarized", tone: "ok" };
  if (task.status === "failed") return { label: "Failed", tone: "fail" };
  if (task.status === "action_needed") return { label: "Action needed", tone: "fail" };
  if (isBlocked(task)) return { label: "Action needed", tone: "fail" };
  return { label: "Awaiting summary", tone: "warn" };
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

function StageBlock({
  title,
  tone,
  outcome,
  children,
}: {
  title: string;
  tone: Tone;
  outcome: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="sync-panel-task-stage-head">
        <h4 className="sync-panel-task-stage-title">
          {title}
        </h4>
        <span
          className="sync-panel-task-stage-outcome"
          style={{ ...toneStyle(tone), fontFamily: "var(--font-geist-mono)" }}
        >
          {outcome}
        </span>
      </div>
      <dl className="sync-panel-task-fact-list">{children}</dl>
    </div>
  );
}

function TaskRow({ task }: { task: FetchTaskLog }) {
  const work = describeWork(task);
  const fetchRes = fetchOutcome(task);
  const sumRes = summarizeOutcome(task);
  const banner = statusBanner(task);
  const bannerStyle = toneStyle(banner.tone);
  const ready = task.contentStatus === "ready";
  // Colour the type pill by the real outcome, not by "ready" (a ready fetch can
  // still fail to summarize).
  const pillTone: Tone = banner.tone;

  const agentLabel = [task.agentRuntime, task.agentModel].filter(Boolean).join(" · ");
  const bodySize = sizeText(task.bodyChars, task.bodyWords);
  const summarySize = sizeText(task.summaryChars, task.summaryWords);
  const compression = compressionText(task.bodyChars, task.summaryChars);

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
            style={{ ...toneStyle(pillTone), fontFamily: "var(--font-geist-mono)" }}
          >
            {ready ? "ready" : "Local Agent"}
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
            {work.blurb ? (
              <span className="sync-panel-task-banner-blurb">: {work.blurb}</span>
            ) : null}
          </div>

          {work.fix ? (
            <div className="sync-panel-task-fix">
              <span className="sync-panel-task-fix-label">How to fix: </span>
              {work.fix}
              {work.fixHref ? (
                <>
                  {" "}
                  <a className="sync-panel-task-link" href={work.fixHref}>
                    open settings
                  </a>
                </>
              ) : null}
            </div>
          ) : null}

          <StageBlock title="① Read" tone={fetchRes.tone} outcome={fetchRes.label}>
            <FactRow label="Method" value={<span>{work.label}</span>} />
            {bodySize ? <FactRow label="Content size" value={bodySize} /> : null}
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
          </StageBlock>

          <StageBlock title="② Summarize" tone={sumRes.tone} outcome={sumRes.label}>
            {agentLabel ? (
              <FactRow label="Local Agent" value={<span>{agentLabel}</span>} />
            ) : null}
            {summarySize ? <FactRow label="Summary size" value={summarySize} /> : null}
            {compression ? <FactRow label="Compression" value={compression} /> : null}
            {!isSummarized(task) && !isContentFailure(task) && failureReasonText(task) ? (
              <FactRow
                label="Reason"
                value={
                  <span className="sync-panel-task-danger">{failureReasonText(task)}</span>
                }
              />
            ) : null}
            {!agentLabel && !summarySize && !failureReasonText(task) ? (
              <p className="sync-panel-task-note">
                {sumRes.label === "Not reached"
                  ? "Fetch was blocked, so no summary was produced."
                  : sumRes.label === "Failed"
                    ? "This post failed to summarize, so it was not saved."
                    : "The Local Agent hasn't summarized this post yet."}
              </p>
            ) : null}
          </StageBlock>

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
