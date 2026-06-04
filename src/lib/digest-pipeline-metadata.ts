import { serializeAgentJobRun } from "@/lib/agent-job-runs";
import {
  buildDigestCronStatus,
  getDigestUpdateStatus,
  type DigestCronRunStatusInput,
  type DigestUpdateStatus,
} from "@/lib/digest-update-status";
import { prisma } from "@/lib/prisma";
import { serializeDigestCronJob } from "@/lib/digest-runs";

export type DigestPipelineRuntimeMetadata = {
  digestCount: number;
  latestDigestAt: string | null;
  latestDigestLanguage: string | null;
  summaryLanguage: string | null;
  digestMaxPostAgeDays: number | null;
  frequencyLabel: string | null;
  agentLabel: string | null;
  cronJobStatus: string | null;
  digestUpdateStatus: Pick<DigestUpdateStatus, "key" | "label" | "summary">;
};

const EMPTY_METADATA: DigestPipelineRuntimeMetadata = {
  digestCount: 0,
  latestDigestAt: null,
  latestDigestLanguage: null,
  summaryLanguage: null,
  digestMaxPostAgeDays: null,
  frequencyLabel: null,
  agentLabel: null,
  cronJobStatus: null,
  digestUpdateStatus: {
    key: "not-connected",
    label: "Not connected",
    summary: "No local helper schedule has reported yet.",
  },
};

export async function getDigestPipelineMetadataByOwnerIds(ownerUserIds: string[]) {
  const uniqueOwnerIds = [...new Set(ownerUserIds)].filter(Boolean);
  const entries = await Promise.all(
    uniqueOwnerIds.map(async (ownerUserId) => {
      const [
        digestCount,
        latestDigest,
        feedPreference,
        rawCronJob,
        rawRuns,
        rawScheduledJobRuns,
      ] = await Promise.all([
        prisma.digest.count({ where: { userId: ownerUserId, itemCount: { gt: 0 } } }),
        prisma.digest.findFirst({
          where: { userId: ownerUserId, itemCount: { gt: 0 } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, language: true },
        }),
        prisma.userFeedPreference.findUnique({
          where: { userId: ownerUserId },
          select: { summaryLanguage: true, digestMaxPostAgeDays: true },
        }),
        prisma.digestCronJob.findUnique({
          where: { userId: ownerUserId },
        }),
        prisma.digestRun.findMany({
          where: { userId: ownerUserId },
          orderBy: { preparedAt: "desc" },
          take: 25,
          select: {
            id: true,
            status: true,
            source: true,
            preparedAt: true,
            candidateCount: true,
            includedCount: true,
          },
        }),
        prisma.agentJobRun.findMany({
          where: { userId: ownerUserId, scheduleJob: "digest-cron", trigger: "scheduled" },
          orderBy: [{ expectedAt: "desc" }, { startedAt: "desc" }],
          take: 25,
        }),
      ]);

      const cronJob = serializeDigestCronJob(rawCronJob);
      const runs: DigestCronRunStatusInput[] = rawRuns.map((run) => ({
        id: run.id,
        status: run.status,
        source: run.source,
        preparedAt: run.preparedAt.toISOString(),
      }));
      const scheduledJobRuns = rawScheduledJobRuns.map(serializeAgentJobRun);
      const cronStatus = buildDigestCronStatus(cronJob, runs, scheduledJobRuns);
      const updateStatus = getDigestUpdateStatus(cronJob, cronStatus.slots, runs);
      const latestScheduledRun = scheduledJobRuns.find((run) => run.runtime || run.hostname || run.platform) ?? null;

      const metadata: DigestPipelineRuntimeMetadata = {
        digestCount,
        latestDigestAt: latestDigest?.createdAt.toISOString() ?? null,
        latestDigestLanguage: latestDigest?.language ?? null,
        summaryLanguage: feedPreference?.summaryLanguage ?? null,
        digestMaxPostAgeDays: feedPreference?.digestMaxPostAgeDays ?? null,
        frequencyLabel: cronJob?.frequencyLabel ?? null,
        agentLabel: digestAgentLabel(cronJob, latestScheduledRun),
        cronJobStatus: cronJob?.status ?? null,
        digestUpdateStatus: {
          key: updateStatus.key,
          label: updateStatus.label,
          summary: updateStatus.summary,
        },
      };
      return [ownerUserId, metadata] as const;
    }),
  );

  return new Map(entries);
}

export function emptyDigestPipelineMetadata(): DigestPipelineRuntimeMetadata {
  return EMPTY_METADATA;
}

function digestAgentLabel(
  cronJob: { runtime: string | null; hostname: string | null; platform: string | null } | null,
  latestScheduledRun: { runtime: string | null; hostname: string | null; platform: string | null } | null,
) {
  const runtime = cronJob?.runtime || latestScheduledRun?.runtime || (cronJob ? "Local helper" : null);
  if (!runtime) return null;
  const host = cronJob?.hostname || latestScheduledRun?.hostname;
  const platform = cronJob?.platform || latestScheduledRun?.platform;
  const hostLabel = host ? host.replace(/\.local$/, "") : "";
  return [runtime, hostLabel || platform].filter(Boolean).join(" · ");
}
