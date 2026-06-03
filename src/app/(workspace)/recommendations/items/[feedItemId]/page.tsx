import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PostCard } from "@/components/PostCard";
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
  await (existing
    ? prisma.feedRead.update({ where: { id: existing.id }, data: readData })
    : prisma.feedRead.create({ data: readData }));

  return (
    <div className="page-pad reading-page">
      <div className="reading-page-nav">
        <Link className="button-light button-compact reading-back-link" href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to feed
        </Link>
      </div>

      <PostCard
        dataRead={true}
        post={{
          id: item.id,
          title: item.title,
          body: item.body,
          summary: null,
          url: item.url,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          sourceName: item.sourceName,
          fetchTool: item.fetchTool,
          builder: item.builder
            ? {
                id: item.builder.id,
                entityId: item.builder.entityId,
                name: item.builder.name,
                kind: item.builder.kind,
                sourceType: item.builder.sourceType,
                sourceUrl: item.builder.sourceUrl,
                fetchUrl: item.builder.fetchUrl,
              }
            : null,
        }}
        showDebugActions={false}
        variant="detail"
      />
    </div>
  );
}
