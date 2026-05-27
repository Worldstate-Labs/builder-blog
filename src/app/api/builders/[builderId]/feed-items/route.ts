import { NextResponse } from "next/server";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { getCurrentSession } from "@/lib/auth";
import { fetchDedupedFeedForEntities } from "@/lib/builder-channel-resolver";
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

  // Resolve to entity, then fetch the deduped feed across all channels of that entity.
  const builder = await prisma.builder.findUnique({
    where: { id: builderId },
    select: { entityId: true },
  });
  if (!builder?.entityId) {
    return NextResponse.json({ items: [] });
  }

  const items = await fetchDedupedFeedForEntities({
    userId: session.user.id,
    entityIds: [builder.entityId],
    limit: feedItemLimit,
  });

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      externalId: item.externalId,
      title: item.title,
      body: item.body,
      summary: item.summary,
      url: item.url,
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      sourceName: item.sourceName,
      fetchTool: item.fetchTool,
      alternateChannelCount: item.alternateChannelCount,
    })),
  });
}
