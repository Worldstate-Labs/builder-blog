import { BuilderKind, BuilderPoolOrigin, BuilderScope, LibraryHubKind, type FeedItemKind } from "@prisma/client";
import { redirect } from "next/navigation";
import { Suspense, type ComponentType, type ReactNode } from "react";
import { Bell, BellOff, ExternalLink, ListPlus, Trash2, UsersRound } from "lucide-react";
import {
  removeBuilderFromLibraryAction,
  subscribeAllLibraryBuildersAction,
  subscribeBuilderAction,
  togglePersonalLibraryHubAvailabilityAction,
  unsubscribeBuilderAction,
} from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { FeedCard } from "@/components/FeedCard";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { builderSourceLabel, feedItemKindLabel } from "@/lib/source-registry";

const perBuilderFeedItemLimit = 8;

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
  feedItems: BuilderFeedItem[];
};

type BuilderFeedItem = {
  id: string;
  kind: FeedItemKind;
  externalId: string;
  title: string | null;
  body: string;
  url: string;
  publishedAt: Date | null;
  createdAt: Date;
  sourceName: string | null;
  crawlingTool: string | null;
};

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
            feedItems: {
              orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
              select: feedItemSummarySelect,
              take: perBuilderFeedItemLimit,
            },
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
                    feedItems: {
                      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
                      select: feedItemSummarySelect,
                      take: perBuilderFeedItemLimit,
                    },
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
            title="Private library"
            detail="Synced by your agent with your own API keys or subscriptions"
            badge="private"
            count={privateBuilders.length}
            defaultOpen
          >
            <form
              action={togglePersonalLibraryHubAvailabilityAction}
              className="library-visibility-control"
            >
              <input
                name="name"
                type="hidden"
                value={`${session.user.name || session.user.email || "Personal"} library`}
              />
              <div className="library-visibility-copy">
                <span>Hub availability</span>
                <strong>{ownSharedLibrary ? "Public on Hub" : "Private"}</strong>
              </div>
              <button
                aria-pressed={Boolean(ownSharedLibrary)}
                className={`library-visibility-toggle ${ownSharedLibrary ? "is-on" : ""}`}
                disabled={privateBuilders.length === 0}
                type="submit"
              >
                <span className="library-visibility-track" aria-hidden="true">
                  <span className="library-visibility-thumb" />
                </span>
                <span>{ownSharedLibrary ? "Public" : "Private"}</span>
              </button>
            </form>
            {privateBuilders.map((builder) => (
              <BuilderCard
                key={builder.id}
                builder={builder}
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
                      key={builder.id}
                      builder={builder}
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

const feedItemSummarySelect = {
  id: true,
  kind: true,
  externalId: true,
  title: true,
  body: true,
  url: true,
  publishedAt: true,
  createdAt: true,
  sourceName: true,
  crawlingTool: true,
} as const;

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
  builder,
  subscribed,
  crawlLabel,
  status,
  action,
}: {
  builder: BuilderWithCount;
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
          status={status ?? (subscribed ? "Subscribed" : "In library")}
          crawlLabel={crawlLabel}
        />
        <div className="row-actions">
          {action ?? (
            <>
              <form action={subscribed ? unsubscribeBuilderAction : subscribeBuilderAction}>
                <input type="hidden" name="builderId" value={builder.id} />
                <FormSubmitButton
                  className={`${subscribed ? "button-light" : "button-dark"} button-compact gap-2`}
                  pendingLabel={subscribed ? "Updating..." : "Subscribing..."}
                >
                  {subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  {subscribed ? "Unsubscribe" : "Subscribe"}
                </FormSubmitButton>
              </form>
              <form action={removeBuilderFromLibraryAction}>
                <input type="hidden" name="builderId" value={builder.id} />
                <FormSubmitButton className="button-light button-compact button-danger gap-2" pendingLabel="Removing...">
                  <Trash2 className="h-4 w-4" />
                  Remove from library
                </FormSubmitButton>
              </form>
            </>
          )}
        </div>
      </div>
      <BuilderFeedItems builder={builder} />
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

function BuilderFeedItems({ builder }: { builder: BuilderWithCount }) {
  return (
    <details className="builder-posts">
      <summary>
        <span>Crawled posts</span>
        <span className="text-[var(--muted)]">
          Latest {builder.feedItems.length} of {builder._count.feedItems}
        </span>
      </summary>
      <div className="builder-post-list">
        {builder.feedItems.map((item) => (
          <article key={item.id} className="builder-post-row">
            <div className="min-w-0">
              <div className="item-kicker">
                <span>{feedItemKindLabel(item.kind)}</span>
                {item.publishedAt ? (
                  <span>Published {item.publishedAt.toLocaleString()}</span>
                ) : null}
                <span>Crawled {item.createdAt.toLocaleString()}</span>
                {item.sourceName ? <span>{item.sourceName}</span> : null}
                <span>{item.crawlingTool ?? "Legacy crawl/import"}</span>
              </div>
              <h4 className="item-title">{item.title || firstLine(item.body)}</h4>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted-strong)]">
                {firstLine(item.body)}
              </p>
              <details className="inline-disclosure">
                <summary>Read full crawl</summary>
                <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                    Crawling tool · {item.crawlingTool ?? "Legacy crawl/import"}
                  </p>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--muted-strong)]">
                    {item.body}
                  </div>
                </div>
              </details>
              <dl className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">External id</dt>
                  <dd className="mt-1 break-all font-mono text-[var(--muted-strong)]">
                    {item.externalId}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Crawling tool</dt>
                  <dd className="mt-1 break-all text-[var(--muted-strong)]">
                    {item.crawlingTool ?? "Legacy crawl/import"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Source URL</dt>
                  <dd className="mt-1 break-all text-[var(--muted-strong)]">{item.url}</dd>
                </div>
              </dl>
            </div>
            <a
              className="button-light button-compact min-w-24 gap-2"
              href={item.url}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          </article>
        ))}
        {builder.feedItems.length === 0 ? (
          <div className="p-4 text-sm text-[var(--muted-strong)]">
            No crawled posts have been stored for this builder yet.
          </div>
        ) : null}
      </div>
    </details>
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

function firstLine(body: string) {
  return body.split(/\r?\n/).find(Boolean)?.slice(0, 160) ?? "Untitled item";
}
