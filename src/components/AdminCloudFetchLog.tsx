"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskRow, deadlineRiskLabel, formatCompactDurationSeconds, type FetchTaskLog, type FetchTaskProgress } from "@/components/FetchLogPanel";
import { RelativeTime } from "@/components/RelativeTime";
import {
  contentSyncStateChanged,
  liveDataSignature,
  LIVE_POLL_IDLE_MS,
  LIVE_POLL_RUNNING_MS,
  requestWorkspaceRefresh,
} from "@/lib/content-sync-events";
import { displayLanguagePreference } from "@/lib/language-preference";
import { formatUsageCost, formatUsageTokens, readUsageSummary, type UsageSummary } from "@/lib/usage-summary";
import type {
  CloudFetchPostOutcome,
  CloudFetchRunLogItem,
  CloudFetchRunLogTask,
  CloudWorkerHostStatus,
  CloudWorkerHostTask,
} from "@/lib/cloud-fetch-run-log";
import {
  formatCloudWorkerTaskLabel,
  formatPreAssignmentFailureMessage,
  isCloudWorkerTerminalStatus,
  normalizeCloudWorkerTaskStatus,
  resolveCloudWorkerTaskStatus,
  resolveWorkerAssignment,
  selectFailedBeforeAssignmentWorkerTasks,
  selectUnassignedWorkerTasks,
  summarizeCloudWorkerLaneStatuses,
  type CloudWorkerLaneStatus,
} from "@/lib/cloud-worker-task-display";
import { fetchFailureInfo } from "@/lib/fetch-failure-taxonomy";
import type {
  CloudPendingSource,
  CloudPendingSourceReason,
  CloudPendingSourceSnapshot,
} from "@/lib/cloud-fetch-pending-sources";

type CloudFetchRunsResponse = {
  leaseBatches?: CloudFetchRunLogItem[];
  runs?: CloudFetchRunLogItem[];
  hasMore?: boolean;
  workerHost?: CloudWorkerHostStatus | null;
  pendingSources?: CloudPendingSourceSnapshot | null;
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

type InlinePart = ReactNode | null | undefined | false;

function InlineParts({ parts }: { parts: InlinePart[] }) {
  const visible = parts.filter(
    (part): part is ReactNode => part !== null && part !== undefined && part !== false && part !== "",
  );
  return (
    <>
      {visible.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? " · " : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds - minutes * 60}s`;
}

function formatStage(value: string | null, fallback = "idle"): string {
  if (!value) return fallback;
  const labels: Record<string, string> = {
    checkpoint_syncing: "Syncing checkpoints",
    expand_discovery: "Expanding discovery",
    failed: "Failed",
    fetch_sources: "Fetching sources",
    interrupted: "Interrupted",
    no_update: "No update",
    reconciled: "Reconciled",
    requesting_cloud_sources: "Requesting cloud sources",
    run_fetch_workers: "Running workers",
    shard_fetch_tasks: "Assigning workers",
    stopped: "Stopped",
    syncing: "Syncing posts",
    tasks_planned: "Tasks planned",
    waiting_after_sync_issue: "Waiting after sync issue",
    waiting_for_cloud_sources: "Waiting for cloud sources",
    waiting_for_heartbeat: "Waiting for heartbeat",
    waiting_for_runtime: "Waiting for runtime",
    worker_host_starting: "Starting host",
    workers_running: "Running workers",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function formatMetric(value: number | null): string {
  return value == null ? "-" : value.toLocaleString();
}

function formatPercent(value: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatSeconds(value: number | null): string {
  return formatCompactDurationSeconds(value) ?? "-";
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

function formatPostOutcomeSummary({
  synced,
  planned,
  failed,
  skipped,
  pending,
  actionNeeded = 0,
  status,
}: {
  synced: number;
  planned: number;
  failed: number;
  skipped: number;
  pending: number;
  actionNeeded?: number;
  status?: string | null;
}): string {
  const normalizedStatus = String(status ?? "").toLowerCase();
  const running = normalizedStatus === "running";
  const failedBeforePostPlanning =
    planned === 0 && (normalizedStatus === "failed" || normalizedStatus === "partial");
  const parts =
    planned > 0
      ? [`${synced.toLocaleString()}/${planned.toLocaleString()} synced`]
      : [running ? "Running without post tasks" : failedBeforePostPlanning ? "Failed before post planning" : "No posts planned"];
  if (pending > 0) parts.push(`${pending.toLocaleString()} pending`);
  if (actionNeeded > 0) parts.push(`${actionNeeded.toLocaleString()} action needed`);
  if (skipped > 0) parts.push(`${skipped.toLocaleString()} skipped`);
  if (failed > 0) parts.push(`${failed.toLocaleString()} failed`);
  return parts.join(" · ");
}

function formatUsage(tokens: number | null, costUsd: number | null): string | null {
  const parts: string[] = [];
  if (tokens != null) parts.push(`${tokens.toLocaleString()} tok`);
  if (costUsd != null) parts.push(`$${costUsd.toFixed(2)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function mergeUsageSummary(left: UsageSummary | null, right: UsageSummary | null): UsageSummary | null {
  if (!left) return right;
  if (!right) return left;
  const sum = (key: "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens" | "totalTokens" | "costUsd") => {
    const leftValue = left[key];
    const rightValue = right[key];
    return leftValue === null && rightValue === null ? null : (leftValue ?? 0) + (rightValue ?? 0);
  };
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    costUsd: sum("costUsd"),
    costEstimated: Boolean(left.costEstimated || right.costEstimated),
    currency: left.currency ?? right.currency,
    provider: left.provider === right.provider ? left.provider : left.provider ?? right.provider,
    model: left.model === right.model ? left.model : left.model ?? right.model,
    source: left.source ?? right.source,
  };
}

function formatInlineUsage(usage: UsageSummary | null): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.totalTokens !== null) parts.push(`${formatUsageTokens(usage.totalTokens)} tokens`);
  if (usage.costUsd !== null) parts.push(formatUsageCost(usage));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function pendingSourceReasonLabel(reason: CloudPendingSourceReason): string {
  switch (reason) {
    case "queued":
      return "Queued for lease";
    case "ready_for_lease":
      return "Ready for lease";
    case "circuit_breaker":
      return "Circuit breaker delay";
    case "retry_backoff":
      return "Retry delay";
    case "canonical_active":
      return "Canonical source active";
    case "canonical_cooldown":
      return "Canonical cooldown";
    case "token_budget":
      return "Token budget gate";
    case "scheduler_capacity":
      return "Scheduler capacity";
  }
}

function pendingSourceReasonMessage(reason: CloudPendingSourceReason): string {
  switch (reason) {
    case "queued":
      return "Queued and waiting for a worker lease.";
    case "ready_for_lease":
      return "Due and within budget; waiting for the worker's next lease request.";
    case "circuit_breaker":
      return "Waiting for the circuit breaker delay to expire.";
    case "retry_backoff":
      return "Waiting for the retry delay to expire.";
    case "canonical_active":
      return "Another active lease already owns this canonical source.";
    case "canonical_cooldown":
      return "Recent canonical activity is still cooling down.";
    case "token_budget":
      return "Needs more estimated tokens than remain in the rolling hourly window.";
    case "scheduler_capacity":
      return "Due now and within budget, waiting for the scheduler's next selection pass.";
  }
}

function pendingSourceTimingParts(source: CloudPendingSource): InlinePart[] {
  const parts: InlinePart[] = [
    <>
      Last deferred <RelativeTime value={source.lastDeferredAt} fallback="Never" />
    </>,
  ];
  if (source.nextAttemptAt) {
    parts.push(
      <>
        Next attempt <RelativeTime value={source.nextAttemptAt} />
      </>,
    );
  }
  if (source.circuitBreakerUntil) {
    parts.push(
      <>
        Circuit until <RelativeTime value={source.circuitBreakerUntil} />
      </>,
    );
  }
  return parts;
}

function runtimeLabel(workerHost: CloudWorkerHostStatus): string | null {
  if (workerHost.runtime && workerHost.model) return `${workerHost.runtime} · ${workerHost.model}`;
  return workerHost.runtime ?? workerHost.model;
}

function sourceTaskFailure(task: CloudFetchRunLogTask) {
  if (
    task.plannedPosts !== 0 ||
    (task.status !== "FAILED" && task.status !== "PARTIAL") ||
    !task.failureReason
  ) {
    return null;
  }
  return fetchFailureInfo(task.failureReason);
}

function runtimeBlockedSummary(workerHost: CloudWorkerHostStatus): string | null {
  if (workerHost.runtimeHealthState !== "blocked") return null;
  if (workerHost.runtimeReason) {
    const failure = fetchFailureInfo(workerHost.runtimeReason);
    if (failure.known) return failure.operatorMessage;
  }
  return "Runtime unavailable; waiting before asking cloud for sources again.";
}

export function runtimeBlockedSummaryForTest(workerHost: CloudWorkerHostStatus): string | null {
  return runtimeBlockedSummary(workerHost);
}

function skippedReasonSummary(
  tasks: CloudWorkerHostTask[],
  events: CloudWorkerHostStatus["recentEvents"],
  skippedTotal: number | null,
): string | null {
  const total = skippedTotal ?? 0;
  if (total <= 0) return null;
  const reasons = new Map<string, number>();
  const seenTaskIds = new Set<string>();
  for (const task of tasks) {
    if (task.status !== "skipped") continue;
    if (task.id) seenTaskIds.add(task.id);
    const reason = skippedReasonLabel(task.reason ?? task.message);
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  for (const event of events) {
    if (event.status !== "skipped") continue;
    if (event.taskId && seenTaskIds.has(event.taskId)) continue;
    const reason = skippedReasonLabel(event.reason ?? event.message);
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const entries = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2);
  const counted = entries.reduce((sum, [, count]) => sum + count, 0);
  if (counted < total) entries.push(["other", total - counted]);
  return entries.length > 0
    ? entries.map(([reason, count]) => `${reason} ${count.toLocaleString()}`).join(" · ")
    : "reason unavailable";
}

function skippedReasonLabel(value: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "reason unavailable";
  if (/^skipped\.?$/i.test(raw)) return "reason unavailable";
  const afterColon = raw.match(/^skipped:\s*(.+)$/i)?.[1] ?? raw;
  return afterColon
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function formatDeliveryCounts(batch: CloudFetchRunLogItem): string {
  const parts = [pluralize(batch.tasksClaimed, "source", "sources") + " delivered"];
  if (batch.tasksRunning > 0) parts.push(`${batch.tasksRunning.toLocaleString()} running`);
  if (batch.tasksSucceeded > 0) parts.push(`${batch.tasksSucceeded.toLocaleString()} finished`);
  if (batch.tasksPartial > 0) parts.push(`${batch.tasksPartial.toLocaleString()} partial`);
  if (batch.tasksFailed > 0) parts.push(`${batch.tasksFailed.toLocaleString()} failed`);
  return parts.join(" · ");
}

function formatWorkerTaskStats(task: CloudWorkerHostTask): string | null {
  const parts: string[] = [];
  if (task.bodyWords != null) parts.push(`body ${task.bodyWords.toLocaleString()} words`);
  else if (task.bodyChars != null) parts.push(`body ${task.bodyChars.toLocaleString()} chars`);
  if (task.summaryWords != null) parts.push(`summary ${task.summaryWords.toLocaleString()} words`);
  else if (task.summaryChars != null) parts.push(`summary ${task.summaryChars.toLocaleString()} chars`);
  if (task.headlineWords != null) parts.push(`headline ${task.headlineWords.toLocaleString()} words`);
  else if (task.headlineChars != null) parts.push(`headline ${task.headlineChars.toLocaleString()} chars`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function taskIdValue(task: FetchTaskLog): string {
  return String(task.id ?? task.url ?? task.title ?? "task");
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

function emptySourceTaskMessage(task: CloudFetchRunLogTask): string {
  const failure = sourceTaskFailure(task);
  const status = String(task.status ?? "").toLowerCase();
  if (
    task.plannedPosts === 0 &&
    !task.noGeneratedFetchTasks &&
    !task.finishedAt &&
    status !== "succeeded" &&
    status !== "failed" &&
    status !== "partial"
  ) {
    return "This source is still running. Post task outcomes appear after its worker shard sends the first synced result.";
  }
  if (failure) return failure.operatorMessage;
  if (task.plannedPosts === 0) return "No post tasks were generated for this source.";
  if (task.finishedAt || status === "succeeded" || status === "failed" || status === "partial") {
    return "No per-post outcomes were recorded for this source.";
  }
  return "This source is still running. Post task outcomes appear after its worker shard sends the first synced result.";
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
    id: post.id ?? `${task.id}:${index}`,
    builder: task.sourceName,
    builderId: task.builderId,
    sourceType: task.sourceType,
    contentStatus: post.contentStatus,
    agentWorkType: post.agentWorkType,
    title: post.title,
    url: post.url,
    status: normalizeCloudWorkerTaskStatus(post.status),
    failureReason: post.failureReason,
    fetchTool: post.fetchTool,
    agentRuntime: post.agentRuntime,
    agentModel: post.model,
    bodyChars: post.bodyChars,
    bodyWords: post.bodyWords,
    headlineChars: post.headlineChars,
    headlineWords: post.headlineWords,
    summaryChars: post.summaryChars,
    summaryWords: post.summaryWords,
    readMethod: post.readMethod,
    summaryMethod: post.summaryMethod,
    hubSharedReuse: post.hubSharedReuse,
    workerId: post.workerId,
    estimatedWorkSeconds: post.estimatedWorkSeconds,
    executionBudgetSeconds: post.executionBudgetSeconds,
    workloadClass: post.workloadClass,
    budgetReason: post.budgetReason,
    deadlineState: post.deadlineState,
    mediaDurationSeconds: post.mediaDurationSeconds,
    plannedExtractionMethod: post.plannedExtractionMethod,
    mustSucceedBy: post.mustSucceedBy,
    estimateEvidence: post.estimateEvidence,
    evidence: post.evidence,
    completedStage: post.completedStage,
  };
}

function workerTaskToFetchTaskLog(task: CloudWorkerHostTask): FetchTaskLog {
  return {
    id: task.id,
    builder: task.builder,
    builderId: task.builderId,
    sourceType: task.sourceType,
    title: task.title,
    url: task.url,
    status: task.status,
    failureReason: task.reason,
    bodyChars: task.bodyChars,
    bodyWords: task.bodyWords,
    headlineChars: task.headlineChars,
    headlineWords: task.headlineWords,
    summaryChars: task.summaryChars,
    summaryWords: task.summaryWords,
    workerId: task.workerId,
  };
}

function workerTaskToProgress(task: CloudWorkerHostTask): FetchTaskProgress {
  return {
    id: task.id,
    taskId: task.id,
    status: task.status,
    phase: task.phase,
    message: task.message,
    builder: task.builder,
    builderId: task.builderId,
    sourceType: task.sourceType,
    title: task.title,
    url: task.url,
    workerId: task.workerId,
    bodyChars: task.bodyChars,
    bodyWords: task.bodyWords,
    headlineChars: task.headlineChars,
    headlineWords: task.headlineWords,
    summaryChars: task.summaryChars,
    summaryWords: task.summaryWords,
    updatedAt: task.updatedAt,
  };
}

type WorkerShardTask = {
  task: FetchTaskLog;
  liveTask: FetchTaskProgress | null;
};

type WorkerShardGroup = {
  workerId: string;
  tasks: WorkerShardTask[];
  synced: number;
  failed: number;
  skipped: number;
  actionNeeded: number;
  pending: number;
  status: CloudWorkerLaneStatus;
  label: "RUNNING" | "ACTION NEEDED" | "PARTIAL" | "FAILED" | "SYNCED" | "SKIPPED";
  updatedAt: string | null;
  usage: UsageSummary | null;
};

function allDeliveryPostTasks(leaseBatches: CloudFetchRunLogItem[]): FetchTaskLog[] {
  return [...leaseBatches]
    .sort((a, b) =>
      Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id),
    )
    .flatMap((batch) =>
    batch.tasks.flatMap((task) =>
      task.posts.map((post, index) => postToFetchTaskLog(post, task, index)),
    ),
  );
}

function cloudWorkerUsageMap(leaseBatches: CloudFetchRunLogItem[]): Map<string, UsageSummary> {
  const byWorkerId = new Map<string, UsageSummary>();
  const seen = new Set<string>();
  for (const batch of leaseBatches) {
    for (const task of batch.tasks) {
      for (const value of task.workerUsages) {
        const key = workerUsageIdentity(value);
        if (seen.has(key)) continue;
        seen.add(key);
        const usage = readUsageSummary(value.usage, value);
        if (!usage) continue;
        byWorkerId.set(value.workerId, mergeUsageSummary(byWorkerId.get(value.workerId) ?? null, usage) ?? usage);
      }
    }
  }
  return byWorkerId;
}

function workerUsageIdentity(value: { workerId: string; usage: Record<string, unknown>; taskIds?: string[] }) {
  const taskIds = Array.isArray(value.taskIds) ? [...value.taskIds].sort().join("\u0000") : "";
  return `${value.workerId}\u0000${taskIds}\u0000${JSON.stringify(value.usage)}`;
}

function totalUsage(usageMap: Map<string, UsageSummary>): UsageSummary | null {
  let total: UsageSummary | null = null;
  for (const usage of usageMap.values()) total = mergeUsageSummary(total, usage);
  return total;
}

function buildWorkerShardGroups(
  leaseBatches: CloudFetchRunLogItem[],
  workerTasks: CloudWorkerHostTask[],
): WorkerShardGroup[] {
  const usages = cloudWorkerUsageMap(leaseBatches);
  const byTaskId = new Map<string, WorkerShardTask>();
  for (const task of allDeliveryPostTasks(leaseBatches)) {
    const id = taskIdValue(task);
    if (!byTaskId.has(id)) {
      byTaskId.set(id, {
        task: {
          ...task,
          status: normalizeCloudWorkerTaskStatus(task.status),
        },
        liveTask: null,
      });
    }
  }
  for (const live of workerTasks) {
    const id = taskIdValue({ id: live.id });
    const existing = byTaskId.get(id);
    const persistedStatus = existing?.task.status ?? null;
    const effectiveStatus = resolveCloudWorkerTaskStatus(persistedStatus, live.status);
    const suppressStaleLive =
      existing != null &&
      isCloudWorkerTerminalStatus(persistedStatus) &&
      normalizeCloudWorkerTaskStatus(live.status) !==
        normalizeCloudWorkerTaskStatus(persistedStatus);
    byTaskId.set(id, {
      task: {
        ...(existing?.task ?? workerTaskToFetchTaskLog(live)),
        status: effectiveStatus,
        workerId: existing?.task.workerId ?? live.workerId,
      },
      liveTask: suppressStaleLive ? null : workerTaskToProgress(live),
    });
  }

  const groups = new Map<string, WorkerShardTask[]>();
  for (const entry of byTaskId.values()) {
    const workerId = resolveWorkerAssignment(
      entry.task.workerId,
      entry.liveTask?.workerId,
    );
    if (!workerId) continue;
    const list = groups.get(workerId) ?? [];
    list.push(entry);
    groups.set(workerId, list);
  }

  return [...groups.entries()]
    .map(([workerId, tasks]) => {
      const summary = summarizeCloudWorkerLaneStatuses(
        tasks.map((entry) => ({
          persistedStatus: entry.task.status,
          liveStatus: entry.liveTask?.status,
        })),
      );
      const updatedAt = tasks
        .map((entry) => entry.liveTask?.updatedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
      return {
        workerId,
        tasks,
        ...summary,
        updatedAt,
        usage: usages.get(workerId) ?? null,
      };
    })
    .sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bTime - aTime || a.workerId.localeCompare(b.workerId);
    });
}

export function buildWorkerShardGroupsForTest(
  leaseBatches: CloudFetchRunLogItem[],
  workerTasks: CloudWorkerHostTask[],
): WorkerShardGroup[] {
  return buildWorkerShardGroups(leaseBatches, workerTasks);
}

function workerHostMeta(workerHost: CloudWorkerHostStatus): InlinePart[] {
  const parts = [
    workerHost.hostname,
    runtimeLabel(workerHost),
    workerHost.localWorkers != null
      ? `${workerHost.localWorkers} ${workerHost.localWorkers === 1 ? "worker" : "workers"}`
      : null,
  ].filter(Boolean) as InlinePart[];
  if (workerHost.heartbeatAt) {
    parts.push(
      <>
        heartbeat <RelativeTime value={workerHost.heartbeatAt} fallback="Never" />
      </>,
    );
  } else if (parts.length > 0) {
    parts.push("heartbeat missing");
  }
  if (workerHost.runtimeHealthState === "blocked" && workerHost.runtimeRetryAt) {
    parts.push(
      <>
        Next retry <RelativeTime value={workerHost.runtimeRetryAt} />
      </>,
    );
  }
  return parts.length > 0 ? parts : ["No host heartbeat yet"];
}

function WorkerHostPanel({
  workerHost,
  runningSourceDeliveries,
  leaseBatches,
  pendingSources,
  usage,
}: {
  workerHost: CloudWorkerHostStatus;
  runningSourceDeliveries: number;
  leaseBatches: CloudFetchRunLogItem[];
  pendingSources: CloudPendingSourceSnapshot;
  usage: UsageSummary | null;
}) {
  const progress = workerHost.progress;
  const runtimeBlocked = workerHost.runtimeHealthState === "blocked";
  const waitingTasks = useMemo(
    () => sortedWorkerTasks(selectUnassignedWorkerTasks(workerHost.tasks)),
    [workerHost.tasks],
  );
  const failedBeforeAssignmentTasks = useMemo(
    () =>
      sortedWorkerTasks(
        selectFailedBeforeAssignmentWorkerTasks(workerHost.tasks),
      ),
    [workerHost.tasks],
  );
  const events = workerHost.recentEvents.slice(-5).reverse();
  const fallbackMetrics = useMemo(() => {
    const plannedPosts = leaseBatches.reduce((sum, batch) => sum + batch.plannedPosts, 0);
    const syncedPosts = leaseBatches.reduce((sum, batch) => sum + batch.syncedPosts, 0);
    const failedPosts = leaseBatches.reduce((sum, batch) => sum + batch.failedPosts, 0);
    const skippedPosts = leaseBatches.reduce((sum, batch) => sum + batch.skippedPosts, 0);
    const sourcesTotal = leaseBatches.reduce((sum, batch) => sum + batch.tasksClaimed, 0);
    const sourcesChecked = leaseBatches.reduce(
      (sum, batch) => sum + batch.tasksSucceeded + batch.tasksPartial + batch.tasksFailed,
      0,
    );
    return {
      plannedPosts,
      donePosts: syncedPosts + failedPosts + skippedPosts,
      syncedPosts,
      failedPosts,
      skippedPosts,
      sourcesTotal,
      sourcesChecked,
    };
  }, [leaseBatches]);
  const runningWithoutHeartbeat = workerHost.startedAt == null && runningSourceDeliveries > 0;
  const statusLabel = runningWithoutHeartbeat
    ? "No host heartbeat"
    : runtimeBlocked
      ? "Runtime blocked"
      : workerHost.statusLabel;
  const stage = runtimeBlocked
    ? "waiting_for_runtime"
    : progress?.stage ?? workerHost.stage ?? (runningWithoutHeartbeat ? "waiting_for_heartbeat" : null);
  const summary = runningWithoutHeartbeat
    ? `${runningSourceDeliveries} source ${runningSourceDeliveries === 1 ? "delivery is" : "deliveries are"} still running without a worker heartbeat.`
    : runtimeBlocked
      ? runtimeBlockedSummary(workerHost)
    : workerHost.status === "offline" && workerHost.summary
      ? `Last reported: ${workerHost.summary}`
      : workerHost.summary;
  const sourceProgress =
    progress?.sourcesTotal != null
      ? `${formatMetric(progress.sourcesChecked ?? 0)}/${formatMetric(progress.sourcesTotal)}`
      : fallbackMetrics.sourcesTotal > 0
        ? `${formatMetric(fallbackMetrics.sourcesChecked)}/${formatMetric(fallbackMetrics.sourcesTotal)}`
        : "-";
  const postProgress =
    progress?.tasksPlanned != null
      ? `${formatMetric(progress.tasksDone ?? 0)}/${formatMetric(progress.tasksPlanned)}`
      : fallbackMetrics.plannedPosts > 0
        ? `${formatMetric(fallbackMetrics.donePosts)}/${formatMetric(fallbackMetrics.plannedPosts)}`
        : "-";
  const localWorkers = workerHost.localWorkers != null ? workerHost.localWorkers : null;
  const usageText = formatInlineUsage(usage);
  const skippedCount = progress?.skipped ?? (fallbackMetrics.plannedPosts > 0 ? fallbackMetrics.skippedPosts : null);
  const skippedSummary = skippedReasonSummary(
    workerHost.tasks,
    workerHost.recentEvents,
    skippedCount,
  );

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
          <p className="cloud-worker-host-meta">
            <InlineParts parts={workerHostMeta(workerHost)} />
          </p>
        </div>
        {summary ? <p className="cloud-worker-host-summary">{summary}</p> : null}
      </div>

      <div className="cloud-worker-host-metrics" aria-label="Worker host metrics">
        <div className="cloud-worker-host-metric is-stage">
          <span>Stage</span>
          <strong>{formatStage(stage)}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Local workers</span>
          <strong>{formatMetric(localWorkers)}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Completed / planned</span>
          <strong>{postProgress}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Sources checked</span>
          <strong>{sourceProgress}</strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Synced</span>
          <strong>
            {formatMetric(
              progress?.synced ?? (fallbackMetrics.plannedPosts > 0 ? fallbackMetrics.syncedPosts : null),
            )}
          </strong>
        </div>
        <div className="cloud-worker-host-metric">
          <span>Failed</span>
          <strong>
            {formatMetric(
              progress?.failed ?? (fallbackMetrics.plannedPosts > 0 ? fallbackMetrics.failedPosts : null),
            )}
          </strong>
        </div>
        <div className="cloud-worker-host-metric is-skipped">
          <span>Skipped</span>
          <strong>
            {formatMetric(skippedCount)}
          </strong>
          {skippedSummary ? <em>{skippedSummary}</em> : null}
        </div>
        <div className="cloud-worker-host-metric">
          <span>Action needed</span>
          <strong>{formatMetric(progress?.actionNeeded ?? null)}</strong>
        </div>
        <div className="cloud-worker-host-metric is-usage">
          <span>Usage</span>
          <strong>{usageText ?? "-"}</strong>
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
          <h5>Waiting for source lease</h5>
          <span>{pendingSources.sources.length} waiting</span>
        </div>
        {pendingSources.sources.length === 0 ? (
          <p className="cron-field-hint">No sources waiting for lease.</p>
        ) : (
          <ul className="cloud-worker-task-list">
            {pendingSources.sources.map((source) => (
              <li key={source.taskId} className="cloud-worker-task-row">
                <span className={`cloud-status-chip ${statusClass("queued")}`}>
                  {pendingSourceReasonLabel(source.reason)}
                </span>
                <span className="cloud-worker-task-main">
                  <span className="cloud-worker-task-title">{source.name}</span>
                  <span className="cloud-worker-task-meta">
                    <InlineParts
                      parts={[
                        source.sourceType,
                        pendingSourceReasonLabel(source.reason),
                        `Estimated ${formatUsageTokens(source.estimatedTokens)} tokens`,
                        `Remaining ${formatUsageTokens(pendingSources.budget.remainingTokens)} tokens`,
                        `Deferrals ${source.consecutiveDeferrals.toLocaleString()}`,
                        ...pendingSourceTimingParts(source),
                      ]}
                    />
                  </span>
                  <span className="cloud-worker-task-message">
                    {pendingSourceReasonMessage(source.reason)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="cloud-worker-task-section">
        <div className="cloud-worker-task-section-head">
          <h5>Waiting for assignment</h5>
          <span>{waitingTasks.length} waiting</span>
        </div>
        {waitingTasks.length === 0 ? (
          <p className="cron-field-hint">
            {runningWithoutHeartbeat
              ? "No post task heartbeat yet."
              : "No tasks waiting for assignment."}
          </p>
        ) : (
          <ul className="cloud-worker-task-list">
            {waitingTasks.map((task) => (
              <li key={task.id} className="cloud-worker-task-row">
                <span className={`cloud-status-chip ${statusClass(task.status)}`}>
                  {task.status ?? "queued"}
                </span>
                <span className="cloud-worker-task-main">
                  <span className="cloud-worker-task-title">
                    {formatCloudWorkerTaskLabel(task)}
                  </span>
                  <span className="cloud-worker-task-meta">
                    <InlineParts
                      parts={[
                        task.builder,
                        task.sourceType,
                        task.workerId,
                        task.updatedAt ? <RelativeTime value={task.updatedAt} /> : null,
                        formatWorkerTaskStats(task),
                      ]}
                    />
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

      {failedBeforeAssignmentTasks.length > 0 ? (
        <div className="cloud-worker-task-section">
          <div className="cloud-worker-task-section-head">
            <h5>Failed before assignment</h5>
            <span>{failedBeforeAssignmentTasks.length} failed</span>
          </div>
          <ul className="cloud-worker-task-list">
            {failedBeforeAssignmentTasks.map((task) => (
              <li key={task.id} className="cloud-worker-task-row">
                <span className={`cloud-status-chip ${statusClass(task.status)}`}>
                  {task.status ?? "failed"}
                </span>
                <span className="cloud-worker-task-main">
                  <span className="cloud-worker-task-title">
                    {formatCloudWorkerTaskLabel(task)}
                  </span>
                  <span className="cloud-worker-task-meta">
                    <InlineParts
                      parts={[
                        task.builder,
                        task.sourceType,
                        task.updatedAt ? <RelativeTime value={task.updatedAt} /> : null,
                        formatWorkerTaskStats(task),
                      ]}
                    />
                  </span>
                  <span className="cloud-worker-task-message">
                    {formatPreAssignmentFailureMessage(task)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="cloud-worker-events">
          <div className="cloud-worker-task-section-head">
            <h5>Recent events</h5>
          </div>
          <ul className="cloud-worker-event-list">
            {events.map((event, index) => (
              <li key={`${event.at ?? "event"}:${event.taskId ?? index}`}>
                <RelativeTime value={event.at} fallback="Unknown time" />
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
  initialPendingSources,
}: {
  initialWorkerHost: CloudWorkerHostStatus;
  initialLeaseBatches: CloudFetchRunLogItem[];
  initialHasMore: boolean;
  initialPendingSources: CloudPendingSourceSnapshot;
}) {
  const [workerHost, setWorkerHost] = useState(initialWorkerHost);
  const [leaseBatches, setLeaseBatches] = useState(initialLeaseBatches);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [pendingSources, setPendingSources] = useState(initialPendingSources);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [expandedShard, setExpandedShard] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const livePayloadSignatureRef = useRef(
    liveDataSignature({
      workerHost: initialWorkerHost,
      leaseBatches: initialLeaseBatches,
      pendingSources: initialPendingSources,
    }),
  );
  const workerHostRef = useRef(initialWorkerHost);
  const leaseBatchesRef = useRef(initialLeaseBatches);
  const pendingSourcesRef = useRef(initialPendingSources);
  const runningSourceDeliveries = leaseBatches.filter((batch) => batch.status.toUpperCase() === "RUNNING").length;
  const hasRunningWorkerTask = workerHost.tasks.some(
    (task) => task.status?.toUpperCase() === "RUNNING",
  );
  const workerShardGroups = useMemo(
    () => buildWorkerShardGroups(leaseBatches, workerHost.tasks),
    [leaseBatches, workerHost.tasks],
  );
  const workerUsageTotal = useMemo(
    () => totalUsage(cloudWorkerUsageMap(leaseBatches)),
    [leaseBatches],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/cloud-fetch/runs", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as CloudFetchRunsResponse | null;
      const batches = body?.leaseBatches ?? body?.runs;
      const nextWorkerHost = body?.workerHost ?? workerHostRef.current;
      const nextPendingSources = body?.pendingSources !== null && body?.pendingSources !== undefined
        ? body.pendingSources
        : pendingSourcesRef.current;
      if (Array.isArray(batches) || body?.workerHost || body?.pendingSources !== undefined) {
        const nextLeaseBatches = Array.isArray(batches)
          ? mergeLeaseBatches(leaseBatchesRef.current, batches)
          : leaseBatchesRef.current;
        const nextSignature = liveDataSignature({
          workerHost: nextWorkerHost,
          leaseBatches: nextLeaseBatches,
          pendingSources: body?.pendingSources !== null ? nextPendingSources : pendingSourcesRef.current,
        });
        const changed = nextSignature !== livePayloadSignatureRef.current;
        livePayloadSignatureRef.current = nextSignature;
        if (Array.isArray(batches)) {
          leaseBatchesRef.current = nextLeaseBatches;
          setLeaseBatches(nextLeaseBatches);
          setHasMore(Boolean(body?.hasMore));
        }
        if (body?.workerHost) {
          workerHostRef.current = body.workerHost;
          setWorkerHost(body.workerHost);
        }
        if (body?.pendingSources !== null && body?.pendingSources !== undefined) {
          pendingSourcesRef.current = body.pendingSources;
          setPendingSources(body.pendingSources);
        }
        if (changed) requestWorkspaceRefresh("admin-cloud-fetch-log");
      }
    } catch {
      // keep showing what we have; transient errors self-heal on the next tick
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(id);
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasRunningBatch = leaseBatches.some((batch) => batch.status.toUpperCase() === "RUNNING");
    const pollMs = hasRunningBatch || hasRunningWorkerTask
      ? LIVE_POLL_RUNNING_MS
      : LIVE_POLL_IDLE_MS;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [hasRunningWorkerTask, leaseBatches, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener(contentSyncStateChanged, refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener(contentSyncStateChanged, refreshWhenVisible);
    };
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const lastBatch = leaseBatches[leaseBatches.length - 1];
    const cursor = lastBatch?.startedAt;
    if (!cursor) {
      setHasMore(false);
      return;
    }
    setLoadingMore(true);
    setError(null);
    try {
      // Composite keyset cursor: send the tiebreak id so equal-startedAt runs
      // page through exactly once (no skip, no stall) — see the runs route.
      const cursorQuery = lastBatch?.id
        ? `before=${encodeURIComponent(cursor)}&beforeId=${encodeURIComponent(lastBatch.id)}`
        : `before=${encodeURIComponent(cursor)}`;
      const res = await fetch(
        `/api/admin/cloud-fetch/runs?${cursorQuery}`,
        { cache: "no-store", headers: { accept: "application/json" } },
      );
      const body = (await res.json().catch(() => null)) as CloudFetchRunsResponse | null;
      if (!res.ok) {
        setError(body?.error ?? "Could not load older source deliveries.");
        return;
      }
      const batches = body?.leaseBatches ?? body?.runs;
      if (Array.isArray(batches)) {
        setLeaseBatches((current) => {
          const next = mergeLeaseBatches(current, batches);
          leaseBatchesRef.current = next;
          return next;
        });
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
      <WorkerHostPanel
        workerHost={workerHost}
        runningSourceDeliveries={runningSourceDeliveries}
        leaseBatches={leaseBatches}
        pendingSources={pendingSources}
        usage={workerUsageTotal}
      />

      <div className="cloud-source-deliveries-head">
        <h4>Worker lanes</h4>
        <p>
          Each lane is one local worker slot. Assigned tasks appear here when a worker claims them.
        </p>
      </div>

      {workerShardGroups.length === 0 ? (
        <p className="cron-field-hint">No worker lane assignments yet.</p>
      ) : (
        <ul className="cloud-fetch-log-list">
          {workerShardGroups.map((group) => {
            const isOpen = expandedShard === group.workerId;
            const groupTasks = group.tasks.map((entry) => entry.task);
            const groupUsage = formatInlineUsage(group.usage);
            return (
              <li key={group.workerId} className="cloud-fetch-log-row">
                <button
                  type="button"
                  className="cloud-fetch-log-head"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedShard(isOpen ? null : group.workerId)}
                >
                  <span aria-hidden="true">{isOpen ? <ChevronDown /> : <ChevronRight />}</span>
                  <span className={`cloud-status-chip ${statusClass(group.status)}`}>
                    {group.label}
                  </span>
                  <span className="cloud-fetch-log-time">{group.workerId}</span>
                  <span className="cloud-fetch-log-counts">
                    {pluralize(group.tasks.length, "post task")}
                  </span>
                  <span className="cloud-fetch-log-meta">
                    <InlineParts
                      parts={[
                        formatPostOutcomeSummary({
                          synced: group.synced,
                          planned: group.tasks.length,
                          failed: group.failed,
                          skipped: group.skipped,
                          pending: group.pending,
                          actionNeeded: group.actionNeeded,
                          status: group.status,
                        }),
                        groupUsage,
                        group.updatedAt ? (
                          <>
                            updated <RelativeTime value={group.updatedAt} />
                          </>
                        ) : null,
                      ]}
                    />
                  </span>
                </button>
                {isOpen ? (
                  <div className="cloud-fetch-log-detail">
                    <ul className="sync-panel-run-card-candidate-list">
                      {group.tasks.map((entry, index) => (
                        <TaskRow
                          key={entry.task.id ?? index}
                          groupTasks={groupTasks}
                          liveTask={entry.liveTask}
                          liveTasks={EMPTY_LIVE_TASKS}
                          task={entry.task}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="cloud-source-deliveries-head">
        <h4>Source deliveries</h4>
        <p>
          Each row is a refill batch of sources delivered to the local worker host. Expand it to
          inspect source outcomes and post task results.
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
                  <span className="cloud-fetch-log-time">
                    <RelativeTime value={batch.startedAt} />
                  </span>
                  <span className="cloud-fetch-log-counts">
                    {formatDeliveryCounts(batch)}
                  </span>
                  <span className="cloud-fetch-log-meta">
                    {formatPostOutcomeSummary({
                      synced: batch.syncedPosts,
                      planned: batch.plannedPosts,
                      failed: batch.failedPosts,
                      skipped: batch.skippedPosts,
                      pending: batch.pendingPosts,
                      status: batch.status,
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
                        <RelativeTime value={batch.finishedAt} fallback="Still running" />
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
                          const failure = sourceTaskFailure(task);
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
                                  {task.sourceType ? ` · ${task.sourceType}` : ""} ·{" "}
                                  {displayLanguagePreference(task.summaryLanguage)}
                                </span>
                                <span className="cloud-fetch-log-task-counts">
                                  {formatPostOutcomeSummary({
                                    synced: task.syncedPosts,
                                    planned: task.plannedPosts,
                                    failed: task.failedPosts,
                                    skipped: task.skippedPosts,
                                    pending: task.pendingPosts,
                                    status: task.status,
                                  })}
                                  {task.durationMs != null ? ` · ${formatDuration(task.durationMs)}` : ""}
                                  {taskUsage ? ` · ${taskUsage}` : ""}
                                </span>
                              </button>
                              {taskOpen ? (
                                <div className="cloud-fetch-log-task-detail">
                                  <div className="cloud-fetch-log-task-facts" aria-label="Source task details">
                                    <span>
                                      <strong>Started</strong>
                                      <RelativeTime value={task.startedAt} fallback="-" />
                                    </span>
                                    <span>
                                      <strong>Finished</strong>
                                      <RelativeTime value={task.finishedAt} fallback="Still running" />
                                    </span>
                                    <span>
                                      <strong>Historical estimate</strong>
                                      {formatSeconds(task.estimatedDurationSeconds)}
                                    </span>
                                    <span>
                                      <strong>Historical P(success)</strong>
                                      {formatPercent(task.successProbability)}
                                    </span>
                                    {task.provisionalExecutionBudgetSeconds != null ? (
                                      <span>
                                        <strong>Initial budget</strong>
                                        {formatSeconds(task.provisionalExecutionBudgetSeconds)}
                                      </span>
                                    ) : null}
                                    {task.deadlineState ? (
                                      <span>
                                        <strong>Deadline risk</strong>
                                        {deadlineRiskLabel(task.deadlineState) ?? task.deadlineState}
                                      </span>
                                    ) : null}
                                    {task.mustSucceedBy ? (
                                      <span>
                                        <strong>Must succeed by</strong>
                                        <RelativeTime value={task.mustSucceedBy} fallback={task.mustSucceedBy} />
                                      </span>
                                    ) : null}
                                    {failure ? (
                                      <span>
                                        <strong>Failure</strong>
                                        {failure.userMessage}
                                      </span>
                                    ) : null}
                                    {failure ? (
                                      <span>
                                        <strong>Code</strong>
                                        {failure.code}
                                      </span>
                                    ) : null}
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
                                      {emptySourceTaskMessage(task)}
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
