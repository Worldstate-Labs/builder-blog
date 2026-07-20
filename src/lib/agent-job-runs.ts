import type { AgentJobRun, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AgentJobRunListItem = {
  id: string;
  jobType: string;
  trigger: string;
  scheduleJob: string | null;
  instanceId: string;
  expectedAt: string | null;
  startedAt: string;
  heartbeatAt: string | null;
  finishedAt: string | null;
  status: string;
  exitCode: number | null;
  signal: string | null;
  runtime: string | null;
  runnerPid: number | null;
  workerPid: number | null;
  hostname: string | null;
  platform: string | null;
  stage: string | null;
  summary: string | null;
  details: unknown;
  updatedAt: string;
};

type AgentJobRunFloorFilterArgs = {
  before?: Date | null;
  linkedInstanceIds: string[];
  runFloor: Date;
};

type FetchRunHistoryLinkRow = {
  startedAt: Date;
  jobRunId: string | null;
};

type BuildFetchRunHistoryAgentJobQueryPlanArgs = {
  rows: FetchRunHistoryLinkRow[];
  cronRows: FetchRunHistoryLinkRow[];
  before?: Date | null;
  pageSize: number;
};

type FinalizeFetchRunHistoryAgentJobPageArgs<T> = {
  runFloor: Date | null;
  rowCount: number;
  cronRowCount: number;
  pageSize: number;
  jobRuns: T[];
  scheduledJobRuns: T[];
  moreJobRuns: boolean;
  moreScheduledJobRuns: boolean;
};

export type FetchRunHistoryAgentJobQuery = {
  findMany: (args: {
    where: Prisma.AgentJobRunWhereInput;
    orderBy: Prisma.AgentJobRunFindManyArgs["orderBy"];
    take?: number;
  }) => Promise<AgentJobRun[]>;
  findFirst: (args: {
    where: Prisma.AgentJobRunWhereInput;
    select: { id: true };
  }) => Promise<{ id: string } | null>;
};

type LoadFetchRunHistoryAgentJobsArgs = BuildFetchRunHistoryAgentJobQueryPlanArgs & {
  userId: string;
  querySize: number;
  query?: FetchRunHistoryAgentJobQuery;
};

function normalizedLinkedInstanceIds(linkedInstanceIds: string[]) {
  return Array.from(new Set(
    linkedInstanceIds
      .map((instanceId) => instanceId.trim())
      .filter((instanceId) => instanceId.length > 0),
  ));
}

export function agentJobRunFloorFilter({
  before,
  linkedInstanceIds,
  runFloor,
}: AgentJobRunFloorFilterArgs): Prisma.AgentJobRunWhereInput {
  const normalizedIds = normalizedLinkedInstanceIds(linkedInstanceIds);
  if (normalizedIds.length === 0) {
    return {
      startedAt: {
        gte: runFloor,
        ...(before ? { lt: before } : {}),
      },
    };
  }

  return {
    AND: [
      ...(before ? [{ startedAt: { lt: before } }] : []),
      {
        OR: [
          { startedAt: { gte: runFloor } },
          { instanceId: { in: normalizedIds } },
        ],
      },
    ],
  };
}

export function scheduledAgentJobRunFloorFilter({
  before,
  linkedInstanceIds,
  runFloor,
}: AgentJobRunFloorFilterArgs): Prisma.AgentJobRunWhereInput {
  const normalizedIds = normalizedLinkedInstanceIds(linkedInstanceIds);
  const floorBranch: Prisma.AgentJobRunWhereInput = {
    OR: [
      { expectedAt: { gte: runFloor } },
      { expectedAt: null, startedAt: { gte: runFloor } },
      ...(normalizedIds.length > 0 ? [{ instanceId: { in: normalizedIds } }] : []),
    ],
  };

  if (!before) {
    return floorBranch;
  }

  return {
    AND: [
      {
        OR: [
          { expectedAt: { lt: before } },
          { expectedAt: null, startedAt: { lt: before } },
        ],
      },
      floorBranch,
    ],
  };
}

export function buildFetchRunHistoryAgentJobQueryPlan({
  rows,
  cronRows,
  before,
  pageSize,
}: BuildFetchRunHistoryAgentJobQueryPlanArgs) {
  const visibleRows = rows.slice(0, pageSize);
  const visibleCronRows = cronRows.slice(0, pageSize);
  const linkedInstanceIds = normalizedLinkedInstanceIds(
    [...visibleRows, ...visibleCronRows].map((run) => run.jobRunId ?? ""),
  );
  const runFloor = visibleRows.length > 0 ? rows[visibleRows.length - 1].startedAt : null;

  return {
    linkedInstanceIds,
    runFloor,
    regularJobRunWhere: runFloor
      ? agentJobRunFloorFilter({ before, linkedInstanceIds, runFloor })
      : null,
    scheduledJobRunWhere: runFloor
      ? scheduledAgentJobRunFloorFilter({ before, linkedInstanceIds, runFloor })
      : null,
  };
}

export function finalizeFetchRunHistoryAgentJobPage<T>({
  runFloor,
  rowCount,
  cronRowCount,
  pageSize,
  jobRuns,
  scheduledJobRuns,
  moreJobRuns,
  moreScheduledJobRuns,
}: FinalizeFetchRunHistoryAgentJobPageArgs<T>) {
  const visibleJobRuns = runFloor ? jobRuns : jobRuns.slice(0, pageSize);
  const visibleScheduledJobRuns = runFloor
    ? scheduledJobRuns
    : scheduledJobRuns.slice(0, pageSize);
  const hasMore =
    rowCount > pageSize ||
    cronRowCount > pageSize ||
    (runFloor
      ? moreJobRuns || moreScheduledJobRuns
      : jobRuns.length > pageSize || scheduledJobRuns.length > pageSize);

  return {
    visibleJobRuns,
    visibleScheduledJobRuns,
    hasMore,
  };
}

const defaultFetchRunHistoryAgentJobQuery: FetchRunHistoryAgentJobQuery = {
  findMany: (args) => prisma.agentJobRun.findMany(args),
  findFirst: (args) => prisma.agentJobRun.findFirst(args),
};

export async function loadFetchRunHistoryAgentJobs({
  userId,
  rows,
  cronRows,
  before,
  pageSize,
  querySize,
  query = defaultFetchRunHistoryAgentJobQuery,
}: LoadFetchRunHistoryAgentJobsArgs) {
  const {
    runFloor,
    regularJobRunWhere,
    scheduledJobRunWhere,
  } = buildFetchRunHistoryAgentJobQueryPlan({
    rows,
    cronRows,
    before,
    pageSize,
  });

  // Fetch-run cursors drive the client pagination. Keep every runtime down to
  // the visible fetch-run floor, plus explicitly linked runtimes that started
  // earlier, so advancing that cursor cannot skip runtime-only failures.
  const [jobRunRows, scheduledJobRunRows, olderJobRun, olderScheduledJobRun] = await Promise.all([
    query.findMany({
      where: {
        userId,
        jobType: "library-fetch",
        ...(regularJobRunWhere ?? (before ? { startedAt: { lt: before } } : {})),
      },
      orderBy: { startedAt: "desc" },
      ...(!runFloor ? { take: querySize } : {}),
    }),
    query.findMany({
      where: {
        userId,
        scheduleJob: "library-cron",
        trigger: "scheduled",
        ...(scheduledJobRunWhere ?? (before
          ? {
              OR: [
                { expectedAt: { lt: before } },
                { expectedAt: null, startedAt: { lt: before } },
              ],
            }
          : {})),
      },
      orderBy: [{ expectedAt: "desc" }, { startedAt: "desc" }],
      ...(!runFloor ? { take: querySize } : {}),
    }),
    runFloor
      ? query.findFirst({
          where: {
            userId,
            jobType: "library-fetch",
            startedAt: { lt: runFloor },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    runFloor
      ? query.findFirst({
          where: {
            userId,
            scheduleJob: "library-cron",
            trigger: "scheduled",
            OR: [
              { expectedAt: { lt: runFloor } },
              { expectedAt: null, startedAt: { lt: runFloor } },
            ],
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const {
    visibleJobRuns,
    visibleScheduledJobRuns,
    hasMore,
  } = finalizeFetchRunHistoryAgentJobPage({
    runFloor,
    rowCount: rows.length,
    cronRowCount: cronRows.length,
    pageSize,
    jobRuns: jobRunRows.map(serializeAgentJobRun),
    scheduledJobRuns: scheduledJobRunRows.map(serializeAgentJobRun),
    moreJobRuns: olderJobRun !== null,
    moreScheduledJobRuns: olderScheduledJobRun !== null,
  });

  return {
    jobRuns: visibleJobRuns,
    scheduledJobRuns: visibleScheduledJobRuns,
    hasMore,
  };
}

export function serializeAgentJobRun(row: {
  id: string;
  jobType: string;
  trigger: string;
  scheduleJob: string | null;
  instanceId: string;
  expectedAt: Date | null;
  startedAt: Date;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  status: string;
  exitCode: number | null;
  signal: string | null;
  runtime: string | null;
  runnerPid: number | null;
  workerPid: number | null;
  hostname: string | null;
  platform: string | null;
  stage: string | null;
  summary: string | null;
  details: unknown;
  updatedAt: Date;
}): AgentJobRunListItem {
  return {
    id: row.id,
    jobType: row.jobType,
    trigger: row.trigger,
    scheduleJob: row.scheduleJob,
    instanceId: row.instanceId,
    expectedAt: row.expectedAt?.toISOString() ?? null,
    startedAt: row.startedAt.toISOString(),
    heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    status: row.status,
    exitCode: row.exitCode,
    signal: row.signal,
    runtime: row.runtime,
    runnerPid: row.runnerPid,
    workerPid: row.workerPid,
    hostname: row.hostname,
    platform: row.platform,
    stage: row.stage,
    summary: row.summary,
    details: row.details,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getAgentJobRuns(
  userId: string,
  jobType: string,
  limit = 25,
  before?: Date | null,
) {
  const rows = await prisma.agentJobRun.findMany({
    where: {
      userId,
      jobType,
      ...(before ? { startedAt: { lt: before } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return rows.map(serializeAgentJobRun);
}

export async function getScheduledAgentJobRuns(
  userId: string,
  scheduleJob: string,
  limit = 25,
  before?: Date | null,
) {
  const rows = await prisma.agentJobRun.findMany({
    where: {
      userId,
      scheduleJob,
      trigger: "scheduled",
      ...(before
        ? {
            OR: [
              { expectedAt: { lt: before } },
              { expectedAt: null, startedAt: { lt: before } },
            ],
          }
        : {}),
    },
    orderBy: [{ expectedAt: "desc" }, { startedAt: "desc" }],
    take: limit,
  });
  return rows.map(serializeAgentJobRun);
}
