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

const personalCrawledItemLimit = 5000;

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const includePrompts = url.searchParams.get("includePrompts") === "1";
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

  const [items, personalCrawledItems] = await Promise.all([
    // Crawl dedupe is based on existing FeedItem rows, not user read/view state.
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
            createdAt: {
              gt: since,
              lte: now,
            },
            OR: [
              { publishedAt: null },
              {
                publishedAt: {
                  gte: maxAgeCutoff,
                  lte: now,
                },
              },
            ],
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
        publishedAt: true,
        createdAt: true,
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: personalCrawledItemLimit,
    }),
  ]);
  const latestPersonalCrawledItems = new Map<
    string,
    { builderId: string; latestPostAt: string; publishedAt: string | null; createdAt: string }
  >();
  for (const item of personalCrawledItems) {
    if (!item.builderId) continue;
    const latestPostAt = item.publishedAt ?? item.createdAt;
    const current = latestPersonalCrawledItems.get(item.builderId);
    if (!current || new Date(current.latestPostAt) < latestPostAt) {
      latestPersonalCrawledItems.set(item.builderId, {
        builderId: item.builderId,
        latestPostAt: latestPostAt.toISOString(),
        publishedAt: item.publishedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      });
    }
  }

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
      timestampRule:
        "include items published after the last digest, plus newly crawled items created after the last digest when their publishedAt is still within max post age",
    },
    libraryBuilders,
    personalCrawlStates,
    personalCrawledItems,
    latestPersonalCrawledItems: Array.from(latestPersonalCrawledItems.values()),
    subscriptions: subscriptions.map((subscription) => subscription.builder),
    subscriptionCount: subscriptions.length,
    items,
    ...(includePrompts ? { prompts: DIGEST_PROMPTS } : {}),
  });
}
