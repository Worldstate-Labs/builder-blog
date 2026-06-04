"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BuilderEditDialog } from "@/components/BuilderEditDialog";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import { BuilderLibraryActions } from "@/components/BuilderLibraryActions";
import { CountBadge } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { SourceBadge } from "@/components/SourceBadge";
import { SourceAvatar } from "@/components/SourceAvatar";
import {
  builderLibraryBuilderAdded,
  builderLibraryStatsChanged,
  builderLibrarySubscribeAll,
  type BuilderLibraryEventItem,
  type BuilderLibraryStatsChange,
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
  const [removedBuilderIds, setRemovedBuilderIds] = useState<Set<string>>(() => new Set());
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
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

  useEffect(() => {
    function onSubscribeAll() {
      setSubscribedByBuilderId((current) => ({
        ...current,
        ...Object.fromEntries(allBuilders.map((builder) => [builder.id, true])),
      }));
    }

    window.addEventListener(builderLibrarySubscribeAll, onSubscribeAll);
    return () => window.removeEventListener(builderLibrarySubscribeAll, onSubscribeAll);
  }, [allBuilders, setSubscribedByBuilderId]);

  // Track which builder id (if any) was just added but hasn't been
  // scrolled into view yet. Read by the scroll effect below after
  // React commits the new <article id> to the DOM.
  const pendingScrollIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!acceptAddedBuilders) return;

    function onBuilderAdded(event: Event) {
      const builder = (event as CustomEvent<BuilderLibraryListItem>).detail;
      if (!builder?.id) return;
      if (allBuilders.some((item) => item.id === builder.id)) return;
      setAddedBuilders((current) => [builder, ...current]);
      setSubscribedByBuilderId((current) => ({ ...current, [builder.id]: builder.subscribed }));
      // Mark for scrolling on the next render cycle. The scroll
      // effect below fires AFTER React commits the new row so
      // document.getElementById is guaranteed to find it. When the
      // server returned a soft warning (e.g. blog has no RSS feed),
      // skip the scroll — AddBuilderForm renders a warm banner the
      // user needs to see before we move focus away.
      if (!builder.addWarning) {
        pendingScrollIdRef.current = builder.id;
      }
      dispatchStatsChange({
        fetchedDelta: builder.feedItemCount,
        inLibraryDelta: 1,
        subscribedDelta: builder.subscribed ? 1 : 0,
      });
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
  }, [allBuilders]);

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
    const builder = allBuilders.find((item) => item.id === builderId);
    const subscribed = subscribedByBuilderId[builderId] ?? builder?.subscribed ?? false;
    if (builder) {
      dispatchStatsChange({
        fetchedDelta: removed ? -builder.feedItemCount : builder.feedItemCount,
        inLibraryDelta: removed ? -1 : 1,
        subscribedDelta: subscribed ? (removed ? -1 : 1) : 0,
      });
    }

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
    previousSubscribed: boolean,
  ) {
    setSubscribedByBuilderId((current) => ({ ...current, [builderId]: subscribed }));
    if (subscribed !== previousSubscribed) {
      dispatchStatsChange({ subscribedDelta: subscribed ? 1 : -1 });
    }
  }

  if (visibleBuilders.length === 0) {
    return (
      <EmptyState body={emptyBody} title={emptyTitle} />
    );
  }

  return (
    <div className="builder-library-list">
      {visibleSections.map((section) => (
        <section
          className="builder-library-source-section"
          key={section.sourceType}
        >
          <div className="builder-library-source-section-head">
            <h3 className="builder-library-source-section-title">
              <SourceBadge sourceType={section.sourceType} />
            </h3>
            <CountBadge value={section.builders.length} />
          </div>
          <div className="builder-library-source-section-body">
            {section.builders.map((builder, index) => (
              <BuilderCard
                builder={builder}
                first={index === 0}
                key={builder.id}
                editableSourceOptions={editableSourceOptions}
                removeError={removeErrors[builder.id]}
                onRemoveStateChange={onRemoveStateChange}
                onSubscriptionStateChange={onSubscriptionStateChange}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BuilderCard({
  builder,
  first,
  editableSourceOptions,
  onRemoveStateChange,
  onSubscriptionStateChange,
  removeError,
}: {
  builder: BuilderLibraryListItem;
  first: boolean;
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
      className={
        first
          ? "builder-library-card px-4 py-3.5"
          : "builder-library-card border-t border-[var(--line)] px-4 py-3.5"
      }
    >
      <div className="builder-library-card-main grid items-center gap-3.5">
        <SourceAvatar className="builder-library-avatar" source={builder} />
        <BuilderInfo builder={builder} />
        <div className="builder-library-actions row-actions flex flex-shrink-0 items-center gap-3">
          {canEdit && editableSourceOptions ? (
            <div className="builder-library-row-tools" aria-label="Source tools">
              <BuilderEditDialog
                builder={builder}
                sourceOptions={editableSourceOptions}
              />
            </div>
          ) : null}
          <BuilderLibraryActions
            allowRemove={builder.allowRemove}
            builderId={builder.id}
            initialSubscribed={builder.subscribed}
            key={`${builder.id}:${builder.subscribed}`}
            onRemoveStateChange={onRemoveStateChange}
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

function normalizeSourceType(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized || normalized === "auto") return "";
  if (normalized === "pdf") return "website";
  return normalized;
}

function sourceTypeSortRank(sourceType: string) {
  const order = ["blog", "youtube", "podcast", "x", "website"];
  const index = order.indexOf(sourceType);
  return index === -1 ? order.length : index;
}

function dispatchStatsChange(detail: BuilderLibraryStatsChange) {
  window.dispatchEvent(new CustomEvent(builderLibraryStatsChanged, { detail }));
}

function BuilderInfo({ builder }: { builder: BuilderLibraryListItem }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {builder.entityId ? (
          <Link
            href={`/builder/${builder.entityId}`}
            className="fb-src-name truncate hover:underline"
          >
            {builder.name}
          </Link>
        ) : (
          <div className="fb-src-name truncate">{builder.name}</div>
        )}
      </div>
    </div>
  );
}
