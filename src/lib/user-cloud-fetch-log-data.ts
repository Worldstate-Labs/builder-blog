import { prisma } from "@/lib/prisma";
import {
  serializeUserCloudFetchLog,
  type UserCloudFetchLogData,
} from "@/lib/user-cloud-fetch-log";

const CLOUD_FETCH_SUBMISSION_QUERY_SIZE = 50;

export async function loadUserCloudFetchLog(
  userId: string,
  now = new Date(),
): Promise<UserCloudFetchLogData> {
  const submissions = await prisma.cloudSourceSubmission.findMany({
    where: { userId, active: true },
    orderBy: { submittedAt: "desc" },
    take: CLOUD_FETCH_SUBMISSION_QUERY_SIZE,
    include: {
      userBuilder: {
        select: {
          id: true,
          entityId: true,
          kind: true,
          name: true,
          sourceType: true,
          sourceUrl: true,
          fetchUrl: true,
          avatarUrl: true,
          avatarDataUrl: true,
        },
      },
      cloudBuilder: {
        select: {
          id: true,
          entityId: true,
          kind: true,
          name: true,
          sourceType: true,
          sourceUrl: true,
          fetchUrl: true,
          avatarUrl: true,
          avatarDataUrl: true,
          _count: { select: { feedItems: true } },
          cloudSourceTask: {
            select: {
              id: true,
              builderId: true,
              status: true,
              effectiveFrequency: true,
              lastSuccessAt: true,
              lastFailureAt: true,
              lastFailureReason: true,
              nextAttemptAt: true,
              mustSucceedBy: true,
              consecutiveFailures: true,
              runTasks: {
                orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
                take: 1,
                select: {
                  id: true,
                  builderId: true,
                  summaryLanguage: true,
                  status: true,
                  plannedPosts: true,
                  syncedPosts: true,
                  failedPosts: true,
                  startedAt: true,
                  finishedAt: true,
                  actualDurationSeconds: true,
                  estimatedDurationSeconds: true,
                  successProbabilitySnapshot: true,
                  usageTokens: true,
                  usageCostUsd: true,
                  failureReason: true,
                  details: true,
                  builder: { select: { name: true, sourceType: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  return serializeUserCloudFetchLog(submissions, now);
}
