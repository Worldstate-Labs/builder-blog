"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Activity, ChevronDown, ChevronRight, ChevronUp, Clock3 } from "lucide-react";
import { useHydrated } from "@/components/ThemeToggle";
import { contentSyncStateChanged } from "@/lib/content-sync-events";

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
  // When true, the fetch prompt above is the shared FollowBrief
  // default — admin hasn't configured a custom fetch prompt for this
  // source. UI flags this with a small "default" pill so users know
  // editing the admin field would change it.
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
  if (!RELATIVE_FORMATTER) return new Date(iso).toLocaleString();
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

type CronSlotStatus = "ok" | "failed" | "missed" | "waiting";

type CronSlot = {
  expectedAt: string;
  windowEnd: string;
  status: CronSlotStatus;
  run: LibraryFetchRunListItem | null;
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

function buildCronStatus(
  cronJob: LibraryCronJobStatus | null,
  runs: LibraryFetchRunListItem[],
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
    const status: CronSlotStatus = match
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
    };
  });

  return { slots, nextExpectedAt: nextExpected.toISOString() };
}

export function FetchLogPanel({
  initialRuns,
  initialCronRuns,
  initialCronJob,
  actions,
}: {
  initialRuns: LibraryFetchRunListItem[];
  initialCronRuns: LibraryFetchRunListItem[];
  initialCronJob: LibraryCronJobStatus | null;
  actions?: ReactNode;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [cronRuns, setCronRuns] = useState(initialCronRuns);
  const [cronJob, setCronJob] = useState(initialCronJob);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"status" | "log">("status");
  const cronStatus = useMemo(() => buildCronStatus(cronJob, cronRuns), [cronJob, cronRuns]);
  const updateStatus = useMemo(
    () => getFetchUpdateStatus(cronJob, cronStatus.slots, runs),
    [cronJob, cronStatus.slots, runs],
  );
  const hydrated = useHydrated();

  // Latest runs, readable inside the poll loop without re-arming the interval
  // on every refresh. Synced in an effect (not during render) so the poll loop
  // sees fresh data while keeping the [refresh]-only effect stable.
  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

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
              cronJob?: LibraryCronJobStatus | null;
              error?: string;
            }
          | null;
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setRuns(Array.isArray(body?.runs) ? body.runs : []);
        setCronRuns(Array.isArray(body?.cronRuns) ? body.cronRuns : []);
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
      const inflight = runsRef.current.some(isRunInflight);
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
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="fb-section-heading">Fetch sync</h2>
            <FetchStatusToggle
              detailsOpen={detailsOpen}
              onToggle={() => setDetailsOpen((value) => !value)}
              status={updateStatus}
            />
          </div>
          <FetchScheduleSummary
            cronJob={cronJob}
            hydrated={hydrated}
            nextExpectedAt={cronStatus.nextExpectedAt}
            status={updateStatus}
          />
        </div>
        {actions ? (
          <div className="digest-updates-actions">
            {actions}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-[12px] text-[var(--danger)]">{error}</p>
      ) : null}

      {detailsOpen ? (
        <div id="fetch-sync-details">
          <div
            aria-label="Fetch sync views"
            className="fb-segmented-tabs mt-4 inline-flex rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)] p-1"
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
      summary: "A fetch run is still updating item outcomes.",
      style: statusStyle("partial"),
    };
  }
  if (!cronJob) {
    return {
      key: "not-connected",
      label: "Not connected",
      summary: "No local fetch schedule has reported yet.",
      style: statusStyle("partial"),
    };
  }
  if (cronJob.status !== "active") {
    return {
      key: "stopped",
      label: "Stopped",
      summary: "The recurring fetch schedule is stopped.",
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
      title={detailsOpen ? "Hide fetch sync details" : "Show fetch sync details"}
      type="button"
    >
      {status.label}
      <span aria-hidden="true" className="digest-status-toggle-hint">Details</span>
      <Icon aria-hidden="true" />
    </button>
  );
}

function FetchScheduleSummary({
  cronJob,
  hydrated,
  nextExpectedAt,
  status,
}: {
  cronJob: LibraryCronJobStatus | null;
  hydrated: boolean;
  nextExpectedAt: string | null;
  status: FetchUpdateStatus;
}) {
  if (!cronJob) {
    return (
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
        {status.summary} Fetch history appears after the local CLI runs.
      </p>
    );
  }

  if (cronJob.status !== "active") {
    return (
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
        Schedule stopped
        {cronJob.stoppedAt
          ? ` ${hydrated ? formatRelative(cronJob.stoppedAt) : formatAbsolute(cronJob.stoppedAt)}`
          : ""}
        . One-time fetch runs can still be started from the local helper.
      </p>
    );
  }

  const nextLabel = nextExpectedAt
    ? hydrated
      ? formatRelative(nextExpectedAt)
      : formatAbsolute(nextExpectedAt)
    : null;

  return (
    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
      {status.summary} · {cronJob.frequencyLabel}
      {nextLabel ? ` · next ${nextLabel}` : ""}
      {cronJob.overrideFetched ? " · refreshes already fetched items" : ""}
    </p>
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
      <div className="mt-4 rounded-[10px] border border-dashed border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
        No library fetch cron has reported its schedule yet.
      </div>
    );
  }

  if (cronJob.status !== "active") {
    return (
      <div className="mt-4 rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="fb-chip">Stopped</span>
          {cronJob.stoppedAt ? (
            <time
              className="text-[12.5px] text-[var(--muted-strong)]"
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
    <div className="mt-4 rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
            {cronJob.overrideFetched ? <span className="fb-chip">refreshes fetched items</span> : null}
          </div>
          <dl className="mt-3 grid gap-2 text-[12.5px] text-[var(--muted-strong)]">
            <div className="flex items-baseline justify-between gap-3">
              <dt>Started</dt>
              <dd className="text-right text-[var(--ink)]">
                {hydrated ? formatRelative(cronJob.startedAt) : formatAbsolute(cronJob.startedAt)}
              </dd>
            </div>
            {nextExpectedAt ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt>Next run</dt>
                <dd className="text-right text-[var(--ink)]">
                  {hydrated ? formatRelative(nextExpectedAt) : formatAbsolute(nextExpectedAt)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <dt>Runner</dt>
              <dd className="truncate text-right text-[var(--ink)]">
                {cronJob.runtime || "Local helper"}
                {cronJob.hostname ? ` · ${cronJob.hostname.replace(/\.local$/, "")}` : ""}
              </dd>
            </div>
          </dl>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <MetricPill label="OK" value={okCount} />
            <MetricPill label="Issue" value={problemCount} />
            <MetricPill label="Waiting" value={waitingCount} />
          </div>
          {problemCount > 0 ? (
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: statusTone.color }}>
              {problemDetail}
            </p>
          ) : null}
        </div>

        {slots.length > 0 ? (
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[var(--muted-strong)]">
              <span className="font-semibold text-[var(--ink)]">
                Last {slots.length} scheduled {slots.length === 1 ? "window" : "windows"}
              </span>
              <span>Green completed, amber waiting, red missed or failed.</span>
            </div>
            <div className="flex items-end gap-1.5" aria-label="Fetch schedule status graph">
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
            <div className="mt-3 grid gap-1">
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
          <div className="rounded-[8px] border border-dashed border-[var(--line)] px-3 py-3 text-sm text-[var(--muted-strong)]">
            No expected scheduled run has elapsed since setup. The first status point appears after the next scheduled time.
          </div>
        )}
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
      <div className="mono text-[16px] font-bold text-[var(--ink)]">{value}</div>
      <div className="text-[11.5px] text-[var(--muted-strong)]">{label}</div>
    </div>
  );
}

function cronSlotStyle(status: CronSlotStatus): { background: string; border: string; color: string } {
  if (status === "ok") return statusStyle("ok");
  if (status === "failed" || status === "missed") return statusStyle("failed");
  return statusStyle("partial");
}

function cronSlotLabel(status: CronSlotStatus): string {
  if (status === "ok") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "missed") return "Missed";
  return "Waiting";
}

function CronSlotBar({ onSelect, slot }: { onSelect: () => void; slot: CronSlot }) {
  const style = cronSlotStyle(slot.status);
  const height =
    slot.status === "ok" ? "h-12" : slot.status === "waiting" ? "h-8" : "h-10";
  const label = cronSlotLabel(slot.status);
  return (
    <button
      aria-label={`${label} scheduled fetch run at ${formatAbsolute(slot.expectedAt)}`}
      className={`block min-w-0 flex-1 cursor-pointer rounded-sm border ${height} transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
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
      className="flex flex-wrap items-center justify-between gap-2 rounded-[7px] px-1 py-1 text-[12.5px] target:bg-[var(--accent-soft)]"
      id={slotDomId(slot)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="fb-chip"
          style={{ background: style.background, borderColor: style.border, color: style.color }}
        >
          {label}
        </span>
        <time
          className="text-[var(--ink)]"
          dateTime={slot.expectedAt}
          title={formatAbsolute(slot.expectedAt)}
        >
          {hydrated ? formatRelative(slot.expectedAt) : formatAbsolute(slot.expectedAt)}
        </time>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="mono truncate text-[11.5px] text-[var(--muted-strong)]">
          {slot.run
            ? `${slot.run.itemsFetched} fetched · ${formatDuration(slot.run.durationMs)}`
            : "no run recorded for this scheduled time"}
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
  runs,
  setExpanded,
}: {
  expanded: boolean;
  runs: LibraryFetchRunListItem[];
  setExpanded: (value: (previous: boolean) => boolean) => void;
}) {
  return (
    <div className="mt-4 grid gap-2.5">
      {runs.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
          No fetch runs yet. The next time your local CLI runs <code className="mono">fetch-personal</code> it will show up here.
        </div>
      ) : (
        <>
          {(expanded ? runs : runs.slice(0, VISIBLE_RUN_LIMIT)).map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
          {runs.length > VISIBLE_RUN_LIMIT ? (
            <button
              aria-expanded={expanded}
              className="fb-btn light compact justify-center"
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              {expanded
                ? "See less"
                : `See more (${runs.length - VISIBLE_RUN_LIMIT})`}
            </button>
          ) : null}
        </>
      )}
    </div>
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
  // Show the local helper that ran this fetch. Model names are kept out of the
  // run header because they are not useful for everyday readers.
  const agentLabel =
    details.agentRuntime || (run.cliVersion ? "Local helper" : "");
  const startedAtLabel = hydrated ? formatRelative(run.startedAt) : formatAbsolute(run.startedAt);

  return (
    <article
      className="rounded-[10px] border bg-[var(--paper-strong)] px-3.5 py-3"
      id={runDomId(run.id)}
      style={{ borderColor: "var(--line)" }}
    >
      <header className="flex flex-wrap items-center gap-2">
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
            className="fb-chip inline-flex items-center gap-1.5"
            style={{
              background: "var(--warm-soft)",
              color: "color-mix(in oklch, var(--warm) 68%, var(--ink))",
              borderColor: "color-mix(in oklch, var(--warm) 30%, var(--line))",
            }}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
            />
            Updating…
          </span>
        ) : null}
        <time
          className="text-[12.5px] text-[var(--muted-strong)]"
          dateTime={run.startedAt}
          title={formatAbsolute(run.startedAt)}
        >
          {startedAtLabel}
        </time>
        <span className="fb-chip">{run.source}</span>
        {agentLabel ? (
          <span className="text-[11.5px] text-[var(--muted-strong)]">
            {agentLabel}
          </span>
        ) : null}
      </header>

      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink)]">
        {run.summary}
      </p>

      <div className="mono mt-2 text-[11.5px] text-[var(--muted-strong)]">
        {run.itemsFetched} items read · {run.tasksGenerated} checked ·{" "}
        {run.userActionsCount} action{run.userActionsCount === 1 ? "" : "s"} needed ·{" "}
        {formatDuration(run.durationMs)}
      </div>

      <details className="mt-2 rounded-[8px] border border-[var(--line)] bg-[var(--paper)]">
        <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-bold text-[var(--ink)]">
          Show details
        </summary>
        <div className="border-t border-[var(--line)] px-3 py-3">
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
    <div className="grid gap-3">
      {perBuilder.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
            Sources
          </h3>
          <ul className="mt-1.5 grid gap-1">
            {perBuilder.map((entry, index) => (
              <li
                key={entry.builderId ?? `${entry.name ?? "builder"}-${index}`}
                className="mono text-[12px] text-[var(--ink)]"
              >
                <span>{entry.name ?? entry.builderId ?? "unknown"}</span>
                <span className="text-[var(--muted-strong)]"> · </span>
                <span className="text-[var(--muted-strong)]">{entry.sourceType ?? "—"}</span>
                <span className="text-[var(--muted-strong)]"> · </span>
                <span>{entry.itemsFetched ?? 0} items</span>
                <span className="text-[var(--muted-strong)]"> · </span>
                <span>{entry.tasksGenerated ?? 0} checked</span>
                {entry.error ? (
                  <>
                    <span className="text-[var(--muted-strong)]"> · </span>
                    <span style={{ color: "var(--danger)" }}>{entry.error}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {fetchTasks.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
            Items checked ({fetchTasks.length})
          </h3>
          <ul className="mt-1.5 grid gap-1">
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
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
            Helper instructions
          </h3>
          <p className="mt-1 text-[11.5px] text-[var(--muted)]">
            The instructions used to read and summarize each source type on
            this update.
          </p>
          <div className="mt-2 grid gap-2">
            {promptEntries.map(([sourceType, bundle]) => (
              <details
                key={sourceType}
                className="rounded-[8px] border border-[var(--line)] bg-[var(--paper-strong)]"
              >
                <summary
                  className="cursor-pointer px-3 py-2 text-[12px] font-bold text-[var(--ink)]"
                  style={{ fontFamily: "var(--font-geist-mono)" }}
                >
                  {sourceType}
                </summary>
                <div className="grid gap-2 border-t border-[var(--line)] px-3 py-2">
                  <div>
                    <p
                      className="text-[10.5px] uppercase tracking-wide"
                      style={{ color: "var(--muted)" }}
                    >
                      Summary instructions
                    </p>
                    <pre
                      className="mono mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[11.5px]"
                      style={{ color: "var(--muted-strong)" }}
                    >
                      {bundle.summary ?? "(none)"}
                    </pre>
                  </div>
                  <div>
                    <p
                      className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide"
                      style={{ color: "var(--muted)" }}
                    >
                      <span>Fetch instructions</span>
                      {bundle.fetchIsDefault ? (
                        <span
                          className="rounded-sm px-1 py-[1px] text-[9.5px] font-bold uppercase"
                          style={{
                            background: "var(--paper)",
                            border: "1px solid var(--line)",
                            color: "var(--muted-strong)",
                            letterSpacing: "0.05em",
                          }}
                          title="Admin hasn't configured a custom fetch prompt for this source — agent used the shared default."
                        >
                          default
                        </span>
                      ) : null}
                    </p>
                    <pre
                      className="mono mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[11.5px]"
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
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
            Actions needed
          </h3>
          <ul className="mt-1.5 grid gap-1.5">
            {userActions.map((action, index) => (
              <li key={`${action.kind ?? "action"}-${index}`} className="text-[12.5px]">
                <span className="fb-chip mr-2">{action.kind ?? "action"}</span>
                <span className="text-[var(--ink)]">{action.builder ?? ""}</span>
                {action.message ? (
                  <span className="text-[var(--muted-strong)]"> — {action.message}</span>
                ) : null}
                {action.helpUrl ? (
                  <>
                    {" "}
                    <a
                      className="text-[var(--accent)] underline"
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
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
            Local errors
          </h3>
          <ul className="mt-1.5 grid gap-1">
            {localErrors.map((message, index) => (
              <li
                key={`${message.slice(0, 32)}-${index}`}
                className="mono text-[12px]"
                style={{ color: "var(--danger)" }}
              >
                {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {details.cliFlags ? (
        <details className="rounded-[8px] border border-[var(--line)] bg-[var(--paper-strong)]">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold text-[var(--ink)]">
            CLI flags
          </summary>
          <pre className="mono overflow-auto px-3 pb-3 pt-2 text-[11.5px] text-[var(--muted-strong)]">
            {JSON.stringify(details.cliFlags, null, 2)}
          </pre>
        </details>
      ) : null}

      {details.error ? (
        <details className="rounded-[8px] border border-[var(--line)] bg-[var(--paper-strong)]">
          <summary
            className="cursor-pointer px-3 py-2 text-[12px] font-bold"
            style={{ color: "var(--danger)" }}
          >
            Error stack
          </summary>
          <pre className="mono overflow-auto px-3 pb-3 pt-2 text-[11.5px] text-[var(--muted-strong)]">
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
        <p className="text-[12.5px] text-[var(--muted-strong)]">No structured details.</p>
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
        fix: "Add X access in Settings, then update sources again.",
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
        label: "Local helper",
        blurb:
          "The local helper read the primary content before summarizing it.",
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
  return { label: "Read by helper", tone: "idle" };
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
  if (task.status === "skipped") return { label: "Skipped — no content", tone: "idle" };
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
    <div className="flex gap-2 text-[12px] leading-relaxed">
      <dt className="w-24 shrink-0 text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 flex-1 text-[var(--ink)]">{value}</dd>
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
      <div className="flex items-center gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
          {title}
        </h4>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ ...toneStyle(tone), fontFamily: "var(--font-geist-mono)" }}
        >
          {outcome}
        </span>
      </div>
      <dl className="mt-1 grid gap-0.5">{children}</dl>
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
      <details className="fb-task rounded-[8px] border border-[var(--line)] bg-[var(--paper-strong)]">
        <summary className="fb-task-summary flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] leading-snug">
          <ChevronRight
            aria-hidden="true"
            className="fb-task-chev h-3.5 w-3.5 shrink-0 text-[var(--muted)]"
          />
          {task.sourceType ? (
            <span className="mono shrink-0 text-[11px] text-[var(--muted-strong)]">
              {task.sourceType}
            </span>
          ) : null}
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide"
            style={{ ...toneStyle(pillTone), fontFamily: "var(--font-geist-mono)" }}
          >
            {ready ? "ready" : "helper"}
          </span>
          <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
            {task.title ?? task.url ?? "—"}
          </span>
          {task.builder ? (
            <span className="shrink-0 text-[var(--muted-strong)]">· {task.builder}</span>
          ) : null}
        </summary>

        <div className="grid gap-3 border-t border-[var(--line)] px-3 py-2.5">
          <div
            className="rounded-[6px] px-2.5 py-1.5 text-[12px] font-bold"
            style={bannerStyle}
          >
            {banner.label}
            {work.blurb ? (
              <span className="font-normal opacity-90"> — {work.blurb}</span>
            ) : null}
          </div>

          {work.fix ? (
            <div className="text-[12px] leading-relaxed text-[var(--muted-strong)]">
              <span className="font-bold text-[var(--ink)]">How to fix: </span>
              {work.fix}
              {work.fixHref ? (
                <>
                  {" "}
                  <a className="text-[var(--accent)] underline" href={work.fixHref}>
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
                  <span className="text-[var(--danger)]">{failureReasonText(task)}</span>
                }
              />
            ) : null}
            {task.status === "skipped" && failureReasonText(task) ? (
              <FactRow
                label="Skipped"
                value={
                  <span className="text-[var(--muted-strong)]">{failureReasonText(task)}</span>
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
                    className="break-all text-[var(--accent)] underline"
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
              <FactRow label="Helper" value={<span>{agentLabel}</span>} />
            ) : null}
            {summarySize ? <FactRow label="Summary size" value={summarySize} /> : null}
            {compression ? <FactRow label="Compression" value={compression} /> : null}
            {!isSummarized(task) && !isContentFailure(task) && failureReasonText(task) ? (
              <FactRow
                label="Reason"
                value={
                  <span className="text-[var(--danger)]">{failureReasonText(task)}</span>
                }
              />
            ) : null}
            {!agentLabel && !summarySize && !failureReasonText(task) ? (
              <p className="text-[11.5px] text-[var(--muted)]">
                {sumRes.label === "Not reached"
                  ? "Fetch was blocked, so no summary was produced."
                  : sumRes.label === "Failed"
                    ? "This item failed to summarize, so it was not saved."
                    : "The local helper hasn't summarized this item yet."}
              </p>
            ) : null}
          </StageBlock>

          <details className="rounded-[6px] border border-[var(--line)] bg-[var(--paper)]">
            <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
              Technical details
            </summary>
            <pre className="mono max-h-72 overflow-auto px-2.5 pb-2.5 pt-1 text-[11px] text-[var(--muted-strong)]">
              {JSON.stringify(task, null, 2)}
            </pre>
          </details>
        </div>
      </details>
    </li>
  );
}
