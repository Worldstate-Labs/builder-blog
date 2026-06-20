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
  const hasAccess = await canReadBuilderFeedItems({
    builderId,
    userId: session.user.id,
  });
  if (!hasAccess) {
    return NextResponse.json({ error: "Source is not in your source library." }, { status: 404 });
  }

  // Resolve to entity, then fetch the deduped feed across all channels of that entity.
  const builder = await prisma.builder.findUnique({
    where: { id: builderId },
    select: { entityId: true },
  });
  if (!builder?.entityId) {
    return NextResponse.json({ items: [] });
  }

  try {
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
  } catch (error) {
    // Without this, every prisma/dedup hiccup surfaces as a bare 500
    // and the client only sees "Could not load summarized posts" with
    // no way to triage. Logging the builder + entity pair makes the
    // failure findable in server logs without leaking internals to
    // the response.
    console.error("feed-items query failed", {
      builderId,
      entityId: builder.entityId,
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Could not load summarized posts.", code: "fetch_failed" },
      { status: 500 },
    );
  }
}

async function canReadBuilderFeedItems({
  builderId,
  userId,
}: {
  builderId: string;
  userId: string;
}) {
  const poolBuilderIds = await activePoolBuilderIds(userId);
  if (poolBuilderIds.includes(builderId)) return true;

  const hubItem = await prisma.libraryHubItem.findFirst({
    where: { builderId },
    select: { builderId: true },
  });
  return Boolean(hubItem);
}
