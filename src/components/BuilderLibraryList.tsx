"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BuilderEditDialog } from "@/components/BuilderEditDialog";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import { BuilderLibraryActions } from "@/components/BuilderLibraryActions";
import { formatCount } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { SourceBadge } from "@/components/SourceBadge";
import { SourceAvatar } from "@/components/SourceAvatar";
import {
  builderLibraryBuilderAdded,
  type BuilderLibraryEventItem,
} from "@/lib/builder-library-events";

export type BuilderLibraryListItem = BuilderLibraryEventItem;

type SourceOption = { id: string; label: string };

type BuilderLibraryListProps = {
  acceptAddedBuilders?: boolean;
  builders: BuilderLibraryListItem[];
  emptyBody: string;
  emptyTitle?: string;
  /**
   * Optional source-type options. When provided, each row's owner can
   * open an Edit dialog that lets them change the same three fields
   * (sourceType / sourceValue / display name) used at creation time.
   * Omit on lists that don't grant edit rights (e.g. central pool).
   */
  editableSourceOptions?: SourceOption[];
};

export function BuilderLibraryList({
  acceptAddedBuilders = false,
  builders,
  emptyBody,
  emptyTitle,
  editableSourceOptions,
}: BuilderLibraryListProps) {
  const [addedBuilders, setAddedBuilders] = useState<BuilderLibraryListItem[]>([]);
  const [expandedSourceTypes, setExpandedSourceTypes] = useState<Set<string>>(
    () => initialExpandedSourceTypes(builders),
  );
  const [removedBuilderIds, setRemovedBuilderIds] = useState<Set<string>>(() => new Set());
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const listId = useId();
  const builderSubscriptionSignature = useMemo(
    () => builders.map((builder) => `${builder.id}:${builder.subscribed}`).join("|"),
    [builders],
  );
  const propSubscribedByBuilderId = useMemo(
    () => Object.fromEntries(builders.map((builder) => [builder.id, builder.subscribed])),
    [builders],
  );
  const [subscribedState, setSubscribedState] = useState<{
    key: string;
    values: Record<string, boolean>;
  }>({
    key: builderSubscriptionSignature,
    values: propSubscribedByBuilderId,
  });
  const subscribedByBuilderId =
    subscribedState.key === builderSubscriptionSignature
      ? subscribedState.values
      : propSubscribedByBuilderId;
  const allBuilders = useMemo(
    () => [
      // Newly-added rows render at the top until the server refetches
      // and starts including them in `builders` (already
      // newest-first). Filter dedupes by id so a refetch doesn't
      // briefly double-render the row.
      ...addedBuilders.filter(
        (addedBuilder) => !builders.some((builder) => builder.id === addedBuilder.id),
      ),
      ...builders,
    ],
    [addedBuilders, builders],
  );

  const setSubscribedByBuilderId = useCallback((
    updater:
      | Record<string, boolean>
      | ((current: Record<string, boolean>) => Record<string, boolean>),
  ) => {
    setSubscribedState((current) => {
      const currentValues =
        current.key === builderSubscriptionSignature
          ? current.values
          : propSubscribedByBuilderId;
      return {
        key: builderSubscriptionSignature,
        values:
          typeof updater === "function"
            ? updater(currentValues)
            : updater,
      };
    });
  }, [builderSubscriptionSignature, propSubscribedByBuilderId]);

  // Track which builder id (if any) was just added but hasn't been
  // scrolled into view yet. Read by the scroll effect below after
  // React commits the new <article id> to the DOM.
  const pendingScrollIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!acceptAddedBuilders) return;

    function onBuilderAdded(event: Event) {
      const builder = (event as CustomEvent<BuilderLibraryListItem>).detail;
      if (!builder?.id) return;
      const sourceType = sourceTypeForBuilder(builder);
      const alreadyVisible = allBuilders.some((item) => item.id === builder.id);
      setExpandedSourceTypes((current) => {
        if (current.has(sourceType)) return current;
        const next = new Set(current);
        next.add(sourceType);
        return next;
      });
      if (!alreadyVisible) {
        setAddedBuilders((current) => [builder, ...current]);
      }
      setSubscribedByBuilderId((current) => ({ ...current, [builder.id]: builder.subscribed }));
      // Mark for scrolling on the next render cycle. The scroll
      // effect below fires AFTER React expands the source-type section
      // and commits the new row, so document.getElementById can find it.
      pendingScrollIdRef.current = builder.id;
    }

    window.addEventListener(builderLibraryBuilderAdded, onBuilderAdded);
    return () => window.removeEventListener(builderLibraryBuilderAdded, onBuilderAdded);
  }, [acceptAddedBuilders, allBuilders, setSubscribedByBuilderId]);

  // Smooth-scroll the freshly-added row into view. Runs as a layout
  // effect AFTER allBuilders changes (which happens on add and on
  // every subsequent server refresh that re-confirms the new row).
  // scrollIntoView({ behavior: "smooth" }) auto-degrades to instant
  // under prefers-reduced-motion per the platform spec.
  useEffect(() => {
    const id = pendingScrollIdRef.current;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    pendingScrollIdRef.current = null;
  }, [allBuilders, expandedSourceTypes]);

  function toggleSourceType(sourceType: string) {
    setExpandedSourceTypes((current) => {
      const next = new Set(current);
      if (next.has(sourceType)) {
        next.delete(sourceType);
      } else {
        next.add(sourceType);
      }
      return next;
    });
  }

  const visibleBuilders = useMemo(
    () =>
      allBuilders
        .filter((builder) => !removedBuilderIds.has(builder.id))
        .map((builder) => ({
          ...builder,
          subscribed: subscribedByBuilderId[builder.id] ?? builder.subscribed,
        }))
        // Mirror the server's builderSort so a just-prepended row
        // lands at the top of its KIND group (not the top of the
        // whole list), and so no visual jump happens when the server
        // refetch eventually arrives with the same ordering.
        .sort(clientBuilderSort),
    [allBuilders, removedBuilderIds, subscribedByBuilderId],
  );
  const visibleSections = useMemo(
    () => groupBuildersBySourceType(visibleBuilders),
    [visibleBuilders],
  );

  function onRemoveStateChange(builderId: string, removed: boolean) {
    setRemovedBuilderIds((current) => {
      const next = new Set(current);
      if (removed) {
        next.add(builderId);
      } else {
        next.delete(builderId);
      }
      return next;
    });
    setRemoveErrors((current) => {
      const next = { ...current };
      if (removed) {
        delete next[builderId];
      } else {
        next[builderId] = "Could not remove source.";
      }
      return next;
    });
  }

  function onSubscriptionStateChange(
    builderId: string,
    subscribed: boolean,
  ) {
    setSubscribedByBuilderId((current) => ({ ...current, [builderId]: subscribed }));
  }

  if (visibleBuilders.length === 0) {
    return (
      <EmptyState body={emptyBody} title={emptyTitle} />
    );
  }

  return (
    <div className="builder-library-list">
      {visibleSections.map((section) => {
        const expanded = expandedSourceTypes.has(section.sourceType);
        const sectionFollowedCount = section.builders.filter(
          (builder) => builder.subscribed,
        ).length;
        const sectionBodyId = sourceTypeSectionBodyId(listId, section.sourceType);
        return (
          <section
            className="builder-library-source-section"
            key={section.sourceType}
          >
            <h3 className="builder-library-source-section-head">
              <button
                aria-controls={sectionBodyId}
                aria-expanded={expanded}
                className="builder-library-source-section-toggle"
                onClick={() => toggleSourceType(section.sourceType)}
                type="button"
              >
                <span className="builder-library-source-section-title">
                  <ChevronRight
                    aria-hidden="true"
                    className="builder-library-source-section-chevron"
                  />
                  <SourceBadge sourceType={section.sourceType} />
                </span>
                <span className="builder-library-source-count">
                  <span>
                    {formatCount(section.builders.length)}{" "}
                    {section.builders.length === 1 ? "source" : "sources"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {formatCount(sectionFollowedCount)} in Following
                  </span>
                </span>
              </button>
            </h3>
            {expanded ? (
              <div
                className="builder-library-source-section-body"
                id={sectionBodyId}
              >
                {section.builders.map((builder) => (
                  <BuilderCard
                    builder={builder}
                    key={builder.id}
                    editableSourceOptions={editableSourceOptions}
                    removeError={removeErrors[builder.id]}
                    onRemoveStateChange={onRemoveStateChange}
                    onSubscriptionStateChange={onSubscriptionStateChange}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function BuilderCard({
  builder,
  editableSourceOptions,
  onRemoveStateChange,
  onSubscriptionStateChange,
  removeError,
}: {
  builder: BuilderLibraryListItem;
  editableSourceOptions?: SourceOption[];
  onRemoveStateChange: (builderId: string, removed: boolean) => void;
  onSubscriptionStateChange: (
    builderId: string,
    subscribed: boolean,
    previousSubscribed: boolean,
  ) => void;
  removeError?: string;
}) {
  const canEdit = Boolean(editableSourceOptions && builder.allowRemove);
  return (
    <article
      id={builder.id}
      className="builder-library-card"
    >
      <div className="builder-library-card-main">
        <SourceAvatar className="builder-library-avatar" source={builder} />
        <BuilderInfo builder={builder} />
        <div className="builder-library-actions">
          {canEdit && editableSourceOptions ? (
            <div
              aria-label={`Source tools for ${builder.name}`}
              className="builder-library-row-tools"
              role="group"
            >
              <BuilderEditDialog
                builder={builder}
                onRemoveStateChange={onRemoveStateChange}
                sourceOptions={editableSourceOptions}
              />
            </div>
          ) : (
            <span
              aria-hidden="true"
              className="builder-library-row-tools-placeholder"
            />
          )}
          <BuilderLibraryActions
            builderId={builder.id}
            builderName={builder.name}
            initialSubscribed={builder.subscribed}
            key={`${builder.id}:${builder.subscribed}`}
            onSubscriptionStateChange={onSubscriptionStateChange}
          />
        </div>
      </div>
      {removeError ? (
        <div className="builder-library-error" role="status">
          {removeError}
        </div>
      ) : null}
      {builder.feedItemCount > 0 ? (
        <BuilderFeedItems
          builder={builder}
          builderId={builder.id}
          latestPostCreatedAt={builder.latestPostCreatedAt}
          totalCount={builder.feedItemCount}
        />
      ) : null}
    </article>
  );
}

/**
 * Mirror of the server-side builderSort in builders/page.tsx —
 * source-type grouped, newest-within-type first, name as tiebreak. Keeping
 * the two in sync means a row added optimistically client-side lands
 * in the same section the server would have placed it on next refresh,
 * so there's no visual jump.
 */
function clientBuilderSort(
  a: BuilderLibraryListItem,
  b: BuilderLibraryListItem,
): number {
  const sourceCmp =
    sourceTypeSortRank(sourceTypeForBuilder(a)) -
    sourceTypeSortRank(sourceTypeForBuilder(b));
  if (sourceCmp !== 0) return sourceCmp;
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return tb - ta;
  return a.name.localeCompare(b.name);
}

function groupBuildersBySourceType(builders: BuilderLibraryListItem[]) {
  const sections = new Map<
    string,
    { sourceType: string; builders: BuilderLibraryListItem[] }
  >();

  for (const builder of builders) {
    const sourceType = sourceTypeForBuilder(builder);
    const section = sections.get(sourceType);
    if (section) {
      section.builders.push(builder);
    } else {
      sections.set(sourceType, { sourceType, builders: [builder] });
    }
  }

  return Array.from(sections.values()).sort(
    (a, b) => sourceTypeSortRank(a.sourceType) - sourceTypeSortRank(b.sourceType),
  );
}

function sourceTypeForBuilder(builder: BuilderLibraryListItem) {
  const explicit = normalizeSourceType(builder.sourceType);
  if (explicit) return explicit;
  if (builder.kind === "X") return "x";
  if (builder.kind === "BLOG") return "blog";
  if (builder.kind === "PODCAST") return "podcast";
  return "website";
}

function sourceTypeSectionBodyId(listId: string, sourceType: string) {
  return `builder-library-source-${listId}-${sourceType.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function initialExpandedSourceTypes(builders: BuilderLibraryListItem[]) {
  const firstSection = groupBuildersBySourceType(builders)[0];
  return firstSection ? new Set([firstSection.sourceType]) : new Set<string>();
}

function normalizeSourceType(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized || normalized === "auto") return "";
  if (normalized === "pdf") return "website";
  return normalized;
}

function sourceTypeSortRank(sourceType: string) {
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

function BuilderInfo({ builder }: { builder: BuilderLibraryListItem }) {
  return (
    <div className="builder-library-info">
      <div className="builder-library-info-head">
        {builder.entityId ? (
          <Link
            href={`/builder/${builder.entityId}`}
            className="builder-library-name"
          >
            {builder.name}
          </Link>
        ) : (
          <div className="builder-library-name">{builder.name}</div>
        )}
      </div>
    </div>
  );
}
