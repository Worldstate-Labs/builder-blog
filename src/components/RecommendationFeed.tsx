"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, Loader2, RefreshCcw } from "lucide-react";
import { SourceBadge } from "@/components/SourceBadge";

export type RecommendationFeedEntry = {
  score: number;
  reasons: string[];
  rank: number;
  readAt: string | null;
  item: {
    id: string;
    title: string | null;
    body: string;
    url: string;
    publishedAt: string | null;
    createdAt: string;
    sourceName: string | null;
    crawlingTool: string | null;
    builder: {
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

export function RecommendationFeed({
  initialSnapshots,
}: {
  initialSnapshots: RecommendationSnapshotEntry[];
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
    const response = await fetch("/api/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedItemId }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (data?.readAt) {
      setSnapshots((current) =>
        current.map((snapshot) => ({
          ...snapshot,
          items: snapshot.items.map((entry) =>
            entry.item.id === feedItemId ? { ...entry, readAt: data.readAt } : entry,
          ),
        })),
      );
    }
  }, []);

  const requestSnapshot = useCallback(
    async (direction: "append" | "prepend") => {
      if (loadingDirection) return;
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
        setLoadingDirection(null);
      }
    },
    [loadingDirection],
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
    <section className="mt-10">
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
        <span className="text-sm text-[var(--muted)]">
          Read posts stay in their snapshot and are filtered from future requests.
        </span>
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
    <article className="feed-card" data-read={isRead ? "true" : undefined}>
      <div className="item-kicker">
        <SourceBadge
          builder={entry.item.builder}
          sourceType={entry.item.builder?.sourceType ?? null}
        />
        <span>{entry.item.builder?.name ?? entry.item.sourceName ?? "Unknown source"}</span>
        <span>{formatDate(entry.item.publishedAt ?? entry.item.createdAt)}</span>
        <span>{Math.round(entry.score)} match</span>
        {isRead ? <span>Read {formatDate(entry.readAt ?? "")}</span> : null}
      </div>
      <h2 className="mt-3 font-serif text-2xl">{entry.item.title || firstLine(entry.item.body)}</h2>
      <p className="mt-3 line-clamp-4 text-sm leading-7 text-[var(--muted-strong)]">
        {firstLine(entry.item.body, 420)}
      </p>
      {entry.reasons.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {entry.reasons.map((reason) => (
            <span className="sub-pill" key={reason}>
              {reason}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          className="button-dark button-compact gap-2"
          href={entry.item.url}
          onClick={() => void markRead(entry.item.id)}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-4 w-4" />
          Open
        </a>
        <Link
          className="button-light button-compact gap-2"
          href={`/recommendations/items/${entry.item.id}`}
        >
          <BookOpen className="h-4 w-4" />
          {isRead ? "Read again" : "Read"}
        </Link>
      </div>
    </article>
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

function firstLine(body: string, maxLength = 180) {
  return body.split(/\r?\n/).find(Boolean)?.slice(0, maxLength) ?? "Untitled post";
}

function formatDate(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}
