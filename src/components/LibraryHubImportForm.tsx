"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Download, Sliders, Trash2 } from "lucide-react";

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

const AVATAR_COLORS = ["#e6e0d3", "#dde2ec", "#e9e0e6", "#d8e3dc", "#e7dccb"];

export function LibraryHubImportForm({ libraries }: LibraryHubImportFormProps) {
  const [importedIds, setImportedIds] = useState<Set<string>>(
    () => new Set(libraries.filter((library) => library.imported).map((library) => library.id)),
  );
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    libraryId: string;
    type: "import" | "remove";
  } | null>(null);
  const [isPending, startTransition] = useTransition();

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
    <section className="mt-5">
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
                <span className="fb-stab-count">{counts[filter.key]}</span>
              </button>
            ))}
          </nav>
          <div className="fb-m-segctl at-mobile" aria-label="Library filter">
            {visibleFilters.slice(0, 3).map((filter) => (
              <button
                className={`fb-m-seg${activeFilter === filter.key ? " active" : ""}`}
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
        <p className="mt-3 text-xs text-[var(--danger)]" role="status">
          {error}
        </p>
      ) : null}

      <section className={showFilters ? "mt-7" : "mt-0"}>
        <div className="mb-3.5 at-desktop">
          <div className="flex items-center justify-between">
            <h2 className="fb-section-heading">Available libraries</h2>
            <span className="text-xs text-[var(--muted)]">
              {filteredLibraries.length} {filteredLibraries.length === 1 ? "library" : "libraries"}
            </span>
          </div>
        </div>
        <div className="grid gap-3.5 lg:grid-cols-2">
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
            <div className="fb-panel dashed col-span-full text-sm text-[var(--muted-strong)]">
              No libraries match this filter yet.
            </div>
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="fb-kind-pill">{kindBadge(library)}</span>
              <span className="text-[11px] text-[var(--muted)]">· {topicLabel(library)}</span>
            </div>
            <h3 className="serif mt-2 text-xl font-semibold leading-snug tracking-tight">
              {library.name}
            </h3>
          </div>
          {action}
        </div>

        {library.description ? (
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted-strong)]">
            {library.description}
          </p>
        ) : null}
      </div>

      {sourcePreview.length > 0 ? (
        <div className="flex items-center gap-3">
          <div className="flex">
            {sourcePreview.map((item, index) => (
              <SourceAvatar
                key={item.builderId}
                name={item.builder.name}
                index={index}
                style={index === 0 ? undefined : { marginLeft: -8 }}
              />
            ))}
          </div>
          <div className="min-w-0 text-[12px] leading-relaxed text-[var(--muted-strong)]">
            {sourceNames.join(", ")}
            {sourceKinds.length > 0 ? (
              <span className="text-[var(--muted)]"> · {sourceKinds.join(", ")}</span>
            ) : null}
            {remainingSources > 0 ? (
              <span className="text-[var(--muted)]"> · +{remainingSources} more</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] pt-3 text-[11.5px] font-semibold text-[var(--muted)]">
        <span>
          <span className="mr-1 font-bold text-[var(--ink)]">{library.itemCount}</span>
          sources
        </span>
        <span>
          <span className="mr-1 font-bold text-[var(--ink)]">
            {library.importCount.toLocaleString()}
          </span>
          imports
        </span>
        <span>
          <span className="mr-1 font-bold text-[var(--ink)]">
            {library.viewCount.toLocaleString()}
          </span>
          views
        </span>
      </div>
    </article>
  );
}

function SourceAvatar({
  index,
  name,
  style,
}: {
  index: number;
  name: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        background: AVATAR_COLORS[index % AVATAR_COLORS.length],
        color: "var(--ink)",
        fontFamily: "var(--font-display)",
        fontWeight: 600,
        fontSize: 13,
        border: "2px solid var(--paper-strong)",
        ...style,
      }}
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
