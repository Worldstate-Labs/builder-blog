"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
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

const VISIBLE_RUN_LIMIT = 3;

export function FetchLogPanel({
  initialRuns,
}: {
  initialRuns: LibraryFetchRunListItem[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Latest runs, readable inside the poll loop without re-arming the interval
  // on every refresh. Synced in an effect (not during render) so the poll loop
  // sees fresh data while keeping the [refresh]-only effect stable.
  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

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
    </section>
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
  // Show the agent + model that ran this fetch (e.g. "Codex · gpt-5-codex").
  // Fall back to the CLI version for runs recorded before this was captured.
  const agentLabel =
    [details.agentRuntime, details.agentModel].filter(Boolean).join(" · ") ||
    (run.cliVersion ? `CLI ${run.cliVersion}` : "");
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
            Syncing…
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
          <span className="mono text-[11.5px] text-[var(--muted-strong)]">
            {agentLabel}
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

      {fetchTasks.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
            Tasks ({fetchTasks.length})
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
            Prompts used
          </h3>
          <p className="mt-1 text-[11.5px] text-[var(--muted)]">
            The exact strings the agent received as{" "}
            <code>task.summaryInstructions.prompt</code> and (when the admin
            configured one) <code>task.fetchInstructions.prompt</code> for each
            source type on this run.
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
                      Summary prompt · what the agent received
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
                      <span>Fetch prompt · what the agent received</span>
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
        label: "x_token_missing",
        blurb:
          "This X (Twitter) source needs a personal API token before its posts can be read.",
        fix: "Add an X token under Settings → Tokens, then run fetch again.",
        fixHref: "/settings",
      };
    case "youtube_transcription":
      return {
        label: "youtube_transcription",
        blurb:
          "The video transcript was pulled and handed to the agent to summarize.",
        fix: null,
      };
    case "fetch_builder_fallback":
      return {
        label: "fetch_builder_fallback",
        blurb:
          "The standard fetcher couldn't pull the body, so the agent fetched the primary content itself before summarizing.",
        fix: null,
      };
    default:
      return { label: code || "—", blurb: null, fix: null };
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
  return { label: "Fetched by agent", tone: "idle" };
}

// Human-readable labels for the server/CLI failure reasons.
const FAILURE_REASON_LABEL: Record<string, string> = {
  summary_missing: "No summary was produced",
  not_summarized: "Fetched but the agent never summarized it",
  not_synced: "Not saved",
  content_missing: "No content was crawled",
  content_too_short: "Crawled content was too short / not real content",
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
  const compression =
    typeof task.bodyWords === "number" &&
    task.bodyWords > 0 &&
    typeof task.summaryWords === "number" &&
    task.summaryWords > 0
      ? `${task.bodyWords.toLocaleString()} → ${task.summaryWords.toLocaleString()} words (${(
          task.bodyWords / task.summaryWords
        ).toFixed(1)}× shorter)`
      : null;

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
            {ready ? "ready" : "agent"}
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

          <StageBlock title="① Fetch" tone={fetchRes.tone} outcome={fetchRes.label}>
            <FactRow label="Method" value={<span className="mono">{work.label}</span>} />
            {bodySize ? <FactRow label="Raw size" value={bodySize} /> : null}
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
              <FactRow label="Agent" value={<span className="mono">{agentLabel}</span>} />
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
                    : "The agent hasn't summarized this item yet."}
              </p>
            ) : null}
          </StageBlock>

          <details className="rounded-[6px] border border-[var(--line)] bg-[var(--paper)]">
            <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-strong)]">
              Raw JSON
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
