import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { createAgentToken } from "@/lib/tokens";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let name = "Manual web token";
  try {
    const body = await request.json().catch(() => null);
    if (body?.name && typeof body.name === "string" && body.name.trim()) {
      name = body.name.trim();
    }
  } catch {
    // use default name
  }

  const { token, record } = await createAgentToken(session.user.id, name);

  return NextResponse.json({
    token,
    record: {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt.toISOString(),
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
      lastIp: record.lastIp ?? null,
      lastUserAgent: record.lastUserAgent ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
    },
  });
}
