"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { SourceBadge } from "@/components/SourceBadge";

type BuilderSummary = {
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType: string;
  sourceUrl: string | null;
  crawlUrl: string | null;
};

type BuilderFeedItem = {
  id: string;
  kind: string;
  externalId: string;
  title: string | null;
  body: string;
  url: string;
  publishedAt: string | null;
  createdAt: string;
  sourceName: string | null;
  crawlingTool: string | null;
};

type BuilderFeedItemsProps = {
  builder: BuilderSummary;
  builderId: string;
  totalCount: number;
};

export function BuilderFeedItems({
  builder,
  builderId,
  totalCount,
}: BuilderFeedItemsProps) {
  const [items, setItems] = useState<BuilderFeedItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadItems(open: boolean) {
    if (!open || items || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/builders/${builderId}/feed-items`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load crawled posts");
      const payload = (await response.json()) as { items?: BuilderFeedItem[] };
      setItems(payload.items ?? []);
    } catch {
      setError("Could not load crawled posts.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <details className="builder-posts" onToggle={(event) => loadItems(event.currentTarget.open)}>
      <summary>
        <span>Crawled posts</span>
        <span className="text-[var(--muted)]">
          {items ? `Latest ${items.length} of ${totalCount}` : `Latest posts of ${totalCount}`}
        </span>
      </summary>
      <div className="builder-post-list">
        {isLoading ? (
          <div className="p-4 text-sm text-[var(--muted-strong)]" role="status">
            Loading crawled posts...
          </div>
        ) : null}
        {error ? (
          <div className="p-4 text-sm text-[var(--danger)]" role="status">
            {error}
          </div>
        ) : null}
        {items?.map((item) => (
          <article key={item.id} className="builder-post-row">
            <div className="min-w-0">
              <div className="item-kicker">
                <SourceBadge builder={builder} />
                <span>{feedItemKindLabel(item.kind)}</span>
                {item.publishedAt ? <span>Published {formatDate(item.publishedAt)}</span> : null}
                <span>Crawled {formatDate(item.createdAt)}</span>
                {item.sourceName ? <span>{item.sourceName}</span> : null}
                <span>{item.crawlingTool ?? "Legacy crawl/import"}</span>
              </div>
              <h4 className="item-title">{item.title || firstLine(item.body)}</h4>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted-strong)]">
                {firstLine(item.body)}
              </p>
              <details className="inline-disclosure">
                <summary>Read full crawl</summary>
                <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                    Crawling tool · {item.crawlingTool ?? "Legacy crawl/import"}
                  </p>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--muted-strong)]">
                    {item.body}
                  </div>
                </div>
              </details>
              <dl className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">External id</dt>
                  <dd className="mt-1 break-all font-mono text-[var(--muted-strong)]">
                    {item.externalId}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Crawling tool</dt>
                  <dd className="mt-1 break-all text-[var(--muted-strong)]">
                    {item.crawlingTool ?? "Legacy crawl/import"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Source URL</dt>
                  <dd className="mt-1 break-all text-[var(--muted-strong)]">{item.url}</dd>
                </div>
              </dl>
            </div>
            <a
              className="button-light button-compact min-w-24 gap-2"
              href={item.url}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          </article>
        ))}
        {items?.length === 0 ? (
          <div className="p-4 text-sm text-[var(--muted-strong)]">
            No crawled posts have been stored for this builder yet.
          </div>
        ) : null}
      </div>
    </details>
  );
}

function feedItemKindLabel(kind: string) {
  const labels: Record<string, string> = {
    ARTICLE: "Article",
    POST: "Post",
    TWEET: "X post",
    PODCAST_EPISODE: "Podcast",
    VIDEO: "Video",
  };
  return labels[kind] ?? kind.toLowerCase().replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function firstLine(body: string) {
  return body.split(/\r?\n/).find(Boolean)?.slice(0, 160) ?? "Untitled item";
}
