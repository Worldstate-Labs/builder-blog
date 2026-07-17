import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/zod-error";
import { z } from "zod";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SubscriptionBodySchema = z.object({
  subscribed: z.boolean(),
});

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
    return NextResponse.json({ error: "Source is not in your source library." }, { status: 404 });
  }

  const builder = await prisma.builder.findUnique({
    where: { id: builderId },
    select: { id: true, entityId: true },
  });
  if (!builder) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  const entityId = builder.entityId;

  const parsed = SubscriptionBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { subscribed } = parsed.data;

  if (subscribed) {
    const writes: Array<Promise<unknown>> = [
      prisma.subscription.upsert({
        where: { userId_builderId: { userId: session.user.id, builderId } },
        update: {},
        create: { userId: session.user.id, builderId },
      }),
    ];
    // Establish primary channel preference if absent — defaults to the channel the user
    // followed from.
    if (entityId) {
      writes.push(
        prisma.userChannelPreference.upsert({
          where: { userId_entityId: { userId: session.user.id, entityId } },
          update: {},
          create: {
            userId: session.user.id,
            entityId,
            primaryBuilderId: builderId,
            pinnedByUser: false,
          },
        }),
      );
    }
    await Promise.all(writes);
  } else {
    const writes: Array<Promise<unknown>> = [
      prisma.subscription.deleteMany({
        where: { userId: session.user.id, builderId },
      }),
    ];
    // The preference is shared across every channel of the entity, so only
    // rebind/clear it when it points at the channel being unfollowed —
    // otherwise a pin the user set on a different, still-followed channel of
    // the same entity would be silently wiped.
    if (entityId) {
      const pref = await prisma.userChannelPreference.findUnique({
        where: { userId_entityId: { userId: session.user.id, entityId } },
        select: { primaryBuilderId: true },
      });
      if (pref?.primaryBuilderId === builderId) {
        // Fall back to another channel of this entity the user still follows,
        // else drop the preference entirely.
        const fallback = await prisma.subscription.findFirst({
          where: {
            userId: session.user.id,
            builderId: { not: builderId },
            builder: { entityId },
          },
          orderBy: { createdAt: "desc" },
          select: { builderId: true },
        });
        writes.push(
          fallback
            ? prisma.userChannelPreference.update({
                where: { userId_entityId: { userId: session.user.id, entityId } },
                data: { primaryBuilderId: fallback.builderId, pinnedByUser: false },
              })
            : prisma.userChannelPreference.deleteMany({
                where: { userId: session.user.id, entityId },
              }),
        );
      }
    }
    await Promise.all(writes);
  }

  revalidateTag(`user:${session.user.id}:recs`, "default");
  return NextResponse.json({ builderId, entityId, subscribed });
}
