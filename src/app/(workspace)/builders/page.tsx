import { BuilderKind, BuilderPoolOrigin, BuilderScope, LibraryHubKind } from "@prisma/client";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Bell, Plus } from "lucide-react";
import { addPersonalBuilderAction } from "@/app/actions";
import {
  BuilderLibraryActions,
  SubscribeAllLibraryBuildersButton,
} from "@/components/BuilderLibraryActions";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { LibraryVisibilityToggle } from "@/components/LibraryVisibilityToggle";
import { SourceBadge } from "@/components/SourceBadge";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SOURCE_DEFINITIONS } from "@/lib/source-registry";

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
    <div className="page-pad">
        <section className="page-header">
          <div>
            <h1 className="page-title">Builders</h1>
            <p className="page-description">
              Manage your library, subscriptions, and per-builder crawl history.
            </p>
          </div>
          <div className="page-toolbar">
            <span className="status-chip">{poolBuilders.length} in library</span>
            <span className="status-chip">
              <Bell className="h-3.5 w-3.5" />
              {subscribedCount} subscribed
            </span>
            <span className="status-chip">{crawledItems} crawled</span>
            <SubscribeAllLibraryBuildersButton />
          </div>
        </section>

        <section className="mt-6 grid gap-5">
          <LibrarySection
            title="Private library"
            detail="Synced by your agent"
            badge="private"
            count={privateBuilders.length}
            defaultOpen
          >
            <LibraryVisibilityToggle
              disabled={privateBuilders.length === 0}
              initialIsPublic={Boolean(ownSharedLibrary)}
              name={`${session.user.name || session.user.email || "Personal"} library`}
            />
            <SkillPromptActions context="library" />
            <AddBuilderForm />
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
                <h3 className="text-lg font-semibold text-[var(--ink)]">No personal builders yet</h3>
                <p className="mt-2 text-sm leading-6">
                  Add a builder here, or sync richer crawled data from your agent later.
                </p>
              </div>
            ) : null}
          </LibrarySection>

          <section className="grid gap-3">
            <div>
              <h2 className="section-heading">Imported libraries</h2>
              <p className="mt-1 text-sm text-[var(--muted-strong)]">
                Builders grouped by the shared library they came from.
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
    </div>
  );
}

function AddBuilderForm() {
  return (
    <form action={addPersonalBuilderAction} className="add-builder-form">
      <div className="add-builder-form-header">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink)]">Add builder</h3>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">
            Create a private library entry.
          </p>
        </div>
        <FormSubmitButton className="button-dark button-compact gap-2" pendingLabel="Adding...">
          <Plus className="h-4 w-4" />
          Add
        </FormSubmitButton>
      </div>
      <div className="add-builder-grid">
        <label>
          <span>Source</span>
          <select className="input" name="sourceType" defaultValue="x">
            {SOURCE_DEFINITIONS.filter((source) => source.id !== "pdf").map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Handle or URL</span>
          <input
            className="input"
            name="sourceValue"
            placeholder="@deepmind or https://example.com/feed"
            required
          />
        </label>
        <label className="add-builder-grid-wide">
          <span>Display name</span>
          <input className="input" name="name" placeholder="Optional; inferred when empty" />
        </label>
      </div>
    </form>
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
        <h3 className="text-lg font-semibold leading-snug">{builder.name}</h3>
        <SourceBadge builder={builder} />
        <span className="sub-pill">{status}</span>
      </div>
      <div className="builder-meta">
        <span>{builder.handle ? `@${builder.handle}` : hostFromUrl(builder.sourceUrl)}</span>
        <span>{crawlLabel}</span>
        <span>{builder._count.feedItems} items</span>
        {latestPostCreatedAt ? (
          <span>Latest {formatCompactDate(latestPostCreatedAt)}</span>
        ) : null}
      </div>
      <details className="inline-disclosure">
        <summary>Technical details</summary>
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
          <h2 className="text-lg font-semibold leading-snug">{title}</h2>
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

function builderSort(a: BuilderWithCount, b: BuilderWithCount) {
  return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
}

function hostFromUrl(value: string | null) {
  if (!value) return "No source";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function formatCompactDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
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
