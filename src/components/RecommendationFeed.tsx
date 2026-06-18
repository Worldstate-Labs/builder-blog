"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { PostCard } from "@/components/PostCard";
import { PostFavoriteButton, postFavoriteActionLabel } from "@/components/PostFavoriteButton";
import { useHydrated } from "@/components/ThemeToggle";
import { markPostRead } from "@/lib/mark-read";
import { postDetailHref } from "@/lib/navigation";

export type RecommendationFeedEntry = {
  score: number;
  reasons: string[];
  rank: number;
  favoritedAt: string | null;
  readAt: string | null;
  item: {
    id: string;
    title: string | null;
    body: string;
    summary: string | null;
    url: string;
    publishedAt: string | null;
    createdAt: string;
    sourceName: string | null;
    fetchTool: string | null;
    builder: {
      id: string;
      entityId: string | null;
      avatarUrl: string | null;
      avatarDataUrl: string | null;
      name: string;
      sourceType: string;
      kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
      sourceUrl: string | null;
      fetchUrl: string | null;
    } | null;
  };
};

export type RecommendationSnapshotEntry = {
  id: string;
  createdAt: string;
  reason: string;
  items: RecommendationFeedEntry[];
};

export function RecommendationFeed({
  initialSnapshots,
  showAdminActions = false,
}: {
  initialSnapshots: RecommendationSnapshotEntry[];
  showAdminActions?: boolean;
}) {
  const [snapshots, setSnapshots] = useState(() => nonEmptySnapshots(initialSnapshots));
  const hydrated = useHydrated();
  const [loadingDirection, setLoadingDirection] = useState<"append" | "prepend" | null>(null);
  const [loadErrorDirection, setLoadErrorDirection] = useState<"append" | "prepend" | null>(null);
  const [favoriteError, setFavoriteError] = useState("");
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<string>>(() => new Set());
  const loadingGuard = useRef<"append" | "prepend" | null>(null);
  const [exhausted, setExhausted] = useState(initialSnapshots.length === 0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const favoriteStateByItemId = useMemo(() => {
    const stateByItemId = new Map<string, string | null>();
    for (const snapshot of snapshots) {
      for (const entry of snapshot.items) {
        if (!stateByItemId.has(entry.item.id)) {
          stateByItemId.set(entry.item.id, entry.favoritedAt);
        }
      }
    }
    return stateByItemId;
  }, [snapshots]);

  const markRead = useCallback(async (feedItemId: string) => {
    const fallbackReadAt = new Date().toISOString();
    setSnapshots((current) =>
      current.map((snapshot) => ({
        ...snapshot,
        items: snapshot.items.map((entry) =>
          entry.item.id === feedItemId
            ? { ...entry, readAt: entry.readAt ?? fallbackReadAt }
            : entry,
        ),
      })),
    );
    await markPostRead(feedItemId);
  }, []);

  const toggleFavorite = useCallback(async (feedItemId: string, nextFavorite: boolean) => {
    if (pendingFavoriteIds.has(feedItemId)) return;
    const fallbackFavoritedAt = nextFavorite ? new Date().toISOString() : null;
    const previousFavoritedAt = favoriteStateByItemId.get(feedItemId) ?? null;
    setFavoriteError("");
    setPendingFavoriteIds((current) => new Set([...current, feedItemId]));
    setSnapshots((current) =>
      current.map((snapshot) => ({
        ...snapshot,
        items: snapshot.items.map((entry) =>
          entry.item.id === feedItemId
            ? { ...entry, favoritedAt: fallbackFavoritedAt }
            : entry,
        ),
      })),
    );
    try {
      await setPostFavorite(feedItemId, nextFavorite);
    } catch {
      setSnapshots((current) => restoreFavoriteState(current, feedItemId, previousFavoritedAt));
      setFavoriteError("Could not update reading queue. Try again.");
    } finally {
      setPendingFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(feedItemId);
        return next;
      });
    }
  }, [favoriteStateByItemId, pendingFavoriteIds]);

  const requestSnapshot = useCallback(
    async (direction: "append" | "prepend") => {
      if (loadingGuard.current) return;
      loadingGuard.current = direction;
      setLoadingDirection(direction);
      setLoadErrorDirection(null);
      try {
        const response = await fetch(`/api/recommendations?direction=${direction}&limit=6`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const snapshot = data.snapshot as RecommendationSnapshotEntry | null | undefined;
        if (!snapshot || snapshot.items.length === 0) {
          if (direction === "append") setExhausted(true);
          return;
        }
        setSnapshots((current) =>
          direction === "prepend"
            ? mergeSnapshots([snapshot, ...current])
            : mergeSnapshots([...current, snapshot]),
        );
        setExhausted(false);
      } catch {
        setLoadErrorDirection(direction);
      } finally {
        loadingGuard.current = null;
        setLoadingDirection(null);
      }
    },
    [],
  );

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || exhausted) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void requestSnapshot("append");
      },
      { rootMargin: "520px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [exhausted, requestSnapshot]);

  return (
    <section className="feed-content-stack recommendation-feed">
      <div className="recommendation-feed-actions">
        <button
          aria-label="Refresh Following posts"
          className="fb-btn light compact"
          disabled={loadingDirection !== null}
          onClick={() => void requestSnapshot("prepend")}
          type="button"
        >
          <RefreshCcw className="feed-action-icon" />
          Refresh
        </button>
      </div>
      {favoriteError ? (
        <p className="feed-load-error recommendation-favorite-error" role="status">
          {favoriteError}
        </p>
      ) : null}
      <div className="recommendation-snapshot-list">
        {snapshots.map((snapshot) => (
          <section className="recommendation-snapshot" key={snapshot.id}>
            <div className="recommendation-snapshot-header">
              <span>Following update</span>
              <span>{formatDate(snapshot.createdAt, hydrated)}</span>
              <CountMeta
                label={snapshot.items.length === 1 ? "post" : "posts"}
                value={snapshot.items.length}
              />
            </div>
            {snapshot.items.map((entry) => (
              <RecommendationCard
                entry={entry}
                key={`${snapshot.id}:${entry.item.id}`}
                markRead={markRead}
                pendingFavorite={pendingFavoriteIds.has(entry.item.id)}
                showAdminActions={showAdminActions}
                toggleFavorite={toggleFavorite}
              />
            ))}
          </section>
        ))}
      </div>
      <div ref={loadMoreRef} className="feed-load-more">
        {loadingDirection ? (
          <span className="status-chip">
            <Loader2 className="feed-loading-icon" />
            Loading Following posts
          </span>
        ) : loadErrorDirection ? (
          <span className="feed-load-error" role="status">
            Could not load Following posts.
            <button
              className="feed-inline-retry"
              onClick={() => void requestSnapshot(loadErrorDirection)}
              type="button"
            >
              Retry
            </button>
          </span>
        ) : exhausted ? (
          <span className="feed-end-note">No more unread Following posts to load.</span>
        ) : null}
      </div>
    </section>
  );
}

function RecommendationCard({
  entry,
  markRead,
  pendingFavorite,
  showAdminActions,
  toggleFavorite,
}: {
  entry: RecommendationFeedEntry;
  markRead: (feedItemId: string) => Promise<void>;
  pendingFavorite: boolean;
  showAdminActions: boolean;
  toggleFavorite: (feedItemId: string, nextFavorite: boolean) => Promise<void>;
}) {
  const isRead = Boolean(entry.readAt);
  const isFavorite = Boolean(entry.favoritedAt);

  return (
    <PostCard
      dataRead={isRead}
      extraActions={
        <PostFavoriteButton
          ariaLabel={postFavoriteActionLabel(isFavorite, recommendationTargetLabel(entry.item))}
          disabled={pendingFavorite}
          isFavorite={isFavorite}
          onToggle={() => void toggleFavorite(entry.item.id, !isFavorite)}
        />
      }
      onInteract={() => markRead(entry.item.id)}
      post={{
        ...entry.item,
        detailUrl: postDetailHref(
          entry.item.id,
          "/dashboard?tab=following",
          "Following",
        ),
      }}
      reasons={showAdminActions ? entry.reasons : undefined}
      showDebugActions={showAdminActions}
      stackActionsOnMobile={showAdminActions}
    />
  );
}

function recommendationTargetLabel(item: RecommendationFeedEntry["item"]) {
  return item.title?.trim() || item.sourceName?.trim() || "this post";
}

async function setPostFavorite(feedItemId: string, favorite: boolean) {
  const response = await fetch("/api/favorites", {
    method: favorite ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedItemId }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function restoreFavoriteState(
  snapshots: RecommendationSnapshotEntry[],
  feedItemId: string,
  favoritedAt: string | null,
): RecommendationSnapshotEntry[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    items: snapshot.items.map((entry) =>
      entry.item.id === feedItemId ? { ...entry, favoritedAt } : entry,
    ),
  }));
}

function mergeSnapshots(snapshots: RecommendationSnapshotEntry[]) {
  const seen = new Set<string>();
  return nonEmptySnapshots(snapshots).filter((snapshot) => {
    if (seen.has(snapshot.id)) return false;
    seen.add(snapshot.id);
    return true;
  });
}

function nonEmptySnapshots(snapshots: RecommendationSnapshotEntry[]) {
  return snapshots.filter((snapshot) => snapshot.items.length > 0);
}

function formatDate(value: string, hydrated: boolean) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(hydrated ? {} : { timeZone: "UTC", timeZoneName: "short" }),
  }).format(new Date(value));
}
