import type { CloudWorkerHostTask } from "@/lib/cloud-fetch-run-log";

const FETCH_POST_ID = /^fetch_post:[^:]+:([^:]+):(.+)$/;
const TERMINAL_TASK_STATUSES = new Set([
  "synced",
  "skipped",
  "failed",
  "action_needed",
]);

export type CloudWorkerLaneStatus =
  | "running"
  | "action_needed"
  | "partial"
  | "failed"
  | "synced"
  | "skipped";

export type CloudWorkerLaneSummary = {
  synced: number;
  skipped: number;
  failed: number;
  actionNeeded: number;
  pending: number;
  status: CloudWorkerLaneStatus;
  label: "RUNNING" | "ACTION NEEDED" | "PARTIAL" | "FAILED" | "SYNCED" | "SKIPPED";
};

export function normalizeCloudWorkerTaskStatus(
  status: string | null | undefined,
): string | null {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return null;
  return normalized === "blocked" ? "action_needed" : normalized;
}

export function isCloudWorkerTerminalStatus(
  status: string | null | undefined,
): boolean {
  const normalized = normalizeCloudWorkerTaskStatus(status);
  return normalized != null && TERMINAL_TASK_STATUSES.has(normalized);
}

export function resolveCloudWorkerTaskStatus(
  persistedStatus: string | null | undefined,
  liveStatus: string | null | undefined,
): string | null {
  const persisted = normalizeCloudWorkerTaskStatus(persistedStatus);
  if (isCloudWorkerTerminalStatus(persisted)) return persisted;
  return normalizeCloudWorkerTaskStatus(liveStatus) ?? persisted;
}

export function summarizeCloudWorkerLaneStatuses(
  tasks: Array<{
    persistedStatus?: string | null;
    liveStatus?: string | null;
  }>,
): CloudWorkerLaneSummary {
  const statuses = tasks.map((task) =>
    resolveCloudWorkerTaskStatus(task.persistedStatus, task.liveStatus),
  );
  const synced = statuses.filter((status) => status === "synced").length;
  const skipped = statuses.filter((status) => status === "skipped").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const actionNeeded = statuses.filter((status) => status === "action_needed").length;
  const pending = statuses.length - synced - skipped - failed - actionNeeded;

  if (pending > 0 || statuses.length === 0) {
    return { synced, skipped, failed, actionNeeded, pending, status: "running", label: "RUNNING" };
  }
  if (actionNeeded > 0) {
    return {
      synced,
      skipped,
      failed,
      actionNeeded,
      pending,
      status: "action_needed",
      label: "ACTION NEEDED",
    };
  }
  if (failed > 0) {
    const allFailed = failed === statuses.length;
    return {
      synced,
      skipped,
      failed,
      actionNeeded,
      pending,
      status: allFailed ? "failed" : "partial",
      label: allFailed ? "FAILED" : "PARTIAL",
    };
  }
  if (synced > 0) {
    return { synced, skipped, failed, actionNeeded, pending, status: "synced", label: "SYNCED" };
  }
  return { synced, skipped, failed, actionNeeded, pending, status: "skipped", label: "SKIPPED" };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function shortenMiddle(value: string, threshold: number): string {
  if (value.length <= threshold) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatUrlLabel(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.replace(/^www\./i, "");
    const pathname = safeDecode(url.pathname).replace(/\/+$/, "");
    if (!hostname) return null;
    return shortenMiddle(`${hostname}${pathname === "/" ? "" : pathname}`, 64);
  } catch {
    return null;
  }
}

function formatContentType(value: string): string {
  return value
    .toLowerCase()
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatCompoundTaskId(value: string): string | null {
  const match = value.match(FETCH_POST_ID);
  if (!match) return null;
  const contentType = match[1].toUpperCase();
  const externalId = safeDecode(match[2]).trim();
  if (!externalId) return null;

  if (contentType === "BLOG_POST") {
    return shortenMiddle(
      externalId.replace(/^github-trending:/i, ""),
      64,
    );
  }
  if (contentType === "TWEET") {
    return `Tweet ${shortenMiddle(externalId, 18)}`;
  }
  if (contentType === "PODCAST_EPISODE") {
    return `Episode ${shortenMiddle(externalId, 18)}`;
  }
  return `Post (${formatContentType(contentType)}) ${shortenMiddle(externalId, 18)}`;
}

export function resolveWorkerAssignment(
  ...workerIds: Array<string | null | undefined>
): string | null {
  for (const workerId of workerIds) {
    const normalized = workerId?.trim();
    if (normalized) return normalized;
  }
  return null;
}

export function hasWorkerAssignment(
  workerId: string | null | undefined,
): boolean {
  return resolveWorkerAssignment(workerId) !== null;
}

export function selectUnassignedWorkerTasks(
  tasks: CloudWorkerHostTask[],
): CloudWorkerHostTask[] {
  return tasks.filter((task) => !hasWorkerAssignment(task.workerId));
}

export function formatCloudWorkerTaskLabel(
  task: CloudWorkerHostTask,
): string {
  const title = task.title?.trim();
  if (title) return title;
  return (
    formatUrlLabel(task.url) ??
    formatCompoundTaskId(task.id) ??
    "Untitled post task"
  );
}
