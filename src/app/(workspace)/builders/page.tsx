import { BuilderKind, BuilderPoolOrigin, BuilderScope, LibraryHubKind } from "@prisma/client";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AddBuilderForm } from "@/components/AddBuilderForm";
import { BuilderLibraryAutoRefresh } from "@/components/BuilderLibraryAutoRefresh";
import { BuilderLibraryList, type BuilderLibraryListItem } from "@/components/BuilderLibraryList";
import { BuilderLibraryStats } from "@/components/BuilderLibraryStats";
import { LibraryVisibilityToggle } from "@/components/LibraryVisibilityToggle";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import {
  adminCommunityLibraryDescription,
  adminCommunityLibraryName,
  ensureAdminCommunityLibrary,
  sharePersonalLibraryToHub,
} from "@/lib/library-hub";
import { builderLibraryState } from "@/lib/builder-library-state";
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
  const isAdmin = isAdminEmail(session.user.email);

  const [poolEntries, subscriptions, importedLibraries, ownSharedLibrary, feedPreference] = await Promise.all([
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
      select: {
        id: true,
        name: true,
        description: true,
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
        _count: { select: { items: true } },
      },
    }),
    prisma.userFeedPreference.findUnique({
      where: { userId: session.user.id },
      select: { adminCommunityLibraryHidden: true },
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
  const adminCommunityBuilders = isAdmin
    ? (ownSharedLibrary?.items.map((item) => item.builder).sort(builderSort) ?? privateBuilders)
    : privateBuilders;
  const adminCommunityPersonalItemCount = isAdmin
    ? (ownSharedLibrary?.items.filter(
        (item) =>
          item.builder.scope === BuilderScope.PERSONAL &&
          item.builder.ownerUserId === session.user.id,
      ).length ?? 0)
    : privateBuilders.length;
  const primaryLibraryBuilders = isAdmin ? adminCommunityBuilders : privateBuilders;
  const importedLibrarySections = importedLibraries.map((libraryImport) => ({
    id: libraryImport.hubEntryId,
    name: libraryImport.hubEntry.name,
    description: libraryImport.hubEntry.description,
    ownerName:
      libraryImport.hubEntry.owner?.name ||
      libraryImport.hubEntry.owner?.email ||
      "FollowBrief",
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
  const isAdminCommunityLibraryHidden = Boolean(feedPreference?.adminCommunityLibraryHidden);
  let isPublicLibrary = isAdmin ? !isAdminCommunityLibraryHidden : Boolean(ownSharedLibrary);
  if (
    isAdmin &&
    !isAdminCommunityLibraryHidden &&
    (!ownSharedLibrary ||
      ownSharedLibrary.name !== adminCommunityLibraryName ||
      ownSharedLibrary.description !== adminCommunityLibraryDescription ||
      adminCommunityPersonalItemCount !== privateBuilders.length)
  ) {
    const result = await ensureAdminCommunityLibrary(session.user.id, { checkHidden: false });
    isPublicLibrary = result.isPublic;
  } else if (
    !isAdmin &&
    ownSharedLibrary &&
    ownSharedLibrary._count.items !== privateBuilders.length
  ) {
    await sharePersonalLibraryToHub({
      userId: session.user.id,
      name: ownSharedLibrary.name,
      description: ownSharedLibrary.description,
    });
  }
  const [latestPostCreatedAtByBuilderId, libraryState] = await Promise.all([
    latestPostCreationTimes(poolBuilderIds),
    builderLibraryState(session.user.id, poolBuilderIds),
  ]);

  return (
    <div className="page-pad">
        <BuilderLibraryAutoRefresh initialVersion={libraryState.version} />
        <section className="page-header">
          <div>
            <h1 className="page-title">Sources</h1>
            <p className="page-description">
              Manage your library, subscriptions, and per-source crawl history.
            </p>
          </div>
          <BuilderLibraryStats
            initialCrawledItems={crawledItems}
            initialInLibrary={poolBuilders.length}
            initialSubscribed={subscribedCount}
          />
        </section>

        <section className="mt-6 grid gap-5">
          <LibrarySection
            title={isAdmin ? adminCommunityLibraryName : "Private library"}
            detail={isAdmin ? adminCommunityLibraryDescription : "Synced by your agent"}
            badge={isAdmin ? "admin" : "private"}
            count={primaryLibraryBuilders.length}
            defaultOpen
          >
            <LibraryVisibilityToggle
              disabled={!isAdmin && privateBuilders.length === 0}
              initialIsPublic={isPublicLibrary}
              isAdminLibrary={isAdmin}
              name={isAdmin ? adminCommunityLibraryName : `${session.user.name || session.user.email || "Personal"} library`}
            />
            <SkillPromptActions context="library" />
            <AddBuilderForm
              sourceOptions={SOURCE_DEFINITIONS.filter((source) => source.id !== "pdf").map(
                (source) => ({ id: source.id, label: source.label }),
              )}
            />
            <BuilderLibraryList
              acceptAddedBuilders
              builders={primaryLibraryBuilders.map((builder) =>
                builderListItem({
                  allowRemove:
                    builder.scope === BuilderScope.PERSONAL &&
                    builder.ownerUserId === session.user.id,
                  builder,
                  crawlLabel:
                    builder.scope === BuilderScope.CENTRAL ? "Webapp crawled" : "Agent synced",
                  latestPostCreatedAt: latestPostCreatedAtByBuilderId.get(builder.id) ?? null,
                  subscribed: subscribed.has(builder.id),
                }),
              )}
              emptyBody="Add a source here, or sync richer crawled data from your agent later."
              emptyTitle="No personal sources yet"
            />
          </LibrarySection>

          <section className="grid gap-3">
            <div>
              <h2 className="section-heading">Imported libraries</h2>
              <p className="mt-1 text-sm text-[var(--muted-strong)]">
                Sources grouped by the shared library they came from.
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
                  <BuilderLibraryList
                    builders={library.builders.map((builder) =>
                      builderListItem({
                        allowRemove: false,
                        builder,
                        crawlLabel:
                          builder.scope === BuilderScope.CENTRAL ? "Webapp crawled" : "Hub imported",
                        latestPostCreatedAt: latestPostCreatedAtByBuilderId.get(builder.id) ?? null,
                        subscribed: subscribed.has(builder.id),
                      }),
                    )}
                    emptyBody="No active sources from this imported library."
                  />
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

function builderListItem({
  allowRemove,
  builder,
  crawlLabel,
  latestPostCreatedAt,
  subscribed,
}: {
  allowRemove: boolean;
  builder: BuilderWithCount;
  latestPostCreatedAt: Date | null;
  subscribed: boolean;
  crawlLabel: string;
}): BuilderLibraryListItem {
  return {
    id: builder.id,
    kind: builder.kind,
    sourceType: builder.sourceType,
    name: builder.name,
    handle: builder.handle,
    sourceUrl: builder.sourceUrl,
    crawlUrl: builder.crawlUrl,
    feedItemCount: builder._count.feedItems,
    latestPostCreatedAt: latestPostCreatedAt?.toISOString() ?? null,
    subscribed,
    crawlLabel,
    allowRemove,
  };
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
          <span className="sub-pill">{count} sources</span>
        </div>
      </summary>
      <div className="library-section-body">{children}</div>
    </details>
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
