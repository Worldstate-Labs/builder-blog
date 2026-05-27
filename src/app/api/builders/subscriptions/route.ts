import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Bulk subscribe to every channel in the user's pool.
 * Subscription is now per-channel (userId, builderId) — one row per builder in pool.
 * UserChannelPreference (entity → primary channel) is still created, picking the first
 * builder per entity as the canonical display channel.
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

  // Create one Subscription row per pool channel.
  await prisma.subscription.createMany({
    data: poolBuilderIds.map((builderId) => ({
      userId: session.user.id,
      builderId,
    })),
    skipDuplicates: true,
  });

  // Also ensure UserChannelPreference exists per entity (pick first builder per entity).
  const builders = await prisma.builder.findMany({
    where: { id: { in: poolBuilderIds } },
    select: { id: true, entityId: true },
  });
  const entityToBuilder = new Map<string, string>();
  for (const b of builders) {
    if (b.entityId && !entityToBuilder.has(b.entityId)) {
      entityToBuilder.set(b.entityId, b.id);
    }
  }
  if (entityToBuilder.size > 0) {
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

  revalidateTag(`user:${session.user.id}:recs`, "default");
  return NextResponse.json({
    subscribed: poolBuilderIds.length,
    builderIds: poolBuilderIds,
    entityIds: [...entityToBuilder.keys()],
  });
}
