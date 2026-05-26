import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ builderId: string }> };

/**
 * Follow / unfollow a channel. Subscription is now per-channel (userId, builderId).
 * UserChannelPreference is still entity-based and is set on subscribe to record
 * which channel the user followed from.
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
  if (!builder) {
    return NextResponse.json({ error: "Builder not found" }, { status: 404 });
  }
  const entityId = builder.entityId;

  const payload = await request.json().catch(() => null);
  const subscribed = Boolean(payload?.subscribed);

  if (subscribed) {
    await prisma.subscription.upsert({
      where: { userId_builderId: { userId: session.user.id, builderId } },
      update: {},
      create: { userId: session.user.id, builderId },
    });
    // Establish primary channel preference if absent — defaults to the channel the user
    // followed from.
    if (entityId) {
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
    }
  } else {
    await prisma.subscription.deleteMany({
      where: { userId: session.user.id, builderId },
    });
    if (entityId) {
      await prisma.userChannelPreference.deleteMany({
        where: { userId: session.user.id, entityId },
      });
    }
  }

  return NextResponse.json({ builderId, entityId, subscribed });
}
