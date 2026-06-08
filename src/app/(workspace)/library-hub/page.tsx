import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  DigestPipelineImportForm,
  type HubDigestPipeline,
} from "@/components/DigestPipelineImportForm";
import { LibraryHubImportForm, type HubLibrary } from "@/components/LibraryHubImportForm";
import { WorkspaceTopTabs, type WorkspaceTopTabItem } from "@/components/WorkspaceTopTabs";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { ensureDefaultCommunityLibraryImport } from "@/lib/builder-pool";
import {
  emptyDigestPipelineMetadata,
  getDigestPipelineMetadataByOwnerIds,
} from "@/lib/digest-pipeline-metadata";
import {
  adminCommunityLibraryDescription,
  adminCommunityLibraryName,
  digestPipelineTitle,
  digestPipelineOwnerLabel,
  displayDigestPipelineTitleForOwner,
  ensureAdminCommunityDigestPipeline,
  ensureDefaultCommunityDigestImport,
  recordDigestPipelineHubViews,
  recordLibraryHubViews,
} from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";

type SourceLibraryHubPageData = Awaited<ReturnType<typeof loadSourceLibraryHubPageData>>;
type DigestPipelineHubPageData = Awaited<ReturnType<typeof loadDigestPipelineHubPageData>>;
type LibraryHubTab = "source-library" | "ai-digests";
type LibraryHubSearchParams = Promise<{
  tab?: string | string[];
}>;

const LIBRARY_HUB_TABS: Array<WorkspaceTopTabItem<LibraryHubTab>> = [
  {
    value: "source-library",
    label: "Source libraries",
    href: "/library-hub?tab=source-library",
    panelId: "hub-panel-source-library",
    tabId: "hub-tab-source-library",
  },
  {
    value: "ai-digests",
    label: "AI Digest archives",
    href: "/library-hub?tab=ai-digests",
    panelId: "hub-panel-ai-digests",
    tabId: "hub-tab-ai-digests",
  },
];

export default async function LibraryHubPage({
  searchParams,
}: {
  searchParams: LibraryHubSearchParams;
}) {
  const params = await searchParams;
  const selectedTab = parseHubTab(firstParam(params.tab));
  const selectedTabItem = selectedHubTabItem(selectedTab);
  const sourceLibraryDataPromise =
    selectedTab === "source-library" ? loadSourceLibraryHubPageData() : null;
  const digestPipelineDataPromise =
    selectedTab === "ai-digests" ? loadDigestPipelineHubPageData() : null;

  return (
    <div className="page-pad">
      <h1 className="sr-only">Hub</h1>
      <div className="workspace-content-stack workspace-content-stack--tabs-first">
        <WorkspaceTopTabs
          ariaLabel="Hub tabs"
          items={LIBRARY_HUB_TABS}
          selectedValue={selectedTab}
        />

        {selectedTab === "source-library" ? (
          <section
            aria-labelledby={selectedTabItem.tabId}
            id={selectedTabItem.panelId}
            role="tabpanel"
          >
            <Suspense fallback={<LibraryHubImportFallback />}>
              <LibraryHubImportSection dataPromise={sourceLibraryDataPromise!} />
            </Suspense>
          </section>
        ) : (
          <section
            aria-labelledby={selectedTabItem.tabId}
            id={selectedTabItem.panelId}
            role="tabpanel"
          >
            <Suspense fallback={<DigestPipelineImportFallback />}>
              <DigestPipelineImportSection dataPromise={digestPipelineDataPromise!} />
            </Suspense>
          </section>
        )}
      </div>
    </div>
  );
}

async function requireLibraryHubSession() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  return session;
}

async function loadSourceLibraryHubPageData() {
  const session = await requireLibraryHubSession();
  await ensureDefaultCommunityLibraryImport(session.user.id);

  const [libraries, imports] = await Promise.all([
    prisma.libraryHubEntry.findMany({
      include: {
        owner: { select: { name: true, email: true } },
        items: {
          include: {
            builder: {
              select: {
                id: true,
                kind: true,
                sourceType: true,
                name: true,
                avatarUrl: true,
                handle: true,
                sourceUrl: true,
                fetchUrl: true,
                lastFetchedAt: true,
                _count: { select: { feedItems: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
          // Hard cap to keep payload sane on community libraries that
          // could grow indefinitely. Tuned well above the largest
          // hand-curated library we expect; bump if needed.
          take: 200,
        },
        _count: { select: { items: true } },
      },
      orderBy: [{ importCount: "desc" }, { viewCount: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.libraryImport.findMany({
      where: { userId: session.user.id },
      select: { hubEntryId: true },
    }),
  ]);
  await recordLibraryHubViews(libraries.map((library) => library.id));

  const importedLibraryIds = new Set(imports.map((item) => item.hubEntryId));
  const hubLibraries: HubLibrary[] = libraries.map((library) => {
    const isCommunityLibrary = library.isFeatured || isAdminEmail(library.owner?.email);
    return {
      id: library.id,
      isCommunity: isCommunityLibrary,
      name: isCommunityLibrary ? adminCommunityLibraryName : library.name,
      description: library.description,
      ownerUserId: library.ownerUserId,
      importCount: library.importCount,
      viewCount: library.viewCount,
      itemCount: library._count.items,
      ownerLabel: ownerLabel(library.owner, isCommunityLibrary),
      items: library.items.map((item) => ({
        builderId: item.builderId,
        builder: {
          ...item.builder,
          lastFetchedAt: item.builder.lastFetchedAt?.toISOString() ?? null,
        },
      })),
      imported: importedLibraryIds.has(library.id),
      owned: library.ownerUserId === session.user.id,
    };
  });

  return {
    hubLibraries,
  };
}

async function loadDigestPipelineHubPageData() {
  const session = await requireLibraryHubSession();
  if (isAdminEmail(session.user.email)) {
    await ensureAdminCommunityDigestPipeline(session.user.id, session.user.email);
  } else {
    await ensureDefaultCommunityDigestImport(session.user.id);
  }

  const [digestPipelineShares, digestPipelineImports] = await Promise.all([
    prisma.digestPipelineShare.findMany({
      where: { isPublic: true },
      include: {
        owner: { select: { name: true, email: true } },
        imports: {
          where: { userId: session.user.id },
          select: { userId: true },
        },
      },
      orderBy: [{ importCount: "desc" }, { viewCount: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.digestPipelineImport.findMany({
      where: { userId: session.user.id },
      select: { pipelineId: true },
    }),
  ]);
  await recordDigestPipelineHubViews(
    digestPipelineShares
      .filter((pipeline) => pipeline.ownerUserId !== session.user.id)
      .map((pipeline) => pipeline.id),
  );

  const importedDigestPipelineIds = new Set(
    digestPipelineImports.map((item) => item.pipelineId),
  );
  const digestMetadataByOwnerId = await getDigestPipelineMetadataByOwnerIds(
    digestPipelineShares.map((pipeline) => pipeline.ownerUserId),
  );
  const hubDigestPipelines: HubDigestPipeline[] = digestPipelineShares
    .map((pipeline) => {
      const owned = pipeline.ownerUserId === session.user.id;
      const owner = pipeline.owner;
      const metadata =
        digestMetadataByOwnerId.get(pipeline.ownerUserId) ?? emptyDigestPipelineMetadata();
      return {
        id: pipeline.id,
        title: displayDigestPipelineTitleForOwner(
          pipeline.title || digestPipelineTitle(owner),
          owner,
        ),
        description: pipeline.description,
        ownerUserId: pipeline.ownerUserId,
        ownerLabel: digestPipelineOwnerLabel(owner, { owned }),
        importCount: pipeline.importCount,
        viewCount: pipeline.viewCount,
        ...metadata,
        imported:
          importedDigestPipelineIds.has(pipeline.id) || pipeline.imports.length > 0,
        owned,
      };
    })
    .sort((a, b) => Number(b.owned) - Number(a.owned));

  return {
    hubDigestPipelines,
  };
}

async function LibraryHubImportSection({
  dataPromise,
}: {
  dataPromise: Promise<SourceLibraryHubPageData>;
}) {
  const data = await dataPromise;

  return <LibraryHubImportForm libraries={data.hubLibraries} />;
}

async function DigestPipelineImportSection({
  dataPromise,
}: {
  dataPromise: Promise<DigestPipelineHubPageData>;
}) {
  const data = await dataPromise;

  return <DigestPipelineImportForm pipelines={data.hubDigestPipelines} />;
}

function LibraryHubImportFallback() {
  return (
    <section aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading source libraries</span>
      <div className="library-hub-toolbar">
        <div className="library-hub-toolbar-copy">
          <h2 className="fb-section-heading">Source libraries</h2>
          <p className="hub-section-copy">
            Community source libraries, your shared source libraries, and source libraries built by other users.
          </p>
          <div className="library-hub-skeleton-line is-wide" />
        </div>
        <div className="library-hub-skeleton-pill" />
      </div>
      <div className="hub-list-stack fb-hub-list">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="fb-hub-card" key={index}>
            <div className="fb-hub-card-head">
              <div className="library-hub-skeleton-copy">
                <div className="library-hub-skeleton-line is-kicker" />
                <div className="library-hub-skeleton-line is-title" />
                <div className="library-hub-skeleton-line is-body" />
              </div>
              <div className="library-hub-skeleton-chip" />
            </div>
            <div className="library-hub-skeleton-sources">
              <div className="library-hub-skeleton-row" />
              <div className="library-hub-skeleton-row" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DigestPipelineImportFallback() {
  return (
    <section aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading AI Digest archives</span>
      <div className="library-hub-toolbar">
        <div className="library-hub-toolbar-copy">
          <h2 className="fb-section-heading">AI Digest archives</h2>
          <p className="hub-section-copy">
            AI Digest archives built and shared by other users.
          </p>
          <div className="library-hub-skeleton-line is-wide" />
        </div>
        <div className="library-hub-skeleton-pill" />
      </div>
      <div className="hub-list-stack fb-hub-list">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="fb-hub-card" key={index}>
            <div className="fb-hub-card-head">
              <div className="library-hub-skeleton-copy">
                <div className="library-hub-skeleton-line is-title" />
                <div className="library-hub-skeleton-line is-body" />
              </div>
              <div className="library-hub-skeleton-chip" />
            </div>
            <div className="library-hub-skeleton-digest-preview">
              <div className="library-hub-skeleton-line is-medium" />
              <div className="library-hub-skeleton-line is-body" />
              <div className="library-hub-skeleton-line is-body" />
            </div>
            <div className="library-hub-skeleton-meta-grid">
              <div className="library-hub-skeleton-row" />
              <div className="library-hub-skeleton-row" />
              <div className="library-hub-skeleton-row" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseHubTab(value: string | undefined): LibraryHubTab {
  if (value === "ai-digests" || value === "digests") return "ai-digests";
  return "source-library";
}

function selectedHubTabItem(value: LibraryHubTab) {
  return LIBRARY_HUB_TABS.find((tab) => tab.value === value) ?? LIBRARY_HUB_TABS[0];
}

function ownerLabel(owner: { name: string | null; email: string | null } | null, isFeatured: boolean) {
  if (isFeatured) return adminCommunityLibraryDescription;
  if (!owner) return "Curated by FollowBrief.";
  return `Shared by ${owner.name || owner.email || "a FollowBrief user"}.`;
}
