"use client";

import Link from "next/link";
import { useState } from "react";
import { FeedEmptyState } from "@/components/FeedState";
import { PostCard, type PostCardPost } from "@/components/PostCard";
import { PostFavoriteButton, postFavoriteActionLabel } from "@/components/PostFavoriteButton";
import { RelativeTime } from "@/components/RelativeTime";
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
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");

  async function removeFavorite(feedItemId: string) {
    if (pendingIds.has(feedItemId)) return;
    const removedItem = items.find((item) => item.feedItemId === feedItemId);
    if (!removedItem) return;
    setError("");
    setPendingIds((current) => new Set([...current, feedItemId]));
    setItems((current) => current.filter((item) => item.feedItemId !== feedItemId));
    try {
      const response = await fetch("/api/favorites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedItemId }),
      });
      if (!response.ok) throw new Error("Favorite update failed");
    } catch {
      setItems((current) =>
        current.some((item) => item.feedItemId === feedItemId)
          ? current
          : sortFavoriteItems([...current, removedItem]),
      );
      setError("Could not remove from Favorites. Try again.");
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(feedItemId);
        return next;
      });
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
            <Link className="fb-btn light compact" href="/search">
              Search posts
            </Link>
          </div>
        }
        className="favorites-empty is-actionable"
        title="No Favorites yet"
        body="Save posts from AI Digest, Following, Search, or post details."
      />
    );
  }

  return (
    <section className="feed-content-stack favorites-feed" aria-label="Favorite posts">
      {error ? (
        <p className="favorites-feed-error" role="status">
          {error}
        </p>
      ) : null}
      <div className="favorites-feed-list">
        {items.map((item) => (
          <PostCard
            dataRead={Boolean(item.readAt)}
            extraActions={
              <PostFavoriteButton
                ariaLabel={postFavoriteActionLabel(true, favoritePostLabel(item.post))}
                disabled={pendingIds.has(item.feedItemId)}
                isFavorite
                onToggle={() => void removeFavorite(item.feedItemId)}
              />
            }
            extraMeta={
              <>
                <span className="post-meta-dot" aria-hidden="true">·</span>
                <span className="favorite-saved-at">
                  Saved <RelativeTime value={item.favoritedAt} />
                </span>
              </>
            }
            key={item.feedItemId}
            post={{
              ...item.post,
              detailUrl: postDetailHref(item.feedItemId, "/dashboard?tab=favorites", "Favorites"),
            }}
          />
        ))}
      </div>
    </section>
  );
}

function sortFavoriteItems(items: FavoritePostListItem[]) {
  return [...items].sort((a, b) => Date.parse(b.favoritedAt) - Date.parse(a.favoritedAt));
}

function favoritePostLabel(post: PostCardPost) {
  return post.title?.trim() || post.sourceName?.trim() || "this post";
}
