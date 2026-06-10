"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { SourceBadge } from "@/components/SourceBadge";
import { SourceAvatar } from "@/components/SourceAvatar";
import { FetchMethodPopover } from "@/components/FetchMethodPopover";
import { RecommendationReasonsPopover } from "@/components/RecommendationReasonsPopover";
import { useHydrated } from "@/components/ThemeToggle";

type FetchedPostBuilder = {
  id: string;
  entityId?: string | null;
  avatarUrl?: string | null;
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
  detailUrl?: string | null;
  url: string;
  publishedAt: string | null;
  createdAt: string;
  sourceName: string | null;
  sourceType?: string | null;
  fetchTool: string | null;
  builder?: FetchedPostBuilder | null;
  /** Number of additional library copies of this canonical post. */
  alternateChannelCount?: number;
};

export function PostCard({
  context,
  dataRead,
  extraMeta,
  extraActions,
  fallbackBuilder,
  onInteract,
  post,
  reasons,
  showBuilderRow = true,
  showDebugActions = false,
  showPublishedDate = true,
  showRawContent = true,
  showSourceBadge = true,
  stackActionsOnMobile = false,
  variant = "card",
}: {
  context?: ReactNode;
  dataRead?: boolean;
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
  showRawContent?: boolean;
  showSourceBadge?: boolean;
  stackActionsOnMobile?: boolean;
  variant?: "card" | "row" | "detail";
}) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryCanExpand, setSummaryCanExpand] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const hydrated = useHydrated();
  const interactionSentRef = useRef(false);
  const summaryTextRef = useRef<HTMLParagraphElement | null>(null);
  const builder = post.builder ?? fallbackBuilder ?? null;
  const isDetail = variant === "detail";
  const summary = normalizedText(post.summary) || normalizedText(post.body);
  const originalSummary = normalizedText(post.originalSummary);
  const title = post.title || firstLine(post.body);
  const actionContext = compactActionContext(title);
  const summaryIdBase = useId();
  const rawIdBase = useId();
  const summaryTextId = `${summaryIdBase}-summary`;
  const rawRegionId = `${rawIdBase}-raw-content`;
  const hasMoreSummary = summaryCanExpand;

  useEffect(() => {
    if (isDetail) return;
    const node = summaryTextRef.current;
    if (!node) return;

    const updateOverflow = () => {
      if (summaryExpanded) return;
      const hasRenderedOverflow = node.scrollHeight > node.clientHeight + 1;
      setSummaryCanExpand(hasRenderedOverflow);
    };

    updateOverflow();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isDetail, summary, summaryExpanded]);

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
  const authorAvatarSource = authorName
    ? {
        avatarUrl: builder?.avatarUrl ?? null,
        fetchUrl: builder?.fetchUrl ?? null,
        name: authorName,
        sourceType: builder?.sourceType ?? post.sourceType ?? "website",
        sourceUrl: builder?.sourceUrl ?? post.url ?? null,
      }
    : null;
  const hasAlternateChannels = Boolean(post.alternateChannelCount && post.alternateChannelCount > 0);
  const rawContentMode = rawContentModeForSourceType(builder?.sourceType ?? post.sourceType);
  const rawContent = rawContentMode === "raw_summary"
    ? originalSummary || summary
    : post.body;
  const rawContentLabel = rawContentMode === "raw_summary" ? "Source summary" : "Crawled content";
  const detailSummary = normalizedText(post.summary);
  const detailRawContent = normalizedText(post.body);
  const showDetailSummary = Boolean(
    isDetail && detailSummary && detailSummary !== detailRawContent,
  );
  const canReadRawContent = !isDetail && showRawContent && Boolean(rawContent);
  const showReadIndicator = Boolean(dataRead && !isDetail);
  const showMetaRow = Boolean(
    (showBuilderRow && authorName) ||
      showSourceBadge ||
      hasAlternateChannels ||
      showReadIndicator ||
      extraMeta,
  );

  return (
    <article
      className={`${variant === "row" ? "builder-post-row" : "feed-card"} fetched-post-card${isDetail ? " post-detail-card" : ""}`}
      data-read={dataRead ? "true" : undefined}
    >
      <div className="post-copy">
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
                <span className="post-meta-author">
                  {authorAvatarSource ? (
                    <SourceAvatar
                      className="post-meta-avatar"
                      imageSize={24}
                      source={authorAvatarSource}
                    />
                  ) : null}
                  {authorHref ? (
                    <Link className="post-meta-author-link" href={authorHref} onClick={noteInteraction}>
                      {authorName}
                    </Link>
                  ) : (
                    <span className="post-meta-author-link">{authorName}</span>
                  )}
                </span>
                {(showSourceBadge || hasAlternateChannels || showReadIndicator || extraMeta) ? (
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
                <span title="Same post available via other source libraries">
                  <CountMeta
                    label={post.alternateChannelCount === 1 ? "additional source library" : "additional source libraries"}
                    value={post.alternateChannelCount ?? 0}
                  />
                </span>
              </>
            ) : null}

            {showReadIndicator ? (
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
          <>
            {showDetailSummary ? (
              <section className="post-detail-summary" aria-label="Summary">
                <h2 className="post-detail-section-label">Summary</h2>
                <p>{detailSummary}</p>
              </section>
            ) : null}
            <section
              className={`post-detail-raw${rawExpanded ? " post-detail-raw--expanded" : ""}`}
              aria-label="Crawled content"
            >
              <div className="post-detail-raw-head">
                <div className="post-detail-raw-copy">
                  <h2 className="post-detail-section-label">Crawled content</h2>
                  <p className="post-detail-section-desc">
                    Full content captured by Fetch sources. It stays collapsed until
                    you need the source text.
                  </p>
                </div>
                <button
                  aria-controls={rawRegionId}
                  aria-expanded={rawExpanded}
                  className="post-detail-raw-toggle"
                  onClick={() => setRawExpanded((expanded) => !expanded)}
                  type="button"
                >
                  <BookOpen aria-hidden="true" className="post-detail-raw-toggle-icon" />
                  {rawExpanded ? "Hide crawled content" : "Show crawled content"}
                </button>
              </div>
              {rawExpanded ? (
                <div
                  aria-label="Crawled content"
                  className="post-detail-body"
                  id={rawRegionId}
                  role="region"
                >
                  {post.body}
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <div
            className={`fetched-post-summary post-summary${hasMoreSummary ? " post-summary--expandable" : ""}${summaryExpanded ? " post-summary--expanded" : ""}`}
          >
            <p
              className="fetched-post-summary-text"
              id={summaryTextId}
              ref={summaryTextRef}
            >
              {summary}
            </p>
            {hasMoreSummary ? (
              <button
                aria-controls={summaryTextId}
                aria-expanded={summaryExpanded}
                aria-label={actionLabel(
                  summaryExpanded ? "Show less summary" : "Show more summary",
                  actionContext,
                )}
                className="post-summary-toggle"
                onClick={() => {
                  setSummaryExpanded((expanded) => !expanded);
                  noteInteraction();
                }}
                type="button"
              >
                <ChevronDown aria-hidden="true" className="post-summary-toggle-icon" />
                <span>{summaryExpanded ? "Show less" : "See more"}</span>
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

          <div
            aria-label={actionLabel("Post actions", actionContext)}
            className="post-actions"
            onClickCapture={noteInteraction}
            role="group"
          >
            {/* External platform action: keep the platform icon, but use one stable label. */}
            <a
              aria-label={actionLabel("View original", actionContext)}
              className="post-source-original"
              href={post.url}
              onClick={noteInteraction}
              rel="noreferrer"
              target="_blank"
              title="View original"
            >
              <SourceBadge
                builder={builder}
                decorative
                sourceType={builder?.sourceType ?? post.sourceType ?? null}
                showLabel={false}
              />
              <span>View original</span>
            </a>

            {canReadRawContent && post.detailUrl ? (
              <Link
                aria-label={actionLabel("Read", actionContext)}
                className="post-raw-content-action post-read-action"
                href={post.detailUrl}
                onClick={noteInteraction}
                title="Read"
              >
                <BookOpen aria-hidden="true" className="post-raw-content-action-icon" />
                <span>Read</span>
              </Link>
            ) : canReadRawContent ? (
              <button
                aria-controls={rawRegionId}
                aria-label={actionLabel(rawContentLabel, actionContext)}
                aria-expanded={rawExpanded}
                className={`post-raw-content-action${rawExpanded ? " post-raw-content-action--active" : ""}`}
                onClick={() => {
                  setRawExpanded((v) => !v);
                  if (!rawExpanded) noteInteraction();
                }}
                title={rawContentLabel}
                type="button"
              >
                <BookOpen aria-hidden="true" className="post-raw-content-action-icon" />
                <span>{rawExpanded ? `Hide ${rawContentLabel.toLowerCase()}` : `Show ${rawContentLabel.toLowerCase()}`}</span>
              </button>
            ) : null}

            {extraActions}

            {showDebugActions && (post.fetchTool || post.createdAt) ? (
              <FetchMethodPopover
                accessibleLabel={actionLabel("Summary method", actionContext)}
                fetchTool={post.fetchTool}
                summarizedAt={post.createdAt}
              />
            ) : null}

            {showDebugActions && reasons && reasons.length > 0 ? (
              <RecommendationReasonsPopover reasons={reasons} />
            ) : null}
          </div>
        </div>

        {/* Crawled content collapsible region */}
        {!isDetail && rawExpanded && rawContent ? (
          <div
            aria-label={actionLabel(rawContentLabel, actionContext)}
            className="fetched-post-raw"
            id={rawRegionId}
            role="region"
          >
            {rawContent}
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

const rawContentModesBySourceType: Partial<Record<string, "raw_content" | "raw_summary">> = {};

function rawContentModeForSourceType(sourceType: string | null | undefined): "raw_content" | "raw_summary" {
  const key = sourceType?.trim().toLowerCase();
  if (!key) return "raw_content";
  return rawContentModesBySourceType[key] ?? "raw_content";
}
