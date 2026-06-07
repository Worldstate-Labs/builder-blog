"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCcw, Star } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { PostCard } from "@/components/PostCard";
import { useHydrated } from "@/components/ThemeToggle";
import { markPostRead } from "@/lib/mark-read";

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
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const hydrated = useHydrated();
  const [loadingDirection, setLoadingDirection] = useState<"append" | "prepend" | null>(null);
  const loadingGuard = useRef<"append" | "prepend" | null>(null);
  const [exhausted, setExhausted] = useState(initialSnapshots.length === 0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

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
    const fallbackFavoritedAt = nextFavorite ? new Date().toISOString() : null;
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
    await setPostFavorite(feedItemId, nextFavorite);
  }, []);

  const requestSnapshot = useCallback(
    async (direction: "append" | "prepend") => {
      if (loadingGuard.current) return;
      loadingGuard.current = direction;
      setLoadingDirection(direction);
      try {
        const response = await fetch(`/api/recommendations?direction=${direction}&limit=6`);
        if (!response.ok) return;
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
          className="fb-btn light compact"
          disabled={loadingDirection !== null}
          onClick={() => void requestSnapshot("prepend")}
          type="button"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>
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
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading posts
          </span>
        ) : exhausted ? (
          <span className="feed-end-note">No new unread posts left.</span>
        ) : null}
      </div>
    </section>
  );
}

function RecommendationCard({
  entry,
  markRead,
  showAdminActions,
  toggleFavorite,
}: {
  entry: RecommendationFeedEntry;
  markRead: (feedItemId: string) => Promise<void>;
  showAdminActions: boolean;
  toggleFavorite: (feedItemId: string, nextFavorite: boolean) => Promise<void>;
}) {
  const isRead = Boolean(entry.readAt);
  const isFavorite = Boolean(entry.favoritedAt);

  return (
    <PostCard
      dataRead={isRead}
      extraActions={
        <FavoriteToggleButton
          isFavorite={isFavorite}
          toggleFavorite={() => toggleFavorite(entry.item.id, !isFavorite)}
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
      showSourceBadge={false}
      stackActionsOnMobile={showAdminActions}
    />
  );
}

function postDetailHref(feedItemId: string, returnTo: string, returnLabel: string) {
  const params = new URLSearchParams({ returnLabel, returnTo });
  return `/posts/${feedItemId}?${params.toString()}`;
}

function FavoriteToggleButton({
  isFavorite,
  toggleFavorite,
}: {
  isFavorite: boolean;
  toggleFavorite: () => Promise<void>;
}) {
  return (
    <button
      aria-pressed={isFavorite}
      className={`post-action-btn post-favorite-btn${isFavorite ? " post-action-btn--active" : ""}`}
      onClick={() => void toggleFavorite()}
      title={isFavorite ? "Saved post" : "Save post"}
      type="button"
    >
      <Star className="h-4 w-4" />
    </button>
  );
}

async function setPostFavorite(feedItemId: string, favorite: boolean) {
  try {
    await fetch("/api/favorites", {
      method: favorite ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedItemId }),
    });
  } catch {
    // Best-effort optimistic UI; a reload restores the authoritative state.
  }
}

function mergeSnapshots(snapshots: RecommendationSnapshotEntry[]) {
  const seen = new Set<string>();
  return snapshots.filter((snapshot) => {
    if (seen.has(snapshot.id)) return false;
    seen.add(snapshot.id);
    return true;
  });
}

function formatDate(value: string, hydrated: boolean) {
  if (!value) return "";
  if (hydrated) return new Date(value).toLocaleString();
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}
