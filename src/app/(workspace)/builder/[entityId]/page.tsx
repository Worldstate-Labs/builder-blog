import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { fetchDedupedFeedForEntities, getReadEntityKeys } from "@/lib/builder-channel-resolver";
import { getEntityWithChannels } from "@/lib/builder-entities";
import { BuilderDetailActions } from "@/components/BuilderDetailActions";
import { ChannelPreferenceToggle } from "@/components/ChannelPreferenceToggle";
import { CountMeta } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { RecentPostsList } from "@/components/RecentPostsList";
import { SourceBadge } from "@/components/SourceBadge";
import { SourceAvatar } from "@/components/SourceAvatar";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ entityId: string }> };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type ChannelInfo = {
  builderId: string;
  libraryName: string;
  libraryId: string | null;
  isAdminCommunity: boolean;
  isOwnChannel: boolean;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  avatarUrl: string | null;
  handle: string | null;
  lastFetchedAt: Date | null;
  itemCount: number;
  status: string;
};

export default async function BuilderDetailPage({ params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const { entityId } = await params;
  const [entity, dedupedItemCount] = await Promise.all([
    getEntityWithChannels(entityId),
    countDedupedItemsForEntity(entityId),
  ]);
  if (!entity) notFound();

  const channels: ChannelInfo[] = entity.builders.map((channel) => {
    const ownerEmail = channel.owner?.email;
    const isAdmin = isAdminEmail(ownerEmail);
    const libraryName =
      channel.hubItems[0]?.hubEntry.name ??
      (isAdmin
        ? "Community library"
        : channel.owner?.name ?? channel.owner?.email ?? "Unknown");
    return {
      builderId: channel.id,
      libraryName,
      libraryId: channel.hubItems[0]?.hubEntry.id ?? null,
      isAdminCommunity: isAdmin,
      isOwnChannel: channel.ownerUserId === userId,
      sourceType: channel.sourceType,
      sourceUrl: channel.sourceUrl,
      fetchUrl: channel.fetchUrl,
      avatarUrl: channel.avatarUrl,
      handle: channel.handle,
      lastFetchedAt: channel.lastFetchedAt,
      itemCount: channel.itemCount,
      status: channel.status,
    };
  });

  // BuilderEntity is the canonical creator; it may have multiple
  // Builder rows (channels) — typically the user's own row + the
  // copy from any imported library pointing at the same source. The
  // header shows ONE representative view; pick the user's own
  // channel first (their authoritative copy), else the first
  // channel. Avatar, source URL, source type, handle, and the
  // channel-level itemCount all come from this primary channel so
  // we don't double-count duplicated copies across channels.
  const primaryChannel =
    channels.find((c) => c.isOwnChannel) ?? channels[0] ?? null;
  const headerAvatarUrl =
    primaryChannel?.avatarUrl ??
    channels.find((c) => c.avatarUrl)?.avatarUrl ??
    null;
  const headerSourceType = primaryChannel?.sourceType ?? null;
  const headerSourceUrl =
    primaryChannel?.sourceUrl ?? primaryChannel?.fetchUrl ?? null;
  // Match the count shown below the header: the RecentPostsList uses
  // fetchDedupedFeedForEntities, which collapses duplicate copies of
  // the same canonical post across channels. Reporting any single
  // channel's itemCount here would either over- or under-count
  // depending on which channel won.
  const headerItemCount = dedupedItemCount;
  const headerHostLabel = (() => {
    if (entity.handle) return `@${entity.handle}`;
    if (primaryChannel?.handle) return `@${primaryChannel.handle}`;
    if (!headerSourceUrl) return null;
    try {
      return new URL(headerSourceUrl).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();
  const lastFetchedMax = channels.reduce<Date | null>((max, c) => {
    if (!c.lastFetchedAt) return max;
    if (!max || c.lastFetchedAt > max) return c.lastFetchedAt;
    return max;
  }, null);

  // Every Builder (channel) of this entity that the user has access
  // to — used by the entity-level Follow button to compute "any
  // channel subscribed" and to fan out subscribe/unsubscribe across
  // them.
  const channelIds = channels.map((c) => c.builderId);

  return (
    <div className="page-pad">
      <PageHeader
        actions={
          <Suspense fallback={<BuilderActionsSkeleton />}>
            <BuilderDetailActionsSlot
              entityId={entityId}
              userId={userId}
              channelIds={channelIds}
            />
          </Suspense>
        }
        className="builder-detail-page-head"
        title={entity.name}
      >
        <div className="builder-detail-head-stack">
          <Link className="builder-detail-breadcrumb" href="/builders">
            <ChevronLeft aria-hidden="true" />
            Sources
          </Link>
          <div className="builder-detail-identity">
            <SourceAvatar
              className="builder-detail-avatar"
              imageSize={56}
              source={{
                avatarUrl: headerAvatarUrl,
                fetchUrl: primaryChannel?.fetchUrl ?? null,
                name: entity.name,
                sourceType: headerSourceType ?? "",
                sourceUrl: primaryChannel?.sourceUrl ?? null,
              }}
            />
            <div className="builder-detail-title-stack">
              <div className="builder-detail-title-row">
                <h1 className="fb-title">{entity.name}</h1>
                {headerSourceType ? (
                  <SourceBadge sourceType={headerSourceType} />
                ) : null}
              </div>
              <div className="fb-src-meta">
                {headerHostLabel ? (
                  <span className="builder-detail-host source-host-meta mono truncate">
                    {headerHostLabel}
                  </span>
                ) : null}
                {headerHostLabel ? (
                  <span className="source-count-dot source-meta-dot">·</span>
                ) : null}
                <span
                  className={
                    headerItemCount > 0
                      ? "source-count-meta"
                      : "source-count-meta source-count-meta-empty"
                  }
                >
                  <CountMeta label={headerItemCount === 1 ? "item" : "items"} value={headerItemCount} />
                </span>
                {lastFetchedMax ? (
                  <>
                    <span className="source-latest-dot source-meta-dot">·</span>
                    <span className="source-latest-meta">
                      Last summarized {dateFormatter.format(lastFetchedMax)}
                    </span>
                  </>
                ) : null}
                {headerSourceUrl ? (
                  <a
                    aria-label={`Open ${entity.name} on its source site`}
                    className="builder-library-open-source"
                    href={headerSourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    title="Open source"
                  >
                    <ExternalLink aria-hidden="true" />
                  </a>
                ) : null}
              </div>
              {entity.bio ? (
                <p className="builder-detail-bio fb-desc">{entity.bio}</p>
              ) : null}
            </div>
          </div>
        </div>
      </PageHeader>

      <div className="workspace-content-stack builder-detail-workspace">
        <section className="builder-detail-section">
          <h2 className="fb-section-title">Recent posts</h2>
          <Suspense fallback={<RecentPostsSkeleton />}>
            <RecentPostsSlot userId={userId} entityId={entityId} channels={channels} />
          </Suspense>
        </section>

        <details className="builder-detail-section builder-detail-channels">
          <summary className="builder-detail-channels-summary">
            <span>Libraries</span>
            <CountMeta label={channels.length === 1 ? "library" : "libraries"} value={channels.length} />
          </summary>
          <Suspense fallback={null}>
            <ChannelsListSlot
              entityId={entityId}
              userId={userId}
              channels={channels}
            />
          </Suspense>
        </details>
      </div>
    </div>
  );
}

/**
 * Count canonical (deduped) FeedItems linked to this BuilderEntity
 * across all its channels. Two FeedItems collapse into one when they
 * share (kind, externalId) — that's the same dedup key used by
 * fetchDedupedFeedForEntities for the post list below the header,
 * so the header's "N items" matches what the user actually sees.
 */
async function countDedupedItemsForEntity(entityId: string): Promise<number> {
  const distinct = await prisma.feedItem.findMany({
    where: { builder: { entityId } },
    distinct: ["kind", "externalId"],
    select: { id: true },
  });
  return distinct.length;
}

async function BuilderDetailActionsSlot({
  entityId,
  userId,
  channelIds,
}: {
  entityId: string;
  userId: string;
  channelIds: string[];
}) {
  // Follow state is "any channel of this entity is subscribed". Mirrors
  // the entity-level toggle semantics: a user who follows the creator
  // wants updates from any library that brings them in, so the toggle
  // stays on as long as at least one channel is subscribed.
  const subscribedCount =
    channelIds.length === 0
      ? 0
      : await prisma.subscription.count({
          where: { userId, builderId: { in: channelIds } },
        });
  return (
    <BuilderDetailActions
      entityId={entityId}
      initialSubscribed={subscribedCount > 0}
    />
  );
}

function BuilderActionsSkeleton() {
  return (
    <div className="builder-detail-actions-skeleton" aria-busy="true" aria-live="polite">
      <div className="builder-detail-action-skeleton-button" />
    </div>
  );
}

async function ChannelsListSlot({
  entityId,
  userId,
  channels,
}: {
  entityId: string;
  userId: string;
  channels: ChannelInfo[];
}) {
  const channelPref = await prisma.userChannelPreference.findUnique({
    where: { userId_entityId: { userId, entityId } },
    select: { primaryBuilderId: true, pinnedByUser: true },
  });
  const pinnedBuilderId = channelPref?.pinnedByUser
    ? channelPref.primaryBuilderId
    : null;

  return (
    <ul className="builder-detail-channel-list">
      {channels.map((channel) => (
        <li
          key={channel.builderId}
          className="builder-detail-channel-row"
        >
          <div>
            <div className="builder-detail-channel-name">
              {channel.libraryName}
              {channel.isAdminCommunity ? " · community" : ""}
              {channel.isOwnChannel ? " · own" : ""}
            </div>
            {channel.sourceUrl ? (
              <a
                className="builder-detail-channel-link"
                href={channel.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open source
              </a>
            ) : null}
          </div>
          <div className="builder-detail-channel-date mono">
            {channel.lastFetchedAt ? dateFormatter.format(channel.lastFetchedAt) : "—"}
          </div>
          <ChannelPreferenceToggle
            entityId={entityId}
            builderId={channel.builderId}
            initialIsPreferred={pinnedBuilderId === channel.builderId}
          />
        </li>
      ))}
    </ul>
  );
}

async function RecentPostsSlot({
  userId,
  entityId,
  channels,
}: {
  userId: string;
  entityId: string;
  channels: ChannelInfo[];
}) {
  const [items, readKeySet] = await Promise.all([
    fetchDedupedFeedForEntities({ userId, entityIds: [entityId], limit: 25 }),
    getReadEntityKeys(userId, [entityId]),
  ]);

  const channelMap = new Map(channels.map((c) => [c.builderId, c]));

  if (items.length === 0) {
    return (
      <EmptyState body="No posts summarized yet." />
    );
  }

  const listItems = items.map((item) => {
    const viaChannel = item.builderId ? channelMap.get(item.builderId) : null;
    const viaLabel = viaChannel
      ? `via ${viaChannel.libraryName}${viaChannel.isOwnChannel ? " · own" : viaChannel.isAdminCommunity ? " · community" : ""}`
      : null;
    return {
      id: item.id,
      readKey: `${item.entityId}:${item.kind}:${item.externalId}`,
      viaLabel,
      post: {
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
              name: item.builder.name,
              kind: item.builder.sourceType as "X" | "BLOG" | "PODCAST" | "WEBSITE",
              sourceType: item.builder.sourceType,
              sourceUrl: item.builder.sourceUrl,
              fetchUrl: item.builder.fetchUrl,
            }
          : null,
        alternateChannelCount: item.alternateChannelCount,
      },
    };
  });

  return (
    <RecentPostsList items={listItems} readKeys={[...readKeySet]} />
  );
}

function RecentPostsSkeleton() {
  return (
    <ul className="recent-post-list recent-post-list--skeleton" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((index) => (
        <li key={index} className="recent-post-skeleton-card fb-panel">
          <div className="recent-post-skeleton-line recent-post-skeleton-line--meta" />
          <div className="recent-post-skeleton-line recent-post-skeleton-line--title" />
          <div className="recent-post-skeleton-line" />
          <div className="recent-post-skeleton-line recent-post-skeleton-line--short" />
        </li>
      ))}
    </ul>
  );
}
