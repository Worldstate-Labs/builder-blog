"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { CrawledPostCard } from "@/components/CrawledPostCard";
import { markPostRead } from "@/lib/mark-read";

export type RecommendationFeedEntry = {
  score: number;
  reasons: string[];
  rank: number;
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
    crawlingTool: string | null;
    builder: {
      id: string;
      entityId: string | null;
      name: string;
      sourceType: string;
      kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
      sourceUrl: string | null;
      crawlUrl: string | null;
    } | null;
  };
};

export type RecommendationSnapshotEntry = {
  id: string;
  createdAt: string;
  reason: string;
  items: RecommendationFeedEntry[];
};

type RecommendationScope = "for-you" | "subscription";

export function RecommendationFeed({
  initialSnapshots,
  scope = "for-you",
}: {
  initialSnapshots: RecommendationSnapshotEntry[];
  scope?: RecommendationScope;
}) {
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [loadingDirection, setLoadingDirection] = useState<"append" | "prepend" | null>(null);
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

  const requestSnapshot = useCallback(
    async (direction: "append" | "prepend") => {
      if (loadingDirection) return;
      setLoadingDirection(direction);
      try {
        const response = await fetch(
          `/api/recommendations?direction=${direction}&limit=6&scope=${scope}`,
        );
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
        setLoadingDirection(null);
      }
    },
    [loadingDirection, scope],
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
    <section className="recommendation-feed mt-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button
          className="button-light button-compact gap-2"
          disabled={loadingDirection !== null}
          onClick={() => void requestSnapshot("prepend")}
          type="button"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh snapshot
        </button>
      </div>
      <div className="item-list">
        {snapshots.map((snapshot) => (
          <section className="recommendation-snapshot" key={snapshot.id}>
            <div className="recommendation-snapshot-header">
              <span>Snapshot</span>
              <span>{formatDate(snapshot.createdAt)}</span>
              <span>{snapshot.items.length} posts</span>
            </div>
            {snapshot.items.map((entry) => (
              <RecommendationCard entry={entry} key={`${snapshot.id}:${entry.item.id}`} markRead={markRead} />
            ))}
          </section>
        ))}
      </div>
      <div ref={loadMoreRef} className="mt-6 flex min-h-14 items-center justify-center">
        {loadingDirection ? (
          <span className="status-chip">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading
          </span>
        ) : exhausted ? (
          <span className="text-sm text-[var(--muted)]">No new unread recommendations left.</span>
        ) : null}
      </div>
    </section>
  );
}

function RecommendationCard({
  entry,
  markRead,
}: {
  entry: RecommendationFeedEntry;
  markRead: (feedItemId: string) => Promise<void>;
}) {
  const isRead = Boolean(entry.readAt);

  return (
    <CrawledPostCard
      context={
        entry.reasons.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {entry.reasons.map((reason) => (
              <span className="sub-pill" key={reason}>
                {reason}
              </span>
            ))}
          </div>
        ) : null
      }
      dataRead={isRead}
      extraMeta={<span>{Math.round(entry.score)} match</span>}
      onInteract={() => markRead(entry.item.id)}
      post={entry.item}
    />
  );
}

function mergeSnapshots(snapshots: RecommendationSnapshotEntry[]) {
  const seen = new Set<string>();
  return snapshots.filter((snapshot) => {
    if (seen.has(snapshot.id)) return false;
    seen.add(snapshot.id);
    return true;
  });
}

function formatDate(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}
