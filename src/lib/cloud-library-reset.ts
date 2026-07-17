import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockResetFenceForReset } from "@/lib/reset-fence";

export type CloudLibraryResetSummary = {
  libraries: number;
  resetBuilders: number;
  resetSourceTasks: number;
  deletedFeedItems: number;
  deletedQueueItems: number;
  deletedRunTasks: number;
  deletedRuns: number;
  deletedAgentJobRuns: number;
};

export async function resetCloudLibraryGeneratedState(
  client: PrismaClient = prisma,
): Promise<CloudLibraryResetSummary> {
  return client.$transaction(
    async (tx) => {
      // Serialize against in-flight cloud workers: take FOR UPDATE on the
      // global reset fence and advance lastResetAt before deleting generated
      // state. Without this, a concurrent lease/sync transaction's uncommitted
      // inserts (CloudFetchRun/RunTask/FeedItem) escape the deleteMany snapshot
      // and survive the reset, and its later sync passes the worker fence check
      // because lastResetAt was never advanced — silently undoing the reset.
      await lockResetFenceForReset(tx);
      const libraries = await tx.cloudLanguageLibrary.findMany({
        select: {
          id: true,
          ownerUserId: true,
          sourceTasks: { select: { id: true, builderId: true } },
        },
      });
      const ownerIds = libraries.map((library) => library.ownerUserId);
      const sourceTaskIds = libraries.flatMap((library) =>
        library.sourceTasks.map((task) => task.id),
      );
      const builderIds = libraries.flatMap((library) =>
        library.sourceTasks.map((task) => task.builderId),
      );
      const activeSubmissionGroups = await tx.cloudSourceSubmission.groupBy({
        by: ["cloudBuilderId"],
        where: { cloudBuilderId: { in: builderIds }, active: true },
        _count: { _all: true },
      });
      const activeBuilderIds = new Set(
        activeSubmissionGroups.map((group) => group.cloudBuilderId),
      );
      const activeTaskIds = libraries.flatMap((library) =>
        library.sourceTasks
          .filter((task) => activeBuilderIds.has(task.builderId))
          .map((task) => task.id),
      );
      const activeTaskIdSet = new Set(activeTaskIds);
      const inactiveTaskIds = sourceTaskIds.filter((id) => !activeTaskIdSet.has(id));

      const deletedFeedItems = await tx.feedItem.deleteMany({
        where: { builderId: { in: builderIds } },
      });
      const deletedQueueItems = await tx.cloudFetchQueueItem.deleteMany({
        where: { cloudSourceTaskId: { in: sourceTaskIds } },
      });
      const deletedRunTasks = await tx.cloudFetchRunTask.deleteMany({
        where: { cloudSourceTaskId: { in: sourceTaskIds } },
      });
      const deletedRuns = await tx.cloudFetchRun.deleteMany();
      const deletedAgentJobRuns = await tx.agentJobRun.deleteMany({
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
        nextAttemptAt: null,
        mustSucceedBy: null,
        lastRunId: null,
      };
      const resetActiveTasks = await tx.cloudSourceTask.updateMany({
        where: { id: { in: activeTaskIds } },
        data: {
          status: "ACTIVE",
          ...resetTaskData,
        },
      });
      const resetInactiveTasks = await tx.cloudSourceTask.updateMany({
        where: { id: { in: inactiveTaskIds } },
        data: {
          status: "PAUSED",
          ...resetTaskData,
        },
      });
      const resetBuilders = await tx.builder.updateMany({
        where: { id: { in: builderIds }, ownerUserId: { in: ownerIds } },
        data: {
          lastFetchedAt: null,
          lastForcedAt: null,
          itemCount: 0,
          status: "IDLE",
          lastError: null,
        },
      });

      return {
        libraries: libraries.length,
        resetBuilders: resetBuilders.count,
        resetSourceTasks: resetActiveTasks.count + resetInactiveTasks.count,
        deletedFeedItems: deletedFeedItems.count,
        deletedQueueItems: deletedQueueItems.count,
        deletedRunTasks: deletedRunTasks.count,
        deletedRuns: deletedRuns.count,
        deletedAgentJobRuns: deletedAgentJobRuns.count,
      };
    },
    { maxWait: 60_000, timeout: 60_000 },
  );
}
