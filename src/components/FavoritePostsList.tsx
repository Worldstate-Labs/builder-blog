"use client";

import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PostCard, type PostCardPost } from "@/components/PostCard";
import { PostFavoriteButton } from "@/components/PostFavoriteButton";
import { postDetailHref } from "@/lib/navigation";

export type FavoritePostListItem = {
  feedItemId: string;
  favoritedAt: string;
  readAt: string | null;
  post: PostCardPost;
};

export function FavoritePostsList({
  initialItems,
}: {
  initialItems: FavoritePostListItem[];
}) {
  const [items, setItems] = useState(initialItems);

  async function removeFavorite(feedItemId: string) {
    const previousItems = items;
    setItems((current) => current.filter((item) => item.feedItemId !== feedItemId));
    try {
      await fetch("/api/favorites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedItemId }),
      });
    } catch {
      setItems(previousItems);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        className="favorites-empty feed-state-panel"
        title="No saved posts yet"
        body="Save posts from AI Digest or Following to keep a focused reading queue here."
      />
    );
  }

  return (
    <section className="feed-content-stack favorites-feed" aria-label="Saved posts">
      <div className="favorites-feed-head">
        <div>
          <h2 className="favorites-feed-title">Saved posts</h2>
          <p className="favorites-feed-desc">
            Posts you marked for deeper reading, newest saves first.
          </p>
        </div>
        <span className="favorites-feed-count">
          {items.length} {items.length === 1 ? "post" : "posts"}
        </span>
      </div>
      <div className="favorites-feed-list">
        {items.map((item) => (
          <PostCard
            dataRead={Boolean(item.readAt)}
            extraActions={
              <PostFavoriteButton
                isFavorite
                onToggle={() => void removeFavorite(item.feedItemId)}
              />
            }
            extraMeta={
              <>
                <span className="post-meta-dot" aria-hidden="true">·</span>
                <span className="favorite-saved-at">
                  Saved {formatDate(item.favoritedAt)}
                </span>
              </>
            }
            key={item.feedItemId}
            post={{
              ...item.post,
              detailUrl: postDetailHref(item.feedItemId, "/dashboard?tab=favorites", "Favorites"),
            }}
            showSourceBadge={false}
          />
        ))}
      </div>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
