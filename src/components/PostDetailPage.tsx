import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { PostFavoriteControl } from "@/components/PostFavoriteControl";
import { SourceBadge } from "@/components/SourceBadge";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { canFavoritePost } from "@/lib/feed-favorites";
import { normalizeLegacyReturnTo } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export async function PostDetailPage({
  feedItemId,
  searchParams,
}: {
  feedItemId: string;
  searchParams: Promise<{ returnLabel?: string | string[]; returnTo?: string | string[] }>;
}) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const backLink = resolvePostBackLink(await searchParams);
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
    poolBuilderIds.includes(item.builderId) ||
    hubItems.some((hubItem) => hubItem.builderId === item.builderId);
  if (!canRead) notFound();

  if (!item.builder?.entityId) notFound();
  const canFavorite = await canFavoritePost(session.user.id, item.id);
  const entityId = item.builder.entityId;
  const sourceLabel = item.builder?.name ?? item.sourceName ?? "Post";
  const sourceHref = `/builder/${entityId}`;
  const sourceBuilder = item.builder
    ? {
        kind: item.builder.kind,
        sourceType: item.builder.sourceType,
        sourceUrl: item.builder.sourceUrl,
        fetchUrl: item.builder.fetchUrl,
      }
    : null;
  const [existing, favorite] = await Promise.all([
    prisma.feedRead.findFirst({
      where: {
        userId: session.user.id,
        entityId,
        kind: item.kind,
        externalId: item.externalId,
      },
      select: { id: true },
    }),
    canFavorite
      ? prisma.feedFavorite.findUnique({
          where: {
            userId_entityId_kind_externalId: {
              userId: session.user.id,
              entityId,
              kind: item.kind,
              externalId: item.externalId,
            },
          },
          select: { id: true },
        })
      : null,
  ]);
  const readData = {
    userId: session.user.id,
    feedItemId: item.id,
    entityId,
    kind: item.kind,
    externalId: item.externalId,
    source: "post-detail",
    readAt: new Date(),
  };
  await (existing
    ? prisma.feedRead.update({ where: { id: existing.id }, data: readData })
    : prisma.feedRead.create({ data: readData }));

  return (
    <div className="page-pad page-pad--reading reading-page">
      <nav aria-label="Post navigation" className="reading-page-toolbar">
        <Link
          aria-label={`Back to ${backLink.label}`}
          className="fb-breadcrumb-link reading-back-link"
          href={backLink.href}
        >
          <ChevronLeft aria-hidden="true" />
          {backLink.label}
        </Link>
        <Link
          aria-label={`View ${sourceLabel} source profile`}
          className="reading-source-label"
          href={sourceHref}
        >
          <SourceBadge builder={sourceBuilder} />
          <span className="reading-source-kicker">Source</span>
          <span className="reading-source-copy">{sourceLabel}</span>
        </Link>
      </nav>

      <PostCard
        dataRead={true}
        extraActions={
          canFavorite ? (
            <PostFavoriteControl
              feedItemId={item.id}
              initialIsFavorite={Boolean(favorite)}
              targetLabel={item.title?.trim() || item.sourceName?.trim() || sourceLabel}
            />
          ) : undefined
        }
        post={{
          id: item.id,
          title: item.title,
          body: item.body,
          summary: item.summary,
          url: item.url,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          sourceName: item.sourceName,
          fetchTool: item.fetchTool,
          builder: item.builder
            ? {
                id: item.builder.id,
                entityId: item.builder.entityId,
                avatarUrl: item.builder.avatarUrl,
                avatarDataUrl: item.builder.avatarDataUrl,
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

function resolvePostBackLink(params: {
  returnLabel?: string | string[];
  returnTo?: string | string[];
}) {
  const returnTo = normalizeLegacyReturnTo(firstParam(params.returnTo));
  if (isSafeInternalReturnTo(returnTo)) {
    return {
      href: returnTo,
      label: safeReturnLabel(firstParam(params.returnLabel), returnTo),
    };
  }

  return { href: "/dashboard?tab=following", label: "Following" };
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isSafeInternalReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/api/");
}

function safeReturnLabel(value: string, returnTo: string) {
  switch (value) {
    case "AI Digest":
    case "Following":
    case "Favorites":
    case "Search":
    case "Search results":
    case "Sources":
    case "Hub":
      return value;
    case "Source":
      return "Sources";
    default:
      if (returnTo.startsWith("/builder/")) {
        const sourceLabel = cleanDynamicReturnLabel(value);
        if (sourceLabel) return sourceLabel;
      }
      return labelFromReturnTo(returnTo);
  }
}

function labelFromReturnTo(returnTo: string) {
  if (returnTo.startsWith("/search")) return "Search results";
  if (returnTo.startsWith("/builders") || returnTo.startsWith("/builder/")) return "Sources";
  if (returnTo.startsWith("/library-hub")) return "Hub";
  if (returnTo.startsWith("/dashboard")) {
    if (returnTo.includes("tab=favorites")) return "Favorites";
    return returnTo.includes("tab=following") ? "Following" : "AI Digest";
  }
  return "Back";
}

function cleanDynamicReturnLabel(value: string) {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80) return null;
  return label;
}
