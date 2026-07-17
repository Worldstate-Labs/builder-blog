import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function omitSecretFields<T extends Record<string, unknown>>(record: T): T {
  return record;
}

async function serializeSafeAccountExport(userId: string) {
  const [
    user,
    accounts,
    sessions,
    agentTokens,
    sourceLibraries,
    subscriptions,
    feedPreference,
    feedReads,
    feedFavorites,
    digests,
    digestRuns,
    libraryHubEntries,
    libraryImports,
    digestPipelineShares,
    digestPipelineImports,
    libraryFetchRuns,
    agentJobRuns,
    libraryCronJob,
    digestCronJob,
    sourceTypeConfigs,
    digestConfig,
    digestedItems,
    recommendationSnapshots,
    channelPreferences,
    libraryVisibilities,
    builderPoolEntries,
    cloudSourceSubmissions,
    cronJobStatusEvents,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        provider: true,
        providerAccountId: true,
        expires_at: true,
        token_type: true,
        scope: true,
        session_state: true,
      },
      orderBy: { provider: "asc" },
    }),
    prisma.session.findMany({
      where: { userId },
      select: { id: true, expires: true },
      orderBy: { expires: "desc" },
    }),
    prisma.agentToken.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        lastIp: true,
        lastUserAgent: true,
        lastHostname: true,
        lastPlatform: true,
        lastUser: true,
        revokedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.builder.findMany({
      where: { ownerUserId: userId },
      select: {
        id: true,
        kind: true,
        name: true,
        handle: true,
        canonicalKey: true,
        libraryKey: true,
        sourceType: true,
        sourceUrl: true,
        fetchUrl: true,
        avatarUrl: true,
        bio: true,
        addedByUserId: true,
        lastFetchedAt: true,
        lastForcedAt: true,
        itemCount: true,
        status: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.subscription.findMany({
      where: { userId },
      select: { id: true, builderId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.userFeedPreference.findUnique({ where: { userId } }),
    prisma.feedRead.findMany({
      where: { userId },
      select: {
        id: true,
        feedItemId: true,
        entityId: true,
        kind: true,
        externalId: true,
        source: true,
        readAt: true,
      },
      orderBy: { readAt: "desc" },
    }),
    prisma.feedFavorite.findMany({
      where: { userId },
      select: {
        id: true,
        feedItemId: true,
        entityId: true,
        kind: true,
        externalId: true,
        favoritedAt: true,
        markedReadAt: true,
      },
      orderBy: { favoritedAt: "desc" },
    }),
    prisma.digest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.digestRun.findMany({
      where: { userId },
      orderBy: { preparedAt: "desc" },
    }),
    prisma.libraryHubEntry.findMany({
      where: { ownerUserId: userId },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        isFeatured: true,
        importCount: true,
        viewCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.libraryImport.findMany({
      where: { userId },
      select: { hubEntryId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.digestPipelineShare.findMany({
      where: { ownerUserId: userId },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        isPublic: true,
        importCount: true,
        viewCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.digestPipelineImport.findMany({
      where: { userId },
      select: { pipelineId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.libraryFetchRun.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
    prisma.agentJobRun.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
    prisma.libraryCronJob.findUnique({ where: { userId } }),
    prisma.digestCronJob.findUnique({ where: { userId } }),
    prisma.userSourceTypeConfig.findMany({
      where: { userId },
      orderBy: { sourceId: "asc" },
    }),
    prisma.userDigestConfig.findUnique({ where: { userId } }),
    prisma.digestedItem.findMany({
      where: { userId },
      select: {
        id: true,
        feedItemId: true,
        entityId: true,
        kind: true,
        externalId: true,
        digestId: true,
        digestedAt: true,
      },
      orderBy: { digestedAt: "desc" },
    }),
    prisma.recommendationSnapshot.findMany({
      where: { userId },
      select: {
        id: true,
        reason: true,
        createdAt: true,
        items: {
          select: {
            feedItemId: true,
            rank: true,
            score: true,
            reasons: true,
            createdAt: true,
          },
          orderBy: { rank: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.userChannelPreference.findMany({
      where: { userId },
      select: {
        entityId: true,
        primaryBuilderId: true,
        pinnedByUser: true,
        updatedAt: true,
      },
    }),
    prisma.userLibraryVisibility.findMany({
      where: { userId },
      select: {
        hubEntryId: true,
        hidden: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.builderPoolEntry.findMany({
      where: { userId },
      select: {
        id: true,
        builderId: true,
        origin: true,
        removedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.cloudSourceSubmission.findMany({
      where: { userId },
      select: {
        id: true,
        userBuilderId: true,
        cloudBuilderId: true,
        summaryLanguage: true,
        frequency: true,
        active: true,
        submittedAt: true,
        updatedAt: true,
      },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.cronJobStatusEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return omitSecretFields({
    exportedAt: new Date().toISOString(),
    product: "FollowBrief",
    user,
    accounts,
    sessions,
    agentTokens,
    sourceLibraries,
    subscriptions,
    feedPreference,
    feedReads,
    feedFavorites,
    digests,
    digestRuns,
    libraryHubEntries,
    libraryImports,
    digestPipelineShares,
    digestPipelineImports,
    recentLibraryFetchRuns: libraryFetchRuns,
    recentAgentJobRuns: agentJobRuns,
    libraryCronJob,
    digestCronJob,
    sourceTypeConfigs,
    digestConfig,
    digestedItems,
    recommendationSnapshots,
    channelPreferences,
    libraryVisibilities,
    builderPoolEntries,
    cloudSourceSubmissions,
    recentCronJobStatusEvents: cronJobStatusEvents,
  });
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await serializeSafeAccountExport(session.user.id);
  const body = JSON.stringify(payload, null, 2);

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="followbrief-account-export.json"',
      "content-type": "application/json; charset=utf-8",
    },
  });
}
