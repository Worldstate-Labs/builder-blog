"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CloudFetchRunLogItem } from "@/lib/cloud-fetch-run-log";

function mergeRuns(current: CloudFetchRunLogItem[], incoming: CloudFetchRunLogItem[]) {
  const byId = new Map(current.map((run) => [run.id, run]));
  for (const run of incoming) byId.set(run.id, run);
  return Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
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

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds - minutes * 60}s`;
}

function statusClass(status: string): string {
  if (status === "SUCCEEDED") return "is-ok";
  if (status === "PARTIAL") return "is-partial";
  if (status === "RUNNING") return "is-partial";
  return "is-failed";
}

export function AdminCloudFetchLog({
  initialRuns,
  initialHasMore,
}: {
  initialRuns: CloudFetchRunLogItem[];
  initialHasMore: boolean;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/cloud-fetch/runs", {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (Array.isArray(body?.runs)) {
        setRuns((current) => mergeRuns(current, body.runs));
        setHasMore(Boolean(body.hasMore));
      }
    } catch {
      // keep showing what we have; transient errors self-heal on the next tick
    }
  }, []);

  // Poll only while a run is still RUNNING, and only when the tab is visible.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!runs.some((run) => run.status === "RUNNING")) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [runs, refresh]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const cursor = runs[runs.length - 1]?.startedAt;
    if (!cursor) {
      setHasMore(false);
      return;
    }
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/cloud-fetch/runs?before=${encodeURIComponent(cursor)}`,
        { headers: { accept: "application/json" } },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not load older runs.");
        return;
      }
      if (Array.isArray(body?.runs)) {
        setRuns((current) => mergeRuns(current, body.runs));
        setHasMore(Boolean(body.hasMore));
      }
    } catch {
      setError("Could not load older runs.");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, runs]);

  if (runs.length === 0) {
    return (
      <p className="cron-field-hint">
        No cloud fetch runs yet. Copy a prompt above and run it on your local agent.
      </p>
    );
  }

  return (
    <div className="cloud-fetch-log">
      <ul className="cloud-fetch-log-list">
        {runs.map((run) => {
          const isOpen = expanded === run.id;
          return (
            <li key={run.id} className="cloud-fetch-log-row">
              <button
                type="button"
                className="cloud-fetch-log-head"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : run.id)}
              >
                <span aria-hidden="true">
                  {isOpen ? <ChevronDown /> : <ChevronRight />}
                </span>
                <span className={`cloud-status-chip ${statusClass(run.status)}`}>
                  {run.status}
                </span>
                <span className="cloud-fetch-log-time">{formatTime(run.startedAt)}</span>
                <span className="cloud-fetch-log-counts">
                  {run.tasksClaimed} claimed · {run.tasksSucceeded} ok · {run.tasksFailed} failed
                </span>
                <span className="cloud-fetch-log-meta">
                  {formatDuration(run.durationMs)}
                  {run.usageTokens != null ? ` · ${run.usageTokens} tok` : ""}
                  {run.usageCostUsd != null ? ` · $${run.usageCostUsd.toFixed(2)}` : ""}
                </span>
              </button>
              {isOpen ? (
                <div className="cloud-fetch-log-detail">
                  {run.summary ? <p className="cron-field-hint">{run.summary}</p> : null}
                  {run.tasks.length === 0 ? (
                    <p className="cron-field-hint">No per-source tasks recorded.</p>
                  ) : (
                    <ul className="cloud-fetch-log-tasks">
                      {run.tasks.map((task) => (
                        <li key={task.id} className="cloud-fetch-log-task">
                          <span className={`cloud-status-chip ${statusClass(task.status)}`}>
                            {task.status}
                          </span>
                          <span className="cloud-fetch-log-task-name">
                            {task.sourceName ?? task.builderId}
                            {task.sourceType ? ` · ${task.sourceType}` : ""} · {task.summaryLanguage}
                          </span>
                          <span className="cloud-fetch-log-task-counts">
                            {task.syncedPosts}/{task.plannedPosts} synced
                            {task.failedPosts > 0 ? ` · ${task.failedPosts} failed` : ""}
                            {task.failureReason ? ` · ${task.failureReason}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? <p className="cron-field-error">{error}</p> : null}
      {hasMore ? (
        <button
          type="button"
          className="fb-btn light compact"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "Loading" : "Load older runs"}
        </button>
      ) : null}
    </div>
  );
}
