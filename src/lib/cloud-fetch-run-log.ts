// Serialization for the admin cloud worker monitor. CloudFetchRun remains the
// persisted lease-batch table for compatibility, but the product UI treats the
// local admin worker host as the primary thing to monitor. Lease batches are
// secondary history rows, and CloudFetchRunTask rows are per-source outcomes.
// Pure mapping so it stays unit-testable without a database.

export type CloudFetchPostOutcome = {
  id: string | null;
  title: string | null;
  url: string | null;
  contentStatus: string | null;
  agentWorkType: string | null;
  status: string | null;
  failureReason: string | null;
  fetchTool: string | null;
  agentRuntime: string | null;
  model: string | null;
  bodyChars: number | null;
  bodyWords: number | null;
  summaryChars: number | null;
  summaryWords: number | null;
  readMethod: string | null;
  summaryMethod: string | null;
  hubSharedReuse: Record<string, unknown> | null;
  workerId: string | null;
};

export type CloudFetchWorkerUsage = {
  workerId: string;
  usage: Record<string, unknown>;
  taskCount: number | null;
  taskIds: string[];
};

export type CloudWorkerHostTask = {
  id: string;
  status: string | null;
  phase: string | null;
  message: string | null;
  builder: string | null;
  builderId: string | null;
  sourceType: string | null;
  title: string | null;
  url: string | null;
  workerId: string | null;
  bodyChars: number | null;
  bodyWords: number | null;
  summaryChars: number | null;
  summaryWords: number | null;
  updatedAt: string | null;
};

export type CloudWorkerHostStatus = {
  status: "online" | "stale" | "offline";
  statusLabel: string;
  hostname: string | null;
  platform: string | null;
  runtime: string | null;
  stage: string | null;
  summary: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string | null;
  localWorkers: number | null;
  runnerPid: number | null;
  workerPid: number | null;
  progress: {
    stage: string | null;
    updatedAt: string | null;
    sourcesTotal: number | null;
    sourcesChecked: number | null;
    tasksPlanned: number | null;
    tasksDone: number | null;
    synced: number | null;
    failed: number | null;
    skipped: number | null;
    actionNeeded: number | null;
    currentSource: string | null;
    currentTask: string | null;
  } | null;
  tasks: CloudWorkerHostTask[];
  recentEvents: Array<{
    at: string | null;
    type: string | null;
    message: string | null;
    taskId: string | null;
    status: string | null;
    reason: string | null;
  }>;
};

export type CloudFetchRunLogTask = {
  id: string;
  builderId: string;
  sourceName: string | null;
  sourceType: string | null;
  summaryLanguage: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  skippedPosts: number;
  pendingPosts: number;
  durationMs: number | null;
  estimatedDurationSeconds: number | null;
  successProbability: number | null;
  usageTokens: number | null;
  usageCostUsd: number | null;
  failureReason: string | null;
  posts: CloudFetchPostOutcome[];
  workerUsages: CloudFetchWorkerUsage[];
};

export type CloudFetchRunLogItem = {
  id: string;
  leaseOwner: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: string;
  requestedLimit: number;
  tasksClaimed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  tasksRunning: number;
  // Aggregate post lifecycle across the run's per-source tasks.
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  skippedPosts: number;
  pendingPosts: number;
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
  leaseOwner: string;
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

type CloudWorkerHostJobRow = {
  status: string;
  startedAt: string | Date;
  heartbeatAt?: string | Date | null;
  updatedAt?: string | Date | null;
  runtime?: string | null;
  runnerPid?: number | null;
  workerPid?: number | null;
  hostname?: string | null;
  platform?: string | null;
  stage?: string | null;
  summary?: string | null;
  details?: unknown;
};

export function serializeCloudWorkerHost(
  job: CloudWorkerHostJobRow | null | undefined,
  now = new Date(),
): CloudWorkerHostStatus {
  if (!job) {
    return {
      status: "offline",
      statusLabel: "No host heartbeat",
      hostname: null,
      platform: null,
      runtime: null,
      stage: null,
      summary: null,
      startedAt: null,
      heartbeatAt: null,
      updatedAt: null,
      localWorkers: null,
      runnerPid: null,
      workerPid: null,
      progress: null,
      tasks: [],
      recentEvents: [],
    };
  }

  const details = record(job.details);
  const progress = record(details?.progress);
  const heartbeatAt = iso(job.heartbeatAt) ?? iso(job.updatedAt) ?? iso(job.startedAt);
  const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
  const active = job.status === "running" || job.status === "starting";
  const stale = active && (!Number.isFinite(heartbeatMs) || now.getTime() - heartbeatMs > 5 * 60_000);
  const status = active ? (stale ? "stale" : "online") : "offline";
  const counters = record(progress?.counters);
  const current = record(progress?.current);
  return {
    status,
    statusLabel: status === "online" ? "Online" : status === "stale" ? "Stale" : "Offline",
    hostname: str(job.hostname),
    platform: str(job.platform),
    runtime: str(job.runtime),
    stage: str(progress?.stage) ?? str(job.stage),
    summary: str(job.summary),
    startedAt: iso(job.startedAt),
    heartbeatAt,
    updatedAt: iso(progress?.updatedAt) ?? iso(job.updatedAt),
    localWorkers: num(details?.localWorkers),
    runnerPid: num(job.runnerPid),
    workerPid: num(job.workerPid),
    progress: progress
      ? {
          stage: str(progress.stage),
          updatedAt: iso(progress.updatedAt),
          sourcesTotal: num(counters?.sourcesTotal),
          sourcesChecked: num(counters?.sourcesChecked),
          tasksPlanned: num(counters?.tasksPlanned),
          tasksDone: num(counters?.tasksDone),
          synced: num(counters?.synced),
          failed: num(counters?.failed),
          skipped: num(counters?.skipped),
          actionNeeded: num(counters?.actionNeeded),
          currentSource: str(current?.source),
          currentTask: str(current?.task),
        }
      : null,
    tasks: Array.isArray(progress?.tasks) ? progress.tasks.map(serializeWorkerHostTask) : [],
    recentEvents: Array.isArray(progress?.recentEvents)
      ? progress.recentEvents.map(serializeWorkerHostEvent)
      : [],
  };
}

export function serializeCloudFetchRun(run: CloudFetchRunRow): CloudFetchRunLogItem {
  const tasks = run.tasks.map(serializeCloudFetchRunTask);
  const tasksRunning = Math.max(0, run.tasksClaimed - run.tasksSucceeded - run.tasksFailed);
  return {
    id: run.id,
    leaseOwner: run.leaseOwner,
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
    tasksRunning,
    plannedPosts: sumBy(tasks, (t) => t.plannedPosts),
    syncedPosts: sumBy(tasks, (t) => t.syncedPosts),
    failedPosts: sumBy(tasks, (t) => t.failedPosts),
    skippedPosts: sumBy(tasks, (t) => t.skippedPosts),
    pendingPosts: sumBy(tasks, (t) => t.pendingPosts),
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
  const posts = parseCloudTaskPosts(task.details);
  const skippedPosts = posts.filter((post) => String(post.status ?? "").toLowerCase() === "skipped").length;
  return {
    id: task.id,
    builderId: task.builderId,
    sourceName: task.builder?.name ?? null,
    sourceType: task.builder?.sourceType ?? null,
    summaryLanguage: task.summaryLanguage,
    status: task.status,
    startedAt: task.startedAt ? task.startedAt.toISOString() : null,
    finishedAt: task.finishedAt ? task.finishedAt.toISOString() : null,
    plannedPosts: task.plannedPosts,
    syncedPosts: task.syncedPosts,
    failedPosts: task.failedPosts,
    skippedPosts,
    pendingPosts: Math.max(0, task.plannedPosts - task.syncedPosts - task.failedPosts - skippedPosts),
    durationMs,
    estimatedDurationSeconds: task.estimatedDurationSeconds ?? null,
    successProbability: task.successProbabilitySnapshot ?? null,
    usageTokens: task.usageTokens ?? null,
    usageCostUsd: task.usageCostUsd == null ? null : Number(task.usageCostUsd),
    failureReason: task.failureReason ?? null,
    posts,
    workerUsages: parseCloudWorkerUsages(task.details),
  };
}

// The sync CLI stores each source's per-post outcomes under the task details
// (same shape the per-user fetch log uses). Read defensively so a missing or
// differently-shaped details blob just yields no per-post rows.
function parseCloudTaskPosts(details: unknown): CloudFetchPostOutcome[] {
  const detailsRecord =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : null;
  const raw = detailsRecord
    ? Array.isArray(detailsRecord.fetchTasks)
      ? detailsRecord.fetchTasks
      : Array.isArray(detailsRecord.posts)
        ? detailsRecord.posts
        : []
    : [];
  const posts: CloudFetchPostOutcome[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const rawJson = record(p.rawJson ?? p.raw_json);
    posts.push({
      id: str(p.id ?? p.fetchTaskId ?? p.fetch_task_id ?? rawJson?.fetchTaskId),
      title: str(p.title),
      url: str(p.url),
      contentStatus: str(p.contentStatus ?? p.content_status),
      agentWorkType: str(p.agentWorkType ?? p.agent_work_type),
      status: str(p.status),
      failureReason: str(p.failureReason ?? p.failure_reason),
      fetchTool: str(p.fetchTool ?? p.fetch_tool),
      agentRuntime: str(p.agentRuntime ?? p.agent_runtime),
      model: str(p.agentModel ?? p.model),
      bodyChars: num(p.bodyChars ?? p.body_chars),
      bodyWords: num(p.bodyWords ?? p.body_words),
      summaryChars: num(p.summaryChars ?? p.summary_chars),
      summaryWords: num(p.summaryWords ?? p.summary_words),
      readMethod: str(p.readMethod ?? p.read_method),
      summaryMethod: str(p.summaryMethod ?? p.summary_method),
      hubSharedReuse: record(p.hubSharedReuse ?? p.hub_shared_reuse ?? rawJson?.hubSharedReuse),
      workerId: str(p.workerId ?? p.worker_id),
    });
  }
  return posts;
}

function parseCloudWorkerUsages(details: unknown): CloudFetchWorkerUsage[] {
  const detailsRecord =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : null;
  const raw = detailsRecord && Array.isArray(detailsRecord.workerUsages)
    ? detailsRecord.workerUsages
    : [];
  const usages: CloudFetchWorkerUsage[] = [];
  for (const item of raw) {
    const usage = record(item);
    const workerId = str(usage?.workerId);
    const usageRecord = record(usage?.usage) ?? usage;
    if (!workerId || !usageRecord) continue;
    usages.push({
      workerId,
      usage: usageRecord,
      taskCount: num(usage?.taskCount),
      taskIds: Array.isArray(usage?.taskIds)
        ? usage.taskIds.map((id) => str(id)).filter((id): id is string => Boolean(id))
        : [],
    });
  }
  return usages;
}

function serializeWorkerHostTask(value: unknown): CloudWorkerHostTask {
  const task = record(value);
  return {
    id: str(task?.id ?? task?.taskId) ?? "",
    status: str(task?.status),
    phase: str(task?.phase),
    message: str(task?.message),
    builder: str(task?.builder),
    builderId: str(task?.builderId),
    sourceType: str(task?.sourceType),
    title: str(task?.title),
    url: str(task?.url),
    workerId: str(task?.workerId),
    bodyChars: num(task?.bodyChars),
    bodyWords: num(task?.bodyWords),
    summaryChars: num(task?.summaryChars),
    summaryWords: num(task?.summaryWords),
    updatedAt: iso(task?.updatedAt),
  };
}

function serializeWorkerHostEvent(value: unknown) {
  const event = record(value);
  return {
    at: iso(event?.at),
    type: str(event?.type),
    message: str(event?.message),
    taskId: str(event?.taskId),
    status: str(event?.status),
    reason: str(event?.reason),
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + pick(item), 0);
}
