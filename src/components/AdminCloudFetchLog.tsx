"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskRow, type FetchTaskLog, type FetchTaskProgress } from "@/components/FetchLogPanel";
import type {
  CloudFetchPostOutcome,
  CloudFetchRunLogItem,
  CloudFetchRunLogTask,
} from "@/lib/cloud-fetch-run-log";

type LiveProgress = {
  stage: string | null;
  updatedAt: string | null;
  runtime: string | null;
  sourcesTotal: number | null;
  sourcesChecked: number | null;
  tasksPlanned: number | null;
  tasksDone: number | null;
  synced: number | null;
  failed: number | null;
  skipped: number | null;
  currentSource: string | null;
};

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
  if (status === "SUCCEEDED" || status === "synced") return "is-ok";
  if (status === "PARTIAL" || status === "RUNNING" || status === "skipped") return "is-partial";
  return "is-failed";
}

// Reuse the personal fetch log's per-post staged renderer (TaskRow) so each
// cloud source's posts show the same read → summarize → sync lifecycle and
// per-stage debug facts. The sync CLI records each cloud source's per-post
// outcomes in the same shape, so we map CloudFetchPostOutcome back into the
// FetchTaskLog TaskRow expects. Finished rounds have no live overlay.
const EMPTY_LIVE_TASKS = new Map<string, FetchTaskProgress>();

function postToFetchTaskLog(
  post: CloudFetchPostOutcome,
  task: CloudFetchRunLogTask,
  index: number,
): FetchTaskLog {
  return {
    id: `${task.id}:${index}`,
    builder: task.sourceName,
    builderId: task.builderId,
    sourceType: task.sourceType,
    title: post.title,
    url: post.url,
    status: post.status,
    failureReason: post.failureReason,
    fetchTool: post.fetchTool,
    agentModel: post.model,
    bodyChars: post.bodyChars,
    summaryChars: post.summaryChars,
  };
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
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [live, setLive] = useState<LiveProgress | null>(null);
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
      setLive(body?.liveProgress ?? null);
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

  // Attach the live-progress line to the newest RUNNING round only.
  const liveRunId = live ? (runs.find((run) => run.status === "RUNNING")?.id ?? null) : null;

  return (
    <div className="cloud-fetch-log">
      <ul className="cloud-fetch-log-list">
        {runs.map((run) => {
          const isOpen = expanded === run.id;
          const showLive = live && run.id === liveRunId;
          return (
            <li key={run.id} className="cloud-fetch-log-row">
              <button
                type="button"
                className="cloud-fetch-log-head"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : run.id)}
              >
                <span aria-hidden="true">{isOpen ? <ChevronDown /> : <ChevronRight />}</span>
                <span className={`cloud-status-chip ${statusClass(run.status)}`}>{run.status}</span>
                <span className="cloud-fetch-log-time">{formatTime(run.startedAt)}</span>
                <span className="cloud-fetch-log-counts">
                  {run.tasksClaimed} {run.tasksClaimed === 1 ? "source" : "sources"} · {run.tasksSucceeded} ok ·{" "}
                  {run.tasksFailed} failed
                </span>
                <span className="cloud-fetch-log-meta">
                  {run.syncedPosts}/{run.plannedPosts} posts
                  {run.failedPosts > 0 ? ` · ${run.failedPosts} failed` : ""}
                  {" · "}
                  {formatDuration(run.durationMs)}
                  {run.usageTokens != null ? ` · ${run.usageTokens.toLocaleString()} tok` : ""}
                  {run.usageCostUsd != null ? ` · $${run.usageCostUsd.toFixed(2)}` : ""}
                </span>
              </button>

              {showLive ? (
                <div className="cloud-fetch-log-live" role="status">
                  <span className="cloud-fetch-log-live-dot" aria-hidden="true" />
                  {live!.stage ? (
                    <span className="cloud-fetch-log-live-stage">{live!.stage.replace(/_/g, " ")}</span>
                  ) : (
                    <span className="cloud-fetch-log-live-stage">running</span>
                  )}
                  {live!.sourcesTotal != null ? (
                    <span>
                      {live!.sourcesChecked ?? 0}/{live!.sourcesTotal} sources
                    </span>
                  ) : null}
                  {live!.tasksPlanned != null ? (
                    <span>
                      {live!.tasksDone ?? 0}/{live!.tasksPlanned} posts
                    </span>
                  ) : null}
                  {live!.synced != null ? <span>{live!.synced} synced</span> : null}
                  {live!.failed ? <span>{live!.failed} failed</span> : null}
                  {live!.currentSource ? (
                    <span className="cloud-fetch-log-live-current">· {live!.currentSource}</span>
                  ) : null}
                </div>
              ) : null}

              {isOpen ? (
                <div className="cloud-fetch-log-detail">
                  {run.summary ? <p className="cron-field-hint">{run.summary}</p> : null}
                  {run.tasks.length === 0 ? (
                    <p className="cron-field-hint">
                      No per-source outcomes yet — they appear as the runner syncs each source.
                    </p>
                  ) : (
                    <ul className="cloud-fetch-log-tasks">
                      {run.tasks.map((task) => {
                        const taskOpen = expandedTask === task.id;
                        const hasPosts = task.posts.length > 0;
                        const mappedPosts = task.posts.map((post, index) =>
                          postToFetchTaskLog(post, task, index),
                        );
                        return (
                          <li key={task.id} className="cloud-fetch-log-task">
                            <button
                              type="button"
                              className="cloud-fetch-log-task-head"
                              aria-expanded={taskOpen}
                              disabled={!hasPosts}
                              onClick={() => hasPosts && setExpandedTask(taskOpen ? null : task.id)}
                            >
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
                                {task.durationMs != null ? ` · ${formatDuration(task.durationMs)}` : ""}
                                {task.usageTokens != null ? ` · ${task.usageTokens.toLocaleString()} tok` : ""}
                                {task.usageCostUsd != null ? ` · $${task.usageCostUsd.toFixed(2)}` : ""}
                              </span>
                            </button>
                            {task.failureReason ? (
                              <p className="cloud-fetch-log-task-error">{task.failureReason}</p>
                            ) : null}
                            {taskOpen && hasPosts ? (
                              <ul className="sync-panel-run-card-candidate-list">
                                {mappedPosts.map((mapped, index) => (
                                  <TaskRow
                                    key={mapped.id ?? index}
                                    groupTasks={mappedPosts}
                                    liveTask={null}
                                    liveTasks={EMPTY_LIVE_TASKS}
                                    task={mapped}
                                  />
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })}
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
        <button type="button" className="fb-btn light compact" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading" : "Load older runs"}
        </button>
      ) : null}
    </div>
  );
}
