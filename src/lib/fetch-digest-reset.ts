import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockResetFenceForReset } from "@/lib/reset-fence";

const FETCH_DIGEST_JOB_TYPES = ["library-fetch", "digest-build"] as const;

export type FetchDigestResetSummary = {
  users: number;
  resetBuilders: number;
  deletedFeedItems: number;
  deletedLibraryFetchRuns: number;
  deletedDigests: number;
  deletedDigestRuns: number;
  deletedDigestedItems: number;
  deletedAgentJobRuns: number;
  resetCloudSourceTasks: number;
  deletedCloudQueueItems: number;
  deletedCloudRunTasks: number;
  deletedCloudRuns: number;
  deletedCloudAgentJobRuns: number;
  lastResetAt: string;
};

export async function resetFetchDigestState(
  client: PrismaClient = prisma,
): Promise<FetchDigestResetSummary> {
  return client.$transaction(
    async (tx) => {
      const lastResetAt = await lockResetFenceForReset(tx);
      const users = await tx.user.count();
      const cloudSourceTasks = await tx.cloudSourceTask.findMany({
        select: { id: true, builderId: true, effectiveFrequency: true },
      });
      const activeSubmissionGroups = await tx.cloudSourceSubmission.groupBy({
        by: ["cloudBuilderId"],
        where: {
          cloudBuilderId: { in: cloudSourceTasks.map((task) => task.builderId) },
          active: true,
        },
        _count: { _all: true },
      });
      const activeBuilderIds = new Set(
        activeSubmissionGroups.map((group) => group.cloudBuilderId),
      );
      const activeTasks = cloudSourceTasks
        .filter((task) => activeBuilderIds.has(task.builderId));
      const activeDailyTaskIds = activeTasks
        .filter((task) => task.effectiveFrequency === "DAILY")
        .map((task) => task.id);
      const activeWeeklyTaskIds = activeTasks
        .filter((task) => task.effectiveFrequency === "WEEKLY")
        .map((task) => task.id);
      const inactiveTaskIds = cloudSourceTasks
        .filter((task) => !activeBuilderIds.has(task.builderId))
        .map((task) => task.id);

      const deletedFeedItems = await tx.feedItem.deleteMany();
      const deletedCloudQueueItems = await tx.cloudFetchQueueItem.deleteMany();
      const deletedCloudRunTasks = await tx.cloudFetchRunTask.deleteMany();
      const deletedCloudRuns = await tx.cloudFetchRun.deleteMany();
      const deletedLibraryFetchRuns = await tx.libraryFetchRun.deleteMany();
      const deletedDigests = await tx.digest.deleteMany();
      const deletedDigestRuns = await tx.digestRun.deleteMany();
      const deletedDigestedItems = await tx.digestedItem.deleteMany();
      const deletedAgentJobRuns = await tx.agentJobRun.deleteMany({
        where: { jobType: { in: ["library-fetch", "digest-build"] } },
      });
      const deletedCloudAgentJobRuns = await tx.agentJobRun.deleteMany({
        where: { jobType: "cloud-library-fetch" },
      });
      const resetTaskData = {
        lastQueuedAt: null,
        lastStartedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureReason: null,
        consecutiveFailures: 0,
        consecutiveDeferrals: 0,
        lastDeferredAt: null,
        estimatedDurationSeconds: null,
        estimatedTokenCost: null,
        estimatedSuccessProbability: null,
        estimatedPostYield: null,
        durationP50Seconds: null,
        durationP75Seconds: null,
        durationP90Seconds: null,
        durationSampleCount: 0,
        tokenSampleCount: 0,
        postYieldSampleCount: 0,
        successSampleCount: 0,
        circuitBreakerUntil: null,
        circuitBreakerReason: null,
        lastRunId: null,
      };
      const resetActiveDailyCloudSourceTasks = await tx.cloudSourceTask.updateMany({
        where: { id: { in: activeDailyTaskIds } },
        data: {
          status: "ACTIVE",
          ...resetTaskData,
          nextAttemptAt: lastResetAt,
          mustSucceedBy: new Date(lastResetAt.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      const resetActiveWeeklyCloudSourceTasks = await tx.cloudSourceTask.updateMany({
        where: { id: { in: activeWeeklyTaskIds } },
        data: {
          status: "ACTIVE",
          ...resetTaskData,
          nextAttemptAt: lastResetAt,
          mustSucceedBy: new Date(lastResetAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      const resetInactiveCloudSourceTasks = await tx.cloudSourceTask.updateMany({
        where: { id: { in: inactiveTaskIds } },
        data: {
          status: "PAUSED",
          ...resetTaskData,
          nextAttemptAt: null,
          mustSucceedBy: null,
        },
      });
      const resetBuilders = await tx.builder.updateMany({
        data: {
          itemCount: 0,
          lastFetchedAt: null,
          lastForcedAt: null,
          status: "IDLE",
          lastError: null,
        },
      });

      return {
        users,
        resetBuilders: resetBuilders.count,
        deletedFeedItems: deletedFeedItems.count,
        deletedLibraryFetchRuns: deletedLibraryFetchRuns.count,
        deletedDigests: deletedDigests.count,
        deletedDigestRuns: deletedDigestRuns.count,
        deletedDigestedItems: deletedDigestedItems.count,
        deletedAgentJobRuns: deletedAgentJobRuns.count,
        resetCloudSourceTasks:
          resetActiveDailyCloudSourceTasks.count +
          resetActiveWeeklyCloudSourceTasks.count +
          resetInactiveCloudSourceTasks.count,
        deletedCloudQueueItems: deletedCloudQueueItems.count,
        deletedCloudRunTasks: deletedCloudRunTasks.count,
        deletedCloudRuns: deletedCloudRuns.count,
        deletedCloudAgentJobRuns: deletedCloudAgentJobRuns.count,
        lastResetAt: lastResetAt.toISOString(),
      };
    },
    { maxWait: 60_000, timeout: 60_000 },
  );
}

export function resetFetchDigestStateJobTypes() {
  return [...FETCH_DIGEST_JOB_TYPES];
}
