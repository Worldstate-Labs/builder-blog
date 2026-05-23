import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { createAgentToken } from "@/lib/tokens";

export async function POST() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token, record } = await createAgentToken(session.user.id, "Manual web token");

  return NextResponse.json({
    token,
    record: {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt.toISOString(),
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
    },
  });
}
