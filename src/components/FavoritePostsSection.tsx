"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
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
      <div className="item-list mt-6" aria-live="polite" aria-busy="true">
        <div className="h-24 rounded-lg bg-black/10" />
        <div className="h-24 rounded-lg bg-black/10" />
        <span className="sr-only">Loading Favorite posts</span>
      </div>
    );
  }

  if (status === "error") {
    return <FavoritesMessage title="Couldn’t load Favorites" tone="error" />;
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
}: {
  body?: string;
  title: string;
  tone?: "empty" | "error";
}) {
  return (
    <div className="empty-panel mt-6 border-dashed md:p-8" role={tone === "error" ? "alert" : undefined}>
      <div className="flex items-start gap-3">
        <Star className={`mt-1 h-5 w-5 ${tone === "error" ? "text-[var(--danger)]" : "text-[var(--accent)]"}`} />
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">{title}</h2>
          {body ? (
            <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
              {body}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
