"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { ExternalLink, FileText, ScrollText } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { SourceBadge } from "@/components/SourceBadge";
import { FetchMethodPopover } from "@/components/FetchMethodPopover";
import { RecommendationReasonsPopover } from "@/components/RecommendationReasonsPopover";
import { useHydrated } from "@/components/ThemeToggle";

type FetchedPostBuilder = {
  id: string;
  entityId?: string | null;
  name: string;
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
};

export type PostCardPost = {
  id: string;
  title: string | null;
  body: string;
  summary?: string | null;
  originalSummary?: string | null;
  url: string;
  publishedAt: string | null;
  createdAt: string;
  sourceName: string | null;
  sourceType?: string | null;
  fetchTool: string | null;
  builder?: FetchedPostBuilder | null;
  /** Number of additional channel variants of this canonical post — shown as "+N channels". */
  alternateChannelCount?: number;
};

export function PostCard({
  context,
  dataRead,
  favoriteReadEmphasis = false,
  extraMeta,
  extraActions,
  fallbackBuilder,
  onInteract,
  post,
  reasons,
  showBuilderRow = true,
  showDebugActions = true,
  showPublishedDate = true,
  showSourceBadge = true,
  stackActionsOnMobile = false,
  variant = "card",
}: {
  context?: ReactNode;
  dataRead?: boolean;
  favoriteReadEmphasis?: boolean;
  extraMeta?: ReactNode;
  extraActions?: ReactNode;
  fallbackBuilder?: FetchedPostBuilder | null;
  onInteract?: () => void | Promise<void>;
  post: PostCardPost;
  /** Recommendation reasons surfaced via a popover icon in the footer. */
  reasons?: string[];
  /**
   * Whether to render the source name segment in the meta line. Keep the
   * default for feed-style post lists so every post surface uses the same
   * information hierarchy.
   * @default true
   */
  showBuilderRow?: boolean;
  showDebugActions?: boolean;
  showPublishedDate?: boolean;
  showSourceBadge?: boolean;
  stackActionsOnMobile?: boolean;
  variant?: "card" | "row" | "detail";
}) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [originalSummaryExpanded, setOriginalSummaryExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const hydrated = useHydrated();
  const interactionSentRef = useRef(false);
  const builder = post.builder ?? fallbackBuilder ?? null;
  const isDetail = variant === "detail";
  const summary = normalizedText(post.summary) || normalizedText(post.body);
  const originalSummary = normalizedText(post.originalSummary);
  const summaryPreview = previewWords(summary, 200);
  const hasMoreSummary = summaryPreview !== summary;
  const title = post.title || firstLine(post.body);
  const actionContext = compactActionContext(title);

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
  const hasAlternateChannels = Boolean(post.alternateChannelCount && post.alternateChannelCount > 0);
  const showMetaRow = Boolean(
    (showBuilderRow && authorName) ||
      showSourceBadge ||
      hasAlternateChannels ||
      dataRead ||
      extraMeta,
  );

  return (
    <article
      className={`${variant === "row" ? "builder-post-row" : "feed-card"} fetched-post-card${isDetail ? " post-detail-card" : ""}`}
      data-favorite-read={favoriteReadEmphasis ? "true" : undefined}
      data-read={dataRead ? "true" : undefined}
    >
      <div className="min-w-0">
        {/* Line 1: Title */}
        {isDetail ? (
          <h1 className="post-detail-title">
            {title}
          </h1>
        ) : (
          <h3 className="fetched-post-title">{title}</h3>
        )}

        {/* Line 2: Meta row */}
        {showMetaRow ? (
          <div className="post-meta">
            {showBuilderRow && authorName ? (
              <>
                {authorHref ? (
                  <Link className="post-meta-author-link" href={authorHref} onClick={noteInteraction}>
                    {authorName}
                  </Link>
                ) : (
                  <span className="post-meta-author-link">{authorName}</span>
                )}
                {(showSourceBadge || hasAlternateChannels || dataRead || extraMeta) ? (
                  <span className="post-meta-dot" aria-hidden="true">·</span>
                ) : null}
              </>
            ) : null}

            {showSourceBadge ? (
              <SourceBadge
                builder={builder}
                suppressLabelWhen={authorName}
                sourceType={builder?.sourceType ?? post.sourceType ?? null}
              />
            ) : null}

            {hasAlternateChannels ? (
              <>
                {showSourceBadge ? <span className="post-meta-dot" aria-hidden="true">·</span> : null}
                <span title="Same post available via other libraries / channels">
                  <CountMeta
                    label={post.alternateChannelCount === 1 ? "additional channel" : "additional channels"}
                    value={post.alternateChannelCount ?? 0}
                  />
                </span>
              </>
            ) : null}

            {dataRead ? (
              <>
                {(showSourceBadge || hasAlternateChannels) ? <span className="post-meta-dot" aria-hidden="true">·</span> : null}
                <span className="read-indicator" aria-label="Read">
                  ✓ Read
                </span>
              </>
            ) : null}

            {extraMeta}
          </div>
        ) : null}

        {/* Line 3: Summary / body */}
        {isDetail ? (
          <div className="post-detail-body">
            {post.body}
          </div>
        ) : (
          <div className="fetched-post-summary post-summary">
            <p className="fetched-post-summary-text">
              {summaryExpanded ? summary : summaryPreview}
            </p>
            {hasMoreSummary ? (
              <button
                className="post-summary-toggle"
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
        <div
          className="post-footer"
          data-stack-actions={stackActionsOnMobile ? "true" : undefined}
        >
          {showPublishedDate ? (
            <span className="post-footer-published">
              {post.publishedAt
                ? `Published ${formatDate(post.publishedAt, hydrated)}`
                : "Published date unknown"}
            </span>
          ) : (
            <span />
          )}

          <div className="post-actions" onClickCapture={noteInteraction}>
            {/* Primary action: open the original source to read the full content. */}
            <a
              aria-label={actionLabel("View original source", actionContext)}
              className="post-read-original"
              href={post.url}
              onClick={noteInteraction}
              rel="noreferrer"
              target="_blank"
              title="View the original on its source site"
            >
              View original
              <ExternalLink aria-hidden="true" className="post-read-original-icon" />
            </a>

            {showDebugActions ? (
              <>
                {/* 2. Raw content toggle */}
                <button
                  aria-label={actionLabel("Raw content", actionContext)}
                  aria-expanded={rawExpanded}
                  className={`post-action-btn${rawExpanded ? " post-action-btn--active" : ""}`}
                  onClick={() => {
                    setRawExpanded((v) => !v);
                    if (!rawExpanded) noteInteraction();
                  }}
                  title="Raw content"
                  type="button"
                >
                  <FileText className="h-4 w-4" />
                </button>

                {/* 3. Fetching method popover (also surfaces summarized-at) */}
                {post.fetchTool || post.createdAt ? (
                  <FetchMethodPopover
                    accessibleLabel={actionLabel("Summary method", actionContext)}
                    fetchTool={post.fetchTool}
                    summarizedAt={post.createdAt}
                  />
                ) : null}
              </>
            ) : null}

            {originalSummary ? (
              <button
                aria-label={actionLabel("View original summary", actionContext)}
                aria-expanded={originalSummaryExpanded}
                className={`post-action-btn${originalSummaryExpanded ? " post-action-btn--active" : ""}`}
                onClick={() => {
                  setOriginalSummaryExpanded((v) => !v);
                  if (!originalSummaryExpanded) noteInteraction();
                }}
                title="View original summary"
                type="button"
              >
                <ScrollText className="h-4 w-4" />
              </button>
            ) : null}

            {/* 4. Recommendation reasons (only when present) */}
            {reasons && reasons.length > 0 ? (
              <RecommendationReasonsPopover reasons={reasons} />
            ) : null}

            {extraActions}
          </div>
        </div>

        {/* Original fetch-time summary. Digest summaries may be translated or compressed. */}
        {originalSummaryExpanded && originalSummary ? (
          <div
            className="fetched-post-original-summary"
            role="region"
            aria-label={actionLabel("Original summary", actionContext)}
          >
            <div className="fetched-post-original-summary-label">Original summary</div>
            <p>{originalSummary}</p>
          </div>
        ) : null}

        {/* Raw content collapsible region */}
        {rawExpanded ? (
          <div
            aria-label={actionLabel("Raw content", actionContext)}
            className="fetched-post-raw"
            role="region"
          >
            {post.body}
          </div>
        ) : null}
      </div>
    </article>
  );
}


function formatDate(value: string, hydrated: boolean) {
  if (hydrated) return new Date(value).toLocaleDateString();
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function firstLine(body: string) {
  return body.split(/\r?\n/).find(Boolean)?.slice(0, 160) ?? "Untitled post";
}

function actionLabel(action: string, context: string) {
  return context ? `${action}: ${context}` : action;
}

function compactActionContext(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 96);
}

function normalizedText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function previewWords(value: string, maxWords: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(" ")}...`;
}
