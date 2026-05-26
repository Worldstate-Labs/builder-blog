import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ builderId: string }> };

/**
 * Follow / unfollow a creator. The URL is keyed by builderId (channel) for backward
 * compatibility, but the underlying Subscription is on the entity (the creator) — so
 * clicking Follow from any channel of the same creator results in a single subscription.
 */
export async function PATCH(request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { builderId } = await params;
  const poolBuilderIds = await activePoolBuilderIds(session.user.id);
  if (!poolBuilderIds.includes(builderId)) {
    return NextResponse.json({ error: "Builder is not in your library" }, { status: 404 });
  }

  const builder = await prisma.builder.findUnique({
    where: { id: builderId },
    select: { id: true, entityId: true },
  });
  if (!builder?.entityId) {
    return NextResponse.json({ error: "Builder has no entity binding" }, { status: 500 });
  }
  const entityId = builder.entityId;

  const payload = await request.json().catch(() => null);
  const subscribed = Boolean(payload?.subscribed);

  if (subscribed) {
    const existing = await prisma.subscription.findFirst({
      where: { userId: session.user.id, entityId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.subscription.create({
        data: { userId: session.user.id, builderId, entityId },
      });
    }
    // Establish primary channel preference if absent — defaults to the channel the user
    // followed from.
    await prisma.userChannelPreference.upsert({
      where: { userId_entityId: { userId: session.user.id, entityId } },
      update: {},
      create: {
        userId: session.user.id,
        entityId,
        primaryBuilderId: builderId,
        pinnedByUser: false,
      },
    });
  } else {
    await prisma.$transaction([
      prisma.subscription.deleteMany({
        where: { userId: session.user.id, entityId },
      }),
      prisma.userChannelPreference.deleteMany({
        where: { userId: session.user.id, entityId },
      }),
    ]);
  }

  return NextResponse.json({ builderId, entityId, subscribed });
}
