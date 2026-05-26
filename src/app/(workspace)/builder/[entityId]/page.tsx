import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { fetchDedupedFeedForEntities } from "@/lib/builder-channel-resolver";
import { getEntityWithChannels } from "@/lib/builder-entities";
import { BuilderDetailActions } from "@/components/BuilderDetailActions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ entityId: string }> };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function BuilderDetailPage({ params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const { entityId } = await params;
  const entity = await getEntityWithChannels(entityId);
  if (!entity) notFound();

  const channels = entity.builders.map((channel) => {
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
  const channelBuilderIds = entity.builders.map((b) => b.id);

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
                channelBuilderIds={channelBuilderIds}
                channels={channels.map((channel) => ({
                  builderId: channel.builderId,
                  libraryName: channel.libraryName,
                  isOwnChannel: channel.isOwnChannel,
                  isAdminCommunity: channel.isAdminCommunity,
                }))}
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
          <RecentPostsSlot userId={userId} entityId={entityId} />
        </Suspense>
      </section>

      <section className="mt-10 grid gap-3">
        <h2 className="fb-section-title">Channels providing this source</h2>
        <ul className="grid gap-2">
          {channels.map((channel) => (
            <li
              key={channel.builderId}
              className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 border-b border-[var(--line)] py-2 text-sm"
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
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

async function BuilderDetailActionsSlot({
  entityId,
  userId,
  channelBuilderIds,
  channels,
}: {
  entityId: string;
  userId: string;
  channelBuilderIds: string[];
  channels: Array<{
    builderId: string;
    libraryName: string;
    isOwnChannel: boolean;
    isAdminCommunity: boolean;
  }>;
}) {
  const [subscription, channelPref] = await Promise.all([
    prisma.subscription.findFirst({
      where: {
        userId,
        builderId: { in: channelBuilderIds },
      },
      select: { builderId: true },
    }),
    prisma.userChannelPreference.findUnique({
      where: { userId_entityId: { userId, entityId } },
      select: { primaryBuilderId: true, pinnedByUser: true },
    }),
  ]);
  const primaryBuilderId =
    channelPref?.primaryBuilderId ?? channels[0]?.builderId ?? null;
  return (
    <BuilderDetailActions
      entityId={entityId}
      initialSubscribed={Boolean(subscription)}
      initialPrimaryBuilderId={primaryBuilderId}
      channels={channels}
    />
  );
}

function BuilderActionsSkeleton() {
  return (
    <div className="flex gap-2" aria-busy="true" aria-live="polite">
      <div className="h-9 w-28 animate-pulse rounded-full bg-black/10" />
      <div className="h-9 w-32 animate-pulse rounded-full bg-black/10" />
    </div>
  );
}

async function RecentPostsSlot({
  userId,
  entityId,
}: {
  userId: string;
  entityId: string;
}) {
  const items = await fetchDedupedFeedForEntities({
    userId,
    entityIds: [entityId],
    limit: 25,
  });
  if (items.length === 0) {
    return (
      <div className="fb-panel dashed text-[var(--muted-strong)]">
        No posts crawled yet.
      </div>
    );
  }
  return (
    <ul className="grid gap-4">
      {items.map((item) => (
        <li key={item.id} className="fb-panel grid gap-2">
          <div className="text-xs text-[var(--muted-strong)] font-mono">
            {item.publishedAt
              ? dateFormatter.format(new Date(item.publishedAt))
              : "unknown date"}
            {item.alternateChannelCount > 0
              ? ` · +${item.alternateChannelCount} other channel${
                  item.alternateChannelCount === 1 ? "" : "s"
                }`
              : ""}
          </div>
          {item.title ? (
            <h3 className="font-display text-lg">{item.title}</h3>
          ) : null}
          <p className="text-sm leading-relaxed line-clamp-6">{item.body}</p>
          <a
            className="text-xs underline self-start"
            href={item.url}
            target="_blank"
            rel="noreferrer"
          >
            Read original
          </a>
        </li>
      ))}
    </ul>
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
