import { BuilderPoolOrigin, BuilderScope } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ builderId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { builderId } = await params;
  const poolEntry = await prisma.builderPoolEntry.findUnique({
    where: {
      userId_builderId: {
        userId: session.user.id,
        builderId,
      },
    },
    select: { origin: true, removedAt: true },
  });

  if (!poolEntry || poolEntry.removedAt) {
    return NextResponse.json({ error: "Builder is not in your library" }, { status: 404 });
  }
  if (poolEntry.origin === BuilderPoolOrigin.HUB_IMPORT) {
    return NextResponse.json(
      { error: "Imported library sources cannot be removed individually" },
      { status: 403 },
    );
  }

  const builder = await prisma.builder.findUnique({
    where: { id: builderId },
    select: { id: true, ownerUserId: true, scope: true },
  });
  if (builder?.scope === BuilderScope.PERSONAL && builder.ownerUserId === session.user.id) {
    const feedItems = await prisma.feedItem.findMany({
      where: { builderId },
      select: { id: true },
    });
    const feedItemIds = feedItems.map((item) => item.id);
    await prisma.$transaction([
      prisma.feedItem.deleteMany({
        where: { id: { in: feedItemIds } },
      }),
      prisma.builder.delete({
        where: { id: builderId },
      }),
    ]);

    return NextResponse.json({
      builderId,
      removed: true,
      deletedBuilder: true,
      deletedFeedItems: feedItemIds.length,
    });
  }

  await prisma.$transaction([
    prisma.subscription.deleteMany({
      where: { userId: session.user.id, builderId },
    }),
    prisma.builderPoolEntry.updateMany({
      where: { userId: session.user.id, builderId },
      data: { removedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ builderId, removed: true });
}
