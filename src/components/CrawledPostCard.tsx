"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { SourceBadge } from "@/components/SourceBadge";

type CrawledPostBuilder = {
  id: string;
  entityId?: string | null;
  name: string;
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType: string;
  sourceUrl: string | null;
  crawlUrl: string | null;
};

export type CrawledPostCardPost = {
  id: string;
  title: string | null;
  body: string;
  summary?: string | null;
  url: string;
  publishedAt: string | null;
  createdAt: string;
  sourceName: string | null;
  sourceType?: string | null;
  crawlingTool: string | null;
  builder?: CrawledPostBuilder | null;
};

export function CrawledPostCard({
  context,
  dataRead,
  extraMeta,
  extraActions,
  fallbackBuilder,
  onInteract,
  post,
  variant = "card",
}: {
  context?: ReactNode;
  dataRead?: boolean;
  extraMeta?: ReactNode;
  extraActions?: ReactNode;
  fallbackBuilder?: CrawledPostBuilder | null;
  onInteract?: () => void | Promise<void>;
  post: CrawledPostCardPost;
  variant?: "card" | "row";
}) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const interactionSentRef = useRef(false);
  const builder = post.builder ?? fallbackBuilder ?? null;
  const summary = normalizedText(post.summary) || normalizedText(post.body);
  const summaryPreview = previewWords(summary, 200);
  const hasMoreSummary = summaryPreview !== summary;
  const title = post.title || firstLine(post.body);

  function noteInteraction() {
    if (!onInteract || interactionSentRef.current) return;
    interactionSentRef.current = true;
    void onInteract();
  }

  return (
    <article
      className={`${variant === "row" ? "builder-post-row" : "feed-card"} crawled-post-card`}
      data-read={dataRead ? "true" : undefined}
    >
      <div className="min-w-0">
        <div className="item-kicker">
          <SourceBadge
            builder={builder}
            sourceType={builder?.sourceType ?? post.sourceType ?? null}
          />
          {post.publishedAt ? (
            <span>Published {formatDate(post.publishedAt)}</span>
          ) : (
            <span>Published date unknown</span>
          )}
          {post.crawlingTool ? <span>{post.crawlingTool}</span> : null}
          {extraMeta}
        </div>
        <h3 className="crawled-post-title">{title}</h3>
        <div className="crawled-post-builder">
          <span>Builder</span>
          {builder ? (
            <Link
              href={
                builder.entityId
                  ? `/builder/${builder.entityId}`
                  : `/builders#${builder.id}`
              }
            >
              {builder.name}
            </Link>
          ) : (
            <span>{post.sourceName ?? "Unknown builder"}</span>
          )}
        </div>
        <div className="crawled-post-summary">
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
            Summary
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">
            {summaryExpanded ? summary : summaryPreview}
          </p>
          {hasMoreSummary ? (
            <button
              className="text-link mt-2"
              onClick={() => {
                setSummaryExpanded((expanded) => !expanded);
                noteInteraction();
              }}
              type="button"
            >
              {summaryExpanded ? "See less" : "See more"}
            </button>
          ) : null}
        </div>
        {context}
        <details
          className="inline-disclosure crawled-post-raw"
          onToggle={(event) => {
            if (event.currentTarget.open) noteInteraction();
          }}
        >
          <summary>Raw crawled content</summary>
          <div className="mt-3 whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--paper)] p-4 text-sm leading-7 text-[var(--muted-strong)]">
            {post.body}
          </div>
        </details>
      </div>
      <div className="crawled-post-actions">
        <a
          className="button-light button-compact gap-2"
          href={post.url}
          onClick={noteInteraction}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-4 w-4" />
          Open source
        </a>
        {extraActions}
      </div>
    </article>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function firstLine(body: string) {
  return body.split(/\r?\n/).find(Boolean)?.slice(0, 160) ?? "Untitled post";
}

function normalizedText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function previewWords(value: string, maxWords: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(" ")}...`;
}
