import { BuilderScope } from "@prisma/client";
import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ builderId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { builderId } = await params;
  await prisma.builder.deleteMany({
    where: {
      id: builderId,
      scope: BuilderScope.CENTRAL,
    },
  });

  return NextResponse.json({ builderId, removed: true });
}
