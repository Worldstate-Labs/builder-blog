import type { CloudWorkerHostTask } from "@/lib/cloud-fetch-run-log";

const FETCH_POST_ID = /^fetch_post:[^:]+:([^:]+):(.+)$/;

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

function contentTypeLabel(value: string): string {
  const label = value.toLowerCase().replace(/[_-]+/g, " ").trim();
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : "Post";
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
  return `${contentTypeLabel(contentType)} ${shortenMiddle(externalId, 18)}`;
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
