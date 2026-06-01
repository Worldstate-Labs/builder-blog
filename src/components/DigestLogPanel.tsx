"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Activity, Clock3, ExternalLink } from "lucide-react";
import { useHydrated } from "@/components/ThemeToggle";
import { contentSyncStateChanged } from "@/lib/content-sync-events";
import type {
  DigestCronJobStatus,
  DigestRunCandidate,
  DigestRunListItem,
  DigestRunSource,
} from "@/lib/digest-runs";

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
const PREPARED_RUN_MAX_AGE_MS = 30 * 60_000;
const CRON_SLOT_LIMIT = 12;

type CronSlotStatus = "ok" | "failed" | "missed" | "waiting";

type CronSlot = {
  expectedAt: string;
  windowEnd: string;
  status: CronSlotStatus;
  run: DigestRunListItem | null;
};

function slotDomId(slot: CronSlot): string {
  return `digest-slot-${Date.parse(slot.expectedAt)}`;
}

function runDomId(runId: string): string {
  return `digest-run-${runId}`;
}

function isRunInflight(run: DigestRunListItem): boolean {
  const ageMs = Date.now() - Date.parse(run.preparedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > PREPARED_RUN_MAX_AGE_MS) return false;
  return run.status !== "synced";
}

function addScheduleInterval(date: Date, cronJob: DigestCronJobStatus, steps = 1): Date {
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

function floorToExpectedSchedule(now: Date, cronJob: DigestCronJobStatus): Date {
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

function cronGraceMs(cronJob: DigestCronJobStatus): number {
  const minutes = Math.min(30, Math.max(5, Math.round(cronJob.intervalMinutes * 0.1)));
  return minutes * 60_000;
}

function buildCronStatus(
  cronJob: DigestCronJobStatus | null,
  runs: DigestRunListItem[],
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
    .map((run) => ({ run, startedMs: Date.parse(run.preparedAt) }))
    .filter(({ startedMs }) => Number.isFinite(startedMs))
    .sort((a, b) => a.startedMs - b.startedMs);

  let cursor = floorToExpectedSchedule(now, cronJob);
  const nextExpected = addScheduleInterval(cursor, cronJob);
  const expected: Date[] = [];
  for (let index = 0; index < CRON_SLOT_LIMIT * 3 && expected.length < CRON_SLOT_LIMIT; index += 1) {
    // Only expect slots at or after activation. A slot that fell before the job
    // was set up could never have run, so it must not count as "missed" (this
    // produced a false "Needs attention" on the activation-boundary slot). The
    // grace window applies to matching a run to a slot, not to inventing slots.
    if (cursor.getTime() >= startedAt) {
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
      ? match.status === "synced"
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

export function DigestLogPanel({
  initialRuns,
  initialCronRuns,
  initialCronJob,
  actions,
  shareToggle,
}: {
  initialRuns: DigestRunListItem[];
  initialCronRuns: DigestRunListItem[];
  initialCronJob: DigestCronJobStatus | null;
  actions?: ReactNode;
  shareToggle?: ReactNode;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [cronRuns, setCronRuns] = useState(initialCronRuns);
  const [cronJob, setCronJob] = useState(initialCronJob);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"status" | "log">("status");
  const cronStatus = useMemo(() => buildCronStatus(cronJob, cronRuns), [cronJob, cronRuns]);
  const runsRef = useRef(runs);
  const hydrated = useHydrated();

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  const openRun = useCallback((runId: string) => {
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
        const response = await fetch("/api/digest-runs", {
          headers: { accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as
          | {
              runs?: DigestRunListItem[];
              cronRuns?: DigestRunListItem[];
              cronJob?: DigestCronJobStatus | null;
              error?: string;
            }
          | null;
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        setRuns(Array.isArray(body?.runs) ? body.runs : []);
        setCronRuns(Array.isArray(body?.cronRuns) ? body.cronRuns : []);
        setCronJob(body?.cronJob ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Refresh failed");
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
      const inflight = runsRef.current.some(isRunInflight);
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

  return (
    <section className="fb-panel digest-updates-panel">
      <div className="digest-updates-head">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="fb-section-heading">Digest updates</h2>
            <ScheduleHealthChip cronJob={cronJob} slots={cronStatus.slots} />
          </div>
          <DigestScheduleSummary
            cronJob={cronJob}
            hydrated={hydrated}
            nextExpectedAt={cronStatus.nextExpectedAt}
          />
        </div>
        {(shareToggle || actions) ? (
          <div className="digest-updates-actions">
            {shareToggle}
            {actions}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-[12px] text-[var(--danger)]">{error}</p>
      ) : null}

      <div
        aria-label="Digest update views"
        className="mt-4 inline-flex rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)] p-1"
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
          Schedule status
        </button>
        <button
          aria-selected={activeTab === "log"}
          className={`fb-btn compact ${activeTab === "log" ? "" : "light"}`}
          onClick={() => setActiveTab("log")}
          role="tab"
          type="button"
        >
          <Clock3 aria-hidden="true" />
          Build history
        </button>
      </div>

      {activeTab === "status" ? (
        <DigestStatusPanel
          cronJob={cronJob}
          nextExpectedAt={cronStatus.nextExpectedAt}
          onOpenRun={openRun}
          slots={cronStatus.slots}
        />
      ) : (
        <DigestRunList
          expanded={expanded}
          runs={runs}
          setExpanded={setExpanded}
        />
      )}
    </section>
  );
}

type ChipStyle = { background: string; color: string; border: string };

function summarizeSchedule(cronJob: DigestCronJobStatus | null, slots: CronSlot[]) {
  if (!cronJob) return { label: "Not connected", style: statusStyle("partial") };
  if (cronJob.status !== "active") return { label: "Stopped", style: statusStyle("partial") };
  const problemCount = slots.filter((slot) => slot.status === "missed" || slot.status === "failed").length;
  const okCount = slots.filter((slot) => slot.status === "ok").length;
  return {
    label: problemCount > 0 ? "Needs attention" : okCount > 0 ? "Healthy" : "Waiting",
    style: problemCount > 0 ? statusStyle("failed") : okCount > 0 ? statusStyle("ok") : statusStyle("partial"),
  };
}

function ScheduleHealthChip({
  cronJob,
  slots,
}: {
  cronJob: DigestCronJobStatus | null;
  slots: CronSlot[];
}) {
  const summary = summarizeSchedule(cronJob, slots);
  return (
    <span
      className="fb-chip"
      style={{
        background: summary.style.background,
        borderColor: summary.style.border,
        color: summary.style.color,
      }}
    >
      {summary.label}
    </span>
  );
}

function DigestScheduleSummary({
  cronJob,
  hydrated,
  nextExpectedAt,
}: {
  cronJob: DigestCronJobStatus | null;
  hydrated: boolean;
  nextExpectedAt: string | null;
}) {
  if (!cronJob) {
    return (
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
        No local helper schedule has reported yet. Build history appears after a digest prompt runs.
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
        . One-time digest builds can still be copied.
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
      {cronJob.frequencyLabel}
      {nextLabel ? ` · next ${nextLabel}` : ""}
      {cronJob.regenerateDigest ? " · includes already digested items" : ""}
    </p>
  );
}

function statusStyle(status: "ok" | "partial" | "failed"): ChipStyle {
  switch (status) {
    case "ok":
      return {
        background: "var(--signal-soft)",
        color: "color-mix(in oklch, var(--signal) 72%, var(--ink))",
        border: "color-mix(in oklch, var(--signal) 28%, var(--line))",
      };
    case "failed":
      return {
        background: "var(--danger-soft)",
        color: "var(--danger)",
        border: "color-mix(in oklch, var(--danger) 30%, var(--line))",
      };
    default:
      return {
        background: "var(--warm-soft)",
        color: "color-mix(in oklch, var(--warm) 68%, var(--ink))",
        border: "color-mix(in oklch, var(--warm) 30%, var(--line))",
      };
  }
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
  slots: CronSlot[];
}) {
  const hydrated = useHydrated();
  if (!cronJob) {
    return (
      <div className="mt-4 rounded-[10px] border border-dashed border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
        No digest schedule has reported yet.
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
      ? `${missedCount} scheduled ${missedCount === 1 ? "window has" : "windows have"} no recorded run; ${failedCount} recorded ${failedCount === 1 ? "run did" : "runs did"} not save a digest.`
      : missedCount > 0
        ? `${missedCount} scheduled ${missedCount === 1 ? "window has" : "windows have"} no recorded run in ${missedCount === 1 ? "its" : "their"} expected time range.`
        : `${failedCount} recorded ${failedCount === 1 ? "run did" : "runs did"} not save a digest.`;
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
            {cronJob.regenerateDigest ? <span className="fb-chip">rebuilds past items</span> : null}
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
              <span>Green saved, amber waiting, red missed or failed.</span>
            </div>
            <div className="flex items-end gap-1.5" aria-label="Digest schedule status graph">
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

function cronSlotStyle(status: CronSlotStatus): ChipStyle {
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
      aria-label={`${label} scheduled digest run at ${formatAbsolute(slot.expectedAt)}`}
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
            ? `${slot.run.includedCount ?? 0}/${slot.run.candidateCount} used`
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

function DigestRunList({
  expanded,
  runs,
  setExpanded,
}: {
  expanded: boolean;
  runs: DigestRunListItem[];
  setExpanded: (value: (previous: boolean) => boolean) => void;
}) {
  return (
    <div className="mt-4 grid gap-2.5">
      {runs.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
          No digest builds yet. After your local helper prepares a digest,
          the source breakdown will show up here.
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
              {expanded ? "See less" : `See more (${runs.length - VISIBLE_RUN_LIMIT})`}
            </button>
          ) : null}
        </>
      )}
    </div>
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
    : "all new items";

  const title =
    run.digestTitle ?? (run.status === "synced" ? "Untitled digest" : "Prepared, no digest saved");

  const contributing = run.sources.filter((s) => s.eligible > 0);
  const silentCount = run.subscriptionCount - contributing.length;
  const detailCount = run.candidates.length + contributing.length + Math.max(0, silentCount);

  return (
    <article
      className="rounded-[10px] border bg-[var(--paper-strong)] px-3.5 py-3"
      id={runDomId(run.id)}
      style={{ borderColor: "var(--line)" }}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          className="fb-chip"
          style={{ background: chip.style.background, color: chip.style.color, borderColor: chip.style.border }}
        >
          {chip.label}
        </span>
        <time
          className="text-[12.5px] text-[var(--muted-strong)]"
          dateTime={stampIso}
          title={formatAbsolute(stampIso)}
        >
          {timeLabel}
        </time>
        <span className="fb-chip">{run.source === "cron" ? "scheduled" : "one-time"}</span>
        {run.language ? <span className="fb-chip">{run.language}</span> : null}
        {run.regenerate ? (
          <span className="text-[11px] text-[var(--muted)]">rebuilt</span>
        ) : null}
      </header>

      <p className="mt-2 text-[13.5px] font-semibold leading-snug text-[var(--ink)]">{title}</p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[12.5px]">
        <FunnelStat value={run.candidateCount} label="found" />
        {run.status === "synced" ? (
          <>
            <Arrow />
            <FunnelStat value={run.includedCount ?? 0} label="used" tone="signal" />
            <Arrow />
            <FunnelStat value={run.droppedCount ?? 0} label="skipped" tone="muted" />
          </>
        ) : (
          <span className="text-[var(--muted)]">· not saved yet</span>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--muted-strong)]">
        <span>
          <span className="font-semibold text-[var(--ink)]">{run.contributingSourceCount}</span>
          /{run.subscriptionCount} sources contributed
        </span>
        <span>Covered {windowLabel}</span>
        {run.lastDigestAt ? <span>Previous digest {formatRelative(run.lastDigestAt)}</span> : null}
      </div>

      {run.candidateCount === 0 ? (
        <p className="mt-1.5 text-[12px] text-[var(--muted-strong)]">
          No new posts were found in this window.
        </p>
      ) : null}

      {detailCount > 0 ? (
        <details className="mt-2.5 rounded-[8px] border border-[var(--line)] bg-[var(--paper)]">
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-bold text-[var(--ink)]">
            Show run details
          </summary>
          <div className="grid gap-3 border-t border-[var(--line)] px-3 py-2.5">
            {contributing.length > 0 || silentCount > 0 ? (
              <section aria-label="Source coverage">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Sources
                </div>
                <ul className="grid gap-1">
                  {contributing.slice(0, VISIBLE_SOURCE_LIMIT).map((src) => (
                    <SourceRow key={src.entityId} src={src} synced={run.status === "synced"} />
                  ))}
                  {contributing.length > VISIBLE_SOURCE_LIMIT ? (
                    <li className="mono text-[11px] text-[var(--muted)]">
                      + {contributing.length - VISIBLE_SOURCE_LIMIT} more with new posts
                    </li>
                  ) : null}
                  {silentCount > 0 ? (
                    <li className="mono text-[11px] text-[var(--muted)]">
                      {silentCount} without new posts in this window
                    </li>
                  ) : null}
                </ul>
              </section>
            ) : null}
            {run.candidates.length > 0 ? (
              <section aria-label="Found posts">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Found posts
                </div>
                <ul className="grid gap-1.5">
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
    <span aria-hidden="true" className="text-[var(--muted)]">
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
    <span className="inline-flex items-baseline gap-1">
      <span className="mono text-[14px] font-semibold" style={{ color }}>
        {value}
      </span>
      <span className="text-[var(--muted-strong)]">{label}</span>
    </span>
  );
}

function SourceRow({ src, synced }: { src: DigestRunSource; synced: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-[12px]">
      <span className="min-w-0 truncate text-[var(--ink)]">{src.name}</span>
      <span className="mono shrink-0 text-[11px] text-[var(--muted-strong)]">
        {src.eligible} found{synced ? ` · ${src.included} used` : ""}
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
    ? "Found, digest not saved yet"
    : item.included
      ? "Used in the digest"
      : "Found but skipped";
  return (
    <li className="flex items-start gap-2 text-[12.5px] leading-snug">
      <span
        className="mono mt-[1px] w-[2.6em] shrink-0 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: outcomeColor }}
        title={outcomeTitle}
      >
        {outcome}
      </span>
      <span className="mono mt-[1px] shrink-0 text-[10.5px] text-[var(--muted)]">
        {sourceTag(item.kind)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={item.included ? "text-[var(--ink)]" : "text-[var(--muted-strong)]"}>
          {item.title ?? item.url ?? "—"}
        </span>
        {item.source ? <span className="text-[var(--muted)]"> · {item.source}</span> : null}
      </span>
      {item.url ? (
        <a
          aria-label="View the original on its source site"
          className="shrink-0 text-[var(--accent)]"
          href={item.url}
          rel="noreferrer"
          target="_blank"
          title="View original"
        >
          <ExternalLink className="h-3.5 w-3.5" />
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
