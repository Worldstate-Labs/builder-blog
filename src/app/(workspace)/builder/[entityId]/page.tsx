import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { fetchDedupedFeedForEntities, getReadEntityKeys } from "@/lib/builder-channel-resolver";
import { getEntityWithChannels } from "@/lib/builder-entities";
import { BuilderDetailActions } from "@/components/BuilderDetailActions";
import { ChannelPreferenceToggle } from "@/components/ChannelPreferenceToggle";
import { RecentPostsList } from "@/components/RecentPostsList";
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
  isAdminCommunity: boolean;
  isOwnChannel: boolean;
  sourceUrl: string | null;
  crawlUrl: string | null;
  lastCrawledAt: Date | null;
  itemCount: number;
  status: string;
};

export default async function BuilderDetailPage({ params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const { entityId } = await params;
  const entity = await getEntityWithChannels(entityId);
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
      sourceUrl: channel.sourceUrl,
      crawlUrl: channel.crawlUrl,
      lastCrawledAt: channel.lastCrawledAt,
      itemCount: channel.itemCount,
      status: channel.status,
    };
  });

  const lastCrawledMax = channels.reduce<Date | null>((max, c) => {
    if (!c.lastCrawledAt) return max;
    if (!max || c.lastCrawledAt > max) return c.lastCrawledAt;
    return max;
  }, null);

  const handleDisplay = entity.handle ? `@${entity.handle}` : null;

  // Resolve target builderId server-side: own channel first, else first channel.
  const targetBuilderId =
    channels.find((c) => c.isOwnChannel)?.builderId ??
    channels[0]?.builderId ??
    null;

  return (
    <div className="page-pad">
      <header className="fb-page-head">
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-strong)]">
            {entity.kind.toLowerCase()}
          </div>
          <h1 className="fb-title font-display">{entity.name}</h1>
          {handleDisplay ? (
            <div className="font-mono text-sm text-[var(--muted-strong)]">{handleDisplay}</div>
          ) : null}
          {entity.bio ? <p className="fb-desc max-w-prose">{entity.bio}</p> : null}
          <div className="mt-3 grid gap-2">
            <Suspense fallback={<BuilderActionsSkeleton />}>
              <BuilderDetailActionsSlot
                entityId={entityId}
                userId={userId}
                targetBuilderId={targetBuilderId}
              />
            </Suspense>
            {lastCrawledMax ? (
              <div className="text-xs text-[var(--muted-strong)]">
                Last crawled {dateFormatter.format(lastCrawledMax)}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="mt-8 grid gap-6">
        <h2 className="fb-section-title">Recent posts</h2>
        <Suspense fallback={<RecentPostsSkeleton />}>
          <RecentPostsSlot userId={userId} entityId={entityId} channels={channels} />
        </Suspense>
      </section>

      <section className="mt-10 grid gap-3">
        <h2 className="fb-section-title">Channels providing this source</h2>
        <Suspense fallback={null}>
          <ChannelsListSlot
            entityId={entityId}
            userId={userId}
            channels={channels}
          />
        </Suspense>
      </section>
    </div>
  );
}

async function BuilderDetailActionsSlot({
  entityId,
  userId,
  targetBuilderId,
}: {
  entityId: string;
  userId: string;
  targetBuilderId: string | null;
}) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      builderId: targetBuilderId ?? undefined,
    },
    select: { builderId: true },
  });
  return (
    <BuilderDetailActions
      entityId={entityId}
      initialSubscribed={Boolean(subscription)}
      targetBuilderId={targetBuilderId}
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
    <ul className="grid gap-2">
      {channels.map((channel) => (
        <li
          key={channel.builderId}
          className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-[var(--line)] py-2 text-sm"
        >
          <div>
            <div className="font-medium">
              {channel.libraryName}
              {channel.isAdminCommunity ? " · community" : ""}
              {channel.isOwnChannel ? " · own" : ""}
            </div>
            {channel.sourceUrl ? (
              <div className="font-mono text-xs text-[var(--muted-strong)]">
                {channel.sourceUrl}
              </div>
            ) : null}
          </div>
          <div className="font-mono text-xs text-[var(--muted-strong)]">
            {channel.lastCrawledAt ? dateFormatter.format(channel.lastCrawledAt) : "—"}
          </div>
          <div className="font-mono text-xs text-[var(--muted-strong)]">
            {channel.status}
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
        No posts crawled yet.
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
        crawlingTool: item.crawlingTool,
        builder: item.builder
          ? {
              id: item.builder.id,
              entityId: item.builder.entityId,
              name: item.builder.name,
              kind: item.builder.sourceType as "X" | "BLOG" | "PODCAST" | "WEBSITE",
              sourceType: item.builder.sourceType,
              sourceUrl: item.builder.sourceUrl,
              crawlUrl: item.builder.crawlUrl,
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
