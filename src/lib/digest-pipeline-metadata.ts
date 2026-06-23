import { serializeAgentJobRun } from "@/lib/agent-job-runs";
import {
  buildDigestCronStatus,
  digestCronFrequencyLabel,
  getDigestUpdateStatus,
  type DigestCronRunStatusInput,
  type DigestUpdateStatus,
} from "@/lib/digest-update-status";
import { resolveDigestHeadlineSummary } from "@/lib/digest-headline";
import { digestSourceLinksForUser, type DigestSourceLink } from "@/lib/digest-source-links";
import { prisma } from "@/lib/prisma";
import { serializeDigestCronJob } from "@/lib/digest-runs";

export type DigestPipelineRuntimeMetadata = {
  digestCount: number;
  latestDigestAt: string | null;
  latestDigestHeadline: string | null;
  latestDigestLanguage: string | null;
  latestDigestSourceLinks: DigestSourceLink[];
  summaryLanguage: string | null;
  scheduleStatus: string | null;
  frequencyLabel: string | null;
  digestUpdateStatus: Pick<DigestUpdateStatus, "key" | "label" | "summary">;
};

const EMPTY_METADATA: DigestPipelineRuntimeMetadata = {
  digestCount: 0,
  latestDigestAt: null,
  latestDigestHeadline: null,
  latestDigestLanguage: null,
  latestDigestSourceLinks: [],
  summaryLanguage: null,
  scheduleStatus: null,
  frequencyLabel: null,
  digestUpdateStatus: {
    key: "not-connected",
    label: "Not connected",
    summary: "No Local Agent schedule is connected.",
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
          select: {
            createdAt: true,
            headlineSummary: true,
            id: true,
            language: true,
          },
        }),
        prisma.userFeedPreference.findUnique({
          where: { userId: ownerUserId },
          select: { summaryLanguage: true },
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
      const sourceLinks = await digestSourceLinksForUser(ownerUserId, latestDigest?.id);

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

      const metadata: DigestPipelineRuntimeMetadata = {
        digestCount,
        latestDigestAt: latestDigest?.createdAt.toISOString() ?? null,
        latestDigestHeadline: latestDigest
          ? resolveDigestHeadlineSummary({
              headlineSummary: latestDigest.headlineSummary,
            })
          : null,
        latestDigestLanguage: latestDigest?.language ?? null,
        latestDigestSourceLinks: sourceLinks,
        summaryLanguage: feedPreference?.summaryLanguage ?? null,
        scheduleStatus: cronJob?.status ?? null,
        frequencyLabel: digestCronFrequencyLabel(cronJob),
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
