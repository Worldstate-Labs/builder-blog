// Serialization for the admin cloud fetch log. Each CloudFetchRun is one
// polling round (lease + fetch); its CloudFetchRunTask rows are the per-source
// outcomes. Pure mapping so it is unit-testable without a database.

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
  actualDurationSeconds: number | null;
  failureReason: string | null;
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
  actualDurationSeconds: number | null;
  failureReason: string | null;
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
    usageTokens: run.usageTokens ?? null,
    usageCostUsd: run.usageCostUsd == null ? null : Number(run.usageCostUsd),
    summary: run.summary ?? null,
    tasks: run.tasks.map(serializeCloudFetchRunTask),
  };
}

export function serializeCloudFetchRunTask(task: CloudFetchRunTaskRow): CloudFetchRunLogTask {
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
    actualDurationSeconds: task.actualDurationSeconds ?? null,
    failureReason: task.failureReason ?? null,
  };
}
