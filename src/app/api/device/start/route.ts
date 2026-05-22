import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newDeviceCode } from "@/lib/tokens";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const appName = typeof body.appName === "string" ? body.appName : "Agent CLI";
  let code = newDeviceCode();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await prisma.deviceLogin.findUnique({ where: { code } });
    if (!existing) break;
    code = newDeviceCode();
  }

  const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  await prisma.deviceLogin.create({
    data: {
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return NextResponse.json({
    code,
    appName,
    verificationUrl: `${baseUrl}/device?code=${encodeURIComponent(code)}`,
    expiresInSeconds: 600,
  });
}
