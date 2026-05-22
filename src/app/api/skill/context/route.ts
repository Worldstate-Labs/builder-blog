import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "1");
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

  const subscriptions = await prisma.subscription.findMany({
    where: { userId: user.id },
    include: { builder: true },
    orderBy: { createdAt: "asc" },
  });
  const builderIds = subscriptions.map((sub) => sub.builderId);

  const items = await prisma.feedItem.findMany({
    where: {
      builderId: { in: builderIds },
      OR: [{ publishedAt: { gte: since } }, { createdAt: { gte: since } }],
    },
    include: { builder: true },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 80,
  });

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    generatedAt: new Date().toISOString(),
    language: "zh",
    subscriptions: subscriptions.map((sub) => sub.builder),
    items,
    prompts: {
      digest:
        "Create a concise AI-builder digest in Chinese. Use only the supplied items. Group by builder. Include source URLs for every claim. Highlight launches, technical insights, funding/business moves, and strong opinions. Do not invent missing facts.",
    },
  });
}
