import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRecommendationFeed } from "@/lib/recommendations";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const feed = await getRecommendationFeed({
    userId: session.user.id,
    limit,
    offset,
  });

  return NextResponse.json(feed);
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const feedItemId = String(payload?.feedItemId ?? "");
  if (!feedItemId) {
    return NextResponse.json({ error: "Missing feedItemId" }, { status: 400 });
  }

  const item = await prisma.feedItem.findUnique({
    where: { id: feedItemId },
    select: { id: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Missing feed item" }, { status: 404 });
  }

  await prisma.feedRead.upsert({
    where: {
      userId_feedItemId: {
        userId: session.user.id,
        feedItemId,
      },
    },
    update: {
      source: "recommendation",
      readAt: new Date(),
    },
    create: {
      userId: session.user.id,
      feedItemId,
      source: "recommendation",
    },
  });

  return NextResponse.json({ status: "ok" });
}
