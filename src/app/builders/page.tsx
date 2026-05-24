import { BuilderKind, BuilderPoolOrigin, BuilderScope, LibraryHubKind } from "@prisma/client";
import { redirect } from "next/navigation";
import { Suspense, type ComponentType, type ReactNode } from "react";
import { Bell, ListPlus, UsersRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  BuilderLibraryActions,
  SubscribeAllLibraryBuildersButton,
} from "@/components/BuilderLibraryActions";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import { FeedCard } from "@/components/FeedCard";
import { LibraryVisibilityToggle } from "@/components/LibraryVisibilityToggle";
import { SourceBadge } from "@/components/SourceBadge";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type BuilderWithCount = {
  id: string;
  scope: BuilderScope;
  ownerUserId: string | null;
  kind: BuilderKind;
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  crawlUrl: string | null;
  canonicalKey: string;
  _count: { feedItems: number };
};

type LatestPostCreatedAtByBuilderId = Map<string, Date | null>;

export default async function BuildersPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const [poolEntries, subscriptions, importedLibraries, ownSharedLibrary] = await Promise.all([
    prisma.builderPoolEntry.findMany({
      where: { userId: session.user.id, removedAt: null },
      include: {
        builder: {
          include: {
            _count: { select: { feedItems: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.subscription.findMany({
      where: { userId: session.user.id },
      select: { builderId: true },
    }),
    prisma.libraryImport.findMany({
      where: { userId: session.user.id },
      include: {
        hubEntry: {
          include: {
            owner: { select: { name: true, email: true } },
            items: {
              include: {
                builder: {
                  include: {
                    _count: { select: { feedItems: true } },
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.libraryHubEntry.findFirst({
      where: { ownerUserId: session.user.id, kind: LibraryHubKind.PERSONAL },
      select: { id: true },
    }),
  ]);

  const subscribed = new Set(subscriptions.map((subscription) => subscription.builderId));
  const activeEntryByBuilderId = new Map(poolEntries.map((entry) => [entry.builderId, entry]));
  const poolBuilders = poolEntries.map((entry) => entry.builder).sort(builderSort);
  const poolBuilderIds = poolBuilders.map((builder) => builder.id);
  const privateBuilders = poolEntries
    .filter(
      (entry) =>
        entry.origin === BuilderPoolOrigin.PERSONAL_SYNC &&
        entry.builder.scope === BuilderScope.PERSONAL &&
        entry.builder.ownerUserId === session.user.id,
    )
    .map((entry) => entry.builder)
    .sort(builderSort);
  const importedLibrarySections = importedLibraries.map((libraryImport) => ({
    id: libraryImport.hubEntryId,
    name: libraryImport.hubEntry.name,
    description: libraryImport.hubEntry.description,
    ownerName:
      libraryImport.hubEntry.owner?.name ||
      libraryImport.hubEntry.owner?.email ||
      "Builder Blog",
    builders: libraryImport.hubEntry.items
      .flatMap((item) => {
        const entry = activeEntryByBuilderId.get(item.builderId);
        return entry ? [entry.builder] : [];
      })
      .sort(builderSort),
  }));
  const subscribedCount = poolBuilders.filter((builder) => subscribed.has(builder.id)).length;
  const crawledItems = poolBuilders.reduce(
    (count, builder) => count + builder._count.feedItems,
    0,
  );
  const latestPostCreatedAtByBuilderId = await latestPostCreationTimes(poolBuilderIds);

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_24rem]">
          <div>
            <div className="page-kicker-row">
              <p className="section-label">Library</p>
              <span className="status-chip">
                <Bell className="h-3.5 w-3.5" />
                {subscribedCount} subscribed
              </span>
            </div>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
              Builder pool
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              In library means available to you. Subscribed means included in
              your periodic digest. Private builders are synced by your own
              agent; imported libraries come from the Hub.
            </p>
          </div>
          <div className="stats-panel">
            <Stat icon={UsersRound} label="In library" value={poolBuilders.length} />
            <Stat icon={Bell} label="Subscribed" value={subscribedCount} />
            <Stat icon={ListPlus} label="Crawled items" value={crawledItems} />
          </div>
        </section>

        <section className="action-panel mt-8 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-3xl">Digest subscription</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
                Toggle Subscribe on any builder in your pool. The digest skill
                only receives subscribed builders and their feed items.
              </p>
            </div>
            <SubscribeAllLibraryBuildersButton />
          </div>
        </section>

        <section className="mt-10 grid gap-8">
          <LibrarySection
            title="Private library"
            detail="Synced by your agent with your own API keys or subscriptions"
            badge="private"
            count={privateBuilders.length}
            defaultOpen
          >
            <LibraryVisibilityToggle
              disabled={privateBuilders.length === 0}
              initialIsPublic={Boolean(ownSharedLibrary)}
              name={`${session.user.name || session.user.email || "Personal"} library`}
            />
            {privateBuilders.map((builder) => (
              <BuilderCard
                key={builder.id}
                builder={builder}
                latestPostCreatedAt={latestPostCreatedAtByBuilderId.get(builder.id) ?? null}
                subscribed={subscribed.has(builder.id)}
                crawlLabel="Agent synced"
              />
            ))}
            {privateBuilders.length === 0 ? (
              <div className="empty-panel text-[var(--muted-strong)]">
                <h3 className="font-serif text-2xl text-[var(--ink)]">No personal builders yet</h3>
                <p className="mt-2 text-sm leading-6">
                  Use the skill command{" "}
                  <code className="rounded-lg bg-black/5 px-2 py-1">sync-builders</code>{" "}
                  after your agent crawls private or user-paid sources.
                </p>
              </div>
            ) : null}
          </LibrarySection>

          <section className="grid gap-3">
            <div>
              <h2 className="font-serif text-4xl">Imported libraries</h2>
              <p className="mt-1 text-sm text-[var(--muted-strong)]">
                Libraries imported from the hub are tucked under their source library.
              </p>
            </div>
            <div className="imported-library-stack">
              {importedLibrarySections.map((library) => (
                <LibrarySection
                  key={library.id}
                  title={library.name}
                  detail={library.description || `Imported from ${library.ownerName}`}
                  badge="imported"
                  count={library.builders.length}
                  indented
                >
                  {library.builders.map((builder) => (
                    <BuilderCard
                      allowRemove={false}
                      key={builder.id}
                      builder={builder}
                      latestPostCreatedAt={latestPostCreatedAtByBuilderId.get(builder.id) ?? null}
                      subscribed={subscribed.has(builder.id)}
                      crawlLabel={
                        builder.scope === BuilderScope.CENTRAL ? "Webapp crawled" : "Hub imported"
                      }
                    />
                  ))}
                  {library.builders.length === 0 ? (
                    <div className="empty-panel text-[var(--muted-strong)]">
                      No active builders from this imported library.
                    </div>
                  ) : null}
                </LibrarySection>
              ))}
              {importedLibrarySections.length === 0 ? (
                <div className="empty-panel text-[var(--muted-strong)]">
                  Import shared libraries from the Hub to see them here.
                </div>
              ) : null}
            </div>
          </section>
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
            sourceType={item.builder?.sourceType}
            body={item.body}
            url={item.url}
            date={item.publishedAt ?? item.createdAt}
            crawlingTool={item.crawlingTool}
          />
        ))}
        {recentFeedItems.length === 0 ? (
          <div className="empty-panel border-dashed text-[var(--muted-strong)] md:p-10">
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
  allowRemove = true,
  builder,
  latestPostCreatedAt,
  subscribed,
  crawlLabel,
  status,
  action,
}: {
  allowRemove?: boolean;
  builder: BuilderWithCount;
  latestPostCreatedAt: Date | null;
  subscribed: boolean;
  crawlLabel: string;
  status?: string;
  action?: ReactNode;
}) {
  return (
    <article id={builder.id} className="builder-card">
      <div className="builder-row">
        <BuilderInfo
          builder={builder}
          latestPostCreatedAt={latestPostCreatedAt}
          status={status ?? (subscribed ? "Subscribed" : "In library")}
          crawlLabel={crawlLabel}
        />
        <div className="row-actions">
          {action ?? (
            <BuilderLibraryActions
              allowRemove={allowRemove}
              builderId={builder.id}
              initialSubscribed={subscribed}
            />
          )}
        </div>
      </div>
      <BuilderFeedItems builder={builder} builderId={builder.id} totalCount={builder._count.feedItems} />
    </article>
  );
}

function BuilderInfo({
  builder,
  latestPostCreatedAt,
  status,
  crawlLabel,
}: {
  builder: BuilderWithCount;
  latestPostCreatedAt: Date | null;
  status: string;
  crawlLabel: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-2xl">{builder.name}</h3>
        <SourceBadge builder={builder} />
        <span className="sub-pill">{status}</span>
      </div>
      <p className="mt-2 truncate text-sm text-[var(--muted)]">
        {builder.handle ? `@${builder.handle}` : builder.sourceUrl}
      </p>
      <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
        {crawlLabel} · {builder._count.feedItems} items
      </p>
      <p className="mt-1 text-xs text-[var(--muted-strong)]">
        Latest post created{" "}
        {latestPostCreatedAt ? latestPostCreatedAt.toLocaleString() : "not available"}
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
  badge,
  count,
  defaultOpen = false,
  indented = false,
  children,
}: {
  title: string;
  detail: string;
  badge: string;
  count: number;
  defaultOpen?: boolean;
  indented?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className={`library-section-panel${indented ? " library-section-panel-indented" : ""}`}
      open={defaultOpen}
    >
      <summary className="library-section-summary">
        <div>
          <h2 className="font-serif text-3xl">{title}</h2>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">{detail}</p>
        </div>
        <div className="library-section-meta">
          <span className="kind-pill">{badge}</span>
          <span className="sub-pill">{count} builders</span>
        </div>
      </summary>
      <div className="library-section-body">{children}</div>
    </details>
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

async function latestPostCreationTimes(builderIds: string[]): Promise<LatestPostCreatedAtByBuilderId> {
  if (builderIds.length === 0) return new Map();
  const rows = await prisma.feedItem.groupBy({
    by: ["builderId"],
    where: {
      builderId: { in: builderIds },
      publishedAt: { not: null },
    },
    _max: { publishedAt: true },
  });

  return new Map(rows.flatMap((row) => (row.builderId ? [[row.builderId, row._max.publishedAt]] : [])));
}
