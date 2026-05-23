import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ tokenId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tokenId } = await params;
  await prisma.agentToken.updateMany({
    where: {
      id: tokenId,
      userId: session.user.id,
    },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ tokenId, revoked: true });
}
