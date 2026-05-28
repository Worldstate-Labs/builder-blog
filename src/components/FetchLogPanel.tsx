"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useHydrated } from "@/components/ThemeToggle";

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

type DetailsShape = {
  perBuilder?: PerBuilder[];
  userActions?: UserAction[];
  localErrors?: string[];
  cliFlags?: Record<string, unknown>;
  error?: { message?: string; stack?: string };
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

export function FetchLogPanel({
  initialRuns,
}: {
  initialRuns: LibraryFetchRunListItem[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/skill/fetch-runs", {
          headers: { accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as
          | { runs?: LibraryFetchRunListItem[]; error?: string }
          | null;
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setRuns(Array.isArray(body?.runs) ? body.runs : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Refresh failed");
      } finally {
        setIsLoading(false);
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

  return (
    <section className="fb-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="fb-section-heading">Fetch log</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
            The last {runs.length || 0} fetch runs from your local CLI.
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
            No fetch runs yet. The next time your local CLI runs <code className="mono">fetch-personal</code> it will show up here.
          </div>
        ) : (
          runs.map((run) => <RunCard key={run.id} run={run} />)
        )}
      </div>
    </section>
  );
}

function RunCard({ run }: { run: LibraryFetchRunListItem }) {
  const hydrated = useHydrated();
  const style = statusStyle(run.status);
  const label = STATUS_LABEL[run.status] ?? run.status;
  const details = readDetails(run.details);
  const startedAtLabel = hydrated ? formatRelative(run.startedAt) : formatAbsolute(run.startedAt);

  return (
    <article
      className="rounded-[10px] border bg-[var(--paper-strong)] px-3.5 py-3"
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
        <time
          className="text-[12.5px] text-[var(--muted-strong)]"
          dateTime={run.startedAt}
          title={formatAbsolute(run.startedAt)}
        >
          {startedAtLabel}
        </time>
        <span className="fb-chip">{run.source}</span>
        {run.cliVersion ? (
          <span className="mono text-[11.5px] text-[var(--muted-strong)]">
            CLI {run.cliVersion}
          </span>
        ) : null}
        {run.hostname ? (
          <span className="mono text-[11.5px] text-[var(--muted-strong)]">
            {run.hostname.replace(/\.local$/, "")}
          </span>
        ) : null}
      </header>

      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink)]">
        {run.summary}
      </p>

      <div className="mono mt-2 text-[11.5px] text-[var(--muted-strong)]">
        {run.itemsFetched} fetched · {run.tasksGenerated} tasks ·{" "}
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

  return (
    <div className="grid gap-3">
      {perBuilder.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
            Per builder
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
                <span>{entry.tasksGenerated ?? 0} tasks</span>
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
      !details.cliFlags &&
      !details.error ? (
        <p className="text-[12.5px] text-[var(--muted-strong)]">No structured details.</p>
      ) : null}
    </div>
  );
}
