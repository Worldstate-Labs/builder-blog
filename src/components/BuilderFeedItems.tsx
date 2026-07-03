"use client";

import { useEffect, useState } from "react";
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
  isOpen: boolean;
  listId: string;
  totalCount: number;
};

export function BuilderFeedItems({
  builder,
  builderId,
  isOpen,
  listId,
  totalCount,
}: BuilderFeedItemsProps) {
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
  const returnHref = builder.entityId ? `/builder/${builder.entityId}` : "/builders";
  const returnLabel = builder.entityId ? builder.name : "Sources";

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function loadItems() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/builders/${builderId}/feed-items`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load summarized posts.");
        const payload = (await response.json()) as { items?: BuilderFeedItem[] };
        if (!cancelled) {
          setItemState({ builderId, totalCount, items: payload.items ?? [] });
        }
      } catch {
        if (!cancelled) {
          setError("Could not load summarized posts.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadItems();
    return () => {
      cancelled = true;
    };
  }, [builderId, totalCount, isOpen]);

  return (
    <div className="builder-posts">
      <div className="builder-post-list builder-post-list--scroll" hidden={!isOpen} id={listId}>
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
