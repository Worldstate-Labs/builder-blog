"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, Loader2 } from "lucide-react";

export type RecommendationFeedEntry = {
  score: number;
  reasons: string[];
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
    } | null;
  };
};

export function RecommendationFeed({
  initialItems,
  initialNextOffset,
}: {
  initialItems: RecommendationFeedEntry[];
  initialNextOffset: number | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(initialItems.length === 0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const markRead = useCallback(async (feedItemId: string) => {
    setItems((current) => current.filter((entry) => entry.item.id !== feedItemId));
    await fetch("/api/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedItemId }),
    }).catch(() => undefined);
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || nextOffset === null) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/recommendations?offset=${nextOffset}&limit=20`);
      if (!response.ok) return;
      const data = await response.json();
      const incoming = (data.items ?? []) as RecommendationFeedEntry[];
      setItems((current) => mergeEntries(current, incoming));
      setNextOffset(data.nextOffset ?? null);
      setExhausted((data.nextOffset ?? null) === null && incoming.length === 0);
    } finally {
      setLoading(false);
    }
  }, [loading, nextOffset]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || nextOffset === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { rootMargin: "520px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, nextOffset]);

  return (
    <section className="mt-10">
      <div className="item-list">
        {items.map((entry) => (
          <article className="feed-card" key={entry.item.id}>
            <div className="item-kicker">
              <span>{entry.item.builder?.name ?? entry.item.sourceName ?? "Unknown source"}</span>
              <span>{formatDate(entry.item.publishedAt ?? entry.item.createdAt)}</span>
              <span>{Math.round(entry.score)} match</span>
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
              <button
                className="button-light button-compact gap-2"
                onClick={() => void markRead(entry.item.id)}
                type="button"
              >
                <Eye className="h-4 w-4" />
                Read
              </button>
            </div>
          </article>
        ))}
      </div>
      <div ref={loadMoreRef} className="mt-6 flex min-h-14 items-center justify-center">
        {loading ? (
          <span className="status-chip">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading
          </span>
        ) : nextOffset === null ? (
          <span className="text-sm text-[var(--muted)]">
            {items.length === 0 || exhausted ? "No unread recommendations left." : "End of recommendations."}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function mergeEntries(
  current: RecommendationFeedEntry[],
  incoming: RecommendationFeedEntry[],
) {
  const seen = new Set(current.map((entry) => entry.item.id));
  return [...current, ...incoming.filter((entry) => !seen.has(entry.item.id))];
}

function firstLine(body: string, maxLength = 180) {
  return body.split(/\r?\n/).find(Boolean)?.slice(0, maxLength) ?? "Untitled post";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
