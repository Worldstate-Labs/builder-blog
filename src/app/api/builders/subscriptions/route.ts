import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const poolBuilderIds = await activePoolBuilderIds(session.user.id);
  if (poolBuilderIds.length > 0) {
    await prisma.subscription.createMany({
      data: poolBuilderIds.map((builderId) => ({
        userId: session.user.id,
        builderId,
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    subscribed: poolBuilderIds.length,
    builderIds: poolBuilderIds,
  });
}
