"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { SourceBadge } from "@/components/SourceBadge";

type HubLibraryBuilder = {
  id: string;
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  crawlUrl: string | null;
  _count: { feedItems: number };
};

export type HubLibrary = {
  id: string;
  kind: "CENTRAL" | "PERSONAL";
  name: string;
  description: string | null;
  ownerUserId: string | null;
  importCount: number;
  viewCount: number;
  itemCount: number;
  ownerLabel: string;
  items: Array<{
    builderId: string;
    builder: HubLibraryBuilder;
  }>;
  imported: boolean;
  owned: boolean;
};

type LibraryHubImportFormProps = {
  libraries: HubLibrary[];
};

export function LibraryHubImportForm({ libraries }: LibraryHubImportFormProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [importedIds, setImportedIds] = useState<Set<string>>(
    () => new Set(libraries.filter((library) => library.imported).map((library) => library.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggleLibrary(libraryId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(libraryId)) {
        next.delete(libraryId);
      } else {
        next.add(libraryId);
      }
      return next;
    });
  }

  function importSelected() {
    if (selectedIds.length === 0 || isPending) return;
    const importingIds = selectedIds;
    setError(null);
    setImportedIds((current) => new Set([...current, ...importingIds]));
    setSelected(new Set());

    startTransition(async () => {
      try {
        const response = await fetch("/api/library-hub/imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryIds: importingIds }),
        });
        if (!response.ok) throw new Error("Unable to import libraries");
      } catch {
        setImportedIds((current) => {
          const next = new Set(current);
          for (const id of importingIds) next.delete(id);
          return next;
        });
        setSelected(new Set(importingIds));
        setError("Could not import selected libraries.");
      }
    });
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="section-heading">Available libraries</h2>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">
            Select one or more libraries, then import their sources.
          </p>
        </div>
        <div className="inline-flex flex-col items-end gap-2">
          <button
            aria-busy={isPending}
            className="button-dark button-compact gap-2"
            disabled={selectedIds.length === 0 || isPending}
            onClick={importSelected}
            type="button"
          >
            <Download className="h-4 w-4" />
            {isPending ? "Importing..." : "Import selected"}
          </button>
          {error ? (
            <span className="text-xs text-[var(--danger)]" role="status">
              {error}
            </span>
          ) : null}
        </div>
      </div>

      <div className="library-hub-grid mt-5">
        {libraries.map((library) => {
          const imported = importedIds.has(library.id);
          return (
            <article className="library-hub-card" data-selected={selected.has(library.id) ? "true" : undefined} key={library.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="item-kicker">
                    <span>{library.kind === "CENTRAL" ? "Central" : "Shared"}</span>
                    <span>{library.itemCount} sources</span>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold leading-snug">{library.name}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
                    {library.description || library.ownerLabel}
                  </p>
                </div>
                {library.owned ? (
                  <span className="sub-pill">Yours</span>
                ) : imported ? (
                  <span className="status-chip status-chip-success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Imported
                  </span>
                ) : (
                  <label className="hub-checkbox">
                    <input
                      checked={selected.has(library.id)}
                      disabled={isPending}
                      name="libraryId"
                      onChange={() => toggleLibrary(library.id)}
                      type="checkbox"
                      value={library.id}
                    />
                    <span>Select</span>
                  </label>
                )}
              </div>

              <div className="library-hub-summary">
                <span>{library.importCount} imports</span>
                <span>{library.ownerLabel}</span>
              </div>

              <div className="mt-4 grid gap-2">
                {library.items.map((item) => (
                  <div className="hub-builder-row" key={item.builderId}>
                    <span className="min-w-0 truncate">{item.builder.name}</span>
                    <SourceBadge builder={item.builder} />
                  </div>
                ))}
                {library.itemCount > library.items.length ? (
                  <p className="text-xs font-semibold text-[var(--muted)]">
                    + {library.itemCount - library.items.length} more sources
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
