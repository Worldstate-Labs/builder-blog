"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useHydrated } from "@/components/ThemeToggle";
import { contentSyncStateChanged } from "@/lib/content-sync-events";
import type {
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

const VISIBLE_RUN_LIMIT = 5;
const VISIBLE_SOURCE_LIMIT = 4;
const PREPARED_RUN_MAX_AGE_MS = 30 * 60_000;

function isRunInflight(run: DigestRunListItem): boolean {
  const ageMs = Date.now() - Date.parse(run.preparedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > PREPARED_RUN_MAX_AGE_MS) return false;
  return run.status !== "synced";
}

export function DigestLogPanel({
  initialRuns,
}: {
  initialRuns: DigestRunListItem[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const runsRef = useRef(runs);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/digest-runs", {
          headers: { accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as
          | { runs?: DigestRunListItem[]; error?: string }
          | null;
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        setRuns(Array.isArray(body?.runs) ? body.runs : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Refresh failed");
      } finally {
        setIsLoading(false);
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
    <section className="fb-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="fb-section-heading">Digest log</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
            What each generation actually considered — the eligible pool, the window,
            and which followed sources it drew from. Use it to see why a digest came
            out the way it did.
          </p>
        </div>
        <button
          className="fb-btn light compact"
          disabled={isLoading}
          onClick={refresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" />
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-[12px] text-[var(--danger)]">{error}</p>
      ) : null}

      <div className="mt-4 grid gap-2.5">
        {runs.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
            No digest runs recorded yet. The next time your agent prepares a digest,
            its candidate funnel will show up here.
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
                onClick={() => setExpanded((v) => !v)}
                type="button"
              >
                {expanded ? "See less" : `See more (${runs.length - VISIBLE_RUN_LIMIT})`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

type ChipStyle = { background: string; color: string; border: string };

function statusChip(run: DigestRunListItem): { label: string; style: ChipStyle } {
  if (run.status !== "synced") {
    return {
      label: "Not synced",
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
    label: "Synced",
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
    : "all not-yet-digested";

  const title =
    run.digestTitle ?? (run.status === "synced" ? "Untitled digest" : "Prepared — no digest synced");

  const contributing = run.sources.filter((s) => s.eligible > 0);
  const silentCount = run.subscriptionCount - contributing.length;

  return (
    <article
      className="rounded-[10px] border bg-[var(--paper-strong)] px-3.5 py-3"
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
        {run.language ? <span className="fb-chip">{run.language}</span> : null}
        {run.regenerate ? (
          <span className="mono text-[11px] text-[var(--muted)]">regenerate</span>
        ) : null}
      </header>

      <p className="mt-2 text-[13.5px] font-semibold leading-snug text-[var(--ink)]">{title}</p>

      <div className="mono mt-1 text-[11.5px] text-[var(--muted)]">
        Window {windowLabel}
        {run.lastDigestAt ? ` · last digest ${formatRelative(run.lastDigestAt)}` : ""}
      </div>

      {/* The funnel — the diagnostic spine. */}
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[12.5px]">
        <FunnelStat value={run.candidateCount} label="eligible" />
        {run.status === "synced" ? (
          <>
            <Arrow />
            <FunnelStat value={run.includedCount ?? 0} label="included" tone="signal" />
            <Arrow />
            <FunnelStat value={run.droppedCount ?? 0} label="dropped" tone="muted" />
          </>
        ) : (
          <span className="text-[var(--muted)]">· not synced yet</span>
        )}
      </div>

      {run.candidateCount === 0 ? (
        <p className="mt-1.5 text-[12px] text-[var(--muted-strong)]">
          Nothing was eligible — no new posts from followed sources in this window
          (everything else was already digested).
        </p>
      ) : (
        <>
          <div className="mt-2 text-[12px] text-[var(--muted-strong)]">
            <span className="font-semibold text-[var(--ink)]">{run.contributingSourceCount}</span>{" "}
            of {run.subscriptionCount} followed{" "}
            {run.subscriptionCount === 1 ? "source" : "sources"} contributed
          </div>
          {contributing.length > 0 ? (
            <ul className="mt-1.5 grid gap-1">
              {contributing.slice(0, VISIBLE_SOURCE_LIMIT).map((src) => (
                <SourceRow key={src.entityId} src={src} synced={run.status === "synced"} />
              ))}
              {contributing.length > VISIBLE_SOURCE_LIMIT ? (
                <li className="mono text-[11px] text-[var(--muted)]">
                  + {contributing.length - VISIBLE_SOURCE_LIMIT} more contributing
                </li>
              ) : null}
              {silentCount > 0 ? (
                <li className="mono text-[11px] text-[var(--muted)]">
                  {silentCount} silent · no new posts in window
                </li>
              ) : null}
            </ul>
          ) : null}
        </>
      )}

      {run.candidates.length > 0 ? (
        <details className="mt-2.5 rounded-[8px] border border-[var(--line)] bg-[var(--paper)]">
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-bold text-[var(--ink)]">
            Show {run.candidates.length} eligible{" "}
            {run.candidates.length === 1 ? "post" : "posts"} (in / dropped)
          </summary>
          <ul className="grid gap-1.5 border-t border-[var(--line)] px-3 py-2.5">
            {run.candidates.map((item, index) => (
              <CandidateRow
                key={`${item.url ?? item.title ?? "item"}-${index}`}
                item={item}
                synced={run.status === "synced"}
              />
            ))}
          </ul>
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
        {src.eligible} eligible{synced ? ` · ${src.included} in` : ""}
      </span>
    </li>
  );
}

function CandidateRow({ item, synced }: { item: DigestRunCandidate; synced: boolean }) {
  // Three outcomes: presented (in), eligible-but-passed-over (drop), and — when
  // the run never synced — simply pending (no editorial decision was ever made,
  // so don't imply it was rejected).
  const outcome = !synced ? "elig" : item.included ? "in" : "drop";
  const outcomeColor = !synced
    ? "var(--muted)"
    : item.included
      ? "color-mix(in oklch, var(--signal) 70%, var(--ink))"
      : "var(--muted)";
  const outcomeTitle = !synced
    ? "Eligible; run not synced (no decision made)"
    : item.included
      ? "Included in the digest"
      : "Eligible but not included";
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
