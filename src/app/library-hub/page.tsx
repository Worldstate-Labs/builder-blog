import { BuilderScope, LibraryHubKind } from "@prisma/client";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { Download, Eye, LibraryBig, Share2, UsersRound } from "lucide-react";
import {
  importHubLibrariesAction,
  sharePersonalLibraryToHubAction,
} from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { getCurrentSession } from "@/lib/auth";
import {
  recordLibraryHubViews,
  syncCentralLibraryHub,
} from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";
import { builderSourceLabel } from "@/lib/source-registry";

export default async function LibraryHubPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  await syncCentralLibraryHub();

  const [libraries, personalBuilderCount, ownEntry, imports] = await Promise.all([
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
      orderBy: [{ kind: "asc" }, { importCount: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.builder.count({
      where: { scope: BuilderScope.PERSONAL, ownerUserId: session.user.id },
    }),
    prisma.libraryHubEntry.findFirst({
      where: { ownerUserId: session.user.id, kind: LibraryHubKind.PERSONAL },
      select: { id: true },
    }),
    prisma.libraryImport.findMany({
      where: { userId: session.user.id },
      select: { hubEntryId: true },
    }),
  ]);
  await recordLibraryHubViews(libraries.map((library) => library.id));

  const importedLibraryIds = new Set(imports.map((item) => item.hubEntryId));
  const importableLibraries = libraries.filter((library) => library.ownerUserId !== session.user.id);

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
            <HubStat icon={Share2} label="Your private builders" value={personalBuilderCount} />
          </div>
        </section>

        <section className="action-panel mt-8 md:p-6">
          <div className="grid gap-5 lg:grid-cols-[1fr_28rem]">
            <div>
              <h2 className="font-serif text-3xl">Share your private library</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                Only builders you own in your personal library are shared.
                Central builders and libraries imported from the hub are not
                included.
              </p>
              <p className="mt-3 text-sm font-semibold text-[var(--ink)]">
                {personalBuilderCount} private builder{personalBuilderCount === 1 ? "" : "s"} ready to share.
              </p>
            </div>
            <form action={sharePersonalLibraryToHubAction} className="grid gap-3">
              <label>
                <span className="sr-only">Library name</span>
                <input
                  className="input"
                  name="name"
                  defaultValue={`${session.user.name || session.user.email || "Personal"} library`}
                  placeholder="Library name"
                />
              </label>
              <label>
                <span className="sr-only">Description</span>
                <input
                  className="input"
                  name="description"
                  placeholder="Short description"
                />
              </label>
              <FormSubmitButton
                className="button-dark gap-2"
                disabled={personalBuilderCount === 0}
                pendingLabel="Sharing..."
              >
                <Share2 className="h-4 w-4" />
                {ownEntry ? "Update shared library" : "Share to hub"}
              </FormSubmitButton>
            </form>
          </div>
        </section>

        <form action={importHubLibrariesAction} className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="section-label">Explore</p>
              <h2 className="mt-2 font-serif text-4xl">Library hub</h2>
            </div>
            <FormSubmitButton className="button-dark gap-2" pendingLabel="Importing...">
              <Download className="h-4 w-4" />
              Import selected
            </FormSubmitButton>
          </div>

          <div className="library-hub-grid mt-5">
            {libraries.map((library) => (
              <article className="library-hub-card" key={library.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="item-kicker">
                      <span>{library.kind === LibraryHubKind.CENTRAL ? "Central" : "Shared"}</span>
                      <span>{library._count.items} builders</span>
                    </div>
                    <h3 className="mt-2 font-serif text-2xl">{library.name}</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                      {library.description || ownerLabel(library.owner)}
                    </p>
                  </div>
                  {library.ownerUserId === session.user.id ? (
                    <span className="sub-pill">Yours</span>
                  ) : (
                    <label className="hub-checkbox">
                      <input name="libraryId" type="checkbox" value={library.id} />
                      <span>Select</span>
                    </label>
                  )}
                </div>

                <div className="library-hub-metrics">
                  <Metric icon={Download} label="Imports" value={library.importCount} />
                  <Metric icon={Eye} label="Views" value={library.viewCount + 1} />
                  <Metric icon={LibraryBig} label="Status" value={importedLibraryIds.has(library.id) ? "Imported" : "Ready"} />
                </div>

                <div className="mt-4 grid gap-2">
                  {library.items.map((item) => (
                    <div className="hub-builder-row" key={item.builderId}>
                      <span className="min-w-0 truncate">{item.builder.name}</span>
                      <span className="kind-pill">{builderSourceLabel(item.builder)}</span>
                    </div>
                  ))}
                  {library._count.items > library.items.length ? (
                    <p className="text-xs font-semibold text-[var(--muted)]">
                      + {library._count.items - library.items.length} more builders
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </form>
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

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
}) {
  return (
    <div className="hub-metric">
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ownerLabel(owner: { name: string | null; email: string | null } | null) {
  if (!owner) return "Curated by Builder Blog.";
  return `Shared by ${owner.name || owner.email || "a Builder Blog user"}.`;
}
