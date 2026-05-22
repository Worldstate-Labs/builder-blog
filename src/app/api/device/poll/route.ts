import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const device = await prisma.deviceLogin.findUnique({ where: { code } });
  if (!device || device.expiresAt < new Date()) {
    return NextResponse.json({ status: "expired" }, { status: 410 });
  }

  if (!device.approvedAt || !device.issuedToken) {
    return NextResponse.json({ status: "pending" });
  }

  const token = device.issuedToken;
  await prisma.deviceLogin.update({
    where: { code },
    data: { issuedToken: null },
  });

  return NextResponse.json({ status: "approved", token });
}
