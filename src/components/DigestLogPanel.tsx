"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useHydrated } from "@/components/ThemeToggle";
import type { DigestRunListItem } from "@/lib/digest-runs";

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

  return (
    <section className="fb-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="fb-section-heading">Digest log</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
            Your last {runs.length || 0} digest generations, including empty runs.
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

      <div className="mt-4 grid gap-2">
        {runs.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
            No digests generated yet. Each time your agent syncs a brief it will show up here.
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

function RunCard({ run }: { run: DigestRunListItem }) {
  const hydrated = useHydrated();
  const empty = run.itemCount === 0;
  const startedAtLabel = hydrated ? formatRelative(run.createdAt) : formatAbsolute(run.createdAt);

  const statusStyle = empty
    ? {
        background: "var(--paper-strong)",
        color: "var(--muted-strong)",
        border: "var(--line)",
      }
    : {
        background: "var(--signal-soft)",
        color: "color-mix(in oklch, var(--signal) 72%, var(--ink))",
        border: "color-mix(in oklch, var(--signal) 28%, var(--line))",
      };

  return (
    <article
      className="rounded-[10px] border bg-[var(--paper-strong)] px-3.5 py-3"
      style={{ borderColor: "var(--line)" }}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          className="fb-chip"
          style={{
            background: statusStyle.background,
            color: statusStyle.color,
            borderColor: statusStyle.border,
          }}
        >
          {empty ? "Empty" : String(run.status || "synced")}
        </span>
        <time
          className="text-[12.5px] text-[var(--muted-strong)]"
          dateTime={run.createdAt}
          title={formatAbsolute(run.createdAt)}
        >
          {startedAtLabel}
        </time>
        <span className="fb-chip">{run.language}</span>
        {run.source ? (
          <span className="mono text-[11.5px] text-[var(--muted-strong)]">{run.source}</span>
        ) : null}
      </header>

      <p className="mt-2 text-[13.5px] font-semibold leading-snug text-[var(--ink)]">
        {run.title}
      </p>

      <div className="mono mt-1 text-[11.5px] text-[var(--muted-strong)]">
        {empty
          ? "no new subscription updates"
          : `${run.itemCount} item${run.itemCount === 1 ? "" : "s"}`}{" "}
        · {formatDay(run.periodStart)} → {formatDay(run.periodEnd)}
      </div>

      {empty ? null : (
        <details className="mt-2 rounded-[8px] border border-[var(--line)] bg-[var(--paper)]">
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-bold text-[var(--ink)]">
            Show {run.items.length || run.itemCount} included post
            {(run.items.length || run.itemCount) === 1 ? "" : "s"}
          </summary>
          <div className="border-t border-[var(--line)] px-3 py-2.5">
            {run.items.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)]">
                Item details are no longer available for this digest.
              </p>
            ) : (
              <ul className="grid gap-1.5">
                {run.items.map((item, index) => (
                  <li
                    key={`${item.url ?? item.title ?? "item"}-${index}`}
                    className="flex items-start gap-2 text-[12.5px] leading-snug"
                  >
                    <span className="mono mt-[1px] shrink-0 text-[10.5px] text-[var(--muted)]">
                      {sourceTag(item.kind)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[var(--ink)]">{item.title ?? item.url ?? "—"}</span>
                      {item.source ? (
                        <span className="text-[var(--muted-strong)]"> · {item.source}</span>
                      ) : null}
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
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </article>
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
