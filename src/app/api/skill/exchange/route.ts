import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("code" in body) || typeof (body as Record<string, unknown>).code !== "string") {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const code = (body as { code: string }).code.trim();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const record = await prisma.exchangeCode.findUnique({
    where: { code },
    include: {
      agentToken: {
        include: { user: { select: { id: true, email: true } } },
      },
    },
  });

  if (!record) {
    return NextResponse.json({ error: "Exchange code not found" }, { status: 404 });
  }

  if (record.usedAt || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "Exchange code expired or already used" }, { status: 410 });
  }

  await prisma.exchangeCode.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  const origin = new URL(request.url).origin;

  return NextResponse.json({
    token: record.agentToken.tokenValue,
    email: record.agentToken.user.email,
    userId: record.agentToken.user.id,
    appUrl: origin,
  });
}
