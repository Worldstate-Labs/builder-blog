import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/zod-error";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";
import { getRecommendationFeed } from "@/lib/recommendations";

const ReadBodySchema = z.object({
  feedItemId: z.string().trim().min(1).max(64),
});

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "6");
  const direction = url.searchParams.get("direction") === "prepend" ? "prepend" : "append";
  const feed = await getRecommendationFeed({
    userId: session.user.id,
    limit,
    reason: direction,
    scope: recommendationScope(url.searchParams.get("scope")),
  });

  return NextResponse.json(feed);
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = ReadBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { feedItemId } = parsed.data;

  const item = await prisma.feedItem.findUnique({
    where: { id: feedItemId },
    select: {
      id: true,
      kind: true,
      externalId: true,
      builderId: true,
      builder: { select: { entityId: true } },
    },
  });
  if (!item) {
    return NextResponse.json({ error: "Missing feed item" }, { status: 404 });
  }
  if (!item.builder?.entityId) {
    return NextResponse.json({ error: "Feed item not bound to an entity" }, { status: 409 });
  }

  // Authorization: the user can only mark items from their own pool as read.
  // Otherwise any authenticated user could write FeedRead rows referencing
  // arbitrary global feed items.
  if (item.builderId) {
    const poolIds = await activePoolBuilderIds(session.user.id);
    if (!poolIds.includes(item.builderId)) {
      return NextResponse.json({ error: "Feed item not in your pool" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Feed item not bound to a builder" }, { status: 409 });
  }

  const entityId = item.builder.entityId;
  // Read state is keyed by canonical content (entityId, kind, externalId) so reads on one
  // channel mark the post read across all channels of the same creator.
  const existing = await prisma.feedRead.findFirst({
    where: {
      userId: session.user.id,
      entityId,
      kind: item.kind,
      externalId: item.externalId,
    },
    select: { id: true },
  });
  const data = {
    userId: session.user.id,
    feedItemId,
    entityId,
    kind: item.kind,
    externalId: item.externalId,
    source: "recommendation",
    readAt: new Date(),
  };
  const read = existing
    ? await prisma.feedRead.update({ where: { id: existing.id }, data })
    : await prisma.feedRead.create({ data });

  return NextResponse.json({ status: "ok", readAt: read.readAt.toISOString() });
}

function recommendationScope(value: string | null) {
  return value === "subscription" ? "subscription" : "for-you";
}
