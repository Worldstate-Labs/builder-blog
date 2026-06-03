"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Download, Sliders, Trash2 } from "lucide-react";
import { CountBadge, CountMeta, CountRange, formatCount } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";

type HubLibraryBuilder = {
  id: string;
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
  _count: { feedItems: number };
};

export type HubLibrary = {
  id: string;
  isCommunity: boolean;
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

type FilterKey = "all" | "community" | "shared" | "my" | "imported";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All libraries" },
  { key: "community", label: "Community" },
  { key: "shared", label: "Shared by users" },
  { key: "my", label: "My libraries" },
  { key: "imported", label: "Imported" },
];

export function LibraryHubImportForm({ libraries }: LibraryHubImportFormProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    libraryId: string;
    type: "import" | "remove";
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const importedSignature = useMemo(
    () =>
      libraries
        .filter((library) => library.imported)
        .map((library) => library.id)
        .sort()
        .join("|"),
    [libraries],
  );
  const propImportedIds = useMemo(
    () => new Set(libraries.filter((library) => library.imported).map((library) => library.id)),
    [libraries],
  );
  const [importedState, setImportedState] = useState<{
    ids: Set<string>;
    key: string;
  }>({
    ids: propImportedIds,
    key: importedSignature,
  });
  const importedIds =
    importedState.key === importedSignature ? importedState.ids : propImportedIds;

  function setImportedIds(updater: (current: Set<string>) => Set<string>) {
    setImportedState((current) => {
      const currentIds =
        current.key === importedSignature ? current.ids : propImportedIds;
      return {
        ids: updater(currentIds),
        key: importedSignature,
      };
    });
  }

  const counts = useMemo(() => {
    const all = libraries.length;
    const community = libraries.filter((library) => library.isCommunity).length;
    const my = libraries.filter((library) => library.owned).length;
    const imported = libraries.filter(
      (library) => importedIds.has(library.id) && !library.owned,
    ).length;
    const shared = libraries.filter(
      (library) => !library.isCommunity && !library.owned,
    ).length;
    return { all, community, shared, my, imported };
  }, [libraries, importedIds]);

  const filteredLibraries = libraries.filter((library) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "community") return library.isCommunity;
    if (activeFilter === "my") return library.owned;
    if (activeFilter === "imported") return importedIds.has(library.id) && !library.owned;
    if (activeFilter === "shared") return !library.isCommunity && !library.owned;
    return true;
  });
  const visibleFilters = FILTERS.filter(
    (filter) => filter.key === "all" || counts[filter.key] > 0,
  );
  const showFilters = libraries.length > 3 && visibleFilters.length > 1;

  function importLibrary(libraryId: string) {
    if (pendingAction) return;
    const library = libraries.find((item) => item.id === libraryId);
    if (!library || library.owned || importedIds.has(libraryId)) return;
    setError(null);
    setPendingAction({ libraryId, type: "import" });
    setImportedIds((current) => new Set([...current, libraryId]));

    startTransition(async () => {
      try {
        const response = await fetch("/api/library-hub/imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryIds: [libraryId] }),
        });
        if (!response.ok) throw new Error("Unable to import library");
      } catch {
        setImportedIds((current) => {
          const next = new Set(current);
          next.delete(libraryId);
          return next;
        });
        setError("Could not import library.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function removeImported(libraryId: string) {
    if (pendingAction) return;
    const library = libraries.find((item) => item.id === libraryId);
    if (!library || library.owned || !importedIds.has(libraryId)) return;
    setError(null);
    setPendingAction({ libraryId, type: "remove" });
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
      } finally {
        setPendingAction(null);
      }
    });
  }

  return (
    <section className="hub-import-section">
      {showFilters ? (
        <>
          <nav className="fb-stabs at-desktop" aria-label="Library filter">
            {visibleFilters.map((filter) => (
              <button
                className={`fb-stab${activeFilter === filter.key ? " active" : ""}`}
                key={filter.key}
                onClick={() => setActiveFilter(filter.key)}
                type="button"
              >
                <span>{filter.label}</span>
                <CountBadge value={counts[filter.key]} />
              </button>
            ))}
          </nav>
          <div className="fb-segmented-tabs mobile-filter-tabs at-mobile" aria-label="Library filter">
            {visibleFilters.slice(0, 3).map((filter) => (
              <button
                aria-pressed={activeFilter === filter.key}
                className="fb-btn compact"
                data-active={activeFilter === filter.key ? "true" : undefined}
                key={filter.key}
                onClick={() => setActiveFilter(filter.key)}
                type="button"
              >
                {filter.label.replace(" libraries", "")}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {error ? (
        <p className="hub-form-error" role="status">
          {error}
        </p>
      ) : null}

      <section className={showFilters ? "hub-list-region has-filters" : "hub-list-region"}>
        <div className="hub-list-heading at-desktop">
          <div className="flex items-center justify-between">
            <h2 className="fb-section-heading">Available libraries</h2>
            <CountRange>
              {formatCount(filteredLibraries.length)} {filteredLibraries.length === 1 ? "library" : "libraries"}
            </CountRange>
          </div>
        </div>
        <div className="fb-hub-list">
          {filteredLibraries.map((library) => (
            <HubCard
              key={library.id}
              isPending={isPending}
              library={library}
              imported={importedIds.has(library.id) || library.imported}
              pending={pendingAction?.libraryId === library.id ? pendingAction.type : null}
              onImport={importLibrary}
              onRemove={removeImported}
            />
          ))}
          {filteredLibraries.length === 0 ? (
            <EmptyState
              body="No libraries match this filter yet."
              className="hub-list-empty"
            />
          ) : null}
        </div>
      </section>
    </section>
  );
}

function HubCard({
  imported,
  isPending,
  library,
  onImport,
  onRemove,
  pending,
}: {
  imported: boolean;
  isPending: boolean;
  library: HubLibrary;
  onImport: (id: string) => void;
  onRemove: (id: string) => void;
  pending: "import" | "remove" | null;
}) {
  const sourcePreview = library.items.slice(0, 4);
  const sourceNames = library.items.slice(0, 3).map((item) => item.builder.name);
  const sourceKinds = [
    ...new Set(library.items.slice(0, 3).map((item) => kindLabel(item.builder.kind))),
  ];
  const remainingSources = Math.max(0, library.items.length - sourceNames.length);

  const action = library.owned ? (
    <span className="fb-chip">
      <Sliders aria-hidden="true" />
      Your library
    </span>
  ) : imported ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="fb-chip success">
        <CheckCircle2 aria-hidden="true" />
        {pending === "import" ? "Importing" : "Imported"}
      </span>
      {pending === "import" ? null : (
        <button
          aria-busy={pending === "remove" && isPending}
          aria-label={`Remove ${library.name} from library`}
          className="fb-btn ghost compact disabled:cursor-wait"
          disabled={pending !== null}
          onClick={() => onRemove(library.id)}
          type="button"
        >
          <Trash2 aria-hidden="true" />
          {pending === "remove" ? "Removing" : "Remove"}
        </button>
      )}
    </div>
  ) : (
    <button
      aria-busy={pending === "import" && isPending}
      aria-label={`Import ${library.name}`}
      className="fb-btn dark compact disabled:cursor-wait"
      disabled={pending !== null}
      onClick={() => onImport(library.id)}
      type="button"
    >
      <Download aria-hidden="true" />
      {pending === "import" ? "Importing" : "Import"}
    </button>
  );

  return (
    <article className="fb-hub-card">
      <div>
        <div className="fb-hub-card-head">
          <div className="fb-hub-card-titleblock">
            <div className="fb-hub-card-kicker">
              <span className="fb-kind-pill">{kindBadge(library)}</span>
              <span className="fb-hub-card-topic">· {topicLabel(library)}</span>
            </div>
            <h3 className="fb-hub-title">
              {library.name}
            </h3>
          </div>
          <div className="fb-hub-card-actions">{action}</div>
        </div>

        {library.description ? (
          <p className="fb-hub-card-desc">
            {library.description}
          </p>
        ) : null}
      </div>

      {sourcePreview.length > 0 ? (
        <details className="fb-hub-sources">
          <summary className="fb-hub-sources-summary">
            <div className="fb-hub-source-stack">
              {sourcePreview.map((item, index) => (
                <SourceAvatar
                  index={index}
                  key={item.builderId}
                  name={item.builder.name}
                  stacked={index > 0}
                />
              ))}
            </div>
            <div className="fb-hub-source-summary-text">
              {sourceNames.join(", ")}
              {sourceKinds.length > 0 ? (
                <span> · {sourceKinds.join(", ")}</span>
              ) : null}
              {remainingSources > 0 ? (
                <span>
                  {" "}
                  · <CountMeta label="more sources" value={remainingSources} />
                </span>
              ) : null}
            </div>
            <span aria-hidden="true" className="fb-hub-sources-caret">
              Show
            </span>
          </summary>
          <ul className="fb-hub-source-list">
            {library.items.map((item) => (
              <li
                key={item.builderId}
                className="fb-hub-source-row"
              >
                <span className="fb-kind-pill fb-hub-source-kind">
                  {kindLabel(item.builder.kind)}
                </span>
                <span className="fb-hub-source-name">{item.builder.name}</span>
                {item.builder.handle ? (
                  <span className="fb-hub-source-handle mono">
                    {item.builder.handle.startsWith("@") ? item.builder.handle : `@${item.builder.handle}`}
                  </span>
                ) : null}
              </li>
            ))}
            {library.itemCount > library.items.length ? (
              <li className="fb-hub-source-overflow">
                <CountRange>
                  Showing {formatCount(library.items.length)} of {formatCount(library.itemCount)} sources
                </CountRange>
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}

      <div className="fb-hub-card-stats">
        <CountMeta label={library.itemCount === 1 ? "source" : "sources"} value={library.itemCount} />
        <CountMeta label={library.importCount === 1 ? "import" : "imports"} value={library.importCount} />
        <CountMeta label={library.viewCount === 1 ? "view" : "views"} value={library.viewCount} />
      </div>
    </article>
  );
}

function SourceAvatar({
  index,
  name,
  stacked,
}: {
  index: number;
  name: string;
  stacked?: boolean;
}) {
  return (
    <span
      className={`fb-hub-source-avatar${stacked ? " is-stacked" : ""}`}
      data-avatar-tone={index % 5}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function kindBadge(library: HubLibrary) {
  if (library.isCommunity) return "community";
  if (library.owned) return "private";
  return "shared";
}

function topicLabel(library: HubLibrary) {
  if (library.isCommunity) return "Curated";
  if (library.owned) return "Personal";
  return "Curated by user";
}

function kindLabel(kind: HubLibraryBuilder["kind"]) {
  switch (kind) {
    case "X":
      return "X";
    case "BLOG":
      return "Blog";
    case "PODCAST":
      return "Podcast";
    case "WEBSITE":
      return "Website";
    default:
      return kind;
  }
}
