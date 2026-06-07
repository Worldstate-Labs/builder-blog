"use client";

import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PostCard } from "@/components/PostCard";

type BuilderSummary = {
  id: string;
  name: string;
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
};

type BuilderFeedItem = {
  id: string;
  kind: string;
  externalId: string;
  title: string | null;
  body: string;
  summary: string | null;
  url: string;
  publishedAt: string | null;
  createdAt: string;
  sourceName: string | null;
  fetchTool: string | null;
};

type BuilderFeedItemsProps = {
  builder: BuilderSummary;
  builderId: string;
  latestPostCreatedAt?: string | null;
  totalCount: number;
};

export function BuilderFeedItems({
  builder,
  builderId,
  latestPostCreatedAt,
  totalCount,
}: BuilderFeedItemsProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [itemState, setItemState] = useState<{
    builderId: string;
    totalCount: number;
    items: BuilderFeedItem[] | null;
  }>({ builderId, totalCount, items: null });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items =
    itemState.builderId === builderId && itemState.totalCount === totalCount
      ? itemState.items
      : null;
  const visibleCount = items ? items.length : totalCount;
  const latestDateLabel = latestPostCreatedAt
    ? formatPostDate(new Date(latestPostCreatedAt))
    : null;

  useEffect(() => {
    if (!detailsRef.current?.open) return;
    void loadItems(true, { force: true });
    // loadItems intentionally stays local; this effect only reacts to server props changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderId, totalCount]);

  async function loadItems(open: boolean, options: { force?: boolean } = {}) {
    if (!open || (items && !options.force) || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/builders/${builderId}/feed-items`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load summarized posts");
      const payload = (await response.json()) as { items?: BuilderFeedItem[] };
      setItemState({ builderId, totalCount, items: payload.items ?? [] });
    } catch {
      setError("Could not load summarized posts.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <details
      className="builder-posts"
      onToggle={(event) => loadItems(event.currentTarget.open)}
      ref={detailsRef}
    >
      <summary>
        <span className="builder-posts-summary">
          <span className="builder-posts-count">
            <span>{visibleCount} posts</span>
            {latestDateLabel ? (
              <>
                <span aria-hidden="true" className="builder-posts-dot">·</span>
                <time
                  className="builder-posts-latest"
                  dateTime={latestPostCreatedAt ?? undefined}
                  title={`Latest post ${latestDateLabel}`}
                >
                  latest at {latestDateLabel}
                </time>
              </>
            ) : null}
          </span>
        </span>
      </summary>
      <div className="builder-post-list">
        {isLoading ? (
          <div className="builder-post-loading" role="status">
            <div className="builder-post-loading-line" />
            <div className="builder-post-loading-card" />
          </div>
        ) : null}
        {error ? (
          <div className="builder-post-state builder-post-state--error" role="status">
            {error}
          </div>
        ) : null}
        {items?.map((item) => (
          <PostCard
            fallbackBuilder={builder}
            key={item.id}
            post={{
              ...item,
              builder,
              detailUrl: postDetailHref(item.id, "/builders", "Sources"),
            }}
            showSourceBadge={false}
            variant="row"
          />
        ))}
        {items?.length === 0 ? (
          <EmptyState
            body="No summarized posts have been stored for this source yet."
            className="builder-post-empty"
          />
        ) : null}
      </div>
    </details>
  );
}

function postDetailHref(feedItemId: string, returnTo: string, returnLabel: string) {
  const params = new URLSearchParams({ returnLabel, returnTo });
  return `/recommendations/items/${feedItemId}?${params.toString()}`;
}

function formatPostDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}
