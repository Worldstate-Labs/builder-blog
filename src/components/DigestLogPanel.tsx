"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { Activity, ChevronDown, ChevronUp, Clock3, ExternalLink } from "lucide-react";
import { CountBadge, CountMeta, CountMetric, formatCount } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { useHydrated } from "@/components/ThemeToggle";
import { contentSyncStateChanged } from "@/lib/content-sync-events";
import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import {
  buildDigestCronStatus,
  getDigestUpdateStatus,
  latestResolvedSlotStatus,
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

const VISIBLE_RUN_LIMIT = 2;
const VISIBLE_SOURCE_LIMIT = 4;

type DigestCronSlot = CronSlot<DigestRunListItem>;

function slotDomId(slot: DigestCronSlot): string {
  return `digest-slot-${Date.parse(slot.expectedAt)}`;
}

function runDomId(runId: string): string {
  return `digest-run-${runId}`;
}

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
  const [expanded, setExpanded] = useState(false);
  const [uncontrolledDetailsOpen, setUncontrolledDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"status" | "log">("status");
  const detailsOpen = controlledDetailsOpen ?? uncontrolledDetailsOpen;
  const cronStatus = useMemo(
    () => buildDigestCronStatus(cronJob, cronRuns, scheduledJobRuns),
    [cronJob, cronRuns, scheduledJobRuns],
  );
  const updateStatus = useMemo(
    () => getDigestUpdateStatus(cronJob, cronStatus.slots, runs),
    [cronJob, cronStatus.slots, runs],
  );
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

  const openRun = useCallback(
    (runId: string) => {
      setDetailsOpen(true);
      setExpanded(true);
      setActiveTab("log");
      window.setTimeout(() => {
        document.getElementById(runDomId(runId))?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 0);
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
      <div
        aria-label="AI Digest update views"
        className="fb-segmented-tabs sync-panel-tabs"
        onKeyDown={handleTabKeyDown}
        role="tablist"
      >
        <button
          aria-controls="digest-update-panel-status"
          aria-selected={activeTab === "status"}
          className={`fb-btn compact ${activeTab === "status" ? "" : "light"}`}
          id="digest-update-tab-status"
          onClick={() => setActiveTab("status")}
          role="tab"
          tabIndex={activeTab === "status" ? 0 : -1}
          type="button"
        >
          <Activity aria-hidden="true" />
          Schedule status
        </button>
        <button
          aria-controls="digest-update-panel-log"
          aria-selected={activeTab === "log"}
          className={`fb-btn compact ${activeTab === "log" ? "" : "light"}`}
          id="digest-update-tab-log"
          onClick={() => setActiveTab("log")}
          role="tab"
          tabIndex={activeTab === "log" ? 0 : -1}
          type="button"
        >
          <Clock3 aria-hidden="true" />
          Build log
          <span className="sr-only">AI Digest build history</span>
        </button>
      </div>

      <section
        aria-labelledby="digest-update-tab-status"
        hidden={activeTab !== "status"}
        id="digest-update-panel-status"
        role="tabpanel"
      >
        {activeTab === "status" ? (
          <DigestStatusPanel
            cronJob={cronJob}
            nextExpectedAt={cronStatus.nextExpectedAt}
            onOpenRun={openRun}
            slots={cronStatus.slots}
          />
        ) : null}
      </section>
      <section
        aria-labelledby="digest-update-tab-log"
        hidden={activeTab !== "log"}
        id="digest-update-panel-log"
        role="tabpanel"
      >
        {activeTab === "log" ? (
          <DigestRunList
            expanded={expanded}
            jobRuns={jobRuns}
            runs={runs}
            setExpanded={setExpanded}
          />
        ) : null}
      </section>
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
  const summaryNode = (
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
  );

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
        {status.summary} Use Build AI Digest to copy a Local Agent prompt.
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
      {cronJob.regenerateDigest ? " · includes posts already used in AI Digest archives" : ""}
    </p>
  );
}

function DigestStatusPanel({
  cronJob,
  nextExpectedAt,
  onOpenRun,
  slots,
}: {
  cronJob: DigestCronJobStatus | null;
  nextExpectedAt: string | null;
  onOpenRun: (runId: string) => void;
  slots: DigestCronSlot[];
}) {
  const hydrated = useHydrated();
  if (!cronJob) {
    return (
      <EmptyState
        className="sync-panel-empty is-dashed"
        title="No AI Digest schedule"
        body="No AI Digest schedule has reported yet."
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
              className="sync-panel-run-card-time"
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
  const latestResolved = latestResolvedSlotStatus(slots);
  const hasProblem = latestResolved === "missed" || latestResolved === "failed";
  const problemDetail =
    latestResolved === "missed"
      ? "The latest scheduled window has no recorded run in its expected time range."
      : "The latest scheduled run did not save an AI Digest.";
  const statusTone = hasProblem
    ? statusStyle("failed")
    : latestResolved === "ok"
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
              {hasProblem ? "Needs attention" : latestResolved === "ok" ? "Healthy" : "Waiting"}
            </span>
            <span className="fb-chip">{cronJob.frequencyLabel}</span>
            {cronJob.regenerateDigest ? <span className="fb-chip">rebuilds past posts</span> : null}
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
          {hasProblem ? (
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
              <span>Green saved · amber waiting · red issue.</span>
            </div>
            <div className="sync-panel-status-graph" aria-label="AI Digest schedule status graph">
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

function cronSlotStyle(status: CronSlotStatus): ChipStyle {
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

function CronSlotBar({ onSelect, slot }: { onSelect: () => void; slot: DigestCronSlot }) {
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
      aria-label={`${label} scheduled AI Digest run at ${formatAbsolute(slot.expectedAt)}`}
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
  slot: DigestCronSlot;
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
            ? `${slot.run.includedCount ?? 0}/${slot.run.candidateCount} used`
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

function DigestRunList({
  expanded,
  jobRuns,
  runs,
  setExpanded,
}: {
  expanded: boolean;
  jobRuns: AgentJobRunListItem[];
  runs: DigestRunListItem[];
  setExpanded: (value: (previous: boolean) => boolean) => void;
}) {
  const runJobIds = new Set(runs.map((run) => run.jobRunId).filter((id): id is string => Boolean(id)));
  const entries = [
    ...runs.map((run) => ({ kind: "digest" as const, id: run.id, startedAt: run.preparedAt, run })),
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
          title="No AI Digest builds"
          body="No AI Digest builds yet. Builds appear after your Local Agent prepares an AI Digest."
        />
      ) : (
        <>
          {visibleEntries.map((entry) => (
            entry.kind === "digest"
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

function jobRunStatusStyle(jobRun: AgentJobRunListItem): ChipStyle {
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
      <div className="mono sync-panel-run-card-stage">
        {jobRun.stage || "runtime"} · {jobRun.finishedAt ? "finished" : "active"}
      </div>
    </article>
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

function RunCard({ run }: { run: DigestRunListItem }) {
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

  return (
    <article className="sync-panel-run-card" id={runDomId(run.id)}>
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
        <span className="fb-chip">{run.source === "cron" ? "Scheduled" : "One-time"}</span>
        {run.language ? <span className="fb-chip">{displayLanguagePreference(run.language)}</span> : null}
        {run.regenerate ? (
          <span className="sync-panel-run-card-note">rebuilt</span>
        ) : null}
      </header>

      <p className="sync-panel-run-card-title">{title}</p>

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
            Show run details
          </summary>
          <div className="sync-panel-run-card-details-body">
            {contributing.length > 0 || silentCount > 0 ? (
              <section aria-label="Source coverage">
                <div className="sync-panel-run-card-detail-heading">
                  Sources
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
                  Found posts
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
  const outcome = !synced ? "new" : item.included ? "used" : "skip";
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
        {sourceTag(item.kind)}
      </span>
      <span className="sync-panel-candidate-copy">
        <span className={item.included ? "sync-panel-candidate-title" : "sync-panel-candidate-title is-muted"}>
          {item.title ?? item.url ?? "Untitled candidate"}
        </span>
        {item.source ? <span className="sync-panel-candidate-source"> · {item.source}</span> : null}
      </span>
      {item.url ? (
        <a
          aria-label="View the original on its source site"
          className="sync-panel-candidate-link"
          href={item.url}
          rel="noreferrer"
          target="_blank"
          title="View original"
        >
          <ExternalLink aria-hidden="true" className="sync-panel-candidate-link-icon" />
        </a>
      ) : null}
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
