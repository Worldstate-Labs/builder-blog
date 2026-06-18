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
    if (entityId) {
      writes.push(
        prisma.userChannelPreference.deleteMany({
          where: { userId: session.user.id, entityId },
        }),
      );
    }
    await Promise.all(writes);
  }

  revalidateTag(`user:${session.user.id}:recs`, "default");
  return NextResponse.json({ builderId, entityId, subscribed });
}
