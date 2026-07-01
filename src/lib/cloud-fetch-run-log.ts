// Serialization for the admin cloud fetch log. Each CloudFetchRun is one
// polling round (lease + fetch); its CloudFetchRunTask rows are the per-source
// outcomes. Mirrors the information the normal (per-user) fetch log shows —
// per-run post totals, per-source durations/usage, and per-post outcomes — so an
// admin can follow progress and debug failures. Pure mapping so it stays
// unit-testable without a database.

export type CloudFetchPostOutcome = {
  title: string | null;
  url: string | null;
  status: string | null;
  failureReason: string | null;
  fetchTool: string | null;
  model: string | null;
  bodyChars: number | null;
  summaryChars: number | null;
};

export type CloudFetchRunLogTask = {
  id: string;
  builderId: string;
  sourceName: string | null;
  sourceType: string | null;
  summaryLanguage: string;
  status: string;
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  durationMs: number | null;
  estimatedDurationSeconds: number | null;
  successProbability: number | null;
  usageTokens: number | null;
  usageCostUsd: number | null;
  failureReason: string | null;
  posts: CloudFetchPostOutcome[];
};

export type CloudFetchRunLogItem = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: string;
  requestedLimit: number;
  tasksClaimed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  // Aggregate post lifecycle across the run's per-source tasks.
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  usageTokens: number | null;
  usageCostUsd: number | null;
  summary: string | null;
  tasks: CloudFetchRunLogTask[];
};

// Prisma's Decimal coerces to a number via Number(); its valueOf returns a
// string, so we only rely on toString being present.
type DecimalLike = { toString(): string } | number;

type CloudFetchRunTaskRow = {
  id: string;
  builderId: string;
  summaryLanguage: string;
  status: string;
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  actualDurationSeconds: number | null;
  estimatedDurationSeconds?: number | null;
  successProbabilitySnapshot?: number | null;
  usageTokens?: number | null;
  usageCostUsd?: DecimalLike | null;
  failureReason: string | null;
  details?: unknown;
  builder?: { name: string | null; sourceType: string | null } | null;
};

type CloudFetchRunRow = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  requestedLimit: number;
  tasksClaimed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  usageTokens: number | null;
  usageCostUsd: DecimalLike | null;
  summary: string | null;
  tasks: CloudFetchRunTaskRow[];
};

export function serializeCloudFetchRun(run: CloudFetchRunRow): CloudFetchRunLogItem {
  const tasks = run.tasks.map(serializeCloudFetchRunTask);
  return {
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    durationMs: run.finishedAt
      ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime())
      : null,
    status: run.status,
    requestedLimit: run.requestedLimit,
    tasksClaimed: run.tasksClaimed,
    tasksSucceeded: run.tasksSucceeded,
    tasksFailed: run.tasksFailed,
    plannedPosts: sumBy(tasks, (t) => t.plannedPosts),
    syncedPosts: sumBy(tasks, (t) => t.syncedPosts),
    failedPosts: sumBy(tasks, (t) => t.failedPosts),
    usageTokens: run.usageTokens ?? null,
    usageCostUsd: run.usageCostUsd == null ? null : Number(run.usageCostUsd),
    summary: run.summary ?? null,
    tasks,
  };
}

export function serializeCloudFetchRunTask(task: CloudFetchRunTaskRow): CloudFetchRunLogTask {
  const durationMs =
    task.actualDurationSeconds != null
      ? task.actualDurationSeconds * 1000
      : task.startedAt && task.finishedAt
        ? Math.max(0, task.finishedAt.getTime() - task.startedAt.getTime())
        : null;
  return {
    id: task.id,
    builderId: task.builderId,
    sourceName: task.builder?.name ?? null,
    sourceType: task.builder?.sourceType ?? null,
    summaryLanguage: task.summaryLanguage,
    status: task.status,
    plannedPosts: task.plannedPosts,
    syncedPosts: task.syncedPosts,
    failedPosts: task.failedPosts,
    durationMs,
    estimatedDurationSeconds: task.estimatedDurationSeconds ?? null,
    successProbability: task.successProbabilitySnapshot ?? null,
    usageTokens: task.usageTokens ?? null,
    usageCostUsd: task.usageCostUsd == null ? null : Number(task.usageCostUsd),
    failureReason: task.failureReason ?? null,
    posts: parseCloudTaskPosts(task.details),
  };
}

// The sync CLI stores each source's per-post outcomes under the task details
// (same shape the per-user fetch log uses). Read defensively so a missing or
// differently-shaped details blob just yields no per-post rows.
function parseCloudTaskPosts(details: unknown): CloudFetchPostOutcome[] {
  const record =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : null;
  const raw = record
    ? Array.isArray(record.fetchTasks)
      ? record.fetchTasks
      : Array.isArray(record.posts)
        ? record.posts
        : []
    : [];
  const posts: CloudFetchPostOutcome[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    posts.push({
      title: str(p.title),
      url: str(p.url),
      status: str(p.status),
      failureReason: str(p.failureReason ?? p.failure_reason),
      fetchTool: str(p.fetchTool ?? p.fetch_tool),
      model: str(p.agentModel ?? p.model),
      bodyChars: num(p.bodyChars ?? p.body_chars),
      summaryChars: num(p.summaryChars ?? p.summary_chars),
    });
  }
  return posts;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + pick(item), 0);
}
