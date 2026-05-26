import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ tokenId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tokenId } = await params;
  const record = await prisma.agentToken.findUnique({
    where: { id: tokenId },
    select: { userId: true, tokenValue: true, revokedAt: true },
  });

  if (!record || record.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (record.revokedAt) {
    return NextResponse.json({ error: "Token revoked" }, { status: 410 });
  }
  if (!record.tokenValue) {
    return NextResponse.json({ error: "Token value not available" }, { status: 404 });
  }

  return NextResponse.json({ token: record.tokenValue });
}
