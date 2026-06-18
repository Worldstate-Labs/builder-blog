import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatZodError } from "@/lib/zod-error";

type Params = { params: Promise<{ entityId: string }> };

const SubscriptionBodySchema = z.object({
  subscribed: z.boolean(),
});

/**
 * Follow / unfollow at the BuilderEntity level. Fans out to every
 * Builder (channel) that belongs to this entity AND that the calling
 * user has in their pool — typically the user's own channel plus any
 * imported community-library copies of the same canonical source.
 *
 * Subscription rows themselves stay per-builder (the FK has to point
 * at a concrete channel for the dedup / pool / cascade story), but the
 * entity-page UI treats "follow this creator" as one conceptual action
 * so multiple channels of the same entity stay consistent.
 *
 * On subscribe: upsert a Subscription for each accessible channel, and
 * seed a UserChannelPreference if absent (defaults to the first
 * affected channel as primary). On unsubscribe: delete every
 * Subscription for these channels AND clear the entity's channel pref.
 */
export async function PATCH(request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entityId } = await params;

  const parsed = SubscriptionBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { subscribed } = parsed.data;

  // All channels for this entity that the user currently has access to.
  const poolBuilderIds = await activePoolBuilderIds(session.user.id);
  const channels = await prisma.builder.findMany({
    where: {
      entityId,
      id: { in: poolBuilderIds },
    },
    select: { id: true },
  });

  if (channels.length === 0) {
    return NextResponse.json(
      { error: "No accessible channels for this entity in your source library." },
      { status: 404 },
    );
  }
  const channelIds = channels.map((c) => c.id);

  if (subscribed) {
    // Upsert every accessible channel in one I/O window. The operations are
    // independent and idempotent under the userId_builderId unique key.
    await Promise.all([
      ...channelIds.map((builderId) =>
        prisma.subscription.upsert({
          where: { userId_builderId: { userId: session.user.id, builderId } },
          update: {},
          create: { userId: session.user.id, builderId },
        }),
      ),
      // Seed primary channel preference if the user doesn't have one yet.
      // Defaults to the first channel; user can re-pin from the channels
      // accordion if they care.
      prisma.userChannelPreference.upsert({
        where: { userId_entityId: { userId: session.user.id, entityId } },
        update: {},
        create: {
          userId: session.user.id,
          entityId,
          primaryBuilderId: channelIds[0],
          pinnedByUser: false,
        },
      }),
    ]);
  } else {
    await Promise.all([
      prisma.subscription.deleteMany({
        where: { userId: session.user.id, builderId: { in: channelIds } },
      }),
      prisma.userChannelPreference.deleteMany({
        where: { userId: session.user.id, entityId },
      }),
    ]);
  }

  revalidateTag(`user:${session.user.id}:recs`, "default");
  return NextResponse.json({
    entityId,
    subscribed,
    affectedChannels: channelIds.length,
  });
}
