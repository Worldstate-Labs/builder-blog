import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const sessionCookieNames = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export async function DELETE(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownedBuilders = await prisma.builder.findMany({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  const ownedBuilderIds = ownedBuilders.map((builder) => builder.id);

  await prisma.$transaction([
    prisma.feedItem.deleteMany({
      where: { builderId: { in: ownedBuilderIds } },
    }),
    prisma.user.delete({
      where: { id: session.user.id },
    }),
  ]);

  const response = NextResponse.json({ status: "deleted" });
  const requestCookieNames = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.split("=", 1)[0]?.trim())
    .filter((name): name is string => Boolean(name?.endsWith(".session-token")));

  for (const name of new Set([...sessionCookieNames, ...requestCookieNames])) {
    response.cookies.set({
      name,
      value: "",
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }

  return response;
}
