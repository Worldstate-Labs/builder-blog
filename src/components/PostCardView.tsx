"use client";

import type { ComponentType, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { OriginalSourceAction } from "@/components/OriginalSourceAction";
import { RelativeTime } from "@/components/RelativeTime";
import { SourceBadge } from "@/components/SourceBadge";
import { SourceAvatar } from "@/components/SourceAvatar";
import { FetchMethodPopover } from "@/components/FetchMethodPopover";
import { RecommendationReasonsPopover } from "@/components/RecommendationReasonsPopover";
import { decodeHtmlEntities } from "@/lib/decode-entities";

export type PostCardLinkProps = {
  href: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
  "aria-label"?: string;
  title?: string;
};

export type PostCardLinkComponent = ComponentType<PostCardLinkProps>;

// Dependency-free default link renderer. The app injects next/link via the
// PostCard wrapper to preserve client-side navigation; Storybook and
// design-sync render with this plain anchor so the view stays decoupled.
function DefaultLink({ href, children, ...rest }: PostCardLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

type FetchedPostBuilder = {
  id: string;
  entityId?: string | null;
  avatarUrl?: string | null;
  avatarDataUrl?: string | null;
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

export type PostCardViewProps = {
  context?: ReactNode;
  dataRead?: boolean;
  extraMeta?: ReactNode;
  extraActions?: ReactNode;
  fallbackBuilder?: FetchedPostBuilder | null;
  /** Link renderer for internal navigation. Defaults to a plain anchor. */
  linkComponent?: PostCardLinkComponent;
  onInteract?: () => void | Promise<void>;
  post: PostCardPost;
  /** Recommendation reasons surfaced via a popover icon in the footer. */
  reasons?: string[];
  summaryContent?: ReactNode;
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
  titleContent?: ReactNode;
  variant?: "card" | "row" | "detail";
};

export function PostCardView({
  context,
  dataRead,
  extraMeta,
  extraActions,
  fallbackBuilder,
  linkComponent: LinkComponent = DefaultLink,
  onInteract,
  post,
  reasons,
  summaryContent,
  showBuilderRow = true,
  showDebugActions = false,
  showPublishedDate = true,
  showRawContent = true,
  showSourceBadge = true,
  stackActionsOnMobile = false,
  titleContent,
  variant = "card",
}: PostCardViewProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryCanExpand, setSummaryCanExpand] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(variant === "detail");
  const interactionSentRef = useRef(false);
  const summaryTextRef = useRef<HTMLParagraphElement | null>(null);
  const builder = post.builder ?? fallbackBuilder ?? null;
  const isDetail = variant === "detail";
  const summary = displaySummaryText(post.summary, post.url) || normalizedText(post.body);
  const originalSummary = normalizedText(post.originalSummary);
  const title = decodeHtmlEntities(post.title || firstLine(post.body));
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
  const authorHandle = detailAuthorHandle(builder, authorName);
  const authorAvatarSource = authorName
    ? {
        avatarDataUrl: builder?.avatarDataUrl ?? null,
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
  const rawContentLabel = rawContentMode === "raw_summary" ? "Source summary" : "Original content";
  const detailSummary = displaySummaryText(post.summary, post.url);
  const detailRawContent = normalizedText(post.body);
  const showDetailSummary = Boolean(
    isDetail && detailSummary && detailSummary !== detailRawContent,
  );
  const canReadRawContent = !isDetail && showRawContent && Boolean(rawContent);
  const showOriginalAction = Boolean(post.url);
  const showMetaSourceBadge = showSourceBadge && !showOriginalAction;
  const showReadIndicator = Boolean(dataRead && !isDetail);
  const showMetaRow = Boolean(
    !isDetail &&
      ((showBuilderRow && authorName) ||
        showMetaSourceBadge ||
        hasAlternateChannels ||
        showReadIndicator ||
        extraMeta),
  );
  const detailReadTime = readingTimeLabel(`${detailSummary || ""} ${post.body || ""}`);

  return (
    <article
      className={`${variant === "row" ? "builder-post-row" : "feed-card"} fetched-post-card${isDetail ? " post-detail-card" : ""}`}
      data-read={dataRead ? "true" : undefined}
    >
      <div className="post-copy">
        {isDetail ? (
          <header className="post-detail-head">
            <div className="post-detail-kicker-row" aria-label="Post metadata">
              {post.publishedAt ? (
                <RelativeTime value={post.publishedAt} fallback="Date unknown" />
              ) : (
                <span>Date unknown</span>
              )}
              <span className="post-detail-dot" aria-hidden="true">·</span>
              <span>{detailReadTime}</span>
            </div>
            <h1 className="post-detail-title">
              {titleContent ?? title}
            </h1>
            <div className="post-detail-byline">
              {authorName ? (
                <div className="post-detail-author">
                  {authorAvatarSource ? (
                    <SourceAvatar
                      className="post-detail-author-avatar"
                      imageSize={24}
                      source={authorAvatarSource}
                    />
                  ) : null}
                  <div className="post-detail-author-copy">
                    {authorHref ? (
                      <LinkComponent
                        className="post-detail-author-name"
                        href={authorHref}
                        onClick={noteInteraction}
                      >
                        {authorName}
                      </LinkComponent>
                    ) : (
                      <span className="post-detail-author-name">{authorName}</span>
                    )}
                    {authorHandle ? (
                      <span className="post-detail-author-handle">{authorHandle}</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div
                aria-label={actionLabel("Post actions", actionContext)}
                className="post-detail-actions"
                onClickCapture={noteInteraction}
                role="group"
              >
                {extraActions}
                {showOriginalAction ? (
                  <OriginalSourceAction
                    ariaLabel={actionLabel("Original", actionContext)}
                    builder={builder}
                    href={post.url}
                    onClick={noteInteraction}
                    sourceType={builder?.sourceType ?? post.sourceType ?? null}
                  />
                ) : null}
              </div>
            </div>
          </header>
        ) : (
          <h3 className="fetched-post-title">{titleContent ?? title}</h3>
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
                    <LinkComponent className="post-meta-author-link" href={authorHref} onClick={noteInteraction}>
                      {authorName}
                    </LinkComponent>
                  ) : (
                    <span className="post-meta-author-link">{authorName}</span>
                  )}
                </span>
                {(showMetaSourceBadge || hasAlternateChannels || showReadIndicator || extraMeta) ? (
                  <span className="post-meta-dot" aria-hidden="true">·</span>
                ) : null}
              </>
            ) : null}

            {showMetaSourceBadge ? (
              <SourceBadge
                builder={builder}
                suppressLabelWhen={authorName}
                sourceType={builder?.sourceType ?? post.sourceType ?? null}
              />
            ) : null}

            {hasAlternateChannels ? (
              <>
                {showMetaSourceBadge ? <span className="post-meta-dot" aria-hidden="true">·</span> : null}
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
                {(showMetaSourceBadge || hasAlternateChannels) ? <span className="post-meta-dot" aria-hidden="true">·</span> : null}
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
            {detailRawContent ? (
              <section
                aria-label={rawContentLabel}
                className={`post-detail-raw${rawExpanded ? " post-detail-raw--expanded" : ""}`}
              >
                <div className="post-detail-raw-head">
                  <div className="post-detail-raw-copy">
                    <h2 className="post-detail-section-label">{rawContentLabel}</h2>
                    <p className="post-detail-section-desc">Saved by Fetch sources.</p>
                  </div>
                  <button
                    aria-controls={rawRegionId}
                    aria-expanded={rawExpanded}
                    className="post-inline-action post-inline-action--label post-raw-content-action post-detail-raw-toggle"
                    onClick={() => setRawExpanded((expanded) => !expanded)}
                    type="button"
                  >
                    <BookOpen aria-hidden="true" className="post-raw-content-action-icon" />
                    {rawExpanded ? `Hide ${rawContentLabel.toLowerCase()}` : `Show ${rawContentLabel.toLowerCase()}`}
                  </button>
                </div>
                {rawExpanded ? (
                  <div
                    aria-label={rawContentLabel}
                    className="post-detail-body"
                    id={rawRegionId}
                    role="region"
                  >
                    {post.body}
                  </div>
                ) : null}
              </section>
            ) : null}
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
              {summaryContent ?? summary}
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
                <span className="sr-only">{summaryExpanded ? "Show less" : "Show more"}</span>
              </button>
            ) : null}
          </div>
        )}

        {context}

        {!isDetail ? (
          <div
            className="post-footer"
            data-stack-actions={stackActionsOnMobile ? "true" : undefined}
          >
            {showPublishedDate ? (
              post.publishedAt ? (
                <RelativeTime className="post-footer-published" value={post.publishedAt} />
              ) : (
                <span className="post-footer-published">Date unknown</span>
              )
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
              {showOriginalAction ? (
                <OriginalSourceAction
                  ariaLabel={actionLabel("Original", actionContext)}
                  builder={builder}
                  href={post.url}
                  onClick={noteInteraction}
                  sourceType={builder?.sourceType ?? post.sourceType ?? null}
                />
              ) : null}

              {canReadRawContent && post.detailUrl ? (
                <LinkComponent
                  aria-label={actionLabel("Read", actionContext)}
                  className="post-inline-action post-inline-action--icon post-raw-content-action post-read-action"
                  href={post.detailUrl}
                  onClick={noteInteraction}
                  title="Read"
                >
                  <BookOpen aria-hidden="true" className="post-raw-content-action-icon" />
                </LinkComponent>
              ) : canReadRawContent ? (
                <button
                  aria-controls={rawRegionId}
                  aria-label={actionLabel(rawContentLabel, actionContext)}
                  aria-expanded={rawExpanded}
                  className={`post-inline-action post-inline-action--icon post-raw-content-action${rawExpanded ? " post-inline-action--active post-raw-content-action--active" : ""}`}
                  onClick={() => {
                    setRawExpanded((v) => !v);
                    if (!rawExpanded) noteInteraction();
                  }}
                  title={rawContentLabel}
                  type="button"
                >
                  <BookOpen aria-hidden="true" className="post-raw-content-action-icon" />
                  <span className="sr-only">
                    {rawExpanded ? `Hide ${rawContentLabel.toLowerCase()}` : `Show ${rawContentLabel.toLowerCase()}`}
                  </span>
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
        ) : null}

        {/* Original content collapsible region */}
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


function readingTimeLabel(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 220));
  return `${minutes} min read`;
}

function detailAuthorHandle(builder: FetchedPostBuilder | null, authorName: string | null) {
  const handle = handleFromSourceUrl(builder);
  if (!handle) return null;
  const normalizedName = authorName?.replace(/^@+/, "").trim().toLowerCase();
  const normalizedHandle = handle.replace(/^@+/, "").trim().toLowerCase();
  return normalizedName && normalizedName === normalizedHandle ? null : handle;
}

function handleFromSourceUrl(builder: FetchedPostBuilder | null) {
  if (!builder) return null;
  const sourceType = builder.sourceType?.trim().toLowerCase();
  const url = builder.sourceUrl || builder.fetchUrl;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const firstSegment = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!firstSegment) return null;
    if ((sourceType === "x" || builder.kind === "X" || /(?:^|\.)x\.com$|(?:^|\.)twitter\.com$/.test(host))) {
      return `@${firstSegment.replace(/^@+/, "")}`;
    }
    if (sourceType === "youtube" && firstSegment.startsWith("@")) {
      return firstSegment;
    }
  } catch {
    return null;
  }
  return null;
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
  // Decode entities so summaries render `we'd` rather than the literal
  // `we&#x27;d` the model emits. Crawled raw content is rendered separately and
  // intentionally left untouched to preserve source fidelity.
  return decodeHtmlEntities(value?.trim() ?? "");
}

function displaySummaryText(value: string | null | undefined, sourceUrl: string | null | undefined) {
  return stripTrailingSourceUrl(normalizedText(value), sourceUrl);
}

function stripTrailingSourceUrl(value: string, sourceUrl: string | null | undefined) {
  const url = normalizedText(sourceUrl);
  if (!value || !url) return value;

  const candidates = [url, url.replace(/\/+$/, ""), url.endsWith("/") ? url : `${url}/`]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const candidate of [...new Set(candidates)]) {
    const pattern = new RegExp(
      `(?:\\s*(?:\\(?\\s*(?:source|source url|original|original url|来源|原文|链接)\\s*[:：]\\s*)?)${escapeRegExp(candidate)}[\\s.)）]*$`,
      "i",
    );
    const next = value.replace(pattern, "").trim();
    if (next !== value) return next;
  }

  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const rawContentModesBySourceType: Partial<Record<string, "raw_content" | "raw_summary">> = {};

function rawContentModeForSourceType(sourceType: string | null | undefined): "raw_content" | "raw_summary" {
  const key = sourceType?.trim().toLowerCase();
  if (!key) return "raw_content";
  return rawContentModesBySourceType[key] ?? "raw_content";
}
