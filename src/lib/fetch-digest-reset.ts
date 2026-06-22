import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
};

export async function resetFetchDigestState(
  client: PrismaClient = prisma,
): Promise<FetchDigestResetSummary> {
  return client.$transaction(
    async (tx) => {
      const users = await tx.user.count();

      const deletedFeedItems = await tx.feedItem.deleteMany();
      const deletedLibraryFetchRuns = await tx.libraryFetchRun.deleteMany();
      const deletedDigests = await tx.digest.deleteMany();
      const deletedDigestRuns = await tx.digestRun.deleteMany();
      const deletedDigestedItems = await tx.digestedItem.deleteMany();
      const deletedAgentJobRuns = await tx.agentJobRun.deleteMany({
        where: { jobType: { in: ["library-fetch", "digest-build"] } },
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
      };
    },
    { maxWait: 60_000, timeout: 60_000 },
  );
}

export function resetFetchDigestStateJobTypes() {
  return [...FETCH_DIGEST_JOB_TYPES];
}
