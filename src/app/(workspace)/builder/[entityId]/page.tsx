import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { fetchDedupedFeedForEntities, getReadEntityKeys } from "@/lib/builder-channel-resolver";
import { getEntityWithChannels } from "@/lib/builder-entities";
import { BuilderDetailActions } from "@/components/BuilderDetailActions";
import { ChannelPreferenceToggle } from "@/components/ChannelPreferenceToggle";
import { RecentPostsList } from "@/components/RecentPostsList";
import { SourceBadge } from "@/components/SourceBadge";
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
  const headerMonogram = (() => {
    const cleaned = entity.name.replace(/^@+/, "").trim();
    return (cleaned.charAt(0) || entity.name.charAt(0) || "?").toUpperCase();
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
      <header className="fb-page-head">
        <div className="grid gap-3">
          <Link className="fb-btn light compact w-fit" href="/builders">
            Back to Sources
          </Link>
          <div className="flex items-start gap-4">
            {headerAvatarUrl ? (
              <span
                className="fb-src-icon"
                style={{
                  height: "3.5rem",
                  width: "3.5rem",
                  overflow: "hidden",
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  src={headerAvatarUrl}
                  style={{
                    height: "100%",
                    width: "100%",
                    objectFit: "cover",
                  }}
                />
              </span>
            ) : (
              <span
                className="fb-src-icon"
                style={{
                  height: "3.5rem",
                  width: "3.5rem",
                  fontSize: "1.5rem",
                  flexShrink: 0,
                }}
              >
                {headerMonogram}
              </span>
            )}
            <div className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="fb-title font-display">{entity.name}</h1>
                {headerSourceType ? (
                  <SourceBadge sourceType={headerSourceType} />
                ) : null}
              </div>
              <div className="fb-src-meta">
                <span className="source-kind-meta fb-kind-pill">
                  {entity.kind.toLowerCase()}
                </span>
                {headerHostLabel ? (
                  <span className="source-host-meta mono truncate max-w-[24rem]">
                    {headerHostLabel}
                  </span>
                ) : null}
                <span className="source-count-dot source-meta-dot">·</span>
                <span
                  className={
                    headerItemCount > 0
                      ? "source-count-meta"
                      : "source-count-meta source-count-meta-empty"
                  }
                >
                  {headerItemCount} items
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
                <p className="fb-desc mt-1 max-w-prose">{entity.bio}</p>
              ) : null}
            </div>
          </div>
          <Suspense fallback={<BuilderActionsSkeleton />}>
            <BuilderDetailActionsSlot
              entityId={entityId}
              userId={userId}
              channelIds={channelIds}
            />
          </Suspense>
        </div>
      </header>

      <section className="mt-8 grid gap-6">
        <h2 className="fb-section-title">Recent posts</h2>
        <Suspense fallback={<RecentPostsSkeleton />}>
          <RecentPostsSlot userId={userId} entityId={entityId} channels={channels} />
        </Suspense>
      </section>

      <details className="fb-panel dashed mt-10">
        <summary className="cursor-pointer text-sm font-bold text-[var(--ink)]">
          Available through {channels.length} {channels.length === 1 ? "library" : "libraries"}
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
    <div className="flex gap-2" aria-busy="true" aria-live="polite">
      <div className="h-9 w-28 animate-pulse rounded-full bg-black/10" />
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
    <ul className="mt-3 grid gap-2">
      {channels.map((channel) => (
        <li
          key={channel.builderId}
          className="grid gap-3 border-b border-[var(--line)] py-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center"
        >
          <div>
            <div className="font-medium">
              {channel.libraryName}
              {channel.isAdminCommunity ? " · community" : ""}
              {channel.isOwnChannel ? " · own" : ""}
            </div>
            {channel.sourceUrl ? (
              <a
                className="text-xs font-semibold text-[var(--accent)] hover:underline"
                href={channel.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open source
              </a>
            ) : null}
          </div>
          <div className="font-mono text-xs text-[var(--muted-strong)]">
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
      <div className="fb-panel dashed text-[var(--muted-strong)]">
        No posts summarized yet.
      </div>
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
    <ul className="grid gap-4" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((index) => (
        <li key={index} className="fb-panel grid gap-2">
          <div className="h-3 w-24 animate-pulse rounded bg-black/10" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-black/10" />
          <div className="h-3 w-full animate-pulse rounded bg-black/10" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-black/10" />
        </li>
      ))}
    </ul>
  );
}
