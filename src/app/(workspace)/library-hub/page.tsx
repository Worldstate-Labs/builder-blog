import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  DigestPipelineImportForm,
  type HubDigestPipeline,
} from "@/components/DigestPipelineImportForm";
import { CountChip } from "@/components/Count";
import { LibraryHubImportForm, type HubLibrary } from "@/components/LibraryHubImportForm";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { ensureDefaultCommunityLibraryImport } from "@/lib/builder-pool";
import {
  adminCommunityLibraryName,
  digestPipelineTitle,
  displayDigestPipelineTitle,
  recordDigestPipelineHubViews,
  recordLibraryHubViews,
} from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";

type LibraryHubPageData = Awaited<ReturnType<typeof loadLibraryHubPageData>>;

export default function LibraryHubPage() {
  const dataPromise = loadLibraryHubPageData();

  return (
    <div className="page-pad">
      <section className="fb-page-head">
        <div>
          <h1 className="fb-title">Library Hub</h1>
          <p className="fb-desc">
            Import shared source libraries and AI Digest archives.
          </p>
        </div>
        <div className="library-hub-page-count">
          <Suspense fallback={<span className="fb-chip" aria-busy="true">Loading</span>}>
            <LibraryHubCount dataPromise={dataPromise} />
          </Suspense>
        </div>
      </section>

      <div className="workspace-content-stack">
        <Suspense fallback={<LibraryHubImportFallback />}>
          <LibraryHubImportSection dataPromise={dataPromise} />
        </Suspense>

        <Suspense fallback={<DigestPipelineImportFallback />}>
          <DigestPipelineImportSection dataPromise={dataPromise} />
        </Suspense>
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

  const digestCounts = await Promise.all(
    digestPipelineShares.map(async (pipeline) => {
      const [digestCount, latestDigest] = await Promise.all([
        prisma.digest.count({ where: { userId: pipeline.ownerUserId, itemCount: { gt: 0 } } }),
        prisma.digest.findFirst({
          where: { userId: pipeline.ownerUserId, itemCount: { gt: 0 } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      return [pipeline.id, { digestCount, latestDigestAt: latestDigest?.createdAt ?? null }] as const;
    }),
  );
  const digestCountByPipelineId = new Map(digestCounts);
  const hubDigestPipelines: HubDigestPipeline[] = digestPipelineShares
    .map((pipeline) => {
      const owned = pipeline.ownerUserId === session.user.id;
      const owner = pipeline.owner;
      const stats = digestCountByPipelineId.get(pipeline.id);
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
        digestCount: stats?.digestCount ?? 0,
        latestDigestAt: stats?.latestDigestAt?.toISOString() ?? null,
        imported:
          importedDigestPipelineIds.has(pipeline.id) || pipeline.imports.length > 0,
        owned,
      };
    })
    .sort((a, b) => Number(b.owned) - Number(a.owned));
  return {
    hubLibraries,
    hubDigestPipelines,
    libraryCount: libraries.length,
  };
}

async function LibraryHubCount({
  dataPromise,
}: {
  dataPromise: Promise<LibraryHubPageData>;
}) {
  const data = await dataPromise;

  return <CountChip label={data.libraryCount === 1 ? "library" : "libraries"} value={data.libraryCount} />;
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
        <div>
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
        <div>
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

function ownerLabel(owner: { name: string | null; email: string | null } | null, isFeatured: boolean) {
  if (isFeatured) return "Community Library";
  if (!owner) return "Curated by FollowBrief.";
  return `Shared by ${owner.name || owner.email || "a FollowBrief user"}.`;
}
