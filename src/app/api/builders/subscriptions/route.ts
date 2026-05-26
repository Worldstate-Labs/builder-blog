import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Bulk subscribe to every reachable creator in the user's pool.
 * Subscription is per-entity; if the pool contains multiple channels for the same creator,
 * we collapse to one subscription per entity.
 */
export async function POST() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const poolBuilderIds = await activePoolBuilderIds(session.user.id);
  if (poolBuilderIds.length === 0) {
    return NextResponse.json({ subscribed: 0, builderIds: [] });
  }

  const builders = await prisma.builder.findMany({
    where: { id: { in: poolBuilderIds } },
    select: { id: true, entityId: true },
  });

  // Pick one canonical channel per entity (first occurrence in pool order is fine).
  const entityToBuilder = new Map<string, string>();
  for (const b of builders) {
    if (b.entityId && !entityToBuilder.has(b.entityId)) {
      entityToBuilder.set(b.entityId, b.id);
    }
  }

  if (entityToBuilder.size > 0) {
    // Bulk: find which entities the user already follows, then create the rest.
    const existing = await prisma.subscription.findMany({
      where: {
        userId: session.user.id,
        entityId: { in: [...entityToBuilder.keys()] },
      },
      select: { entityId: true },
    });
    const existingEntitySet = new Set(
      existing.map((s) => s.entityId).filter((id): id is string => Boolean(id)),
    );
    const newSubs = [...entityToBuilder.entries()].filter(
      ([entityId]) => !existingEntitySet.has(entityId),
    );
    if (newSubs.length > 0) {
      await prisma.subscription.createMany({
        data: newSubs.map(([entityId, builderId]) => ({
          userId: session.user.id,
          builderId,
          entityId,
        })),
        skipDuplicates: true,
      });
    }
    await prisma.userChannelPreference.createMany({
      data: [...entityToBuilder.entries()].map(([entityId, builderId]) => ({
        userId: session.user.id,
        entityId,
        primaryBuilderId: builderId,
        pinnedByUser: false,
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    subscribed: entityToBuilder.size,
    builderIds: [...entityToBuilder.values()],
    entityIds: [...entityToBuilder.keys()],
  });
}
