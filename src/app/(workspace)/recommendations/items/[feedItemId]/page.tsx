import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Clock3 } from "lucide-react";
import { CrawledPostCard } from "@/components/CrawledPostCard";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";

export default async function RecommendationItemPage({
  params,
}: {
  params: Promise<{ feedItemId: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const { feedItemId } = await params;
  const item = await prisma.feedItem.findUnique({
    where: { id: feedItemId },
    include: { builder: true },
  });
  if (!item || !item.builderId) notFound();

  const [poolBuilderIds, hubItems] = await Promise.all([
    activePoolBuilderIds(session.user.id),
    prisma.libraryHubItem.findMany({
      where: { builderId: item.builderId },
      select: { builderId: true },
      take: 1,
    }),
  ]);
  const canRead =
    poolBuilderIds.includes(item.builderId) || hubItems.some((hubItem) => hubItem.builderId === item.builderId);
  if (!canRead) notFound();

  if (!item.builder?.entityId) notFound();
  const entityId = item.builder.entityId;
  const existing = await prisma.feedRead.findFirst({
    where: {
      userId: session.user.id,
      entityId,
      kind: item.kind,
      externalId: item.externalId,
    },
    select: { id: true },
  });
  const readData = {
    userId: session.user.id,
    feedItemId: item.id,
    entityId,
    kind: item.kind,
    externalId: item.externalId,
    source: "recommendation-detail",
    readAt: new Date(),
  };
  const read = existing
    ? await prisma.feedRead.update({ where: { id: existing.id }, data: readData })
    : await prisma.feedRead.create({ data: readData });

  return (
    <div className="page-pad">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link className="button-light button-compact gap-2" href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to feed
        </Link>
        <span className="status-chip">
          <Clock3 className="h-3.5 w-3.5" />
          Read {read.readAt.toLocaleString()}
        </span>
      </div>

      <CrawledPostCard
        extraActions={
          <Link className="button-light button-compact gap-2" href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
            Back to feed
          </Link>
        }
        post={{
          id: item.id,
          title: item.title,
          body: item.body,
          summary: null,
          url: item.url,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          sourceName: item.sourceName,
          crawlingTool: item.crawlingTool,
          builder: item.builder
            ? {
                id: item.builder.id,
                entityId: item.builder.entityId,
                name: item.builder.name,
                kind: item.builder.kind,
                sourceType: item.builder.sourceType,
                sourceUrl: item.builder.sourceUrl,
                crawlUrl: item.builder.crawlUrl,
              }
            : null,
        }}
        variant="detail"
      />
    </div>
  );
}
