import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { LibraryBig, UsersRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LibraryHubImportForm, type HubLibrary } from "@/components/LibraryHubImportForm";
import { getCurrentSession } from "@/lib/auth";
import {
  recordLibraryHubViews,
  syncCentralLibraryHub,
} from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";

export default async function LibraryHubPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  await syncCentralLibraryHub();

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
  await recordLibraryHubViews(libraries.map((library) => library.id));

  const importedLibraryIds = new Set(imports.map((item) => item.hubEntryId));
  const importableLibraries = libraries.filter((library) => library.ownerUserId !== session.user.id);
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
    <AppShell session={session}>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_24rem]">
          <div>
            <p className="section-label">Library Hub</p>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
              Shared builder libraries
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              Browse the central library and shared personal libraries. Import
              multiple libraries into your builder pool without resharing the
              libraries you imported from others.
            </p>
          </div>
          <div className="stats-panel">
            <HubStat icon={LibraryBig} label="Libraries" value={libraries.length} />
            <HubStat icon={UsersRound} label="Importable" value={importableLibraries.length} />
          </div>
        </section>

        <LibraryHubImportForm libraries={hubLibraries} />
      </div>
    </AppShell>
  );
}

function HubStat({
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
      <div>
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  );
}

function ownerLabel(owner: { name: string | null; email: string | null } | null) {
  if (!owner) return "Curated by Builder Blog.";
  return `Shared by ${owner.name || owner.email || "a Builder Blog user"}.`;
}
