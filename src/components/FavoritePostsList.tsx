"use client";

import Link from "next/link";
import { useState } from "react";
import { flushSync } from "react-dom";
import { FeedEmptyState } from "@/components/FeedState";
import { PostCard, type PostCardPost } from "@/components/PostCard";
import { PostFavoriteButton, postFavoriteActionLabel } from "@/components/PostFavoriteButton";
import { postDetailHref } from "@/lib/navigation";

const FAVORITE_READ_REORDER_DELAY_MS = 220;

export type FavoritePostListItem = {
  feedItemId: string;
  favoritedAt: string;
  markedReadAt: string | null;
  post: PostCardPost;
};

export function FavoritePostsList({
  initialItems,
}: {
  initialItems: FavoritePostListItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [pendingReadIds, setPendingReadIds] = useState<Set<string>>(() => new Set());
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

  async function toggleFavoriteRead(feedItemId: string, markedRead: boolean) {
    if (pendingReadIds.has(feedItemId)) return;
    const target = items.find((item) => item.feedItemId === feedItemId);
    if (!target) return;
    const previousMarkedReadAt = target.markedReadAt;
    const optimisticMarkedReadAt = markedRead ? new Date().toISOString() : null;
    let reorderTimer: number | null = null;
    setError("");
    setPendingReadIds((current) => new Set([...current, feedItemId]));
    setItems((current) =>
      current.map((item) =>
        item.feedItemId === feedItemId
          ? { ...item, markedReadAt: optimisticMarkedReadAt }
          : item,
      ),
    );
    reorderTimer = window.setTimeout(() => {
      runFavoriteListTransition(() => {
        setItems((current) => sortFavoriteItems(current));
      });
    }, FAVORITE_READ_REORDER_DELAY_MS);

    try {
      const response = await fetch("/api/favorites/read", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedItemId, markedRead }),
      });
      if (!response.ok) throw new Error("Favorite read update failed");
      const body = await response.json().catch(() => null);
      const serverMarkedReadAt =
        typeof body?.markedReadAt === "string" ? body.markedReadAt : null;
      setItems((current) =>
        current.map((item) =>
          item.feedItemId === feedItemId
            ? { ...item, markedReadAt: markedRead ? serverMarkedReadAt ?? optimisticMarkedReadAt : null }
            : item,
        ),
      );
    } catch {
      if (reorderTimer) window.clearTimeout(reorderTimer);
      runFavoriteListTransition(() => {
        setItems((current) =>
          sortFavoriteItems(
            current.map((item) =>
              item.feedItemId === feedItemId
                ? { ...item, markedReadAt: previousMarkedReadAt }
                : item,
            ),
          ),
        );
      });
      setError("Could not update Favorites. Try again.");
    } finally {
      setPendingReadIds((current) => {
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
          <div
            className="favorite-post-shell"
            key={item.feedItemId}
            style={{ viewTransitionName: favoritePostTransitionName(item.feedItemId) }}
          >
            <PostCard
              favoriteMarkedRead={Boolean(item.markedReadAt)}
              extraActions={
                <PostFavoriteButton
                  ariaLabel={postFavoriteActionLabel(true, favoritePostLabel(item.post))}
                  disabled={pendingIds.has(item.feedItemId)}
                  isFavorite
                  onToggle={() => void removeFavorite(item.feedItemId)}
                />
              }
              extraMeta={
                <button
                  aria-pressed={Boolean(item.markedReadAt)}
                  className="favorite-mark-read post-inline-action post-inline-action--label"
                  disabled={pendingReadIds.has(item.feedItemId)}
                  onClick={() => void toggleFavoriteRead(item.feedItemId, !item.markedReadAt)}
                  type="button"
                >
                  {item.markedReadAt ? "Mark unread" : "Mark read"}
                </button>
              }
              post={{
                ...item.post,
                detailUrl: postDetailHref(item.feedItemId, "/dashboard?tab=favorites", "Favorites"),
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function sortFavoriteItems(items: FavoritePostListItem[]) {
  return [...items].sort((a, b) => {
    const aMarkedRead = Boolean(a.markedReadAt);
    const bMarkedRead = Boolean(b.markedReadAt);
    if (aMarkedRead !== bMarkedRead) return aMarkedRead ? 1 : -1;
    return Date.parse(b.favoritedAt) - Date.parse(a.favoritedAt);
  });
}

function favoritePostLabel(post: PostCardPost) {
  return post.title?.trim() || post.sourceName?.trim() || "this post";
}

function favoritePostTransitionName(feedItemId: string) {
  return `favorite-post-${feedItemId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function runFavoriteListTransition(update: () => void) {
  const documentWithTransitions = document as Document & {
    startViewTransition?: (callback: () => void) => void;
  };
  if (typeof documentWithTransitions.startViewTransition !== "function") {
    update();
    return;
  }
  documentWithTransitions.startViewTransition(() => {
    flushSync(update);
  });
}
