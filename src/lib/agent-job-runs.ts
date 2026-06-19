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
