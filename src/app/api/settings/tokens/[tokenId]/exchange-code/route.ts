import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ tokenId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tokenId } = await params;

  const token = await prisma.agentToken.findUnique({
    where: { id: tokenId },
    select: { userId: true, revokedAt: true },
  });

  // Uniform failure for not-found / not-owned / revoked — mirrors
  // /api/skill/exchange so the endpoint can't distinguish those states. (Impact
  // is small here since it only operates on the caller's own tokens, but it
  // keeps the error contract consistent.)
  if (!token || token.userId !== session.user.id || token.revokedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const code = `bb_ec_${randomBytes(16).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const record = await prisma.exchangeCode.create({
    data: { code, agentTokenId: tokenId, expiresAt },
    select: { code: true, expiresAt: true },
  });

  return NextResponse.json({ code: record.code, expiresAt: record.expiresAt.toISOString() });
}
