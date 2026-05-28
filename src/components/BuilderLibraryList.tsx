"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
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

type BuilderLibraryListProps = {
  acceptAddedBuilders?: boolean;
  builders: BuilderLibraryListItem[];
  emptyBody: string;
  emptyTitle?: string;
};

export function BuilderLibraryList({
  acceptAddedBuilders = false,
  builders,
  emptyBody,
  emptyTitle,
}: BuilderLibraryListProps) {
  const [addedBuilders, setAddedBuilders] = useState<BuilderLibraryListItem[]>([]);
  const [removedBuilderIds, setRemovedBuilderIds] = useState<Set<string>>(() => new Set());
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const [subscribedByBuilderId, setSubscribedByBuilderId] = useState<Record<string, boolean>>(
    () => Object.fromEntries(builders.map((builder) => [builder.id, builder.subscribed])),
  );
  const allBuilders = useMemo(
    () => [
      ...builders,
      ...addedBuilders.filter(
        (addedBuilder) => !builders.some((builder) => builder.id === addedBuilder.id),
      ),
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

  useEffect(() => {
    if (!acceptAddedBuilders) return;

    function onBuilderAdded(event: Event) {
      const builder = (event as CustomEvent<BuilderLibraryListItem>).detail;
      if (!builder?.id) return;
      if (allBuilders.some((item) => item.id === builder.id)) return;
      setAddedBuilders((current) => [...current, builder]);
      setSubscribedByBuilderId((current) => ({ ...current, [builder.id]: builder.subscribed }));
      dispatchStatsChange({
        fetchedDelta: builder.feedItemCount,
        inLibraryDelta: 1,
        subscribedDelta: builder.subscribed ? 1 : 0,
      });
    }

    window.addEventListener(builderLibraryBuilderAdded, onBuilderAdded);
    return () => window.removeEventListener(builderLibraryBuilderAdded, onBuilderAdded);
  }, [acceptAddedBuilders, allBuilders]);

  const visibleBuilders = useMemo(
    () =>
      allBuilders
        .filter((builder) => !removedBuilderIds.has(builder.id))
        .map((builder) => ({
          ...builder,
          subscribed: subscribedByBuilderId[builder.id] ?? builder.subscribed,
        })),
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
  onRemoveStateChange,
  onSubscriptionStateChange,
  removeError,
}: {
  builder: BuilderLibraryListItem;
  first: boolean;
  onRemoveStateChange: (builderId: string, removed: boolean) => void;
  onSubscriptionStateChange: (
    builderId: string,
    subscribed: boolean,
    previousSubscribed: boolean,
  ) => void;
  removeError?: string;
}) {
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
        <span className="builder-library-avatar fb-src-icon">
          {builder.name.charAt(0).toUpperCase()}
        </span>
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

function dispatchStatsChange(detail: BuilderLibraryStatsChange) {
  window.dispatchEvent(new CustomEvent(builderLibraryStatsChanged, { detail }));
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
        <span className="source-fetch-dot source-meta-dot">·</span>
        <span className="source-fetch-meta">{builder.fetchLabel}</span>
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
