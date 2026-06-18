"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
  type UIEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { CountBadge, CountMeta, formatCount } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { useHydrated } from "@/components/ThemeToggle";
import { contentSyncStateChanged } from "@/lib/content-sync-events";
import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import {
  buildDigestCronStatus,
  getDigestUpdateStatus,
  isActiveDigestJobRun,
  isDigestRunInflight,
  statusStyle,
  type ChipStyle,
  type CronSlot,
  type CronSlotStatus,
  type DigestUpdateStatus,
} from "@/lib/digest-update-status";
import type {
  DigestCronJobStatus,
  DigestRunCandidate,
  DigestRunListItem,
  DigestRunSource,
} from "@/lib/digest-runs";
import { displayLanguagePreference } from "@/lib/language-preference";
import { postDetailHref } from "@/lib/navigation";
import {
  scheduledJobRunStatusLabel,
  scheduledRunTriggerLabel,
  scheduledWindowRunNote,
  scheduledWindowStatusLabel,
  scheduledWindowStyleStatus,
} from "@/lib/scheduled-window-ui";

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

function formatDay(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const VISIBLE_SOURCE_LIMIT = 4;
const DIGEST_TIMELINE_LIMIT = 12;
const LOG_WINDOW_SIZE = 6;

type DigestCronSlot = CronSlot<DigestRunListItem>;

function slotDomId(slot: DigestCronSlot): string {
  return `digest-slot-${Date.parse(slot.expectedAt)}`;
}

function runDomId(runId: string): string {
  return `digest-run-${runId}`;
}

function jobRunDomId(instanceId: string): string {
  return `digest-job-${instanceId}`;
}

type DigestLogRef =
  | { kind: "run"; runId: string }
  | { kind: "job"; instanceId: string };

type DigestTimelineEntry = {
  key: string;
  time: string;
  status: CronSlotStatus;
  label: string;
  note: string;
  syncSummary: string | null;
  run: DigestRunListItem | null;
  jobRun: AgentJobRunListItem | null;
  slot: DigestCronSlot | null;
  logRef: DigestLogRef | null;
};

export type DigestLogPanelProps = {
  actions?: ReactNode;
  actionsPlacement?: "start" | "end";
  detailsOpen?: boolean;
  detailsRootId?: string;
  initialCronJob: DigestCronJobStatus | null;
  initialCronRuns: DigestRunListItem[];
  initialJobRuns?: AgentJobRunListItem[];
  initialRuns: DigestRunListItem[];
  initialScheduledJobRuns?: AgentJobRunListItem[];
  onDetailsOpenChange?: (open: boolean) => void;
  onStatusChange?: (status: DigestUpdateStatus) => void;
  showHeading?: boolean;
  showStatusToggle?: boolean;
};

function digestJobRunSlotStatus(jobRun: AgentJobRunListItem, nowMs = Date.now()): CronSlotStatus {
  if (jobRun.status === "succeeded") return "ok";
  if (isActiveDigestJobRun(jobRun)) {
    const heartbeatMs = Date.parse(jobRun.heartbeatAt ?? jobRun.startedAt);
    return Number.isFinite(heartbeatMs) && nowMs - heartbeatMs > 2 * 60_000 ? "stalled" : "running";
  }
  return "failed";
}

function digestRunSlotStatus(
  run: DigestRunListItem,
  jobRun?: AgentJobRunListItem | null,
  nowMs = Date.now(),
): CronSlotStatus {
  const jobStatus = jobRun ? digestJobRunSlotStatus(jobRun, nowMs) : null;
  if (jobStatus && jobStatus !== "ok") return jobStatus;
  if (run.status === "synced") return "ok";
  return isDigestRunInflight(run) ? "running" : "failed";
}

function digestRunSummary(run: DigestRunListItem): string {
  if (run.candidateCount === 0) return "No eligible posts";
  if (run.status === "synced") {
    return `${formatCount(run.includedCount ?? 0)}/${formatCount(run.candidateCount)} used`;
  }
  return `${formatCount(run.candidateCount)} prepared`;
}

function digestRunSyncSummary(run: DigestRunListItem | null): string | null {
  if (!run) return null;
  const saved = Math.max(0, run.status === "synced" ? run.includedCount ?? 0 : 0);
  const eligible = Math.max(0, run.candidateCount, saved);
  if (eligible <= 0 && saved <= 0) return null;
  return `${formatCount(saved)}/${formatCount(eligible)} saved`;
}

function buildDigestTimeline({
  jobRuns,
  runs,
  slots,
  nowMs = Date.now(),
}: {
  jobRuns: AgentJobRunListItem[];
  runs: DigestRunListItem[];
  slots: DigestCronSlot[];
  nowMs?: number;
}): DigestTimelineEntry[] {
  const jobsByInstanceId = jobRunByInstanceId(jobRuns);
  const matchedRunIds = new Set<string>();
  const matchedJobInstances = new Set<string>();
  const entries: DigestTimelineEntry[] = slots.map((slot) => {
    if (slot.run) matchedRunIds.add(slot.run.id);
    if (slot.jobRun) matchedJobInstances.add(slot.jobRun.instanceId);
    const triggerLabel = scheduledRunTriggerLabel(slot.jobRun ?? null, "digest-cron", slot.run?.source ?? "cron");
    const runSummary = slot.run ? digestRunSummary(slot.run) : null;
    return {
      key: `slot:${slot.expectedAt}`,
      time: slot.expectedAt,
      status: slot.status,
      label: triggerLabel,
      note: scheduledWindowRunNote({
        jobRunStatus: slot.jobRun ? jobRunStatusLabel(slot.jobRun) : null,
        runSummary,
        runtime: slot.jobRun?.runtime,
      }),
      syncSummary: digestRunSyncSummary(slot.run),
      run: slot.run,
      jobRun: slot.jobRun,
      slot,
      logRef: slot.run
        ? { kind: "run", runId: slot.run.id }
        : slot.jobRun
          ? { kind: "job", instanceId: slot.jobRun.instanceId }
          : null,
    };
  });

  for (const run of runs) {
    if (matchedRunIds.has(run.id)) continue;
    const jobRun = run.jobRunId ? jobsByInstanceId.get(run.jobRunId) ?? null : null;
    if (jobRun) matchedJobInstances.add(jobRun.instanceId);
    entries.push({
      key: `run:${run.id}`,
      time: run.preparedAt,
      status: digestRunSlotStatus(run, jobRun, nowMs),
      label: scheduledRunTriggerLabel(jobRun ?? null, "digest-cron", run.source),
      note: digestRunSummary(run),
      syncSummary: digestRunSyncSummary(run),
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
      status: digestJobRunSlotStatus(jobRun, nowMs),
      label: scheduledRunTriggerLabel(jobRun, "digest-cron"),
      note: scheduledWindowRunNote({
        jobRunStatus: jobRunStatusLabel(jobRun),
        runtime: jobRun.runtime,
      }),
      syncSummary: null,
      run: null,
      jobRun,
      slot: null,
      logRef: { kind: "job", instanceId: jobRun.instanceId },
    });
  }

  return entries
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .slice(-DIGEST_TIMELINE_LIMIT);
}

function clampLogWindowStart(start: number, total: number): number {
  return Math.min(Math.max(0, start), Math.max(0, total - LOG_WINDOW_SIZE));
}

function visibleLogWindowStart(container: HTMLDivElement, total: number): number {
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-sync-log-row='true']"));
  const visibleTop = container.getBoundingClientRect().top + 1;
  const firstVisibleIndex = rows.findIndex((row) => row.getBoundingClientRect().bottom > visibleTop);
  return clampLogWindowStart(firstVisibleIndex === -1 ? rows.length - 1 : firstVisibleIndex, total);
}

export function DigestLogPanel({
  actions,
  actionsPlacement = "end",
  detailsOpen: controlledDetailsOpen,
  detailsRootId,
  initialRuns,
  initialCronRuns,
  initialJobRuns = [],
  initialScheduledJobRuns = [],
  initialCronJob,
  onDetailsOpenChange,
  onStatusChange,
  showHeading = true,
  showStatusToggle = true,
}: DigestLogPanelProps) {
  const [runs, setRuns] = useState(initialRuns);
  const [cronRuns, setCronRuns] = useState(initialCronRuns);
  const [jobRuns, setJobRuns] = useState(initialJobRuns);
  const [scheduledJobRuns, setScheduledJobRuns] = useState(initialScheduledJobRuns);
  const [cronJob, setCronJob] = useState(initialCronJob);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [uncontrolledDetailsOpen, setUncontrolledDetailsOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<DigestLogRef | null>(null);
  const detailsOpen = controlledDetailsOpen ?? uncontrolledDetailsOpen;
  const cronStatus = useMemo(
    () => buildDigestCronStatus(cronJob, cronRuns, scheduledJobRuns),
    [cronJob, cronRuns, scheduledJobRuns],
  );
  const timelineEntries = useMemo(
    () => buildDigestTimeline({ jobRuns, runs, slots: cronStatus.slots }),
    [cronStatus.slots, jobRuns, runs],
  );
  const updateStatus = useMemo(
    () => getDigestUpdateStatus(cronJob, cronStatus.slots, runs),
    [cronJob, cronStatus.slots, runs],
  );
  const runsRef = useRef(runs);
  const jobRunsRef = useRef(jobRuns);
  const hydrated = useHydrated();
  const detailsRoot = detailsRootId && hydrated ? document.getElementById(detailsRootId) : null;

  const setDetailsOpen = useCallback(
    (next: SetStateAction<boolean>) => {
      const nextValue = typeof next === "function" ? next(detailsOpen) : next;
      if (controlledDetailsOpen === undefined) setUncontrolledDetailsOpen(nextValue);
      onDetailsOpenChange?.(nextValue);
    },
    [controlledDetailsOpen, detailsOpen, onDetailsOpenChange],
  );

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  useEffect(() => {
    jobRunsRef.current = jobRuns;
  }, [jobRuns]);
  useEffect(() => {
    onStatusChange?.(updateStatus);
  }, [onStatusChange, updateStatus]);

  const openLog = useCallback(
    (logRef: DigestLogRef) => {
      setDetailsOpen(true);
      setSelectedLog(logRef);
    },
    [setDetailsOpen],
  );

  const refresh = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/digest-runs", {
          headers: { accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as
          | {
              runs?: DigestRunListItem[];
              cronRuns?: DigestRunListItem[];
              jobRuns?: AgentJobRunListItem[];
              scheduledJobRuns?: AgentJobRunListItem[];
              cronJob?: DigestCronJobStatus | null;
              error?: string;
            }
          | null;
        if (response.status === 401) {
          setError(null);
          return;
        }
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
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

  // Confirm against live data once on mount. initialRuns gives an instant first
  // paint, but the log's whole job is to show the run you just made, so a stale
  // SSR payload (which showed "no runs" right after a sync) must not win. One
  // lightweight fetch reconciles it; the timestamp ticker below stays separate.
  const didHeal = useRef(false);
  useEffect(() => {
    if (didHeal.current) return;
    didHeal.current = true;
    refresh();
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

  // Keep relative timestamps approximately fresh without re-fetching. Honor
  // reduced-motion by skipping the interval.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let timer = 0;
    const pollInflightMs = 8_000;
    const pollIdleMs = 45_000;

    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") refresh();
      schedule();
    };
    const schedule = () => {
      const inflight = runsRef.current.some(isDigestRunInflight) ||
        jobRunsRef.current.some((run) => isActiveDigestJobRun(run));
      timer = window.setTimeout(tick, inflight ? pollInflightMs : pollIdleMs);
    };
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

  const detailsPanel = detailsOpen ? (
    <div id="digest-update-details">
      <DigestStatusPanel
        cronJob={cronJob}
        entries={timelineEntries}
        nextExpectedAt={cronStatus.nextExpectedAt}
        onOpenLog={openLog}
      />
    </div>
  ) : null;

  const renderedDetails = detailsRoot && detailsPanel
    ? createPortal(detailsPanel, detailsRoot)
    : detailsPanel;
  const actionsNode = actions ? (
    <div className="digest-updates-actions">
      {actions}
    </div>
  ) : null;
  const showSummary = showHeading || showStatusToggle;
  const summaryNode = showSummary ? (
    <div className="sync-panel-column">
      {showHeading || showStatusToggle ? (
        <div className="sync-panel-title-row">
          {showHeading ? (
            <h2 className="fb-section-heading">AI Digest updates</h2>
          ) : null}
          {showStatusToggle ? (
            <DigestStatusToggle
              detailsOpen={detailsOpen}
              onToggle={() => setDetailsOpen((value) => !value)}
              status={updateStatus}
            />
          ) : null}
        </div>
      ) : null}
      <DigestScheduleSummary
        cronJob={cronJob}
        hydrated={hydrated}
        nextExpectedAt={cronStatus.nextExpectedAt}
        status={updateStatus}
      />
    </div>
  ) : null;

  return (
    <section className="fb-panel digest-updates-panel">
      <div className="digest-updates-head">
        {actionsPlacement === "start" ? (
          <div className="digest-updates-main">
            {actionsNode}
            {summaryNode}
          </div>
        ) : (
          summaryNode
        )}
        {actionsPlacement === "end" ? actionsNode : null}
      </div>

      {error ? (
        <p className="sync-panel-error">{error}</p>
      ) : null}

      {renderedDetails}
      {selectedLog ? (
        <DigestLogDialog
          jobRuns={jobRuns}
          logRef={selectedLog}
          onClose={() => setSelectedLog(null)}
          runs={runs}
        />
      ) : null}
    </section>
  );
}

export function DigestStatusToggle({
  detailsOpen,
  onToggle,
  status,
}: {
  detailsOpen: boolean;
  onToggle: () => void;
  status: DigestUpdateStatus;
}) {
  const Icon = detailsOpen ? ChevronUp : ChevronDown;
  return (
    <button
      aria-controls="digest-update-details"
      aria-expanded={detailsOpen}
      className="fb-chip digest-status-toggle"
      onClick={onToggle}
      style={{
        background: status.style.background,
        borderColor: status.style.border,
        color: status.style.color,
      }}
      title={detailsOpen ? "Hide AI Digest update details" : "Show AI Digest update details"}
      type="button"
    >
      {status.label}
      <span aria-hidden="true" className="digest-status-toggle-hint">Details</span>
      <Icon aria-hidden="true" />
    </button>
  );
}

function DigestScheduleSummary({
  cronJob,
  hydrated,
  nextExpectedAt,
  status,
}: {
  cronJob: DigestCronJobStatus | null;
  hydrated: boolean;
  nextExpectedAt: string | null;
  status: DigestUpdateStatus;
}) {
  if (!cronJob) {
    return (
      <p className="sync-panel-schedule-summary">
        {status.summary} Copy a Build AI Digest prompt to start a Local Agent run.
      </p>
    );
  }

  if (cronJob.status !== "active") return null;

  const nextLabel = nextExpectedAt
    ? hydrated
      ? formatRelative(nextExpectedAt)
      : formatAbsolute(nextExpectedAt)
    : null;

  return (
    <p className="sync-panel-schedule-summary">
      {status.summary} · {cronJob.frequencyLabel}
      {nextLabel ? ` · next ${nextLabel}` : ""}
      {cronJob.regenerateDigest ? " · includes posts already used in AI Digest issues" : ""}
    </p>
  );
}

function DigestStatusPanel({
  cronJob,
  entries,
  nextExpectedAt,
  onOpenLog,
}: {
  cronJob: DigestCronJobStatus | null;
  entries: DigestTimelineEntry[];
  nextExpectedAt: string | null;
  onOpenLog: (logRef: DigestLogRef) => void;
}) {
  const hydrated = useHydrated();
  const entriesKey = useMemo(() => entries.map((entry) => entry.key).join("\n"), [entries]);
  const [logWindow, setLogWindow] = useState({ key: "", start: 0 });
  const rowEntries = useMemo(() => entries.slice().reverse(), [entries]);
  const logWindowStart = logWindow.key === entriesKey
    ? clampLogWindowStart(logWindow.start, rowEntries.length)
    : 0;
  const visibleRowEntries = rowEntries.slice(logWindowStart, logWindowStart + LOG_WINDOW_SIZE);
  const visibleGraphEntries = visibleRowEntries.slice().reverse();
  const graphStartLabel = visibleGraphEntries[0]
    ? hydrated
      ? formatRelative(visibleGraphEntries[0].time)
      : formatAbsolute(visibleGraphEntries[0].time)
    : "";
  const graphEndLabel = visibleGraphEntries.at(-1)
    ? hydrated
      ? formatRelative(visibleGraphEntries.at(-1)!.time)
      : formatAbsolute(visibleGraphEntries.at(-1)!.time)
    : "";
  const handleLogScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextStart = visibleLogWindowStart(event.currentTarget, rowEntries.length);
    setLogWindow((current) =>
      current.key === entriesKey && current.start === nextStart
        ? current
        : { key: entriesKey, start: nextStart },
    );
  }, [entriesKey, rowEntries.length]);
  if (!cronJob && entries.length === 0) {
    return (
      <EmptyState
        className="sync-panel-empty is-dashed"
        title="No AI Digest build history yet"
        body="One-time and scheduled builds appear here after a Local Agent reports them."
      />
    );
  }

  if (cronJob && cronJob.status !== "active" && entries.length === 0) {
    const runnerRuntime = cronJob.runtime || "Local Agent";
    const runnerHost = cronJob.hostname || null;
    return (
      <div className="sync-panel-card">
        <div className="sync-panel-status-brief">
          <dl className="sync-panel-meta">
            <div className="sync-panel-meta-row">
              <dt>Schedule enabled</dt>
              <dd>
                {hydrated ? formatRelative(cronJob.startedAt) : formatAbsolute(cronJob.startedAt)}
              </dd>
            </div>
            {cronJob.stoppedAt ? (
              <div className="sync-panel-meta-row">
                <dt>Schedule stopped</dt>
                <dd>
                  <time
                    className="sync-panel-run-card-time"
                    dateTime={cronJob.stoppedAt}
                    title={formatAbsolute(cronJob.stoppedAt)}
                  >
                    {hydrated ? formatRelative(cronJob.stoppedAt) : formatAbsolute(cronJob.stoppedAt)}
                  </time>
                </dd>
              </div>
            ) : null}
            <div className="sync-panel-meta-row">
              <dt>Runner</dt>
              <dd className="sync-panel-truncate">
                {runnerRuntime}
                {runnerHost ? ` · ${runnerHost.replace(/\.local$/, "")}` : ""}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    );
  }

  const latestEntry = entries.at(-1) ?? null;
  const runnerRuntime = cronJob?.runtime || latestEntry?.jobRun?.runtime || "Local Agent";
  const runnerHost = cronJob?.hostname || latestEntry?.jobRun?.hostname || null;

  return (
    <div className="sync-panel-card">
      <div className="sync-panel-status-brief">
        <dl className="sync-panel-meta">
          {cronJob ? (
            <div className="sync-panel-meta-row">
              <dt>Schedule enabled</dt>
              <dd>
                {hydrated ? formatRelative(cronJob.startedAt) : formatAbsolute(cronJob.startedAt)}
              </dd>
            </div>
          ) : null}
          {cronJob && nextExpectedAt ? (
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
              {runnerRuntime}
              {runnerHost ? ` · ${runnerHost.replace(/\.local$/, "")}` : ""}
            </dd>
          </div>
        </dl>
      </div>
      <div className="sync-panel-layout is-log-only">

        {entries.length > 0 ? (
          <div className="sync-panel-column">
            <div className="sync-panel-timeline-head">
              <div className="sync-panel-timeline-divider" aria-hidden="true" />
            </div>
            <div className="sync-panel-timeline-axis" aria-hidden="true">
              <span>{graphStartLabel}</span>
              <span>{graphEndLabel}</span>
            </div>
            <div className="sync-panel-status-graph" aria-label="AI Digest build status graph, oldest to newest">
              {visibleGraphEntries.map((entry) => (
                <DigestTimelineBar
                  key={entry.key}
                  onSelect={() => {
                    if (entry.logRef) {
                      onOpenLog(entry.logRef);
                      return;
                    }
                    const id = entry.slot ? slotDomId(entry.slot) : null;
                    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  entry={entry}
                />
              ))}
            </div>
            <div className="sync-panel-slot-rows is-scrollable" onScroll={handleLogScroll}>
              {rowEntries.map((entry) => (
                <DigestTimelineRow
                  key={entry.key}
                  entry={entry}
                  hydrated={hydrated}
                  onOpenLog={onOpenLog}
                />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            className="sync-panel-slot-empty"
            title="No AI Digest build history yet"
            body="One-time and scheduled builds appear here after a Local Agent reports them."
          />
        )}
      </div>
    </div>
  );
}

function cronSlotStyle(status: CronSlotStatus): ChipStyle {
  return statusStyle(scheduledWindowStyleStatus(status));
}

function DigestTimelineBar({ entry, onSelect }: { entry: DigestTimelineEntry; onSelect: () => void }) {
  const style = cronSlotStyle(entry.status);
  const heightClass =
    entry.status === "ok"
      ? "is-tall"
      : entry.status === "waiting" || entry.status === "running"
        ? "is-short"
        : "is-medium";
  const label = scheduledWindowStatusLabel(entry.status);
  return (
    <button
      aria-label={`${label} ${entry.label} AI Digest build at ${formatAbsolute(entry.time)}`}
      className={`sync-panel-slot-bar ${heightClass}`}
      onClick={onSelect}
      style={{
        background: style.background,
        borderColor: style.border,
        color: style.color,
      }}
      title={`${label} · ${entry.label} · ${formatAbsolute(entry.time)}`}
      type="button"
    />
  );
}

function DigestTimelineRow({
  entry,
  hydrated,
  onOpenLog,
}: {
  entry: DigestTimelineEntry;
  hydrated: boolean;
  onOpenLog: (logRef: DigestLogRef) => void;
}) {
  const style = cronSlotStyle(entry.status);
  const label = scheduledWindowStatusLabel(entry.status);
  const id = entry.slot
    ? slotDomId(entry.slot)
    : entry.run
      ? runDomId(entry.run.id)
      : entry.jobRun
        ? jobRunDomId(entry.jobRun.instanceId)
        : undefined;
  return (
    <div
      className="sync-panel-slot-row"
      data-sync-log-row="true"
      id={id}
    >
      <div className="sync-panel-slot-row-main">
        <div className="sync-panel-slot-row-primary">
          <span
            className="sync-panel-slot-row-status"
            style={{ color: style.color }}
          >
            <span
              aria-hidden="true"
              className="sync-panel-slot-row-dot"
              style={{ background: style.color }}
            />
            {label}
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
            Open log
          </button>
        ) : null}
      </div>
    </div>
  );
}

function jobRunByInstanceId(jobRuns: AgentJobRunListItem[]): Map<string, AgentJobRunListItem> {
  const map = new Map<string, AgentJobRunListItem>();
  for (const jobRun of jobRuns) map.set(jobRun.instanceId, jobRun);
  return map;
}

function jobRunLabel(jobRun: AgentJobRunListItem): string {
  return scheduledRunTriggerLabel(jobRun, "digest-cron");
}

function jobRunStatusStyle(jobRun: AgentJobRunListItem): ChipStyle {
  if (jobRun.status === "succeeded") return statusStyle("ok");
  if (jobRun.status === "running" || jobRun.status === "starting") return statusStyle("partial");
  return statusStyle("failed");
}

function jobRunStatusLabel(jobRun: AgentJobRunListItem): string {
  return scheduledJobRunStatusLabel(jobRun.status);
}

type RunVerdictTone = "ok" | "warn" | "fail";

type RunVerdict = {
  text: string;
  tone: RunVerdictTone;
};

function jobRunDetailsRecord(jobRun: AgentJobRunListItem): Record<string, unknown> {
  return jobRun.details && typeof jobRun.details === "object" && !Array.isArray(jobRun.details)
    ? jobRun.details as Record<string, unknown>
    : {};
}

function jobRunDetailString(jobRun: AgentJobRunListItem, key: string): string | null {
  const value = jobRunDetailsRecord(jobRun)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jobRunDetailNumber(jobRun: AgentJobRunListItem, key: string): number | null {
  const value = jobRunDetailsRecord(jobRun)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jobRunFailureReason(jobRun: AgentJobRunListItem): string {
  const reason = jobRunDetailString(jobRun, "reason");
  const timeoutSeconds = jobRunDetailNumber(jobRun, "timeoutSeconds");
  const timeoutStage = jobRunDetailString(jobRun, "timeoutStage");
  if (jobRun.status === "timed_out") {
    return timeoutSeconds
      ? `Timed out after ${formatCount(timeoutSeconds)} seconds${timeoutStage ? ` during ${timeoutStage}` : ""}.`
      : "Timed out before the Local Agent could finish.";
  }
  if (jobRun.status === "killed") return "Stopped by the local scheduler before finishing.";
  if (jobRun.status === "replaced") return "Replaced by a newer scheduled run.";
  if (jobRun.status === "stale") return "FollowBrief lost contact with the Local Agent.";
  if (jobRun.signal) return `Stopped after receiving ${jobRun.signal}.`;
  if (jobRun.exitCode !== null) return `Exited with code ${jobRun.exitCode}.`;
  return reason ? readableReason(reason) : "Stopped before reporting a completed AI Digest build.";
}

function jobRunDiagnostic(jobRun: AgentJobRunListItem): string | null {
  if (jobRun.status === "succeeded") return null;
  const parts = [
    jobRunDetailNumber(jobRun, "timeoutSeconds")
      ? `timeout ${formatCount(jobRunDetailNumber(jobRun, "timeoutSeconds")!)} seconds`
      : null,
    jobRunDetailString(jobRun, "timeoutStage")?.replace(/[_-]+/g, " "),
    jobRunDetailString(jobRun, "reason")?.replace(/[_-]+/g, " "),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function jobRunVerdict(jobRun: AgentJobRunListItem): RunVerdict {
  if (jobRun.status === "starting" || jobRun.status === "running") {
    return {
      tone: "warn",
      text: "The Local Agent is running. Waiting for it to prepare candidates and save the AI Digest.",
    };
  }
  if (jobRun.status === "succeeded") {
    return {
      tone: "warn",
      text: "The Local Agent finished, but it did not create an AI Digest build record.",
    };
  }
  return {
    tone: "fail",
    text: jobRunFailureReason(jobRun),
  };
}

function digestRunVerdict(run: DigestRunListItem, jobRun?: AgentJobRunListItem): RunVerdict {
  if (run.status === "synced" && run.candidateCount === 0) {
    return {
      tone: "ok",
      text: "Completed successfully. No new eligible posts were found in this window.",
    };
  }
  if (run.status === "synced") {
    return {
      tone: "ok",
      text: `Saved ${formatCount(run.includedCount ?? 0)} of ${formatCount(run.candidateCount)} eligible posts to FollowBrief.`,
    };
  }
  if (jobRun && !["starting", "running", "succeeded"].includes(jobRun.status)) {
    return {
      tone: "fail",
      text: `Prepared ${formatCount(run.candidateCount)} candidates, but the Local Agent stopped before saving. ${jobRunFailureReason(jobRun)}`,
    };
  }
  return {
    tone: "warn",
    text: `Prepared ${formatCount(run.candidateCount)} candidates. Waiting for the Local Agent to save AI Digest.`,
  };
}

function readableReason(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function JobRunCard({
  jobRun,
  domId = jobRunDomId(jobRun.instanceId),
}: {
  jobRun: AgentJobRunListItem;
  domId?: string | null;
}) {
  const hydrated = useHydrated();
  const style = jobRunStatusStyle(jobRun);
  const startedAtLabel = hydrated ? formatRelative(jobRun.startedAt) : formatAbsolute(jobRun.startedAt);
  const verdict = jobRunVerdict(jobRun);
  const reason = jobRunDetailString(jobRun, "reason");
  const diagnostic = jobRunDiagnostic(jobRun);
  const showRuntimeState = isActiveDigestJobRun(jobRun) || jobRun.status !== "succeeded";
  const showFailureDetails = jobRun.status !== "succeeded" &&
    (Boolean(reason) || jobRun.exitCode !== null || Boolean(jobRun.signal) || Boolean(jobRun.stage));
  return (
    <article className="sync-panel-run-card sync-panel-mobile-flat" id={domId ?? undefined}>
      <header className="sync-panel-run-card-head">
        <span
          className="fb-chip"
          style={{ background: style.background, color: style.color, borderColor: style.border }}
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
        {jobRun.summary || "Runtime job did not create an AI Digest build record."}
      </p>
      <p className={`sync-panel-run-card-verdict is-${verdict.tone}`}>
        {verdict.text}
      </p>
      <DigestLifecycle jobRun={jobRun} />
      {showFailureDetails ? (
        <dl className="sync-panel-run-card-reason">
          {jobRun.stage ? (
            <div>
              <dt>Last event</dt>
              <dd className="mono">{readableReason(jobRun.stage)}</dd>
            </div>
          ) : null}
          {reason ? (
            <div>
              <dt>Reason</dt>
              <dd>{readableReason(reason)}</dd>
            </div>
          ) : null}
          {jobRun.exitCode !== null ? (
            <div>
              <dt>Exit code</dt>
              <dd className="mono">{jobRun.exitCode}</dd>
            </div>
          ) : null}
          {jobRun.signal ? (
            <div>
              <dt>Signal</dt>
              <dd className="mono">{jobRun.signal}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {showRuntimeState ? (
        <div className="mono sync-panel-run-card-stage">
          {jobRun.stage || "runtime"} · {jobRun.finishedAt ? "finished" : "active"}
        </div>
      ) : null}
      {diagnostic ? (
        <div className="mono sync-panel-run-card-stage">
          {diagnostic}
        </div>
      ) : null}
    </article>
  );
}

type DigestLifecycleTone = "ok" | "warn" | "fail" | "idle";

type DigestLifecycleStep = {
  key: string;
  label: string;
  outcome: string;
  tone: DigestLifecycleTone;
  meta?: string;
};

function digestLifecycleToneStyle(tone: DigestLifecycleTone): { color: string } {
  if (tone === "ok") return { color: "color-mix(in oklch, var(--signal) 72%, var(--ink))" };
  if (tone === "warn") return { color: "color-mix(in oklch, var(--warm) 72%, var(--ink))" };
  if (tone === "fail") return { color: "var(--danger)" };
  return { color: "var(--muted)" };
}

function DigestLifecycle({
  jobRun,
  run,
}: {
  jobRun?: AgentJobRunListItem | null;
  run?: DigestRunListItem;
}) {
  const hasRun = Boolean(run);
  const synced = run?.status === "synced";
  const failedJob = Boolean(jobRun && !["starting", "running", "succeeded"].includes(jobRun.status));
  const digestSaved = synced && Boolean(run?.digestTitle);
  const steps: DigestLifecycleStep[] = [
    {
      key: "prepare",
      label: "Prepare candidates",
      outcome: run
        ? `${formatCount(run.candidateCount)} found from ${formatCount(run.contributingSourceCount)} sources`
        : jobRun
          ? jobRunStatusLabel(jobRun)
          : "Waiting for Local Agent",
      tone: hasRun ? "ok" : failedJob ? "fail" : jobRun ? "warn" : "idle",
    },
    {
      key: "generate",
      label: "Generate AI Digest",
      outcome: run
        ? run.candidateCount === 0
          ? "No new posts"
          : `${formatCount(run.includedCount ?? 0)} selected`
        : "Pending",
      tone: synced || (run && run.candidateCount === 0) ? "ok" : failedJob ? "fail" : "idle",
    },
    {
      key: "render",
      label: "Render digest",
      outcome: digestSaved ? run!.digestTitle! : run ? "No saved title" : "Pending",
      tone: digestSaved ? "ok" : synced ? "warn" : failedJob ? "fail" : "idle",
    },
    {
      key: "sync",
      label: "Sync to web",
      outcome: run?.syncedAt ? "Saved to FollowBrief" : run ? "Not saved yet" : "Pending",
      tone: run?.syncedAt ? "ok" : failedJob ? "fail" : "idle",
    },
    {
      key: "mark",
      label: "Mark posts digested",
      outcome: synced ? `${formatCount(run.includedCount ?? 0)} posts marked` : "Pending",
      tone: synced ? "ok" : failedJob ? "fail" : "idle",
    },
  ];

  return (
    <ol aria-label="AI Digest job lifecycle" className="sync-panel-lifecycle">
      {steps.map((step, index) => (
        <li key={step.key} className="sync-panel-lifecycle-item">
          <div
            className={`sync-panel-lifecycle-step is-${step.tone}`}
            style={{ "--step-color": digestLifecycleToneStyle(step.tone).color } as CSSProperties}
          >
            <div className="sync-panel-lifecycle-summary">
              <span aria-hidden="true" className="sync-panel-lifecycle-dot" />
              <span className="sync-panel-lifecycle-copy">
                <span className="sync-panel-lifecycle-label">{step.label}</span>
                <span className="mono sync-panel-lifecycle-outcome">{step.outcome}</span>
              </span>
              {step.meta ? <span className="mono sync-panel-lifecycle-meta">{step.meta}</span> : null}
            </div>
          </div>
          {index < steps.length - 1 ? <span aria-hidden="true" className="sync-panel-lifecycle-rail" /> : null}
        </li>
      ))}
    </ol>
  );
}

function statusChip(run: DigestRunListItem): { label: string; style: ChipStyle } {
  if (run.status !== "synced") {
    return {
      label: "Not saved",
      style: {
        background: "color-mix(in oklch, var(--warm) 12%, var(--paper-strong))",
        color: "color-mix(in oklch, var(--warm) 70%, var(--ink))",
        border: "color-mix(in oklch, var(--warm) 30%, var(--line))",
      },
    };
  }
  if (run.candidateCount === 0) {
    return {
      label: "Empty",
      style: {
        background: "var(--paper-strong)",
        color: "var(--muted-strong)",
        border: "var(--line)",
      },
    };
  }
  return {
    label: "Saved",
    style: {
      background: "var(--signal-soft)",
      color: "color-mix(in oklch, var(--signal) 72%, var(--ink))",
      border: "color-mix(in oklch, var(--signal) 28%, var(--line))",
    },
  };
}

function RunCard({
  jobRun,
  run,
  domId = runDomId(run.id),
}: {
  jobRun?: AgentJobRunListItem;
  run: DigestRunListItem;
  domId?: string | null;
}) {
  const hydrated = useHydrated();
  const stampIso = run.syncedAt ?? run.preparedAt;
  const timeLabel = hydrated ? formatRelative(stampIso) : formatAbsolute(stampIso);
  const chip = statusChip(run);

  const windowLabel = run.lookbackCutoff
    ? `${formatDay(run.lookbackCutoff)} → ${formatDay(run.preparedAt)}`
    : "all new posts";

  const title =
    run.digestTitle ?? (run.status === "synced" ? "Untitled AI Digest" : "Prepared, no AI Digest saved");

  const contributing = run.sources.filter((s) => s.eligible > 0);
  const silentCount = run.subscriptionCount - contributing.length;
  const detailCount = run.candidates.length + contributing.length + Math.max(0, silentCount);
  const verdict = digestRunVerdict(run, jobRun);

  return (
    <article className="sync-panel-run-card sync-panel-mobile-flat" id={domId ?? undefined}>
      <p className="sync-panel-run-card-title">{title}</p>
      <header className="sync-panel-run-card-head">
        <span
          className="fb-chip"
          style={{ background: chip.style.background, color: chip.style.color, borderColor: chip.style.border }}
        >
          {chip.label}
        </span>
        <time
          className="sync-panel-run-card-time"
          dateTime={stampIso}
          title={formatAbsolute(stampIso)}
        >
          {timeLabel}
        </time>
        <span className="fb-chip">{scheduledRunTriggerLabel(jobRun ?? null, "digest-cron", run.source)}</span>
        {run.language ? <span className="fb-chip">{displayLanguagePreference(run.language)}</span> : null}
        {run.regenerate ? (
          <span className="sync-panel-run-card-note">rebuilt</span>
        ) : null}
      </header>

      <p className={`sync-panel-run-card-verdict is-${verdict.tone}`}>
        {verdict.text}
      </p>
      <DigestLifecycle jobRun={jobRun} run={run} />

      <div className="sync-panel-run-card-funnel">
        <FunnelStat value={run.candidateCount} label="found" />
        {run.status === "synced" ? (
          <>
            <Arrow />
            <FunnelStat value={run.includedCount ?? 0} label="used" tone="signal" />
            <Arrow />
            <FunnelStat value={run.droppedCount ?? 0} label="skipped" tone="muted" />
          </>
        ) : (
          <span className="sync-panel-run-card-muted">· not saved yet</span>
        )}
      </div>

      <div className="sync-panel-run-card-meta">
        <span>
          <span className="sync-panel-run-card-meta-strong">{formatCount(run.contributingSourceCount)}</span>
          /{formatCount(run.subscriptionCount)} sources contributed
        </span>
        <span>Covered {windowLabel}</span>
        {run.lastDigestAt ? <span>Previous AI Digest {formatRelative(run.lastDigestAt)}</span> : null}
      </div>

      {run.candidateCount === 0 ? (
        <p className="sync-panel-run-card-help">
          No new posts were found in this window.
        </p>
      ) : null}

      {detailCount > 0 ? (
        <details className="sync-panel-run-card-details">
          <summary className="sync-panel-run-card-details-summary">
            Show sources and posts considered
            <CountBadge value={detailCount} />
          </summary>
          <div className="sync-panel-run-card-details-body">
            {contributing.length > 0 || silentCount > 0 ? (
              <section aria-label="Source coverage">
                <div className="sync-panel-run-card-detail-heading">
                  Source coverage
                </div>
                <ul className="sync-panel-run-card-source-list">
                  {contributing.slice(0, VISIBLE_SOURCE_LIMIT).map((src) => (
                    <SourceRow key={src.entityId} src={src} synced={run.status === "synced"} />
                  ))}
                  {contributing.length > VISIBLE_SOURCE_LIMIT ? (
                    <li className="mono sync-panel-run-card-detail-note">
                      <CountMeta label="more sources with new posts" value={contributing.length - VISIBLE_SOURCE_LIMIT} />
                    </li>
                  ) : null}
                  {silentCount > 0 ? (
                    <li className="mono sync-panel-run-card-detail-note">
                      <CountMeta label="without new posts in this window" value={silentCount} />
                    </li>
                  ) : null}
                </ul>
              </section>
            ) : null}
            {run.candidates.length > 0 ? (
              <section aria-label="Found posts">
                <div className="sync-panel-run-card-detail-heading">
                  Posts considered
                </div>
                <ul className="sync-panel-run-card-candidate-list">
                  {run.candidates.map((item, index) => (
                    <CandidateRow
                      key={`${item.url ?? item.title ?? "item"}-${index}`}
                      item={item}
                      synced={run.status === "synced"}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function DigestLogDialog({
  jobRuns,
  logRef,
  onClose,
  runs,
}: {
  jobRuns: AgentJobRunListItem[];
  logRef: DigestLogRef;
  onClose: () => void;
  runs: DigestRunListItem[];
}) {
  const jobsByInstanceId = jobRunByInstanceId(jobRuns);
  const run = logRef.kind === "run" ? runs.find((candidate) => candidate.id === logRef.runId) ?? null : null;
  const jobRun = logRef.kind === "job"
    ? jobsByInstanceId.get(logRef.instanceId) ?? null
    : run?.jobRunId
      ? jobsByInstanceId.get(run.jobRunId) ?? null
      : null;

  return (
    <div className="sync-panel-log-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="AI Digest build log"
        aria-modal="true"
        className="sync-panel-log-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="sync-panel-log-dialog-head">
          <h3>Build log</h3>
          <button className="post-action-btn" onClick={onClose} title="Close" type="button">
            <X aria-hidden="true" className="post-action-icon" />
            <span className="sr-only">Close</span>
          </button>
        </header>
        <div className="sync-panel-log-dialog-body">
          {run ? (
            <RunCard domId={null} jobRun={jobRun ?? undefined} run={run} />
          ) : jobRun ? (
            <JobRunCard domId={null} jobRun={jobRun} />
          ) : (
            <EmptyState
              className="sync-panel-empty is-dashed"
              title="Build log unavailable"
              body="This AI Digest build is no longer in the current history."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="sync-panel-funnel-arrow">
      →
    </span>
  );
}

function FunnelStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "signal" | "muted";
}) {
  const color =
    tone === "signal"
      ? "color-mix(in oklch, var(--signal) 72%, var(--ink))"
      : tone === "muted"
        ? "var(--muted-strong)"
        : "var(--ink)";
  return (
    <span className="sync-panel-funnel-stat">
      <span className="mono sync-panel-funnel-stat-value" style={{ color }}>
        {formatCount(value)}
      </span>
      <span className="sync-panel-funnel-stat-label">{label}</span>
    </span>
  );
}

function SourceRow({ src, synced }: { src: DigestRunSource; synced: boolean }) {
  return (
    <li className="sync-panel-source-row">
      <span className="sync-panel-source-row-name">{src.name}</span>
      <span className="mono sync-panel-source-row-count">
        {formatCount(src.eligible)} found{synced ? ` · ${formatCount(src.included)} used` : ""}
      </span>
    </li>
  );
}

function CandidateRow({ item, synced }: { item: DigestRunCandidate; synced: boolean }) {
  // Three outcomes: presented (in), eligible-but-passed-over (drop), and when
  // the run never synced — simply pending (no editorial decision was ever made,
  // so don't imply it was rejected).
  const outcome = !synced ? "pending" : item.included ? "used" : "not used";
  const outcomeColor = !synced
    ? "var(--muted)"
    : item.included
      ? "color-mix(in oklch, var(--signal) 70%, var(--ink))"
      : "var(--muted)";
  const outcomeTitle = !synced
    ? "Found, AI Digest not saved yet"
    : item.included
      ? "Used in the AI Digest"
      : "Found but skipped";
  const title = item.title?.trim() || "Untitled candidate";
  const sourceType = item.sourceType?.trim() || sourceTag(item.kind);
  const detailHref = item.feedItemId
    ? postDetailHref(item.feedItemId, "/dashboard?tab=ai-digest", "AI Digest")
    : null;
  return (
    <li className="sync-panel-candidate-row">
      <span
        className="mono sync-panel-candidate-outcome"
        style={{ color: outcomeColor }}
        title={outcomeTitle}
      >
        {outcome}
      </span>
      <span className="mono sync-panel-candidate-kind">
        {sourceType}
      </span>
      <span className="sync-panel-candidate-copy">
        {detailHref ? (
          <a
            className={item.included ? "sync-panel-candidate-title" : "sync-panel-candidate-title is-muted"}
            href={detailHref}
            title={title}
          >
            {title}
          </a>
        ) : (
          <span
            className={item.included ? "sync-panel-candidate-title" : "sync-panel-candidate-title is-muted"}
            title={title}
          >
            {title}
          </span>
        )}
      </span>
    </li>
  );
}

function sourceTag(kind: string): string {
  switch (kind) {
    case "TWEET":
      return "x";
    case "BLOG_POST":
      return "blog";
    case "PODCAST_EPISODE":
      return "podcast";
    default:
      return kind.toLowerCase();
  }
}
