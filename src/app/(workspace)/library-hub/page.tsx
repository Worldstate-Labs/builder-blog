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
  adminCommunityLibraryName,
  digestPipelineTitle,
  displayDigestPipelineTitle,
  recordDigestPipelineHubViews,
  recordLibraryHubViews,
} from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";

type LibraryHubPageData = Awaited<ReturnType<typeof loadLibraryHubPageData>>;
type LibraryHubTab = "source-library" | "ai-digests";
type LibraryHubSearchParams = Promise<{
  tab?: string | string[];
}>;

const LIBRARY_HUB_TABS: Array<WorkspaceTopTabItem<LibraryHubTab>> = [
  { value: "source-library", label: "Source Library", href: "/library-hub" },
  { value: "ai-digests", label: "AI Digests", href: "/library-hub?tab=ai-digests" },
];

export default async function LibraryHubPage({
  searchParams,
}: {
  searchParams: LibraryHubSearchParams;
}) {
  const params = await searchParams;
  const selectedTab = parseHubTab(firstParam(params.tab));
  const dataPromise = loadLibraryHubPageData();

  return (
    <div className="page-pad">
      <div className="workspace-content-stack">
        <WorkspaceTopTabs
          ariaLabel="Hub sections"
          items={LIBRARY_HUB_TABS}
          selectedValue={selectedTab}
        />

        {selectedTab === "source-library" ? (
          <Suspense fallback={<LibraryHubImportFallback />}>
            <LibraryHubImportSection dataPromise={dataPromise} />
          </Suspense>
        ) : (
          <Suspense fallback={<DigestPipelineImportFallback />}>
            <DigestPipelineImportSection dataPromise={dataPromise} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

async function loadLibraryHubPageData() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  await ensureDefaultCommunityLibraryImport(session.user.id);

  const [libraries, imports, digestPipelineShares, digestPipelineImports] = await Promise.all([
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
                handle: true,
                sourceUrl: true,
                fetchUrl: true,
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
  await recordLibraryHubViews(libraries.map((library) => library.id));
  await recordDigestPipelineHubViews(
    digestPipelineShares
      .filter((pipeline) => pipeline.ownerUserId !== session.user.id)
      .map((pipeline) => pipeline.id),
  );

  const importedLibraryIds = new Set(imports.map((item) => item.hubEntryId));
  const importedDigestPipelineIds = new Set(
    digestPipelineImports.map((item) => item.pipelineId),
  );
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
      items: library.items,
      imported: importedLibraryIds.has(library.id),
      owned: library.ownerUserId === session.user.id,
    };
  });

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
        title: displayDigestPipelineTitle(pipeline.title || digestPipelineTitle(owner)),
        description: pipeline.description,
        ownerUserId: pipeline.ownerUserId,
        ownerLabel: owned
          ? "Shared by you."
          : `Shared by ${owner.name || owner.email || "a FollowBrief user"}.`,
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
    hubLibraries,
    hubDigestPipelines,
  };
}

async function LibraryHubImportSection({
  dataPromise,
}: {
  dataPromise: Promise<LibraryHubPageData>;
}) {
  const data = await dataPromise;

  return <LibraryHubImportForm libraries={data.hubLibraries} />;
}

async function DigestPipelineImportSection({
  dataPromise,
}: {
  dataPromise: Promise<LibraryHubPageData>;
}) {
  const data = await dataPromise;

  return <DigestPipelineImportForm pipelines={data.hubDigestPipelines} />;
}

function LibraryHubImportFallback() {
  return (
    <section aria-live="polite" aria-busy="true">
      <div className="library-hub-toolbar">
        <div className="library-hub-toolbar-copy">
          <h2 className="section-heading">Available libraries</h2>
          <div className="library-hub-skeleton-line is-wide" />
        </div>
        <div className="library-hub-counts">
          <span>Loading</span>
        </div>
        <div className="library-hub-skeleton-pill" />
      </div>
      <div className="hub-list-stack fb-hub-list">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="library-hub-card" key={index}>
            <div className="library-hub-card-header">
              <div className="library-hub-skeleton-copy">
                <div className="library-hub-skeleton-line is-kicker" />
                <div className="library-hub-skeleton-line is-title" />
                <div className="library-hub-skeleton-line is-body" />
              </div>
              <div className="library-hub-skeleton-chip" />
            </div>
            <div className="library-hub-sources">
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
      <div className="library-hub-toolbar">
        <div className="library-hub-toolbar-copy">
          <div className="library-hub-skeleton-line is-heading" />
          <div className="library-hub-skeleton-line is-medium" />
        </div>
        <div className="library-hub-skeleton-pill" />
      </div>
      <div className="hub-list-stack fb-hub-list">
        <div className="library-hub-card library-hub-skeleton-card" />
        <div className="library-hub-card library-hub-skeleton-card" />
      </div>
    </section>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseHubTab(value: string | undefined): LibraryHubTab {
  if (value === "ai-digests") return value;
  return "source-library";
}

function ownerLabel(owner: { name: string | null; email: string | null } | null, isFeatured: boolean) {
  if (isFeatured) return "Community Library";
  if (!owner) return "Curated by FollowBrief.";
  return `Shared by ${owner.name || owner.email || "a FollowBrief user"}.`;
}
