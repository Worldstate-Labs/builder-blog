import { createHash } from "node:crypto";
import { builderLibraryState } from "@/lib/builder-library-state";
import { prisma } from "@/lib/prisma";

export type ContentSyncState = {
  version: string;
};

type ContentSyncStateOptions = {
  isAdmin?: boolean;
};

const contentSyncStateTtlMs = 5_000;
const contentSyncStateCacheLimit = 500;

type CachedContentSyncState = {
  expiresAt: number;
  lastAccessedAt: number;
  state: ContentSyncState;
};

const contentSyncStateCache = new Map<string, CachedContentSyncState>();
const contentSyncStateInflight = new Map<string, Promise<ContentSyncState>>();

/**
 * Compact freshness fingerprint for user-visible workspace data.
 *
 * The UI uses this as a low-cost heartbeat: if any server-side data that can
 * change outside the current tab changes, client pages refresh quietly instead
 * of making the user reload the browser.
 */
export async function contentSyncState(
  userId: string,
  { isAdmin = false }: ContentSyncStateOptions = {},
): Promise<ContentSyncState> {
  const key = `${userId}:${isAdmin ? "admin" : "user"}`;
  const now = Date.now();
  const cached = contentSyncStateCache.get(key);
  if (cached && cached.expiresAt > now) {
    cached.lastAccessedAt = now;
    return cached.state;
  }

  const inflight = contentSyncStateInflight.get(key);
  if (inflight) return inflight;

  const nextState = readContentSyncState(userId, isAdmin)
    .then((state) => {
      const cachedAt = Date.now();
      contentSyncStateCache.set(key, {
        expiresAt: cachedAt + contentSyncStateTtlMs,
        lastAccessedAt: cachedAt,
        state,
      });
      pruneContentSyncStateCache(cachedAt);
      return state;
    })
    .finally(() => {
      contentSyncStateInflight.delete(key);
    });
  contentSyncStateInflight.set(key, nextState);
  return nextState;
}

async function readContentSyncState(userId: string, isAdmin: boolean): Promise<ContentSyncState> {
  const [poolEntries, cloudSubmissions] = await Promise.all([
    prisma.builderPoolEntry.findMany({
      where: { userId, removedAt: null },
      select: { builderId: true },
    }),
    prisma.cloudSourceSubmission.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        cloudBuilderId: true,
        active: true,
        frequency: true,
        summaryLanguage: true,
        submittedAt: true,
        updatedAt: true,
      },
    }),
  ]);
  const builderIds = poolEntries.map((entry) => entry.builderId);
  const cloudBuilderIds = [...new Set(cloudSubmissions.map((row) => row.cloudBuilderId))];

  const [
    libraryState,
    digestState,
    digestRunState,
    fetchRunState,
    agentJobState,
    cronEventState,
    tokenState,
    libraryCronJob,
    digestCronJob,
    feedPreference,
    sourceConfigState,
    digestConfig,
    libraryImportState,
    digestPipelineImportState,
    feedReadState,
    feedFavoriteState,
    recommendationState,
    channelPreferenceState,
    libraryVisibilityState,
    digestedItemState,
    cloudTaskState,
    cloudQueueState,
    cloudRunTaskState,
    libraryHubEntries,
    libraryHubItems,
    digestPipelineShares,
    adminState,
  ] = await Promise.all([
    builderLibraryState(userId, builderIds),
    prisma.digest.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true, updatedAt: true },
    }),
    prisma.digestRun.aggregate({
      where: { userId },
      _count: true,
      _max: { preparedAt: true, syncedAt: true },
    }),
    prisma.libraryFetchRun.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true, startedAt: true, finishedAt: true },
    }),
    prisma.agentJobRun.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true, updatedAt: true, heartbeatAt: true, finishedAt: true },
    }),
    prisma.cronJobStatusEvent.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.agentToken.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true, lastUsedAt: true, revokedAt: true },
    }),
    prisma.libraryCronJob.findUnique({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.digestCronJob.findUnique({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.userFeedPreference.findUnique({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.userSourceTypeConfig.aggregate({
      where: { userId },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.userDigestConfig.findUnique({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.libraryImport.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.digestPipelineImport.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.feedRead.aggregate({
      where: { userId },
      _count: true,
      _max: { readAt: true, updatedAt: true },
    }),
    prisma.feedFavorite.aggregate({
      where: { userId },
      _count: true,
      _max: { favoritedAt: true, markedReadAt: true, updatedAt: true },
    }),
    prisma.recommendationSnapshot.aggregate({
      where: { userId },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.userChannelPreference.aggregate({
      where: { userId },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.userLibraryVisibility.aggregate({
      where: { userId },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.digestedItem.aggregate({
      where: { userId },
      _count: true,
      _max: { digestedAt: true },
    }),
    prisma.cloudSourceTask.aggregate({
      where: { builderId: { in: cloudBuilderIds } },
      _count: true,
      _max: {
        updatedAt: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        nextAttemptAt: true,
      },
      _sum: { consecutiveFailures: true, consecutiveDeferrals: true },
    }),
    prisma.cloudFetchQueueItem.aggregate({
      where: { cloudSourceTask: { builderId: { in: cloudBuilderIds } } },
      _count: true,
      _max: { updatedAt: true, leasedAt: true, leaseExpiresAt: true },
      _sum: { attempts: true },
    }),
    prisma.cloudFetchRunTask.aggregate({
      where: { builderId: { in: cloudBuilderIds } },
      _count: true,
      _max: { updatedAt: true, startedAt: true, finishedAt: true },
      _sum: { plannedPosts: true, syncedPosts: true, failedPosts: true },
    }),
    prisma.libraryHubEntry.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        isFeatured: true,
        importCount: true,
      },
    }),
    prisma.libraryHubItem.findMany({
      orderBy: [{ hubEntryId: "asc" }, { builderId: "asc" }],
      select: { hubEntryId: true, builderId: true },
    }),
    prisma.digestPipelineShare.findMany({
      where: { isPublic: true },
      orderBy: { id: "asc" },
      select: {
        id: true,
        ownerUserId: true,
        title: true,
        description: true,
        isPublic: true,
        importCount: true,
      },
    }),
    isAdmin ? readAdminContentSyncState() : Promise.resolve(null),
  ]);

  return {
    version: hashState([
      libraryState.version,
      digestState,
      digestRunState,
      fetchRunState,
      agentJobState,
      cronEventState,
      tokenState,
      libraryCronJob,
      digestCronJob,
      feedPreference,
      sourceConfigState,
      digestConfig,
      libraryImportState,
      digestPipelineImportState,
      feedReadState,
      feedFavoriteState,
      recommendationState,
      channelPreferenceState,
      libraryVisibilityState,
      digestedItemState,
      cloudSubmissions,
      cloudTaskState,
      cloudQueueState,
      cloudRunTaskState,
      libraryHubEntries,
      libraryHubItems,
      digestPipelineShares,
      adminState,
    ]),
  };
}

async function readAdminContentSyncState() {
  return Promise.all([
    prisma.sourceCandidate.aggregate({
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.backupSourceCandidate.aggregate({
      _count: true,
      _max: { updatedAt: true, lastSeenAt: true },
    }),
    prisma.sourceTypeConfig.aggregate({
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.digestConfig.findUnique({
      where: { id: "global" },
      select: { updatedAt: true },
    }),
    prisma.cloudFetchConfig.findUnique({
      where: { id: "global" },
      select: { updatedAt: true },
    }),
    prisma.cloudLanguageLibrary.aggregate({
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.cloudSourceTask.aggregate({
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.cloudFetchQueueItem.aggregate({
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.cloudFetchRun.aggregate({
      _count: true,
      _max: { updatedAt: true, startedAt: true, finishedAt: true },
    }),
    prisma.cloudFetchRunTask.aggregate({
      _count: true,
      _max: { updatedAt: true, startedAt: true, finishedAt: true },
    }),
  ]);
}

function hashState(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

function pruneContentSyncStateCache(now: number) {
  if (contentSyncStateCache.size <= contentSyncStateCacheLimit) return;

  for (const [key, cached] of contentSyncStateCache) {
    if (cached.expiresAt <= now) contentSyncStateCache.delete(key);
  }
  if (contentSyncStateCache.size <= contentSyncStateCacheLimit) return;

  let oldestKey: string | null = null;
  let oldestAccessedAt = Number.POSITIVE_INFINITY;
  for (const [key, cached] of contentSyncStateCache) {
    if (cached.lastAccessedAt < oldestAccessedAt) {
      oldestKey = key;
      oldestAccessedAt = cached.lastAccessedAt;
    }
  }
  if (oldestKey) contentSyncStateCache.delete(oldestKey);
}
