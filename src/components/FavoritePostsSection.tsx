"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import {
  RecommendationFeed,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";

type FavoritesResponse = {
  count: number;
  snapshot: RecommendationSnapshotEntry | null;
  strategy: string;
};

export function FavoritePostsSection() {
  const [favorites, setFavorites] = useState<FavoritesResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadFavorites = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus("loading");

    try {
      const response = await fetch("/api/favorites", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as FavoritesResponse;
      if (mountedRef.current && requestIdRef.current === requestId) {
        setFavorites(data);
        setStatus("ready");
      }
    } catch {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void loadFavorites(), 0);
    return () => window.clearTimeout(id);
  }, [loadFavorites]);

  if (status === "loading") {
    return (
      <div className="feed-content-stack">
        <div className="feed-skeleton-list" aria-live="polite" aria-busy="true">
          <div className="feed-skeleton-card" />
          <div className="feed-skeleton-card" />
          <span className="sr-only">Loading Favorite posts</span>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <FavoritesMessage
        title="Couldn’t load Favorites"
        tone="error"
        onRetry={() => void loadFavorites()}
      />
    );
  }

  if (!favorites?.snapshot || favorites.snapshot.items.length === 0) {
    return (
      <FavoritesMessage
        title="No favorite posts yet"
        body="Save posts from Following and they will appear here."
      />
    );
  }

  return (
    <RecommendationFeed
      initialSnapshots={[favorites.snapshot]}
      key={favorites.snapshot.items.map((entry) => entry.item.id).join("|")}
      mode="favorites"
    />
  );
}

function FavoritesMessage({
  body,
  title,
  tone = "empty",
  onRetry,
}: {
  body?: string;
  onRetry?: () => void;
  title: string;
  tone?: "empty" | "error";
}) {
  return (
    <div className="feed-content-stack">
      <EmptyState
        body={body}
        className="feed-state-panel"
        title={title}
        tone={tone}
        role={tone === "error" ? "alert" : undefined}
        actions={
          onRetry ? (
            <button className="fb-btn light compact" onClick={onRetry} type="button">
              <RefreshCcw aria-hidden="true" className="h-3.5 w-3.5" />
              Retry
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
