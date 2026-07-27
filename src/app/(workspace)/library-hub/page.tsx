import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { I18nText } from "@/components/I18nProvider";
import { LibraryHubImportForm, type HubLibrary } from "@/components/LibraryHubImportForm";
import { PageHeader } from "@/components/PageHeader";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { ensureDefaultCommunityLibraryImport } from "@/lib/builder-pool";
import {
  adminCommunityLibraryDescription,
  adminCommunityLibraryName,
  recordLibraryHubViews,
  userImportableLibraryHubEntryWhere,
} from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";
import { getSourceLibraryMetadataByOwnerIds } from "@/lib/source-library-metadata";

export const metadata: Metadata = { title: "Hub" };

type SourceLibraryHubPageData = Awaited<ReturnType<typeof loadSourceLibraryHubPageData>>;

export default function LibraryHubPage() {
  const sourceLibraryDataPromise = loadSourceLibraryHubPageData();

  return (
    <div className="page-pad">
      <PageHeader
        title={<I18nText id="workspace.hub" />}
        description={<I18nText id="workspace.hubDesc" />}
      />
      <div className="workspace-content-stack">
        <Suspense fallback={<LibraryHubImportFallback />}>
          <LibraryHubImportSection dataPromise={sourceLibraryDataPromise} />
        </Suspense>
      </div>
    </div>
  );
}

async function loadSourceLibraryHubPageData() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  await ensureDefaultCommunityLibraryImport(session.user.id);

  const [libraries, imports] = await Promise.all([
    prisma.libraryHubEntry.findMany({
      where: userImportableLibraryHubEntryWhere(),
      include: {
        owner: { select: { name: true, email: true } },
        items: {
          include: {
            builder: {
              select: {
                id: true,
                entityId: true,
                kind: true,
                sourceType: true,
                name: true,
                avatarUrl: true,
                avatarDataUrl: true,
                handle: true,
                sourceUrl: true,
                fetchUrl: true,
                lastFetchedAt: true,
                _count: { select: { feedItems: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
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
  const ownerUserIds = libraries
    .filter((library) => library.ownerUserId)
    .map((library) => library.ownerUserId as string);
  const metadataByOwnerUserId = await getSourceLibraryMetadataByOwnerIds(ownerUserIds);
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
      metadata:
        library.ownerUserId
          ? metadataByOwnerUserId[library.ownerUserId] ?? null
          : null,
      imported: importedLibraryIds.has(library.id),
      owned: library.ownerUserId === session.user.id,
    };
  });

  return { hubLibraries };
}

async function LibraryHubImportSection({
  dataPromise,
}: {
  dataPromise: Promise<SourceLibraryHubPageData>;
}) {
  const data = await dataPromise;
  return <LibraryHubImportForm libraries={data.hubLibraries} />;
}

function LibraryHubImportFallback() {
  return (
    <section aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading source libraries</span>
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
            <div className="fb-hub-card-stats library-hub-skeleton-stats">
              <span className="library-hub-skeleton-stat" />
              <span className="library-hub-skeleton-stat" />
              <span className="library-hub-skeleton-stat" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ownerLabel(
  owner: { name: string | null; email: string | null } | null,
  isFeatured: boolean,
) {
  if (isFeatured) return adminCommunityLibraryDescription;
  if (!owner) return "Curated by FollowBrief.";
  return `Shared by ${owner.name || owner.email || "a FollowBrief user"}.`;
}
