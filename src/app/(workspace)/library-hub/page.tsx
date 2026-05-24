import { redirect } from "next/navigation";
import { LibraryHubImportForm, type HubLibrary } from "@/components/LibraryHubImportForm";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function LibraryHubPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

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
                crawlUrl: true,
                _count: { select: { feedItems: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 8,
        },
        _count: { select: { items: true } },
      },
      orderBy: [{ kind: "desc" }, { importCount: "desc" }, { viewCount: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.libraryImport.findMany({
      where: { userId: session.user.id },
      select: { hubEntryId: true },
    }),
  ]);

  const importedLibraryIds = new Set(imports.map((item) => item.hubEntryId));
  const hubLibraries: HubLibrary[] = libraries.map((library) => ({
    id: library.id,
    kind: library.kind,
    name: library.name,
    description: library.description,
    ownerUserId: library.ownerUserId,
    importCount: library.importCount,
    viewCount: library.viewCount,
    itemCount: library._count.items,
    ownerLabel: ownerLabel(library.owner),
    items: library.items,
    imported: importedLibraryIds.has(library.id),
    owned: library.ownerUserId === session.user.id,
  }));

  return (
    <div className="page-pad">
      <section className="page-header">
        <div>
          <h1 className="page-title">Library Hub</h1>
          <p className="page-description">
            Import shared builder libraries into your pool.
          </p>
        </div>
        <span className="status-chip">{libraries.length} libraries</span>
      </section>

      <LibraryHubImportForm libraries={hubLibraries} />
    </div>
  );
}

function ownerLabel(owner: { name: string | null; email: string | null } | null) {
  if (!owner) return "Curated by Builder Blog.";
  return `Shared by ${owner.name || owner.email || "a Builder Blog user"}.`;
}
