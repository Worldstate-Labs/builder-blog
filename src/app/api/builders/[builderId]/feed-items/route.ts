import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ builderId: string }> };

const feedItemLimit = 8;

export async function GET(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { builderId } = await params;
  const poolBuilderIds = await activePoolBuilderIds(session.user.id);
  if (!poolBuilderIds.includes(builderId)) {
    return NextResponse.json({ error: "Builder is not in your library" }, { status: 404 });
  }

  const items = await prisma.feedItem.findMany({
    where: { builderId },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      kind: true,
      externalId: true,
      title: true,
      body: true,
      url: true,
      publishedAt: true,
      createdAt: true,
      sourceName: true,
      crawlingTool: true,
    },
    take: feedItemLimit,
  });

  return NextResponse.json({ items });
}
