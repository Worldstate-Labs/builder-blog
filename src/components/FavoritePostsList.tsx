"use client";

import Link from "next/link";
import { useState } from "react";
import { formatCount } from "@/components/Count";
import { FeedEmptyState } from "@/components/FeedState";
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
      const response = await fetch("/api/favorites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedItemId }),
      });
      if (!response.ok) throw new Error("Favorite update failed");
    } catch {
      setItems(previousItems);
    }
  }

  if (items.length === 0) {
    return (
      <FeedEmptyState
        actions={
          <div className="favorites-empty-actions">
            <Link className="fb-btn dark compact" href="/dashboard?tab=ai-digest">
              Open AI Digest
            </Link>
            <Link className="fb-btn light compact" href="/dashboard?tab=following">
              Open Following
            </Link>
          </div>
        }
        className="favorites-empty is-actionable"
        title="No favorites yet"
        body="Save any post to build a focused reading queue here."
      />
    );
  }

  return (
    <section className="feed-content-stack favorites-feed" aria-label="Favorites">
      <div className="favorites-feed-head">
        <div>
          <h2 className="favorites-feed-title">Favorites</h2>
          <p className="favorites-feed-desc">
            Saved for deeper reading, newest first.
          </p>
        </div>
        <span className="favorites-feed-count">
          {formatCount(items.length)} {items.length === 1 ? "post" : "posts"}
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
