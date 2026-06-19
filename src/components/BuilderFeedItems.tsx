"use client";

import { useEffect, useId, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PostCard } from "@/components/PostCard";
import { postDetailHref } from "@/lib/navigation";

type BuilderSummary = {
  id: string;
  entityId: string | null;
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
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
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
  const postCountLabel = `${visibleCount} ${visibleCount === 1 ? "post" : "posts"}`;
  const latestDateLabel = latestPostCreatedAt
    ? formatPostDate(new Date(latestPostCreatedAt))
    : null;
  const postsSummaryLabel = latestDateLabel
    ? `${builder.name} posts, ${postCountLabel}, latest at ${latestDateLabel}`
    : `${builder.name} posts, ${postCountLabel}`;
  const returnHref = builder.entityId ? `/builder/${builder.entityId}` : "/builders";
  const returnLabel = builder.entityId ? builder.name : "Sources";

  useEffect(() => {
    if (!isOpen) return;
    void loadItems(true, { force: true });
    // loadItems intentionally stays local; this effect only reacts to server props changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderId, totalCount, isOpen]);

  async function loadItems(open: boolean, options: { force?: boolean } = {}) {
    if (!open || (items && !options.force) || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/builders/${builderId}/feed-items`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not load summarized posts.");
      const payload = (await response.json()) as { items?: BuilderFeedItem[] };
      setItemState({ builderId, totalCount, items: payload.items ?? [] });
    } catch {
      setError("Could not load summarized posts.");
    } finally {
      setIsLoading(false);
    }
  }

  function toggleOpen() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    void loadItems(nextOpen);
  }

  return (
    <div className="builder-posts">
      <button
        aria-controls={listId}
        aria-expanded={isOpen}
        aria-label={postsSummaryLabel}
        className="builder-posts-summary"
        onClick={toggleOpen}
        type="button"
      >
        <span className="builder-posts-count">
          <span>{postCountLabel}</span>
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
      </button>
      <div className="builder-post-list" hidden={!isOpen} id={listId}>
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
              detailUrl: postDetailHref(item.id, returnHref, returnLabel),
            }}
            showBuilderRow={false}
            showSourceBadge={false}
            variant="row"
          />
        ))}
        {items?.length === 0 ? (
          <EmptyState
            className="builder-post-empty"
            title="No summarized posts yet"
            body="Use Fetch sources to summarize posts from this source."
          />
        ) : null}
      </div>
    </div>
  );
}

function formatPostDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}
