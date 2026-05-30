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
  // Soft-delete: stamp `revokedAt` instead of dropping the row. The bearer
  // lookup rejects any token whose `revokedAt` is set (src/lib/tokens.ts:54),
  // so access stops immediately, while the row persists for the audit trail and
  // the "Revoked [date]" status the UI renders. Idempotent (only flips a token
  // that's still active and owned by this user).
  await prisma.agentToken.updateMany({
    where: {
      id: tokenId,
      userId: session.user.id,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ tokenId, revoked: true });
}
