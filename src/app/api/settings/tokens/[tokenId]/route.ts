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
  // Hard-delete the token row. Any in-flight requests using this token
  // will get 401 because the bearer lookup will miss. Pending exchange
  // codes for this token cascade away via the FK.
  await prisma.agentToken.deleteMany({
    where: {
      id: tokenId,
      userId: session.user.id,
    },
  });

  return NextResponse.json({ tokenId, removed: true });
}
