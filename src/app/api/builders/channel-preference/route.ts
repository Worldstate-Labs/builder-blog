import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Set (or clear) the user's primary channel preference for an entity.
 * Body: { entityId: string, builderId: string | null }
 *
 * If builderId is null → remove the preference (system falls back to auto-pick).
 * Otherwise → record the user-pinned channel.
 */
export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as {
    entityId?: string;
    builderId?: string | null;
  } | null;

  const entityId = payload?.entityId?.trim();
  if (!entityId) {
    return NextResponse.json({ error: "Missing entityId" }, { status: 400 });
  }

  const builderId = payload?.builderId ?? null;

  if (!builderId) {
    await prisma.userChannelPreference.deleteMany({
      where: { userId: session.user.id, entityId },
    });
    return NextResponse.json({ status: "ok", pinned: false });
  }

  const builder = await prisma.builder.findUnique({
    where: { id: builderId },
    select: { entityId: true },
  });
  if (!builder || builder.entityId !== entityId) {
    return NextResponse.json(
      { error: "Builder does not belong to this entity" },
      { status: 400 },
    );
  }

  await prisma.userChannelPreference.upsert({
    where: { userId_entityId: { userId: session.user.id, entityId } },
    update: { primaryBuilderId: builderId, pinnedByUser: true },
    create: {
      userId: session.user.id,
      entityId,
      primaryBuilderId: builderId,
      pinnedByUser: true,
    },
  });

  return NextResponse.json({ status: "ok", pinned: true, primaryBuilderId: builderId });
}
