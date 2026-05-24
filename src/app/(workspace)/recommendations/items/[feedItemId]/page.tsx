import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Clock3, ExternalLink } from "lucide-react";
import { SourceBadge } from "@/components/SourceBadge";
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

  const read = await prisma.feedRead.upsert({
    where: {
      userId_feedItemId: {
        userId: session.user.id,
        feedItemId: item.id,
      },
    },
    update: {
      source: "recommendation-detail",
      readAt: new Date(),
    },
    create: {
      userId: session.user.id,
      feedItemId: item.id,
      source: "recommendation-detail",
    },
  });

  const displayDate = item.publishedAt ?? item.createdAt;

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

        <article className="feed-card p-5 md:p-7">
          <div className="item-kicker">
            <SourceBadge
              builder={item.builder}
              sourceType={item.builder?.sourceType ?? null}
            />
            <span>{item.builder?.name ?? item.sourceName ?? "Unknown source"}</span>
            <span>{displayDate.toLocaleString()}</span>
            <span>{item.crawlingTool ?? "Legacy crawl/import"}</span>
          </div>
          <h1 className="mt-4 max-w-4xl text-2xl font-semibold leading-tight md:text-3xl">
            {item.title || firstLine(item.body)}
          </h1>
          <div className="mt-8 whitespace-pre-wrap text-base leading-8 text-[var(--muted-strong)]">
            {item.body}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              className="button-dark button-compact gap-2"
              href={item.url}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-4 w-4" />
              Open source
            </a>
            <Link className="button-light button-compact gap-2" href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
              Back to feed
            </Link>
          </div>
        </article>
    </div>
  );
}

function firstLine(body: string) {
  return body.split(/\r?\n/).find(Boolean)?.slice(0, 160) ?? "Untitled post";
}
