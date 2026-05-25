"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Download, Trash2 } from "lucide-react";
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
  const importedCount = libraries.filter((library) => importedIds.has(library.id)).length;
  const selectableCount = libraries.filter(
    (library) => !library.owned && !importedIds.has(library.id),
  ).length;

  function toggleLibrary(libraryId: string) {
    const library = libraries.find((item) => item.id === libraryId);
    if (!library || library.owned || importedIds.has(libraryId)) return;
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

  function removeImported(libraryId: string) {
    if (isPending) return;
    const library = libraries.find((item) => item.id === libraryId);
    if (!library || library.owned || !importedIds.has(libraryId)) return;
    setError(null);
    setImportedIds((current) => {
      const next = new Set(current);
      next.delete(libraryId);
      return next;
    });

    startTransition(async () => {
      try {
        const response = await fetch("/api/library-hub/imports", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryId }),
        });
        if (!response.ok) throw new Error("Unable to remove library import");
      } catch {
        setImportedIds((current) => new Set([...current, libraryId]));
        setError("Could not remove imported library.");
      }
    });
  }

  return (
    <section className="mt-6">
      <div className="library-hub-toolbar">
        <div>
          <h2 className="section-heading">Available libraries</h2>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">
            Community Library is added to new accounts automatically. Import other shared libraries when useful.
          </p>
        </div>
        <div className="library-hub-counts" aria-label="Library hub summary">
          <span>{libraries.length} shared</span>
          <span>{importedCount} in library</span>
          <span>{selectableCount} available</span>
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
            {isPending ? "Importing..." : `Import selected${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
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
          const ownerText = library.ownerLabel === library.name ? null : library.ownerLabel;
          return (
            <article
              className="library-hub-card"
              data-selected={selected.has(library.id) ? "true" : undefined}
              key={library.id}
            >
              <div className="library-hub-card-header">
                <div className="min-w-0">
                  <div className="item-kicker">
                    <span>Shared</span>
                    <span>{library.itemCount} sources</span>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold leading-snug">{library.name}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
                    {library.description || library.ownerLabel}
                  </p>
                </div>
                {library.owned ? (
                  <span className="sub-pill">Your library</span>
                ) : imported ? (
                  <div className="library-hub-card-actions">
                    <span className="status-chip status-chip-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      In library
                    </span>
                    <button
                      aria-label={`Remove ${library.name} from library`}
                      className="button-light button-compact button-danger gap-2"
                      disabled={isPending}
                      onClick={() => removeImported(library.id)}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    aria-label={`${selected.has(library.id) ? "Deselect" : "Add"} ${library.name}`}
                    aria-pressed={selected.has(library.id)}
                    className={`hub-select-button button-compact gap-2 ${
                      selected.has(library.id) ? "button-dark" : "button-light"
                    }`}
                    disabled={isPending}
                    onClick={() => toggleLibrary(library.id)}
                    type="button"
                  >
                    {selected.has(library.id) ? <CheckCircle2 className="h-4 w-4" /> : null}
                    {selected.has(library.id) ? "Added" : "Add"}
                  </button>
                )}
              </div>

              <div className="library-hub-summary">
                <span>{library.importCount} imports</span>
                {ownerText ? <span>{ownerText}</span> : null}
              </div>

              <div className="library-hub-sources">
                {library.items.map((item) => (
                  <div className="hub-builder-row" key={item.builderId}>
                    <span className="min-w-0 truncate">{item.builder.name}</span>
                    <SourceBadge builder={item.builder} />
                  </div>
                ))}
                {library.items.length === 0 ? (
                  <p className="text-sm text-[var(--muted-strong)]">No sources shared yet.</p>
                ) : null}
                {library.itemCount > library.items.length ? (
                  <p className="text-xs font-semibold text-[var(--muted)]">
                    + {library.itemCount - library.items.length} more sources
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
        {libraries.length === 0 ? (
          <div className="empty-panel text-[var(--muted-strong)]">
            No shared libraries are available yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}
