import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { DIGEST_PROMPTS } from "@/lib/digest-prompts";
import { subscriptionBuilderIdsInPool } from "@/lib/digest-library";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

const personalSeenItemLimit = 5000;

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "1");
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

  const poolBuilderIds = await activePoolBuilderIds(user.id);
  const [libraryBuilders, subscriptions, personalCrawlStates] = await Promise.all([
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
  ]);
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
        OR: [{ publishedAt: { gte: since } }, { createdAt: { gte: since } }],
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
    generatedAt: new Date().toISOString(),
    language: "zh",
    libraryBuilders,
    personalCrawlStates,
    personalSeenItems,
    subscriptions: subscriptions.map((subscription) => subscription.builder),
    subscriptionCount: subscriptions.length,
    items,
    prompts: DIGEST_PROMPTS,
  });
}
