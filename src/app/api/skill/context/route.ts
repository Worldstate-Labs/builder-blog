import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { DIGEST_PROMPTS } from "@/lib/digest-prompts";
import { subscriptionBuilderIdsInPool } from "@/lib/digest-library";
import {
  digestFallbackSince,
  digestMaxAgeCutoff,
  digestMaxPostAgeDays,
  digestFrequencyDays,
} from "@/lib/feed-preferences";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

const personalSeenItemLimit = 5000;

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const poolBuilderIds = await activePoolBuilderIds(user.id);
  const [libraryBuilders, subscriptions, personalCrawlStates, preference, lastDigest] = await Promise.all([
    prisma.builder.findMany({
      where: { id: { in: poolBuilderIds } },
      orderBy: [{ scope: "asc" }, { kind: "asc" }, { name: "asc" }],
    }),
    prisma.subscription.findMany({
      where: {
        userId: user.id,
        builderId: { in: poolBuilderIds },
      },
      include: { builder: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.userBuilderCrawl.findMany({
      where: {
        userId: user.id,
        builderId: { in: poolBuilderIds },
      },
      orderBy: { lastCrawledAt: "desc" },
    }),
    prisma.userFeedPreference.findUnique({
      where: { userId: user.id },
    }),
    prisma.digest.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const since = lastDigest?.createdAt ?? digestFallbackSince(now, preference);
  const maxAgeCutoff = digestMaxAgeCutoff(now, preference);
  const subscribedBuilderIds = subscriptionBuilderIdsInPool(
    poolBuilderIds,
    subscriptions.map((subscription) => subscription.builderId),
  );
  const personalBuilderIds = libraryBuilders
    .filter((builder) => builder.scope === "PERSONAL")
    .map((builder) => builder.id);

  const [items, personalSeenItems] = await Promise.all([
    prisma.feedItem.findMany({
      where: {
        builderId: { in: subscribedBuilderIds },
        OR: [
          {
            publishedAt: {
              gt: since,
              gte: maxAgeCutoff,
              lte: now,
            },
          },
          {
            publishedAt: null,
            createdAt: {
              gt: since,
              gte: maxAgeCutoff,
              lte: now,
            },
          },
        ],
      },
      include: { builder: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 80,
    }),
    prisma.feedItem.findMany({
      where: { builderId: { in: personalBuilderIds } },
      select: {
        builderId: true,
        kind: true,
        externalId: true,
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: personalSeenItemLimit,
    }),
  ]);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    generatedAt: now.toISOString(),
    language: "zh",
    digestWindow: {
      since: since.toISOString(),
      until: now.toISOString(),
      fallbackFrequencyDays: digestFrequencyDays(preference),
      maxPostAgeDays: digestMaxPostAgeDays(preference),
      lastDigestGeneratedAt: lastDigest?.createdAt.toISOString() ?? null,
      timestampRule: "publishedAt first, createdAt only when publishedAt is missing",
    },
    libraryBuilders,
    personalCrawlStates,
    personalSeenItems,
    subscriptions: subscriptions.map((subscription) => subscription.builder),
    subscriptionCount: subscriptions.length,
    items,
    prompts: DIGEST_PROMPTS,
  });
}
