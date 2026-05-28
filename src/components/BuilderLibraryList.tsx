"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { BuilderEditDialog } from "@/components/BuilderEditDialog";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import { BuilderLibraryActions } from "@/components/BuilderLibraryActions";
import { SourceBadge } from "@/components/SourceBadge";
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
  const [subscribedByBuilderId, setSubscribedByBuilderId] = useState<Record<string, boolean>>(
    () => Object.fromEntries(builders.map((builder) => [builder.id, builder.subscribed])),
  );
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

  useEffect(() => {
    function onSubscribeAll() {
      setSubscribedByBuilderId((current) => ({
        ...current,
        ...Object.fromEntries(allBuilders.map((builder) => [builder.id, true])),
      }));
    }

    window.addEventListener(builderLibrarySubscribeAll, onSubscribeAll);
    return () => window.removeEventListener(builderLibrarySubscribeAll, onSubscribeAll);
  }, [allBuilders]);

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
  }, [acceptAddedBuilders, allBuilders]);

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
      <div className="fb-panel dashed text-[var(--muted-strong)]">
        {emptyTitle ? (
          <h3 className="serif text-lg font-semibold text-[var(--ink)]">{emptyTitle}</h3>
        ) : null}
        <p className={emptyTitle ? "mt-2 text-sm leading-6" : "text-sm"}>{emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="builder-library-list overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)]">
      {visibleBuilders.map((builder, index) => (
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
        <BuilderAvatar builder={builder} />
        <BuilderInfo builder={builder} />
        <div className="builder-library-actions row-actions flex flex-shrink-0 items-center gap-3">
          {builder.sourceUrl || builder.fetchUrl ? (
            <a
              aria-label={`Open ${builder.name} on its source site`}
              className="builder-library-open-source"
              href={(builder.sourceUrl ?? builder.fetchUrl) as string}
              rel="noopener noreferrer"
              target="_blank"
              title="Open source"
            >
              <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
          {canEdit && editableSourceOptions ? (
            <BuilderEditDialog
              builder={builder}
              sourceOptions={editableSourceOptions}
            />
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
        <div className="mt-2 text-sm text-[var(--danger)]" role="status">
          {removeError}
        </div>
      ) : null}
      {builder.feedItemCount > 0 ? (
        <BuilderFeedItems
          builder={builder}
          builderId={builder.id}
          totalCount={builder.feedItemCount}
        />
      ) : null}
    </article>
  );
}

/**
 * Mirror of the server-side builderSort in builders/page.tsx —
 * kind-grouped, newest-within-kind first, name as tiebreak. Keeping
 * the two in sync means a row added optimistically client-side lands
 * in the same slot the server would have placed it on next refresh,
 * so there's no visual jump.
 */
function clientBuilderSort(
  a: BuilderLibraryListItem,
  b: BuilderLibraryListItem,
): number {
  const kindCmp = a.kind.localeCompare(b.kind);
  if (kindCmp !== 0) return kindCmp;
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return tb - ta;
  return a.name.localeCompare(b.name);
}

function dispatchStatsChange(detail: BuilderLibraryStatsChange) {
  window.dispatchEvent(new CustomEvent(builderLibraryStatsChanged, { detail }));
}

function avatarMonogram(builder: BuilderLibraryListItem): string {
  // Strip a leading "@" so X handles like "@karpathy" render as "K"
  // instead of "@", which was indistinguishable across rows.
  const cleaned = builder.name.replace(/^@+/, "").trim();
  const first = cleaned.charAt(0) || builder.name.charAt(0) || "?";
  return first.toUpperCase();
}

function avatarFaviconUrl(builder: BuilderLibraryListItem): string | null {
  // For X and YouTube every row shares the same platform host, so
  // the favicon would be the same generic logo for every account —
  // less informative than the monogram. Stick with the monogram
  // there and use a real favicon only when the host varies per row.
  if (builder.sourceType === "x" || builder.sourceType === "youtube") return null;
  const url = builder.sourceUrl ?? builder.fetchUrl;
  if (!url) return null;
  try {
    const host = new URL(url).host;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

function BuilderAvatar({ builder }: { builder: BuilderLibraryListItem }) {
  const monogram = avatarMonogram(builder);
  const realAvatarUrl = builder.avatarUrl;
  const faviconUrl = avatarFaviconUrl(builder);
  // Priority chain: server-resolved real photo → host favicon → monogram.
  // Track failed URLs in a Set so that when builder.avatarUrl changes
  // (e.g. after an Edit + router.refresh fetches a freshly enriched
  // avatar), the new URL gets a fresh attempt instead of inheriting
  // a stale "this image already failed" flag.
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set());
  function markFailed(url: string) {
    setFailedUrls((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }
  if (realAvatarUrl && !failedUrls.has(realAvatarUrl)) {
    return (
      <span
        className="builder-library-avatar fb-src-icon"
        style={{ overflow: "hidden", padding: 0 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          height={36}
          width={36}
          key={realAvatarUrl}
          loading="lazy"
          onError={() => markFailed(realAvatarUrl)}
          src={realAvatarUrl}
          style={{ height: "100%", width: "100%", objectFit: "cover" }}
        />
      </span>
    );
  }
  if (faviconUrl && !failedUrls.has(faviconUrl)) {
    return (
      <span
        className="builder-library-avatar fb-src-icon"
        style={{ overflow: "hidden", padding: 0 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          height={36}
          width={36}
          key={faviconUrl}
          loading="lazy"
          onError={() => markFailed(faviconUrl)}
          src={faviconUrl}
          style={{ height: "100%", width: "100%", objectFit: "cover" }}
        />
      </span>
    );
  }
  return (
    <span className="builder-library-avatar fb-src-icon">{monogram}</span>
  );
}

function BuilderInfo({ builder }: { builder: BuilderLibraryListItem }) {
  const sourceUrl = builder.sourceUrl ?? builder.fetchUrl;
  const latestPostCreatedAt = builder.latestPostCreatedAt
    ? new Date(builder.latestPostCreatedAt)
    : null;
  const hostLabel = builder.handle ? `@${builder.handle}` : sourceSummary(sourceUrl);
  const hasFeedItems = builder.feedItemCount > 0;

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
        <SourceBadge builder={builder} />
      </div>
      <div className="fb-src-meta">
        <span className="source-kind-meta fb-kind-pill">{builder.kind.toLowerCase()}</span>
        {hostLabel ? (
          <span className="source-host-meta mono truncate max-w-[18rem]">{hostLabel}</span>
        ) : null}
        <span className="source-count-dot source-meta-dot">·</span>
        <span
          className={
            hasFeedItems
              ? "source-count-meta"
              : "source-count-meta source-count-meta-empty"
          }
        >
          {builder.feedItemCount} items
        </span>
        {latestPostCreatedAt ? (
          <>
            <span className="source-latest-dot source-meta-dot">·</span>
            <span className="source-latest-meta">
              Latest {formatCompactDate(latestPostCreatedAt)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function sourceSummary(value: string | null) {
  if (!value) return "No source";
  try {
    const url = new URL(value);
    const [firstPathPart] = url.pathname.split("/").filter(Boolean);
    if (/youtube\.com$/i.test(url.hostname) && firstPathPart?.startsWith("@")) {
      return firstPathPart;
    }
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function formatCompactDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(value);
}
