import { BuilderKind, BuilderPoolOrigin } from "@prisma/client";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AddBuilderForm } from "@/components/AddBuilderForm";
import { BuilderLibraryAutoRefresh } from "@/components/BuilderLibraryAutoRefresh";
import { BuilderLibraryList, type BuilderLibraryListItem } from "@/components/BuilderLibraryList";
import { BuilderLibraryStats } from "@/components/BuilderLibraryStats";
import { LibraryImportRemoveButton } from "@/components/LibraryImportRemoveButton";
import { LibraryVisibilityToggle } from "@/components/LibraryVisibilityToggle";
import { MobileSourcesSwitcher } from "@/components/MobileSourcesSwitcher";
import { PrivateLibraryPanel } from "@/components/PrivateLibraryPanel";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import {
  adminCommunityLibraryDescription,
  adminCommunityLibraryName,
  ensureAdminCommunityLibrary,
  sharePersonalLibraryToHub,
} from "@/lib/library-hub";
import { builderLibraryState } from "@/lib/builder-library-state";
import { ensureDefaultCommunityLibraryImport } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";
import { SOURCE_DEFINITIONS } from "@/lib/source-registry";

type BuilderWithCount = {
  id: string;
  ownerUserId: string | null;
  entityId: string | null;
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

type BuildersPageData = Awaited<ReturnType<typeof loadBuildersPageData>>;

export default function BuildersPage() {
  const dataPromise = loadBuildersPageData();

  return (
    <div className="page-pad">
      <section className="fb-page-head">
        <div>
          <h1 className="fb-title">Sources</h1>
          <p className="fb-desc">
            Manage your library, subscriptions, and per-source summary history.
          </p>
        </div>
        <Suspense fallback={<BuilderStatsFallback />}>
          <BuilderStatsSlot dataPromise={dataPromise} />
        </Suspense>
      </section>

      <Suspense fallback={<BuilderSectionsFallback />}>
        <BuilderSections dataPromise={dataPromise} />
      </Suspense>
    </div>
  );
}

async function loadBuildersPageData() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = isAdminEmail(session.user.email);
  await ensureDefaultCommunityLibraryImport(session.user.id);

  const [poolEntries, subscriptions, importedLibraries, ownSharedLibrary, adminLibVisibility, rawTokens] = await Promise.all([
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
      where: { ownerUserId: session.user.id },
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { items: true } },
      },
    }),
    // Used to determine if the featured community library has been hidden by this user.
    (async () => {
      const featuredLib = await prisma.libraryHubEntry.findFirst({
        where: { isFeatured: true },
        select: { id: true },
      });
      if (!featuredLib) return null;
      const vis = await prisma.userLibraryVisibility.findUnique({
        where: { userId_hubEntryId: { userId: session.user.id, hubEntryId: featuredLib.id } },
        select: { hidden: true },
      });
      return { hidden: Boolean(vis?.hidden) };
    })(),
    prisma.agentToken.findMany({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        lastIp: true,
        lastUserAgent: true,
      },
    }),
  ]);

  const subscribedBuilderIds = new Set(subscriptions.map((s) => s.builderId));
  const subscribed = {
    has(builderId: string) {
      return subscribedBuilderIds.has(builderId);
    },
  };
  const activeEntryByBuilderId = new Map(poolEntries.map((entry) => [entry.builderId, entry]));
  const poolBuilders = poolEntries.map((entry) => entry.builder).sort(builderSort);
  const poolBuilderIds = poolBuilders.map((builder) => builder.id);
  const privateBuilders = poolEntries
    .filter(
      (entry) =>
        entry.origin === BuilderPoolOrigin.PERSONAL_SYNC &&
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
  const isAdminCommunityLibraryHidden = Boolean(adminLibVisibility?.hidden);
  let isPublicLibrary = isAdmin ? !isAdminCommunityLibraryHidden : Boolean(ownSharedLibrary);
  if (
    isAdmin &&
    !isAdminCommunityLibraryHidden &&
    (!ownSharedLibrary ||
      ownSharedLibrary.name !== adminCommunityLibraryName ||
      ownSharedLibrary.description !== adminCommunityLibraryDescription ||
      ownSharedLibrary._count.items !== privateBuilders.length)
  ) {
    const result = await ensureAdminCommunityLibrary(session.user.id);
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

  const activeTokens: AgentTokenListItem[] = rawTokens.map((token) => ({
    id: token.id,
    name: token.name,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    lastIp: token.lastIp ?? null,
    lastUserAgent: token.lastUserAgent ?? null,
    revokedAt: null,
  }));

  return {
    activeTokens,
    crawledItems,
    importedLibrarySections,
    isAdmin,
    isPublicLibrary,
    latestPostCreatedAtByBuilderId,
    libraryState,
    poolBuilders,
    privateBuilders,
    sessionUserEmail: session.user.email,
    sessionUserName: session.user.name,
    subscribed,
    subscribedCount,
  };
}

async function BuilderStatsSlot({
  dataPromise,
}: {
  dataPromise: Promise<BuildersPageData>;
}) {
  const data = await dataPromise;

  return (
    <BuilderLibraryStats
      initialCrawledItems={data.crawledItems}
      initialInLibrary={data.poolBuilders.length}
      initialSubscribed={data.subscribedCount}
    />
  );
}

async function BuilderSections({
  dataPromise,
}: {
  dataPromise: Promise<BuildersPageData>;
}) {
  const data = await dataPromise;
  const userLibraryName =
    data.isAdmin
      ? adminCommunityLibraryName
      : `${data.sessionUserName || data.sessionUserEmail || "Personal"} library`;

  const privateSection = (
    <PrivateLibraryPanel
      title={data.isAdmin ? adminCommunityLibraryName : "Private library"}
      count={data.privateBuilders.length}
      sourceOptions={SOURCE_DEFINITIONS.filter((source) => source.id !== "pdf").map(
        (source) => ({ id: source.id, label: source.label }),
      )}
      visibilityToggle={
        <LibraryVisibilityToggle
          compact
          disabled={!data.isAdmin && data.privateBuilders.length === 0}
          initialIsPublic={data.isPublicLibrary}
          isAdminLibrary={data.isAdmin}
          name={userLibraryName}
        />
      }
    >
      <SkillPromptActions context="library" tokens={data.activeTokens} />
      <BuilderLibraryList
        acceptAddedBuilders
        builders={data.privateBuilders.map((builder) =>
          builderListItem({
            allowRemove: true,
            builder,
            crawlLabel: "Agent synced",
            latestPostCreatedAt: data.latestPostCreatedAtByBuilderId.get(builder.id) ?? null,
            subscribed: data.subscribed.has(builder.id),
          }),
        )}
        emptyBody="Add a source here, or sync richer summarized data from your agent later."
        emptyTitle="No personal sources yet"
      />
    </PrivateLibraryPanel>
  );

  const importedSection = (
    <section className="grid gap-3">
      <div className="at-desktop">
        <h2 className="fb-section-heading">Imported libraries</h2>
        <p className="mt-1 text-sm text-[var(--muted-strong)]">
          Sources grouped by the shared library they came from.
        </p>
      </div>
      <div className="imported-library-stack">
        {data.importedLibrarySections.map((library) => (
          <LibrarySection
            key={library.id}
            title={library.name}
            detail={library.description || `Imported from ${library.ownerName}`}
            badge="imported"
            count={library.builders.length}
            defaultOpen
            indented
            action={
              <LibraryImportRemoveButton
                builderCount={library.builders.length}
                libraryId={library.id}
                libraryName={library.name}
              />
            }
          >
            <BuilderLibraryList
              builders={library.builders.map((builder) =>
                builderListItem({
                  allowRemove: false,
                  builder,
                  // Distinguish admin-curated channels (the community library) from other
                  // imported personal libraries. Detection is owner-based: admin-owned
                  // library entries are treated as community content.
                  crawlLabel: "Hub imported",
                  latestPostCreatedAt: data.latestPostCreatedAtByBuilderId.get(builder.id) ?? null,
                  subscribed: data.subscribed.has(builder.id),
                }),
              )}
              emptyBody="No active sources from this imported library."
            />
          </LibrarySection>
        ))}
        {data.importedLibrarySections.length === 0 ? (
          <div className="fb-panel dashed text-[var(--muted-strong)]">
            Import shared libraries from the Hub to see them here.
          </div>
        ) : null}
      </div>
    </section>
  );

  return (
    <section className="mt-6 grid gap-5">
      <BuilderLibraryAutoRefresh initialVersion={data.libraryState.version} />
      <MobileSourcesSwitcher
        privateLabel="Private"
        importedLabel="Imported"
        privateSection={privateSection}
        importedSection={importedSection}
      />
    </section>
  );
}

function BuilderStatsFallback() {
  return (
    <div className="page-toolbar" aria-live="polite" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-8 w-24 rounded-full bg-black/10" />
      ))}
    </div>
  );
}

function BuilderSectionsFallback() {
  return (
    <section className="mt-6 grid gap-5" aria-live="polite" aria-busy="true">
      <div className="library-section-panel">
        <div className="library-section-summary">
          <div className="min-w-0 flex-1">
            <div className="h-6 w-40 rounded bg-black/10" />
            <div className="mt-3 h-4 max-w-sm rounded bg-black/10" />
          </div>
          <div className="library-section-meta">
            <div className="h-7 w-16 rounded-full bg-black/10" />
            <div className="h-7 w-24 rounded-full bg-black/10" />
          </div>
        </div>
        <div className="library-section-body">
          <div className="h-12 rounded-lg bg-black/10" />
          <div className="mt-3 h-28 rounded-lg bg-black/10" />
        </div>
      </div>
    </section>
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
    entityId: builder.entityId,
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
  action,
  children,
}: {
  title: string;
  detail: string;
  badge: string;
  count: number;
  defaultOpen?: boolean;
  indented?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details
      className={`library-section-panel${indented ? " library-section-panel-indented" : ""}`}
      open={defaultOpen}
    >
      <summary className="library-section-summary">
        <div>
          <h2 className="fb-section-heading">{title}</h2>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">{detail}</p>
        </div>
        <div className="library-section-meta">
          <span className="fb-kind-pill">{badge}</span>
          <span className="fb-kind-pill">{count} sources</span>
          {action}
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
