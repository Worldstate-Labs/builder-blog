import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownedBuilders = await prisma.builder.findMany({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  const ownedBuilderIds = ownedBuilders.map((builder) => builder.id);

  await prisma.$transaction([
    prisma.feedItem.deleteMany({
      where: { builderId: { in: ownedBuilderIds } },
    }),
    prisma.user.delete({
      where: { id: session.user.id },
    }),
  ]);

  return NextResponse.json({ status: "deleted" });
}
