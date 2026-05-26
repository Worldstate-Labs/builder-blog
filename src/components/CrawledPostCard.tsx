"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { SourceBadge } from "@/components/SourceBadge";
import { CrawlingMethodPopover } from "@/components/CrawlingMethodPopover";

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
  /** Number of additional channel variants of this canonical post — shown as "+N channels". */
  alternateChannelCount?: number;
};

export function CrawledPostCard({
  context,
  dataRead,
  extraMeta,
  extraActions,
  fallbackBuilder,
  onInteract,
  post,
  showBuilderRow = true,
  variant = "card",
}: {
  context?: ReactNode;
  dataRead?: boolean;
  extraMeta?: ReactNode;
  extraActions?: ReactNode;
  fallbackBuilder?: CrawledPostBuilder | null;
  onInteract?: () => void | Promise<void>;
  post: CrawledPostCardPost;
  /**
   * Whether to render the "Author: X" segment in the meta line.
   * Pass `false` when the surrounding page already makes the builder clear
   * (e.g. the builder detail page or the post detail page).
   * @default true
   */
  showBuilderRow?: boolean;
  variant?: "card" | "row" | "detail";
}) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const interactionSentRef = useRef(false);
  const builder = post.builder ?? fallbackBuilder ?? null;
  const isDetail = variant === "detail";
  const summary = normalizedText(post.summary) || normalizedText(post.body);
  const summaryPreview = previewWords(summary, 200);
  const hasMoreSummary = summaryPreview !== summary;
  const title = post.title || firstLine(post.body);

  function noteInteraction() {
    if (!onInteract || interactionSentRef.current) return;
    interactionSentRef.current = true;
    void onInteract();
  }

  // Line 2: Author link
  const authorHref = builder
    ? builder.entityId
      ? `/builder/${builder.entityId}`
      : `/builders#${builder.id}`
    : null;

  const authorName = builder?.name ?? post.sourceName ?? null;

  return (
    <article
      className={`${variant === "row" ? "builder-post-row" : "feed-card"} crawled-post-card`}
      data-read={dataRead ? "true" : undefined}
    >
      <div className="min-w-0">
        {/* Line 1: Title */}
        {isDetail ? (
          <h1 className="mt-4 max-w-4xl text-2xl font-semibold leading-tight md:text-3xl">
            {title}
          </h1>
        ) : (
          <h3 className="crawled-post-title">{title}</h3>
        )}

        {/* Line 2: Meta row */}
        <div className="post-meta">
          {showBuilderRow && authorName ? (
            <>
              <span className="post-meta-author-label">Author:</span>
              {authorHref ? (
                <Link className="post-meta-author-link" href={authorHref}>
                  {authorName}
                </Link>
              ) : (
                <span className="post-meta-author-link">{authorName}</span>
              )}
              <span className="post-meta-dot" aria-hidden="true">·</span>
            </>
          ) : null}

          <SourceBadge
            builder={builder}
            sourceType={builder?.sourceType ?? post.sourceType ?? null}
          />

          {post.alternateChannelCount && post.alternateChannelCount > 0 ? (
            <>
              <span className="post-meta-dot" aria-hidden="true">·</span>
              <span title="Same post available via other libraries / channels">
                +{post.alternateChannelCount} channel{post.alternateChannelCount === 1 ? "" : "s"}
              </span>
            </>
          ) : null}

          {dataRead ? (
            <>
              <span className="post-meta-dot" aria-hidden="true">·</span>
              <span className="read-indicator" aria-label="Read">
                ✓ Read
              </span>
            </>
          ) : null}

          {extraMeta}
        </div>

        {/* Line 3: Summary / body */}
        {isDetail ? (
          <div className="mt-8 whitespace-pre-wrap text-base leading-8 text-[var(--muted-strong)]">
            {post.body}
          </div>
        ) : (
          <div className="crawled-post-summary post-summary">
            <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">
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
        )}

        {context}

        {/* Footer row: Published date (left) · Action icons (right) */}
        <div className="post-footer">
          <span className="post-footer-published">
            {post.publishedAt
              ? `Published ${formatDate(post.publishedAt)}`
              : "Published date unknown"}
          </span>

          <div className="post-actions">
            {/* 1. Open source */}
            <a
              aria-label="Open source"
              className="post-action-btn"
              href={post.url}
              onClick={noteInteraction}
              rel="noreferrer"
              target="_blank"
              title="Open source"
            >
              <ExternalLink className="h-4 w-4" />
            </a>

            {/* 2. Raw crawled content toggle */}
            <button
              aria-label="Raw crawled content"
              aria-expanded={rawExpanded}
              className={`post-action-btn${rawExpanded ? " post-action-btn--active" : ""}`}
              onClick={() => {
                setRawExpanded((v) => !v);
                if (!rawExpanded) noteInteraction();
              }}
              title="Raw crawled content"
              type="button"
            >
              <FileText className="h-4 w-4" />
            </button>

            {/* 3. Crawling method popover (also surfaces summarized-at) */}
            {post.crawlingTool || post.createdAt ? (
              <CrawlingMethodPopover
                crawlingTool={post.crawlingTool}
                summarizedAt={post.createdAt}
              />
            ) : null}

            {extraActions}
          </div>
        </div>

        {/* Raw content collapsible region */}
        {rawExpanded ? (
          <div className="mt-3 whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--paper)] p-4 text-sm leading-7 text-[var(--muted-strong)]">
            {post.body}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
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
