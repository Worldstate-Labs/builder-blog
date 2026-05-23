import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ builderId: string }> };

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

  const payload = await request.json().catch(() => null);
  const subscribed = Boolean(payload?.subscribed);

  if (subscribed) {
    await prisma.subscription.upsert({
      where: {
        userId_builderId: {
          userId: session.user.id,
          builderId,
        },
      },
      update: {},
      create: {
        userId: session.user.id,
        builderId,
      },
    });
  } else {
    await prisma.subscription.deleteMany({
      where: {
        userId: session.user.id,
        builderId,
      },
    });
  }

  return NextResponse.json({ builderId, subscribed });
}
