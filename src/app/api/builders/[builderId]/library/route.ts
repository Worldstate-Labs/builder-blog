import { BuilderPoolOrigin } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rebindPrimaryChannels } from "@/lib/builder-entities";

type Params = { params: Promise<{ builderId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { builderId } = await params;
  const poolEntry = await prisma.builderPoolEntry.findUnique({
    where: {
      userId_builderId: { userId: session.user.id, builderId },
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
    select: { id: true, ownerUserId: true, entityId: true },
  });

  // If this is the user's own builder (channel), drop it completely.
  if (builder?.ownerUserId === session.user.id) {
    const entityId = builder.entityId;
    const feedItems = await prisma.feedItem.findMany({
      where: { builderId },
      select: { id: true },
    });
    const feedItemIds = feedItems.map((item) => item.id);
    await prisma.$transaction([
      prisma.feedItem.deleteMany({ where: { id: { in: feedItemIds } } }),
      prisma.builder.delete({ where: { id: builderId } }),
    ]);

    // The Builder row is gone — clean up subscription / channel preference if the entity is
    // no longer reachable from any of this user's libraries.
    if (entityId) {
      const stillReachable = await prisma.builder.findFirst({
        where: {
          entityId,
          OR: [
            { ownerUserId: session.user.id },
            {
              hubItems: {
                some: { hubEntry: { imports: { some: { userId: session.user.id } } } },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (!stillReachable) {
        await prisma.subscription.deleteMany({
          where: { userId: session.user.id, entityId },
        });
        await prisma.userChannelPreference.deleteMany({
          where: { userId: session.user.id, entityId },
        });
      } else {
        await rebindPrimaryChannels({
          userId: session.user.id,
          entityIds: [entityId],
        });
      }
    }

    return NextResponse.json({
      builderId,
      removed: true,
      deletedBuilder: true,
      deletedFeedItems: feedItemIds.length,
    });
  }

  // Otherwise just hide from pool and drop the per-channel pool entry / subscription.
  // (Cross-channel subscription cleanup happens via library-hub removal flow, not here.)
  await prisma.$transaction([
    prisma.builderPoolEntry.updateMany({
      where: { userId: session.user.id, builderId },
      data: { removedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ builderId, removed: true });
}
