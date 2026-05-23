import { BuilderKind, BuilderScope } from "@prisma/client";
import { redirect } from "next/navigation";
import { Suspense, type ComponentType, type ReactNode } from "react";
import { Bell, BellOff, ListPlus, Plus, Trash2, UsersRound } from "lucide-react";
import {
  addBuilderToLibraryAction,
  removeBuilderFromLibraryAction,
  subscribeAllLibraryBuildersAction,
  subscribeBuilderAction,
  unsubscribeBuilderAction,
} from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { FeedCard } from "@/components/FeedCard";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { getCurrentSession } from "@/lib/auth";
import { ensureDefaultBuilderPool } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";
import { builderSourceLabel } from "@/lib/source-registry";

type BuilderWithCount = {
  id: string;
  scope: BuilderScope;
  kind: BuilderKind;
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  crawlUrl: string | null;
  canonicalKey: string;
  _count: { feedItems: number };
};

export default async function BuildersPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  await ensureDefaultBuilderPool(session.user.id);

  const [poolEntries, subscriptions, removedCentralBuilders] = await Promise.all([
    prisma.builderPoolEntry.findMany({
      where: { userId: session.user.id, removedAt: null },
      include: {
        builder: {
          include: { _count: { select: { feedItems: true } } },
        },
      },
    }),
    prisma.subscription.findMany({
      where: { userId: session.user.id },
      select: { builderId: true },
    }),
    prisma.builder.findMany({
      where: {
        scope: BuilderScope.CENTRAL,
        poolEntries: {
          some: {
            userId: session.user.id,
            removedAt: { not: null },
          },
        },
      },
      include: { _count: { select: { feedItems: true } } },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
  ]);

  const subscribed = new Set(subscriptions.map((subscription) => subscription.builderId));
  const poolBuilders = poolEntries
    .map((entry) => entry.builder)
    .sort(builderSort);
  const poolBuilderIds = poolBuilders.map((builder) => builder.id);
  const centralBuilders = poolBuilders.filter((builder) => builder.scope === BuilderScope.CENTRAL);
  const personalBuilders = poolBuilders.filter((builder) => builder.scope === BuilderScope.PERSONAL);
  const subscribedCount = poolBuilders.filter((builder) => subscribed.has(builder.id)).length;
  const crawledItems = poolBuilders.reduce(
    (count, builder) => count + builder._count.feedItems,
    0,
  );

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_24rem]">
          <div>
            <p className="section-label">Library</p>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
              Builder pool
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              In library means available to you. Subscribed means included in
              your periodic digest. Central builders are crawled by the web app;
              personal builders are synced by your own agent.
            </p>
          </div>
          <div className="stats-panel">
            <Stat icon={UsersRound} label="In library" value={poolBuilders.length} />
            <Stat icon={Bell} label="Subscribed" value={subscribedCount} />
            <Stat icon={ListPlus} label="Crawled items" value={crawledItems} />
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-3xl">Digest subscription</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
                Toggle Subscribe on any builder in your pool. The digest skill
                only receives subscribed builders and their feed items.
              </p>
            </div>
            <form action={subscribeAllLibraryBuildersAction}>
              <FormSubmitButton className="button-dark gap-2" pendingLabel="Subscribing...">
                <Bell className="h-4 w-4" />
                Subscribe all in library
              </FormSubmitButton>
            </form>
          </div>
        </section>

        <section className="mt-10 grid gap-8">
          <LibrarySection
            title="Central library"
            detail="Default pool, crawled once by Builder Blog"
            scope={BuilderScope.CENTRAL}
          >
            {centralBuilders.map((builder) => (
              <BuilderCard
                key={builder.id}
                builder={builder}
                subscribed={subscribed.has(builder.id)}
                crawlLabel="Webapp crawled"
              />
            ))}
          </LibrarySection>

          <LibrarySection
            title="Personal library"
            detail="Synced by your agent with your own API keys or subscriptions"
            scope={BuilderScope.PERSONAL}
          >
            {personalBuilders.map((builder) => (
              <BuilderCard
                key={builder.id}
                builder={builder}
                subscribed={subscribed.has(builder.id)}
                crawlLabel="Agent synced"
              />
            ))}
            {personalBuilders.length === 0 ? (
              <div className="builder-row text-[var(--muted-strong)]">
                No personal builders yet. Use the skill command
                <code className="mx-2 rounded-xl bg-black/5 px-2 py-1">sync-builders</code>
                after your agent crawls private or user-paid sources.
              </div>
            ) : null}
          </LibrarySection>

          {removedCentralBuilders.length > 0 ? (
            <LibrarySection
              title="Available central builders"
              detail="Removed from your pool; add back any time"
              scope={BuilderScope.CENTRAL}
            >
              {removedCentralBuilders.map((builder) => (
                <article id={builder.id} key={builder.id} className="builder-row">
                  <BuilderInfo builder={builder} status="Available" crawlLabel="Webapp crawled" />
                  <form action={addBuilderToLibraryAction}>
                    <input type="hidden" name="builderId" value={builder.id} />
                    <FormSubmitButton className="button-dark gap-2" pendingLabel="Adding...">
                      <Plus className="h-4 w-4" />
                      Add to library
                    </FormSubmitButton>
                  </form>
                </article>
              ))}
            </LibrarySection>
          ) : null}
        </section>

        <Suspense fallback={<RecentCrawledContentFallback crawledItems={crawledItems} />}>
          <RecentCrawledContent
            crawledItems={crawledItems}
            poolBuilderIds={poolBuilderIds}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function RecentCrawledContent({
  crawledItems,
  poolBuilderIds,
}: {
  crawledItems: number;
  poolBuilderIds: string[];
}) {
  const recentFeedItems = await prisma.feedItem.findMany({
    where: { builderId: { in: poolBuilderIds } },
    include: { builder: true },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 40,
  });

  return (
    <section className="mt-12">
      <RecentCrawledContentHeader count={recentFeedItems.length} crawledItems={crawledItems} />
      <div className="item-list mt-5">
        {recentFeedItems.map((item) => (
          <FeedCard
            key={item.id}
            title={item.title}
            source={item.builder?.name ?? item.sourceName}
            body={item.body}
            url={item.url}
            date={item.publishedAt ?? item.createdAt}
          />
        ))}
        {recentFeedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--line)] p-6 text-[var(--muted-strong)] md:p-10">
            No crawled content yet. Run the crawler or sync personal builder
            items from the terminal skill.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RecentCrawledContentFallback({ crawledItems }: { crawledItems: number }) {
  return (
    <section className="mt-12" aria-live="polite" aria-busy="true">
      <RecentCrawledContentHeader count={0} crawledItems={crawledItems} loading />
      <div className="item-list mt-5">
        <div className="h-24 rounded-lg bg-black/10" />
        <div className="h-24 rounded-lg bg-black/10" />
        <div className="h-24 rounded-lg bg-black/10" />
      </div>
    </section>
  );
}

function RecentCrawledContentHeader({
  count,
  crawledItems,
  loading = false,
}: {
  count: number;
  crawledItems: number;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="section-label">Crawled content</p>
        <h2 className="mt-2 font-serif text-4xl">Recent crawled content</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
          Raw source items for builders in your active library. Today and
          History stay focused on generated digest feed entries.
        </p>
      </div>
      <span className="rounded-full border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2 text-sm text-[var(--muted-strong)]">
        {loading ? "Loading latest" : `Latest ${count}`} of {crawledItems}
      </span>
    </div>
  );
}

function BuilderCard({
  builder,
  subscribed,
  crawlLabel,
}: {
  builder: BuilderWithCount;
  subscribed: boolean;
  crawlLabel: string;
}) {
  return (
    <article id={builder.id} className="builder-row">
      <BuilderInfo
        builder={builder}
        status={subscribed ? "Subscribed" : "In library"}
        crawlLabel={crawlLabel}
      />
      <div className="flex flex-wrap gap-2">
        <form action={subscribed ? unsubscribeBuilderAction : subscribeBuilderAction}>
          <input type="hidden" name="builderId" value={builder.id} />
          <FormSubmitButton
            className={`${subscribed ? "button-light" : "button-dark"} gap-2`}
            pendingLabel={subscribed ? "Updating..." : "Subscribing..."}
          >
            {subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            {subscribed ? "Unsubscribe" : "Subscribe"}
          </FormSubmitButton>
        </form>
        <form action={removeBuilderFromLibraryAction}>
          <input type="hidden" name="builderId" value={builder.id} />
          <FormSubmitButton className="button-light gap-2" pendingLabel="Removing...">
            <Trash2 className="h-4 w-4" />
            Remove from library
          </FormSubmitButton>
        </form>
      </div>
    </article>
  );
}

function BuilderInfo({
  builder,
  status,
  crawlLabel,
}: {
  builder: BuilderWithCount;
  status: string;
  crawlLabel: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-2xl">{builder.name}</h3>
        <span className="kind-pill">{builderSourceLabel(builder)}</span>
        <span className="sub-pill">{status}</span>
      </div>
      <p className="mt-2 truncate text-sm text-[var(--muted)]">
        {builder.handle ? `@${builder.handle}` : builder.sourceUrl}
      </p>
      <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
        {crawlLabel} · {builder._count.feedItems} items
      </p>
      <details className="inline-disclosure">
        <summary>Source details</summary>
        <div className="mt-2 grid gap-1 text-xs text-[var(--muted)]">
          <p className="break-all font-mono">{builder.canonicalKey}</p>
          <p className="break-all">{builder.crawlUrl ?? builder.sourceUrl ?? "No crawl URL"}</p>
        </div>
      </details>
    </div>
  );
}

function LibrarySection({
  title,
  detail,
  scope,
  children,
}: {
  title: string;
  detail: string;
  scope: BuilderScope;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-4xl">{title}</h2>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">{detail}</p>
        </div>
        <span className="kind-pill">{scope.toLowerCase()}</span>
      </div>
      {children}
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="stat-card">
      <Icon className="stat-card-icon" />
      <div className="min-w-0">
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  );
}

function builderSort(a: BuilderWithCount, b: BuilderWithCount) {
  return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
}
