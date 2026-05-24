"use client";

import { useEffect, useMemo, useState } from "react";
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
        crawledDelta: builder.feedItemCount,
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
        crawledDelta: removed ? -builder.feedItemCount : builder.feedItemCount,
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
        next[builderId] = "Could not remove builder.";
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
      <div className="empty-panel text-[var(--muted-strong)]">
        {emptyTitle ? (
          <h3 className="text-lg font-semibold text-[var(--ink)]">{emptyTitle}</h3>
        ) : null}
        <p className={emptyTitle ? "mt-2 text-sm leading-6" : ""}>{emptyBody}</p>
      </div>
    );
  }

  return (
    <>
      {visibleBuilders.map((builder) => (
        <BuilderCard
          builder={builder}
          key={builder.id}
          removeError={removeErrors[builder.id]}
          onRemoveStateChange={onRemoveStateChange}
          onSubscriptionStateChange={onSubscriptionStateChange}
        />
      ))}
    </>
  );
}

function BuilderCard({
  builder,
  onRemoveStateChange,
  onSubscriptionStateChange,
  removeError,
}: {
  builder: BuilderLibraryListItem;
  onRemoveStateChange: (builderId: string, removed: boolean) => void;
  onSubscriptionStateChange: (
    builderId: string,
    subscribed: boolean,
    previousSubscribed: boolean,
  ) => void;
  removeError?: string;
}) {
  return (
    <article id={builder.id} className="builder-card">
      <div className="builder-row">
        <BuilderInfo builder={builder} />
        <div className="row-actions">
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
        <div className="mt-3 text-sm text-[var(--danger)]" role="status">
          {removeError}
        </div>
      ) : null}
      <BuilderFeedItems
        builder={builder}
        builderId={builder.id}
        totalCount={builder.feedItemCount}
      />
    </article>
  );
}

function dispatchStatsChange(detail: BuilderLibraryStatsChange) {
  window.dispatchEvent(new CustomEvent(builderLibraryStatsChanged, { detail }));
}

function BuilderInfo({ builder }: { builder: BuilderLibraryListItem }) {
  const sourceUrl = builder.sourceUrl ?? builder.crawlUrl;
  const latestPostCreatedAt = builder.latestPostCreatedAt
    ? new Date(builder.latestPostCreatedAt)
    : null;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold leading-snug">{builder.name}</h3>
        <SourceBadge builder={builder} />
        <span className="sub-pill">{builder.subscribed ? "Subscribed" : "In library"}</span>
      </div>
      <div className="builder-meta">
        <span>{builder.handle ? `@${builder.handle}` : sourceSummary(sourceUrl)}</span>
        <span>{builder.crawlLabel}</span>
        <span>{builder.feedItemCount} items</span>
        {latestPostCreatedAt ? (
          <span>Latest {formatCompactDate(latestPostCreatedAt)}</span>
        ) : null}
      </div>
      {sourceUrl ? (
        <a className="builder-source-link" href={sourceUrl} rel="noreferrer" target="_blank">
          <ExternalLink className="h-3.5 w-3.5" />
          Open source
        </a>
      ) : null}
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
  }).format(value);
}
