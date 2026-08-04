import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  lockResetFenceForReset,
  userResetFenceId,
} from "@/lib/reset-fence";

const FETCH_DIGEST_JOB_TYPES = ["library-fetch", "digest-build"] as const;

export type UserFetchDigestResetSummary = {
  resetBuilders: number;
  deletedFeedItems: number;
  deletedLibraryFetchRuns: number;
  deletedDigests: number;
  deletedDigestRuns: number;
  deletedDigestedItems: number;
  deletedRecommendationSnapshots: number;
  deletedAgentJobRuns: number;
  lastResetAt: string;
};

export async function resetUserFetchDigestState(
  userId: string,
  client: PrismaClient = prisma,
): Promise<UserFetchDigestResetSummary> {
  const normalizedUserId = userId.trim();
  const fenceId = userResetFenceId(normalizedUserId);

  return client.$transaction(
    async (tx) => {
      const lastResetAt = await lockResetFenceForReset(tx, fenceId);
      const personalPostFilter = {
        feedItem: {
          builder: {
            ownerUserId: normalizedUserId,
            cloudSourceTask: null,
          },
        },
      };
      const [recommendationReferences, readReferences, favoriteReferences] =
        await Promise.all([
          tx.recommendationSnapshotItem.count({
            where: {
              ...personalPostFilter,
              snapshot: { userId: { not: normalizedUserId } },
            },
          }),
          tx.feedRead.count({
            where: {
              ...personalPostFilter,
              userId: { not: normalizedUserId },
            },
          }),
          tx.feedFavorite.count({
            where: {
              ...personalPostFilter,
              userId: { not: normalizedUserId },
            },
          }),
        ]);

      if (recommendationReferences + readReferences + favoriteReferences > 0) {
        throw new Error(
          "Cannot reset generated data because another user references generated posts owned by this account.",
        );
      }

      const deletedRecommendationSnapshots = await tx.recommendationSnapshot.deleteMany({
        where: { userId: normalizedUserId },
      });
      const deletedDigestedItems = await tx.digestedItem.deleteMany({
        where: { userId: normalizedUserId },
      });
      const deletedFeedItems = await tx.feedItem.deleteMany({
        where: {
          builder: {
            ownerUserId: normalizedUserId,
            cloudSourceTask: null,
          },
        },
      });
      const deletedLibraryFetchRuns = await tx.libraryFetchRun.deleteMany({
        where: { userId: normalizedUserId },
      });
      const deletedDigests = await tx.digest.deleteMany({
        where: { userId: normalizedUserId },
      });
      const deletedDigestRuns = await tx.digestRun.deleteMany({
        where: { userId: normalizedUserId },
      });
      const deletedAgentJobRuns = await tx.agentJobRun.deleteMany({
        where: {
          userId: normalizedUserId,
          jobType: { in: [...FETCH_DIGEST_JOB_TYPES] },
        },
      });
      const resetBuilders = await tx.builder.updateMany({
        where: {
          ownerUserId: normalizedUserId,
          cloudSourceTask: null,
        },
        data: {
          itemCount: 0,
          lastFetchedAt: null,
          lastForcedAt: null,
          status: "IDLE",
          lastError: null,
        },
      });

      return {
        resetBuilders: resetBuilders.count,
        deletedFeedItems: deletedFeedItems.count,
        deletedLibraryFetchRuns: deletedLibraryFetchRuns.count,
        deletedDigests: deletedDigests.count,
        deletedDigestRuns: deletedDigestRuns.count,
        deletedDigestedItems: deletedDigestedItems.count,
        deletedRecommendationSnapshots: deletedRecommendationSnapshots.count,
        deletedAgentJobRuns: deletedAgentJobRuns.count,
        lastResetAt: lastResetAt.toISOString(),
      };
    },
    { maxWait: 60_000, timeout: 60_000 },
  );
}

export function resetFetchDigestStateJobTypes() {
  return [...FETCH_DIGEST_JOB_TYPES];
}
