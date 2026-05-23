import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAgentToken } from "@/lib/tokens";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const code = String(payload?.code ?? "").trim().toUpperCase();
  const device = code ? await prisma.deviceLogin.findUnique({ where: { code } }) : null;

  if (!device || device.expiresAt < new Date()) {
    return NextResponse.json({ error: "Device code not found or expired" }, { status: 404 });
  }

  const { token, record } = await createAgentToken(session.user.id, "Terminal skill");
  await prisma.deviceLogin.update({
    where: { code },
    data: {
      userId: session.user.id,
      agentTokenId: record.id,
      issuedToken: token,
      approvedAt: new Date(),
    },
  });

  return NextResponse.json({ status: "approved" });
}
