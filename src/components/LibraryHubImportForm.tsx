"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
} from "react";
import { CheckCircle2, ChevronDown, Download } from "lucide-react";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import { CountBadge, CountMeta, CountRange, formatCount } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { RelativeTime } from "@/components/RelativeTime";
import { SourceAvatar } from "@/components/SourceAvatar";
import { UserName } from "@/components/UserName";
import { normalizeSourceType, sourceLabelForType } from "@/lib/source-display";

const sourceLibraryImportDescription =
  "Import shared source libraries for AI Brief and Following.";

type HubLibraryBuilder = {
  id: string;
  entityId: string | null;
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType: string;
  name: string;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  handle: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
  lastFetchedAt: string | null;
  _count: { feedItems: number };
};

type SourceGroup = {
  sourceType: string;
  label: string;
  items: Array<{
    builderId: string;
    builder: HubLibraryBuilder;
  }>;
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

const FILTERS: Array<{ key: FilterKey; label: string; shortLabel: string }> = [
  { key: "all", label: "All source libraries", shortLabel: "All libraries" },
  { key: "community", label: "Community", shortLabel: "Community" },
  { key: "shared", label: "Shared source libraries", shortLabel: "Shared" },
  { key: "my", label: "Your source libraries", shortLabel: "Yours" },
  { key: "imported", label: "Imported", shortLabel: "Imported" },
];

export function LibraryHubImportForm({ libraries }: LibraryHubImportFormProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    libraryId: string;
    type: "import" | "remove";
  } | null>(null);
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const propImported = useMemo(() => {
    const ids = new Set<string>();
    for (const library of libraries) {
      if (library.imported) ids.add(library.id);
    }
    return {
      ids,
      key: [...ids].sort().join("|"),
    };
  }, [libraries]);
  const importedSignature = propImported.key;
  const propImportedIds = propImported.ids;
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

  const { counts, filteredLibraries } = useMemo(() => {
    const nextCounts: Record<FilterKey, number> = {
      all: libraries.length,
      community: 0,
      imported: 0,
      my: 0,
      shared: 0,
    };
    const nextFilteredLibraries: HubLibrary[] = [];

    for (const library of libraries) {
      const isImported = importedIds.has(library.id) && !library.owned;
      const isShared = !library.isCommunity && !library.owned;
      if (library.isCommunity) nextCounts.community += 1;
      if (library.owned) nextCounts.my += 1;
      if (isImported) nextCounts.imported += 1;
      if (isShared) nextCounts.shared += 1;

      if (
        activeFilter === "all" ||
        (activeFilter === "community" && library.isCommunity) ||
        (activeFilter === "my" && library.owned) ||
        (activeFilter === "imported" && isImported) ||
        (activeFilter === "shared" && isShared)
      ) {
        nextFilteredLibraries.push(library);
      }
    }

    return {
      counts: nextCounts,
      filteredLibraries: nextFilteredLibraries,
    };
  }, [activeFilter, libraries, importedIds]);
  const visibleFilters = FILTERS.filter(
    (filter) => filter.key === "all" || counts[filter.key] > 0,
  );
  const showFilters = libraries.length > 3 && visibleFilters.length > 1;
  const listCopy = sourceLibraryListCopy(activeFilter);
  const emptyTitle =
    activeFilter === "all"
      ? "No source libraries yet"
      : activeFilter === "imported"
        ? "No imported source libraries"
        : "No matching source libraries";
  const emptyBody =
    activeFilter === "all"
      ? "No source libraries have been shared."
      : listCopy.emptyBody;
  const removeTarget = removeTargetId
    ? libraries.find((library) => library.id === removeTargetId) ?? null
    : null;

  useEffect(() => {
    const dialog = removeDialogRef.current;
    if (!dialog) return;
    if (removeTarget) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (dialog.open) dialog.close();
  }, [removeTarget]);

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
        if (!response.ok) throw new Error("Could not import source library.");
      } catch {
        setImportedIds((current) => {
          const next = new Set(current);
          next.delete(libraryId);
          return next;
        });
        setError("Could not import source library.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function requestRemoveImported(libraryId: string) {
    if (pendingAction) return;
    const library = libraries.find((item) => item.id === libraryId);
    if (!library || library.owned || !importedIds.has(libraryId)) return;
    setError(null);
    setRemoveTargetId(libraryId);
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
        if (!response.ok) throw new Error("Could not remove imported source library.");
      } catch {
        setImportedIds((current) => new Set([...current, libraryId]));
        setError("Could not remove imported source library.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function closeRemoveDialog() {
    if (removeDialogRef.current?.open) {
      removeDialogRef.current.close();
    }
    setRemoveTargetId(null);
  }

  function handleRemoveDialogClose() {
    setRemoveTargetId(null);
  }

  function confirmRemoveImported() {
    if (!removeTargetId) return;
    const libraryId = removeTargetId;
    closeRemoveDialog();
    removeImported(libraryId);
  }

  return (
    <section className="hub-import-section">
      <div className="library-hub-toolbar">
        <div className="library-hub-toolbar-copy">
          <h2 className="fb-section-heading">Source libraries</h2>
          <p className="hub-section-copy">
            {sourceLibraryImportDescription}
          </p>
        </div>
      </div>

      {showFilters ? (
        <>
          <div
            aria-label="Source library filter"
            className="fb-segmented-tabs filter-tabs at-desktop"
            role="group"
          >
            {visibleFilters.map((filter) => (
              <button
                aria-label={sourceLibraryFilterLabel(filter, counts[filter.key])}
                aria-pressed={activeFilter === filter.key}
                className="fb-btn compact"
                data-active={activeFilter === filter.key ? "true" : undefined}
                key={filter.key}
                onClick={() => setActiveFilter(filter.key)}
                type="button"
              >
                <span>{filter.label}</span>
                <CountBadge value={counts[filter.key]} />
              </button>
            ))}
          </div>
          <div
            aria-label="Source library filter"
            className="fb-segmented-tabs mobile-filter-tabs at-mobile"
            role="group"
          >
            {visibleFilters.map((filter) => (
              <button
                aria-label={sourceLibraryFilterLabel(filter, counts[filter.key])}
                aria-pressed={activeFilter === filter.key}
                className="fb-btn compact"
                data-active={activeFilter === filter.key ? "true" : undefined}
                key={filter.key}
                onClick={() => setActiveFilter(filter.key)}
                type="button"
              >
                {filter.shortLabel}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {showFilters && activeFilter !== "all" ? (
        <p className="hub-list-context">{listCopy.description}</p>
      ) : null}

      {error ? (
        <p className="hub-form-error" role="status">
          {error}
        </p>
      ) : null}

      <section className={showFilters ? "hub-list-region has-filters" : "hub-list-region"}>
        <div className="fb-hub-list">
          {filteredLibraries.map((library) => (
            <HubCard
              key={library.id}
              isPending={isPending || pendingAction !== null}
              library={library}
              imported={importedIds.has(library.id)}
              pending={pendingAction?.libraryId === library.id ? pendingAction.type : null}
              onImport={importLibrary}
              onRemove={requestRemoveImported}
            />
          ))}
          {filteredLibraries.length === 0 ? (
            <EmptyState
              actions={
                activeFilter === "imported" ? (
                  <button
                    className="fb-btn light compact"
                    onClick={() => setActiveFilter("all")}
                    type="button"
                  >
                    Browse source libraries
                  </button>
                ) : null
              }
              className="hub-list-empty"
              body={emptyBody}
              title={emptyTitle}
            />
          ) : null}
        </div>
      </section>

      <dialog
        aria-labelledby="hub-remove-source-library-title"
        className="fb-dialog"
        onClick={(event) => {
          if (event.target === removeDialogRef.current) closeRemoveDialog();
        }}
        onClose={handleRemoveDialogClose}
        ref={removeDialogRef}
      >
        {removeTarget ? (
          <div className="fb-dialog-inner settings-dialog-stack">
            <h3 className="fb-section-heading" id="hub-remove-source-library-title">
              Remove imported source library?
            </h3>
            <div className="settings-dialog-copy">
              <p>
                Removing <strong>{removeTarget.name}</strong> removes its sources
                from Sources and stops feeding AI Brief and Following.
              </p>
              <p className="settings-dialog-warning">
                You can import it again from Hub.
              </p>
            </div>
            <div className="settings-dialog-actions">
              <button
                className="fb-btn light compact"
                onClick={closeRemoveDialog}
                type="button"
              >
                Cancel
              </button>
              <button
                className="fb-btn danger compact"
                onClick={confirmRemoveImported}
                type="button"
              >
                Remove import
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}

function sourceLibraryFilterLabel(
  filter: (typeof FILTERS)[number],
  count: number,
) {
  return `${filter.label}, ${formatCount(count)} ${count === 1 ? "source library" : "source libraries"}`;
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
  const sourceGroups = groupedSources(library.items);
  const sourceSummaryItems = selectSourceSummaryItems(library.items, sourceGroups, 4);
  const hiddenSourceSummaryCount = Math.max(0, library.itemCount - sourceSummaryItems.length);
  const latestFetchedAt = latestIso(
    library.items.map((item) => item.builder.lastFetchedAt),
  );
  const sourceToggleLabel = formatSourceToggleLabel(library.itemCount);

  const action = library.owned ? null : imported && pending !== "import" ? (
    <button
      aria-busy={pending === "remove" && isPending}
      aria-label={`Remove imported source library ${library.name}`}
      aria-pressed={true}
      className="fb-btn light compact hub-card-action-button is-imported"
      disabled={isPending || pending !== null}
      onClick={() => onRemove(library.id)}
      type="button"
    >
      <CheckCircle2 aria-hidden="true" />
      {pending === "remove" ? "Removing" : "Imported"}
    </button>
  ) : (
    <button
      aria-busy={pending === "import" && isPending}
      aria-label={`Import source library ${library.name}`}
      aria-pressed={false}
      className="fb-btn dark compact hub-card-action-button"
      disabled={isPending || pending !== null}
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
            <h3 className="fb-hub-title">
              {library.name}
            </h3>
          </div>
          {action ? (
            <div
              aria-label={`Source library actions for ${library.name}`}
              className="fb-hub-card-actions"
              role="group"
            >
              {action}
            </div>
          ) : null}
        </div>
      </div>

      {sourceGroups.length > 0 ? (
        <details className="fb-hub-sources">
          <summary className="fb-hub-sources-summary" aria-label={`${sourceToggleLabel} in ${library.name}`}>
            <div className="fb-hub-source-summary-strip">
              <span className="fb-hub-source-summary-avatar-stack" aria-hidden="true">
                {sourceSummaryItems.map((item) => {
                  const sourceType = sourceTypeForBuilder(item.builder);
                  return (
                    <SourceAvatar
                      className="fb-hub-source-summary-avatar"
                      imageSize={32}
                      key={item.builderId}
                      source={{
                        avatarDataUrl: item.builder.avatarDataUrl,
                        avatarUrl: item.builder.avatarUrl,
                        fetchUrl: item.builder.fetchUrl,
                        name: item.builder.name,
                        sourceType,
                        sourceUrl: item.builder.sourceUrl,
                      }}
                    />
                  );
                })}
                {hiddenSourceSummaryCount > 0 ? (
                  <span className="fb-hub-source-summary-avatar-more">
                    +{formatCount(hiddenSourceSummaryCount)}
                  </span>
                ) : null}
              </span>
              <span className="fb-hub-source-summary-more">
                {sourceToggleLabel}
              </span>
            </div>
            <span aria-hidden="true" className="fb-hub-sources-caret">
              <ChevronDown />
            </span>
          </summary>
          <div className="fb-hub-source-type-groups">
            <ul className="fb-hub-source-list">
              {library.items.map((item) => {
                return <HubSourceRow item={item} key={item.builderId} />;
              })}
            </ul>
            {library.itemCount > library.items.length ? (
              <div className="fb-hub-source-overflow">
                <CountRange>
                  Showing {formatCount(library.items.length)} of {formatCount(library.itemCount)} sources
                </CountRange>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <div className="fb-hub-card-stats fb-hub-card-stats--source-library">
        <CountMeta label={library.importCount === 1 ? "import" : "imports"} value={library.importCount} />
        <CountMeta label={library.viewCount === 1 ? "view" : "views"} value={library.viewCount} />
        <div className="fb-hub-card-fetch-date">
          <RelativeTime prefix="fetched " value={latestFetchedAt} fallback="not fetched yet" />
        </div>
        <span className="fb-hub-card-owner">
          {sourceLibraryByline(library)}
        </span>
      </div>
    </article>
  );
}

function HubSourceRow({
  item,
}: {
  item: HubLibrary["items"][number];
}) {
  const postsListId = useId();
  const [postsOpen, setPostsOpen] = useState(false);
  const builder = item.builder;
  const sourceHref = sourceUrlForBuilder(builder);
  const sourceLabel = sourceHref ? sourceOriginLabel(sourceHref) : null;
  const sourceType = sourceTypeForBuilder(builder);
  const postCount = builder._count.feedItems;
  const hasPosts = postCount > 0;
  const postCountLabel = `${formatCount(postCount)} ${postCount === 1 ? "post" : "posts"}`;
  const postsSummaryLabel = `${builder.name} posts, ${postCountLabel}`;

  function togglePosts() {
    if (!hasPosts) return;
    setPostsOpen((current) => !current);
  }

  function onRowClick(event: MouseEvent<HTMLLIElement>) {
    if (!hasPosts || shouldIgnoreSourceToggleTarget(event.target, event.currentTarget)) return;
    togglePosts();
  }

  return (
    <li
      className="fb-hub-source-row"
      data-expandable={hasPosts ? "true" : undefined}
      onClick={onRowClick}
    >
      <SourceAvatar
        className="builder-library-avatar"
        imageSize={40}
        source={{
          avatarDataUrl: builder.avatarDataUrl,
          avatarUrl: builder.avatarUrl,
          fetchUrl: builder.fetchUrl,
          name: builder.name,
          sourceType,
          sourceUrl: builder.sourceUrl,
        }}
      />
      <div className="builder-library-card-main">
        <div className="builder-library-info">
          <div className="builder-library-info-head">
            <div className="builder-library-name">{builder.name}</div>
          </div>
          <div className="builder-library-meta">
            {sourceHref && sourceLabel ? (
              <a
                aria-label={`Open source site for ${builder.name}`}
                className="builder-library-source-link"
                href={sourceHref}
                rel="noreferrer"
                target="_blank"
              >
                {sourceLabel}
              </a>
            ) : null}
            {hasPosts ? (
              <button
                aria-controls={postsListId}
                aria-expanded={postsOpen}
                aria-label={postsSummaryLabel}
                className="builder-posts-summary"
                onClick={togglePosts}
                type="button"
              >
                <span className="builder-posts-count">
                  <span>{postCountLabel}</span>
                  <ChevronDown aria-hidden="true" className="builder-posts-chevron" />
                </span>
              </button>
            ) : (
              <span className="builder-library-posts-placeholder">
                No summarized posts yet
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span className="fb-hub-source-fetched-at">
              <RelativeTime
                prefix="fetched "
                value={builder.lastFetchedAt}
                fallback="not fetched yet"
              />
            </span>
          </div>
        </div>
      </div>
      {hasPosts ? (
        <div className="builder-library-card-posts">
          <BuilderFeedItems
            builder={builder}
            builderId={builder.id}
            isOpen={postsOpen}
            listId={postsListId}
            totalCount={postCount}
          />
        </div>
      ) : null}
    </li>
  );
}

function shouldIgnoreSourceToggleTarget(target: EventTarget, currentTarget: HTMLElement) {
  if (!(target instanceof Element)) return true;
  if (target.closest(".builder-library-card-posts")) return true;
  const interactiveTarget = target.closest(
    "a, button, input, select, textarea, summary, [role='button'], [data-source-toggle-ignore='true']",
  );
  return Boolean(interactiveTarget && interactiveTarget !== currentTarget);
}

function sourceLibraryListCopy(filter: FilterKey) {
  switch (filter) {
    case "community":
      return {
        description: "Curated source libraries maintained by FollowBrief.",
        emptyBody: "No community source libraries match this filter.",
      };
    case "my":
      return {
        description: "Source libraries you can edit and share.",
        emptyBody: "Share a source library to list it here.",
      };
    case "imported":
      return {
        description: "Source libraries already added to Sources.",
        emptyBody: "Import source libraries from Hub.",
      };
    case "shared":
      return {
        description: "Source libraries shared by other users.",
        emptyBody: "No shared source libraries match this filter.",
      };
    case "all":
    default:
      return {
        description: sourceLibraryImportDescription,
        emptyBody: "Try another source library filter.",
      };
  }
}

function sourceLibraryByline(library: HubLibrary) {
  if (library.owned) return "Your source library";
  if (library.isCommunity) return "Curated by FollowBrief";
  return <>by <UserName>{sourceLibraryOwnerName(library.ownerLabel)}</UserName></>;
}

function sourceLibraryOwnerName(ownerLabel: string) {
  const label = ownerLabel
    .trim()
    .replace(/^Shared by\s+/i, "")
    .replace(/^By\s+/i, "")
    .replace(/[.。]+$/u, "");
  return label || "a FollowBrief user";
}

function formatSourceToggleLabel(sourceCount: number) {
  return `View ${formatCount(sourceCount)} ${sourceCount === 1 ? "source" : "sources"}`;
}

function sourceTypeForBuilder(builder: HubLibraryBuilder) {
  const explicit = normalizeSourceType(builder.sourceType);
  if (explicit) return explicit;
  switch (builder.kind) {
    case "X":
      return "x";
    case "BLOG":
      return "blog";
    case "PODCAST":
      return "podcast";
    case "WEBSITE":
      return "website";
    default:
      return "website";
  }
}

function sourceUrlForBuilder(builder: HubLibraryBuilder) {
  return builder.sourceUrl ?? builder.fetchUrl;
}

function sourceOriginLabel(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || value;
  }
}

function selectSourceSummaryItems(
  libraryItems: HubLibrary["items"],
  sourceGroups: SourceGroup[],
  limit: number,
) {
  const selected: HubLibrary["items"] = [];
  const pickedBuilderIds = new Set<string>();
  for (const group of sourceGroups) {
    const first = group.items[0];
    if (!first) continue;
    selected.push(first);
    pickedBuilderIds.add(first.builderId);
    if (selected.length >= limit) return selected;
  }
  for (const item of libraryItems) {
    if (pickedBuilderIds.has(item.builderId)) continue;
    selected.push(item);
    if (selected.length >= limit) return selected;
  }
  return selected;
}

function groupedSources(libraryItems: HubLibrary["items"]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const item of libraryItems) {
    const sourceType = sourceTypeForBuilder(item.builder);
    const existing = groups.get(sourceType);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(sourceType, {
        sourceType,
        label: sourceLabelForType(sourceType),
        items: [item],
      });
    }
  }
  return [...groups.values()].sort((a, b) => {
    const rank = sourceTypeRank(a.sourceType) - sourceTypeRank(b.sourceType);
    if (rank !== 0) return rank;
    return a.label.localeCompare(b.label);
  });
}

function sourceTypeRank(sourceType: string) {
  const order = [
    "blog",
    "github_trending",
    "product_hunt_top_products",
    "youtube",
    "podcast",
    "x",
    "website",
  ];
  const index = order.indexOf(sourceType);
  return index === -1 ? order.length : index;
}

function latestIso(values: Array<string | null>) {
  return values.reduce<string | null>((latest, value) => maxIso(latest, value), null);
}

function maxIso(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
