"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskRow, type FetchTaskLog, type FetchTaskProgress } from "@/components/FetchLogPanel";
import type {
  CloudFetchPostOutcome,
  CloudFetchRunLogItem,
  CloudFetchRunLogTask,
  CloudWorkerHostStatus,
  CloudWorkerHostTask,
} from "@/lib/cloud-fetch-run-log";

type CloudFetchRunsResponse = {
  leaseBatches?: CloudFetchRunLogItem[];
  runs?: CloudFetchRunLogItem[];
  hasMore?: boolean;
  workerHost?: CloudWorkerHostStatus | null;
  error?: string;
};

function mergeLeaseBatches(
  current: CloudFetchRunLogItem[],
  incoming: CloudFetchRunLogItem[],
) {
  const byId = new Map(current.map((batch) => [batch.id, batch]));
  for (const batch of incoming) byId.set(batch.id, batch);
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

function formatNullableTime(iso: string | null): string {
  return iso ? formatTime(iso) : "Never";
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds - minutes * 60}s`;
}

function formatStage(value: string | null, fallback = "idle"): string {
  return value ? value.replace(/_/g, " ") : fallback;
}

function formatMetric(value: number | null): string {
  return value == null ? "-" : value.toLocaleString();
}

function formatPercent(value: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatSeconds(value: number | null): string {
  if (value == null) return "-";
  return formatDuration(value * 1000);
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

function formatPostOutcomeSummary({
  synced,
  planned,
  failed,
  pending,
}: {
  synced: number;
  planned: number;
  failed: number;
  pending: number;
}): string {
  const parts =
    planned > 0
      ? [`${synced.toLocaleString()}/${planned.toLocaleString()} synced`]
      : ["No posts planned"];
  if (pending > 0) parts.push(`${pending.toLocaleString()} pending`);
  if (failed > 0) parts.push(`${failed.toLocaleString()} failed`);
  return parts.join(" · ");
}

function formatUsage(tokens: number | null, costUsd: number | null): string | null {
  const parts: string[] = [];
  if (tokens != null) parts.push(`${tokens.toLocaleString()} tok`);
  if (costUsd != null) parts.push(`$${costUsd.toFixed(2)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatDeliveryCounts(batch: CloudFetchRunLogItem): string {
  const parts = [pluralize(batch.tasksClaimed, "source", "sources") + " delivered"];
  if (batch.tasksRunning > 0) parts.push(`${batch.tasksRunning.toLocaleString()} running`);
  if (batch.tasksSucceeded > 0) parts.push(`${batch.tasksSucceeded.toLocaleString()} finished`);
  if (batch.tasksFailed > 0) parts.push(`${batch.tasksFailed.toLocaleString()} failed`);
  return parts.join(" · ");
}

function formatWorkerTaskStats(task: CloudWorkerHostTask): string | null {
  const parts: string[] = [];
  if (task.bodyWords != null) parts.push(`body ${task.bodyWords.toLocaleString()} words`);
  else if (task.bodyChars != null) parts.push(`body ${task.bodyChars.toLocaleString()} chars`);
  if (task.summaryWords != null) parts.push(`summary ${task.summaryWords.toLocaleString()} words`);
  else if (task.summaryChars != null) parts.push(`summary ${task.summaryChars.toLocaleString()} chars`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function statusClass(status: string | null): string {
  const normalized = String(status ?? "").toLowerCase();
  if (
    !normalized ||
    normalized === "offline" ||
    normalized === "no worker host seen" ||
    normalized === "no host heartbeat"
  ) {
    return "is-muted";
  }
  if (normalized === "succeeded" || normalized === "synced" || normalized === "online" || normalized === "ok") {
    return "is-ok";
  }
  if (
    normalized === "partial" ||
    normalized === "running" ||
    normalized === "starting" ||
    normalized === "skipped" ||
    normalized === "planned" ||
    normalized === "queued" ||
    normalized === "fetched" ||
    normalized === "summarized" ||
    normalized === "stale"
  ) {
    return "is-partial";
  }
  return "is-failed";
}

function taskLabel(task: CloudWorkerHostTask): string {
  return task.title ?? task.url ?? task.id;
}

function sortedWorkerTasks(tasks: CloudWorkerHostTask[]): CloudWorkerHostTask[] {
  return [...tasks].sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime;
  });
}

// Reuse the personal fetch log's per-post staged renderer (TaskRow) so each
// cloud source's posts show the same read/summarize/sync lifecycle and per-stage
// debug facts. The sync CLI records each cloud source's per-post outcomes in the
// same shape, so we map CloudFetchPostOutcome back into the FetchTaskLog TaskRow
// expects. Finished source deliveries have no live overlay.
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

function workerHostMeta(workerHost: CloudWorkerHostStatus): string[] {
  const parts = [
    workerHost.hostname,
    workerHost.platform,
    workerHost.runtime,
    workerHost.localWorkers != null
      ? `${workerHost.localWorkers} ${workerHost.localWorkers === 1 ? "worker" : "workers"}`
      : null,
  ].filter(Boolean) as string[];
  if (workerHost.heartbeatAt) {
    parts.push(`heartbeat ${formatNullableTime(workerHost.heartbeatAt)}`);
  } else if (parts.length > 0) {
    parts.push("heartbeat missing");
  }
  return parts.length > 0 ? parts : ["No host heartbeat yet"];
}

function WorkerHostPanel({
  workerHost,
  runningSourceDeliveries,
}: {
  workerHost: CloudWorkerHostStatus;
  runningSourceDeliveries: number;
}) {
  const progress = workerHost.progress;
  const tasks = useMemo(() => sortedWorkerTasks(workerHost.tasks).slice(0, 20), [workerHost.tasks]);
  const events = workerHost.recentEvents.slice(-5).reverse();
  const runningWithoutHeartbeat = workerHost.startedAt == null && runningSourceDeliveries > 0;
  const statusLabel = runningWithoutHeartbeat ? "No host heartbeat" : workerHost.statusLabel;
  const stage = progress?.stage ?? workerHost.stage ?? (runningWithoutHeartbeat ? "waiting_for_heartbeat" : null);
  const summary = runningWithoutHeartbeat
    ? `${runningSourceDeliveries} source ${runningSourceDeliveries === 1 ? "delivery is" : "deliveries are"} still running without a worker heartbeat.`
    : workerHost.summary;
  const sourceProgress =
    progress?.sourcesTotal != null
      ? `${formatMetric(progress.sourcesChecked ?? 0)}/${formatMetric(progress.sourcesTotal)}`
      : "-";
  const postProgress =
    progress?.tasksPlanned != null
      ? `${formatMetric(progress.tasksDone ?? 0)}/${formatMetric(progress.tasksPlanned)}`
      : "-";
  const localWorkers = workerHost.localWorkers != null ? workerHost.localWorkers : null;

  return (
    <section className="cloud-worker-host" aria-label="Worker host">
      <div className="cloud-worker-host-head">
        <div className="cloud-worker-host-titleblock">
          <div className="cloud-worker-host-titleline">
            <span className={`cloud-status-chip ${statusClass(statusLabel)}`}>
              {statusLabel}
            </span>
            <h4 className="cloud-worker-host-title">Worker host</h4>
          </div>
          <p className="cloud-worker-host-meta">{workerHostMeta(workerHost).join(" · ")}</p>
        </div>
        {summary ? <p className="cloud-worker-host-summary">{summary}</p> : null}
      </div>

      <div className="cloud-worker-host-metrics" aria-label="Worker host metrics">
        <div className="cloud-worker-host-metric">
          <span>Stage</span>
          <strong>{formatStage(stage)}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Local workers</span>
          <strong>{formatMetric(localWorkers)}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Post tasks</span>
          <strong>{postProgress}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Sources checked</span>
          <strong>{sourceProgress}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Synced</span>
          <strong>{formatMetric(progress?.synced ?? null)}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Failed</span>
          <strong>{formatMetric(progress?.failed ?? null)}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Skipped</span>
          <strong>{formatMetric(progress?.skipped ?? null)}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Action needed</span>
          <strong>{formatMetric(progress?.actionNeeded ?? null)}</strong>
        </div>
      </div>

      {progress?.currentSource || progress?.currentTask ? (
        <p className="cloud-worker-host-current">
          {progress.currentSource ? <span>{progress.currentSource}</span> : null}
          {progress.currentTask ? <span>{progress.currentTask}</span> : null}
        </p>
      ) : null}

      <div className="cloud-worker-task-section">
        <div className="cloud-worker-task-section-head">
          <h5>Post task queue</h5>
          <span>{tasks.length} recent</span>
        </div>
        {tasks.length === 0 ? (
          <p className="cron-field-hint">
            {runningWithoutHeartbeat ? "No post task heartbeat yet." : "No post task activity yet."}
          </p>
        ) : (
          <ul className="cloud-worker-task-list">
            {tasks.map((task) => (
              <li key={task.id} className="cloud-worker-task-row">
                <span className={`cloud-status-chip ${statusClass(task.status)}`}>
                  {task.status ?? "queued"}
                </span>
                <span className="cloud-worker-task-main">
                  <span className="cloud-worker-task-title">{taskLabel(task)}</span>
                  <span className="cloud-worker-task-meta">
                    {[task.builder, task.sourceType, task.workerId, task.updatedAt ? formatTime(task.updatedAt) : null, formatWorkerTaskStats(task)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {task.message ? (
                    <span className="cloud-worker-task-message">{task.message}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {events.length > 0 ? (
        <div className="cloud-worker-events">
          <div className="cloud-worker-task-section-head">
            <h5>Recent events</h5>
          </div>
          <ul className="cloud-worker-event-list">
            {events.map((event, index) => (
              <li key={`${event.at ?? "event"}:${event.taskId ?? index}`}>
                <span>{event.at ? formatTime(event.at) : "Unknown time"}</span>
                <strong>{event.status ?? event.type ?? "event"}</strong>
                {event.message ? <em>{event.message}</em> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function AdminCloudFetchLog({
  initialWorkerHost,
  initialLeaseBatches,
  initialHasMore,
}: {
  initialWorkerHost: CloudWorkerHostStatus;
  initialLeaseBatches: CloudFetchRunLogItem[];
  initialHasMore: boolean;
}) {
  const [workerHost, setWorkerHost] = useState(initialWorkerHost);
  const [leaseBatches, setLeaseBatches] = useState(initialLeaseBatches);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningSourceDeliveries = leaseBatches.filter((batch) => batch.status.toUpperCase() === "RUNNING").length;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/cloud-fetch/runs", {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as CloudFetchRunsResponse | null;
      const batches = body?.leaseBatches ?? body?.runs;
      if (Array.isArray(batches)) {
        setLeaseBatches((current) => mergeLeaseBatches(current, batches));
        setHasMore(Boolean(body?.hasMore));
      }
      if (body?.workerHost) setWorkerHost(body.workerHost);
    } catch {
      // keep showing what we have; transient errors self-heal on the next tick
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasRunningBatch = leaseBatches.some((batch) => batch.status.toUpperCase() === "RUNNING");
    const pollMs = workerHost.status === "offline" && !hasRunningBatch ? 15_000 : 5_000;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [leaseBatches, refresh, workerHost.status]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const cursor = leaseBatches[leaseBatches.length - 1]?.startedAt;
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
      const body = (await res.json().catch(() => null)) as CloudFetchRunsResponse | null;
      if (!res.ok) {
        setError(body?.error ?? "Could not load older source deliveries.");
        return;
      }
      const batches = body?.leaseBatches ?? body?.runs;
      if (Array.isArray(batches)) {
        setLeaseBatches((current) => mergeLeaseBatches(current, batches));
        setHasMore(Boolean(body?.hasMore));
      }
    } catch {
      setError("Could not load older source deliveries.");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, leaseBatches]);

  return (
    <div className="cloud-fetch-log">
      <WorkerHostPanel workerHost={workerHost} runningSourceDeliveries={runningSourceDeliveries} />

      <div className="cloud-source-deliveries-head">
        <h4>Source deliveries</h4>
        <p>
          Each row is a set of sources delivered to the local worker host. Expand it to inspect
          sources and post task outcomes.
        </p>
      </div>

      {leaseBatches.length === 0 ? (
        <p className="cron-field-hint">
          No source deliveries yet. Copy a prompt above to start the worker host.
        </p>
      ) : (
        <ul className="cloud-fetch-log-list">
          {leaseBatches.map((batch) => {
            const isOpen = expanded === batch.id;
            const batchUsage = formatUsage(batch.usageTokens, batch.usageCostUsd);
            return (
              <li key={batch.id} className="cloud-fetch-log-row">
                <button
                  type="button"
                  className="cloud-fetch-log-head"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : batch.id)}
                >
                  <span aria-hidden="true">{isOpen ? <ChevronDown /> : <ChevronRight />}</span>
                  <span className={`cloud-status-chip ${statusClass(batch.status)}`}>
                    {batch.status}
                  </span>
                  <span className="cloud-fetch-log-time">{formatTime(batch.startedAt)}</span>
                  <span className="cloud-fetch-log-counts">
                    {formatDeliveryCounts(batch)}
                  </span>
                  <span className="cloud-fetch-log-meta">
                    {formatPostOutcomeSummary({
                      synced: batch.syncedPosts,
                      planned: batch.plannedPosts,
                      failed: batch.failedPosts,
                      pending: batch.pendingPosts,
                    })}
                    {" · "}
                    {formatDuration(batch.durationMs)}
                    {batchUsage ? ` · ${batchUsage}` : ""}
                  </span>
                </button>

                {isOpen ? (
                  <div className="cloud-fetch-log-detail">
                    {batch.summary ? <p className="cron-field-hint">{batch.summary}</p> : null}
                    <div className="cloud-delivery-facts" aria-label="Source delivery details">
                      <span>
                        <strong>Host id</strong>
                        {batch.leaseOwner}
                      </span>
                      <span>
                        <strong>Requested</strong>
                        {pluralize(batch.requestedLimit, "source", "sources")}
                      </span>
                      <span>
                        <strong>Finished</strong>
                        {batch.finishedAt ? formatTime(batch.finishedAt) : "Still running"}
                      </span>
                    </div>
                    {batch.tasks.length === 0 ? (
                      <p className="cron-field-hint">
                        No source outcomes yet. They appear as the worker syncs source results.
                      </p>
                    ) : (
                      <ul className="cloud-fetch-log-tasks">
                        {batch.tasks.map((task) => {
                          const taskOpen = expandedTask === task.id;
                          const hasPosts = task.posts.length > 0;
                          const taskUsage = formatUsage(task.usageTokens, task.usageCostUsd);
                          const mappedPosts = task.posts.map((post, index) =>
                            postToFetchTaskLog(post, task, index),
                          );
                          return (
                            <li key={task.id} className="cloud-fetch-log-task">
                              <button
                                type="button"
                                className="cloud-fetch-log-task-head"
                                aria-expanded={taskOpen}
                                onClick={() => setExpandedTask(taskOpen ? null : task.id)}
                              >
                                <span aria-hidden="true" className="cloud-fetch-log-task-caret">
                                  {taskOpen ? <ChevronDown /> : <ChevronRight />}
                                </span>
                                <span className={`cloud-status-chip ${statusClass(task.status)}`}>
                                  {task.status}
                                </span>
                                <span className="cloud-fetch-log-task-name">
                                  {task.sourceName ?? task.builderId}
                                  {task.sourceType ? ` · ${task.sourceType}` : ""} · {task.summaryLanguage}
                                </span>
                                <span className="cloud-fetch-log-task-counts">
                                  {formatPostOutcomeSummary({
                                    synced: task.syncedPosts,
                                    planned: task.plannedPosts,
                                    failed: task.failedPosts,
                                    pending: task.pendingPosts,
                                  })}
                                  {task.durationMs != null ? ` · ${formatDuration(task.durationMs)}` : ""}
                                  {taskUsage ? ` · ${taskUsage}` : ""}
                                </span>
                              </button>
                              {task.failureReason ? (
                                <p className="cloud-fetch-log-task-error">{task.failureReason}</p>
                              ) : null}
                              {taskOpen ? (
                                <div className="cloud-fetch-log-task-detail">
                                  <div className="cloud-fetch-log-task-facts" aria-label="Source task details">
                                    <span>
                                      <strong>Started</strong>
                                      {task.startedAt ? formatTime(task.startedAt) : "-"}
                                    </span>
                                    <span>
                                      <strong>Finished</strong>
                                      {task.finishedAt ? formatTime(task.finishedAt) : "Still running"}
                                    </span>
                                    <span>
                                      <strong>Estimated</strong>
                                      {formatSeconds(task.estimatedDurationSeconds)}
                                    </span>
                                    <span>
                                      <strong>P(success)</strong>
                                      {formatPercent(task.successProbability)}
                                    </span>
                                  </div>
                                  {hasPosts ? (
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
                                  ) : (
                                    <p className="cron-field-hint">
                                      Post task outcomes appear after the worker syncs this source.
                                    </p>
                                  )}
                                </div>
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
      )}

      {error ? <p className="cron-field-error">{error}</p> : null}
      {hasMore ? (
        <button type="button" className="fb-btn light compact" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading" : "Load older deliveries"}
        </button>
      ) : null}
    </div>
  );
}
