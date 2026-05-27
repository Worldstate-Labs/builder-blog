import { BuilderPoolOrigin } from "@prisma/client";
import { revalidateTag } from "next/cache";
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

  // Look up as own builder (owned by this user) — used to determine deletion path.
  const ownedBuilder = builder?.ownerUserId === session.user.id
    ? await prisma.builder.findFirst({
        where: { id: builderId, ownerUserId: session.user.id },
        select: { entityId: true },
      })
    : null;

  // If this is the user's own builder (channel), drop it completely.
  if (ownedBuilder) {
    const entityId = ownedBuilder.entityId;
    const feedItems = await prisma.feedItem.findMany({
      where: { builderId },
      select: { id: true },
    });
    const feedItemIds = feedItems.map((item) => item.id);
    await prisma.$transaction([
      prisma.feedItem.deleteMany({ where: { id: { in: feedItemIds } } }),
      prisma.builder.delete({ where: { id: builderId } }),
    ]);

    // Subscription for this builder is cascade-deleted by the Builder FK.
    // Rebind UserChannelPreference if the entity still has other reachable channels.
    if (entityId) {
      await rebindPrimaryChannels({
        userId: session.user.id,
        entityIds: [entityId],
      });
    }

    revalidateTag(`user:${session.user.id}:recs`, "default");
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
