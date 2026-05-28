import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { LibraryHubImportForm, type HubLibrary } from "@/components/LibraryHubImportForm";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { ensureDefaultCommunityLibraryImport } from "@/lib/builder-pool";
import { adminCommunityLibraryName, recordLibraryHubViews } from "@/lib/library-hub";
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
            Import shared source libraries, or publish your own so others can follow what you read.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Suspense fallback={<span className="fb-chip" aria-busy="true">Loading</span>}>
            <LibraryHubCount dataPromise={dataPromise} />
          </Suspense>
          <Link className="fb-btn light" href="/builders">
            <Plus aria-hidden="true" />
            Share my library
          </Link>
        </div>
      </section>

      <Suspense fallback={<LibraryHubImportFallback />}>
        <LibraryHubImportSection dataPromise={dataPromise} />
      </Suspense>
    </div>
  );
}

async function loadLibraryHubPageData() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
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
                handle: true,
                sourceUrl: true,
                fetchUrl: true,
                _count: { select: { feedItems: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 3,
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
      items: library.items,
      imported: importedLibraryIds.has(library.id),
      owned: library.ownerUserId === session.user.id,
    };
  });

  return { hubLibraries, libraryCount: libraries.length };
}

async function LibraryHubCount({
  dataPromise,
}: {
  dataPromise: Promise<LibraryHubPageData>;
}) {
  const data = await dataPromise;

  return <span className="fb-chip">{data.libraryCount} libraries</span>;
}

async function LibraryHubImportSection({
  dataPromise,
}: {
  dataPromise: Promise<LibraryHubPageData>;
}) {
  const data = await dataPromise;

  return <LibraryHubImportForm libraries={data.hubLibraries} />;
}

function LibraryHubImportFallback() {
  return (
    <section className="mt-6" aria-live="polite" aria-busy="true">
      <div className="library-hub-toolbar">
        <div>
          <h2 className="section-heading">Available libraries</h2>
          <div className="mt-2 h-4 max-w-lg rounded bg-black/10" />
        </div>
        <div className="library-hub-counts">
          <span>Loading</span>
        </div>
        <div className="h-11 w-36 rounded-full bg-black/10" />
      </div>
      <div className="library-hub-grid mt-5">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="library-hub-card" key={index}>
            <div className="library-hub-card-header">
              <div className="min-w-0 flex-1">
                <div className="h-4 w-28 rounded bg-black/10" />
                <div className="mt-3 h-6 w-44 rounded bg-black/10" />
                <div className="mt-3 h-4 max-w-sm rounded bg-black/10" />
              </div>
              <div className="h-7 w-20 rounded-full bg-black/10" />
            </div>
            <div className="library-hub-sources">
              <div className="h-10 rounded-lg bg-black/10" />
              <div className="h-10 rounded-lg bg-black/10" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ownerLabel(owner: { name: string | null; email: string | null } | null, isFeatured: boolean) {
  if (isFeatured) return "Community Library";
  if (!owner) return "Curated by FollowBrief.";
  return `Shared by ${owner.name || owner.email || "a FollowBrief user"}.`;
}
