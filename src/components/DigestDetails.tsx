"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, ChevronDown, Loader2 } from "lucide-react";
import { CountMeta } from "@/components/Count";
import {
  DigestContent,
  type DigestFavoriteStateByUrl,
  type DigestSourceLink,
} from "@/components/DigestContent";
import { SourceAvatar } from "@/components/SourceAvatar";
import { useHydrated } from "@/components/ThemeToggle";
import { digestPreviewFromContent } from "@/lib/digest-headline";
import { parseDigest } from "@/lib/digest-markdown";
import { displayLanguagePreference } from "@/lib/language-preference";

const MAX_HEADLINE_SOURCE_ITEMS = 5;
const DEFAULT_HEADLINE_SOURCE_TYPE_ORDER = [
  "podcast",
  "youtube",
  "blog",
  "x",
  "github_trending",
  "product_hunt_top_products",
  "website",
];

export type DigestSummary = {
  id: string;
  title: string;
  headlineSummary: string | null;
  itemCount: number;
  language: string;
  createdAt: string;
};

type DigestLoadState = {
  content: string | null;
  favoriteErrorByUrl: Record<string, string>;
  favoriteStateByUrl: DigestFavoriteStateByUrl;
  isOpen: boolean;
  key: string;
  originalSummariesByUrl: Record<string, string>;
  pendingFavoriteUrls: Set<string>;
  status: "idle" | "loading" | "loaded" | "error";
};

export function DigestDetails({
  defaultOpen = false,
  digest,
  headerAction,
  mode = "archive",
  sourceLinks = [],
}: {
  defaultOpen?: boolean;
  digest: DigestSummary;
  headerAction?: ReactNode;
  mode?: "archive" | "today";
  sourceLinks?: DigestSourceLink[];
}) {
  const digestId = digest.id;
  const hydrated = useHydrated();
  const stateKey = `${digestId}:${defaultOpen ? "open" : "closed"}:${mode}`;
  const initialStatus = defaultOpen || mode === "today" ? "loading" : "idle";
  const initialState: DigestLoadState = useMemo(
    () => ({
      content: null,
      favoriteErrorByUrl: {},
      favoriteStateByUrl: {},
      isOpen: defaultOpen,
      key: stateKey,
      originalSummariesByUrl: {},
      pendingFavoriteUrls: new Set<string>(),
      status: initialStatus,
    }),
    [defaultOpen, initialStatus, stateKey],
  );
  const [digestState, setDigestState] = useState<DigestLoadState>(initialState);
  const currentState = digestState.key === stateKey ? digestState : initialState;
  const { content, favoriteErrorByUrl, isOpen, pendingFavoriteUrls, status } = currentState;
  const favoriteStateByUrl = currentState.favoriteStateByUrl;
  const originalSummariesByUrl = currentState.originalSummariesByUrl;
  const headerHeadline = resolveHeadlineSummary(digest.headlineSummary, content, status);

  const updateDigestState = useCallback((
    updater: (current: DigestLoadState) => Omit<DigestLoadState, "key">,
  ) => {
    setDigestState((current) => {
      const base = current.key === stateKey ? current : initialState;
      return { ...updater(base), key: stateKey };
    });
  }, [initialState, stateKey]);

  const fetchDigest = useCallback(async () => {
    try {
      const response = await fetch(`/api/digests/${digestId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      updateDigestState((current) => ({
        ...current,
        content: String(body.content ?? ""),
        favoriteStateByUrl: cleanFavoriteStateByUrl(body.favoriteStateByUrl),
        originalSummariesByUrl: cleanOriginalSummaries(body.originalSummariesByUrl),
        status: "loaded",
      }));
    } catch {
      updateDigestState((current) => ({
        ...current,
        status: "error",
      }));
    }
  }, [digestId, updateDigestState]);

  const toggleFavorite = useCallback(async (url: string, feedItemId: string, nextFavorite: boolean) => {
    if (pendingFavoriteUrls.has(url)) return;
    const fallbackFavoritedAt = nextFavorite ? new Date().toISOString() : null;
    const previousFavoritedAt = favoriteStateByUrl[url]?.favoritedAt ?? null;
    updateDigestState((current) => ({
      ...current,
      favoriteErrorByUrl: omitUrl(current.favoriteErrorByUrl, url),
      favoriteStateByUrl: {
        ...current.favoriteStateByUrl,
        [url]: {
          feedItemId,
          favoritedAt: fallbackFavoritedAt,
        },
      },
      pendingFavoriteUrls: new Set([...current.pendingFavoriteUrls, url]),
    }));

    try {
      const response = await fetch("/api/favorites", {
        method: nextFavorite ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedItemId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      const favoritedAt = typeof body?.favoritedAt === "string" ? body.favoritedAt : null;
      updateDigestState((current) => ({
        ...current,
        favoriteStateByUrl: {
          ...current.favoriteStateByUrl,
          [url]: {
            feedItemId,
            favoritedAt,
          },
        },
      }));
    } catch {
      updateDigestState((current) => ({
        ...current,
        favoriteErrorByUrl: {
          ...current.favoriteErrorByUrl,
          [url]: "Could not update reading queue. Try again.",
        },
        favoriteStateByUrl: {
          ...current.favoriteStateByUrl,
          [url]: {
            feedItemId,
            favoritedAt: previousFavoritedAt,
          },
        },
      }));
    } finally {
      updateDigestState((current) => ({
        ...current,
        pendingFavoriteUrls: removeUrl(current.pendingFavoriteUrls, url),
      }));
    }
  }, [favoriteStateByUrl, pendingFavoriteUrls, updateDigestState]);

  function loadDigest() {
    if (content || status === "loading") return;
    updateDigestState((current) => ({ ...current, status: "loading" }));
    void fetchDigest();
  }

  useEffect(() => {
    if (defaultOpen || mode === "today") {
      const id = window.setTimeout(() => void fetchDigest(), 0);
      return () => window.clearTimeout(id);
    }
  }, [defaultOpen, fetchDigest, mode]);

  if (mode === "today") {
    const headlineIsLoading = status === "loading" && !content;
    return (
      <article className="fb-digest">
        <div className="fb-digest-head">
          {headlineIsLoading ? (
            <DigestHeadlineSummary headerAction={headerAction} loading />
          ) : headerHeadline ? (
            <DigestHeadlineSummary
              content={content}
              headerAction={headerAction}
              sourceLinks={sourceLinks}
              text={headerHeadline}
            />
          ) : null}
        </div>
        <div className="fb-digest-body">
          <DigestBody
            content={content}
            favoriteErrorByUrl={favoriteErrorByUrl}
            favoriteStateByUrl={favoriteStateByUrl}
            onFavoriteToggle={toggleFavorite}
            originalSummariesByUrl={originalSummariesByUrl}
            pendingFavoriteUrls={pendingFavoriteUrls}
            sourceLinks={sourceLinks}
            status={status}
            variant="today"
          />
        </div>
      </article>
    );
  }

  return (
    <article id={digest.id} className="digest-card digest-card-compact">
      <details
        className="item-disclosure"
        open={isOpen}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          updateDigestState((current) => ({ ...current, isOpen: nextOpen }));
          if (nextOpen) void loadDigest();
        }}
      >
        <summary className="item-summary">
          <span className="item-summary-copy">
            <span className="item-kicker">
              <span>{formatDateTime(digest.createdAt, hydrated)}</span>
              <CountMeta label={digest.itemCount === 1 ? "post" : "posts"} value={digest.itemCount} />
              <span>{displayLanguagePreference(digest.language)}</span>
            </span>
            <span className="item-title">{digest.title}</span>
            {headerHeadline ? (
              <span className="item-headline-preview">{headerHeadline}</span>
            ) : null}
          </span>
          <span className="item-summary-action">
            <BookOpen className="item-summary-action-icon" />
            View AI Digest
          </span>
        </summary>
        <DigestBody
          content={content}
          favoriteErrorByUrl={favoriteErrorByUrl}
          favoriteStateByUrl={favoriteStateByUrl}
          onFavoriteToggle={toggleFavorite}
          originalSummariesByUrl={originalSummariesByUrl}
          pendingFavoriteUrls={pendingFavoriteUrls}
          sourceLinks={sourceLinks}
          status={status}
        />
      </details>
    </article>
  );
}

function DigestBody({
  content,
  favoriteErrorByUrl,
  favoriteStateByUrl,
  onFavoriteToggle,
  originalSummariesByUrl,
  pendingFavoriteUrls,
  sourceLinks,
  status,
  variant = "archive",
}: {
  content: string | null;
  favoriteErrorByUrl: Record<string, string>;
  favoriteStateByUrl: DigestFavoriteStateByUrl;
  onFavoriteToggle: (url: string, feedItemId: string, nextFavorite: boolean) => void;
  originalSummariesByUrl: Record<string, string>;
  pendingFavoriteUrls: Set<string>;
  sourceLinks: DigestSourceLink[];
  status: "idle" | "loading" | "loaded" | "error";
  variant?: "today" | "archive";
}) {
  const isToday = variant === "today";

  if (status === "loading") {
    const loadingChip = (
      <span
        className={
          isToday
            ? "fb-digest-chip digest-loading-chip"
            : "status-chip"
        }
      >
        <Loader2 className="digest-loading-icon" />
        Loading AI Digest
      </span>
    );

    if (isToday) {
      return loadingChip;
    }

    return (
      <div className="item-details" aria-live="polite" aria-busy="true">
        {loadingChip}
      </div>
    );
  }

  if (status === "error") {
    const errorNode = <span>Could not load AI Digest.</span>;
    if (isToday) {
      return (
        <div className="digest-load-error" aria-live="polite">
          {errorNode}
        </div>
      );
    }

    return (
      <div
        className="item-details digest-load-error"
        aria-live="polite"
      >
        {errorNode}
      </div>
    );
  }

  if (isToday) {
    return (
      <DigestContent
        content={content ?? ""}
        favoriteErrorByUrl={favoriteErrorByUrl}
        favoriteStateByUrl={favoriteStateByUrl}
        onFavoriteToggle={onFavoriteToggle}
        originalSummariesByUrl={originalSummariesByUrl}
        pendingFavoriteUrls={pendingFavoriteUrls}
        showContents={false}
        showSectionCounts
        sourceLinks={sourceLinks}
        tone="paper"
      />
    );
  }
  return (
    <div className="item-details">
      <DigestContent
        content={content ?? ""}
        favoriteErrorByUrl={favoriteErrorByUrl}
        favoriteStateByUrl={favoriteStateByUrl}
        onFavoriteToggle={onFavoriteToggle}
        originalSummariesByUrl={originalSummariesByUrl}
        pendingFavoriteUrls={pendingFavoriteUrls}
        sourceLinks={sourceLinks}
        tone="paper"
      />
    </div>
  );
}

function DigestHeadlineSummary({
  content,
  headerAction,
  loading = false,
  sourceLinks = [],
  text,
}: {
  content?: string | null;
  headerAction?: ReactNode;
  loading?: boolean;
  sourceLinks?: DigestSourceLink[];
  text?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const headlineItems = useMemo(
    () => parseHeadlineSourceSummaries(text, sourceLinks, content),
    [content, sourceLinks, text],
  );
  const canExpand = headlineItems.length > MAX_HEADLINE_SOURCE_ITEMS;
  const visibleHeadlineItems = expanded
    ? headlineItems
    : headlineItems.slice(0, MAX_HEADLINE_SOURCE_ITEMS);

  return (
    <section
      className={`digest-headline-summary${loading ? " is-loading" : ""}`}
      aria-busy={loading || undefined}
      aria-label="AI Digest headlines"
    >
      <div className="digest-headline-top">
        <div className="digest-headline-label-row">
          <div className="digest-headline-kicker">Headlines</div>
        </div>
        {headerAction ? <div className="digest-headline-action">{headerAction}</div> : null}
      </div>
      {loading ? (
        <div className="digest-headline-loading" aria-hidden="true">
          <span />
          <span />
        </div>
      ) : headlineItems.length > 0 ? (
        <div
          className={`digest-headline-list-wrap${canExpand ? " is-expandable" : ""}${expanded ? " is-expanded" : ""}`}
        >
          <ul className="digest-headline-list">
            {visibleHeadlineItems.map((item) => (
              <li className="digest-headline-item" key={item.key}>
                <SourceAvatar
                  className="digest-headline-avatar"
                  imageSize={28}
                  source={{
                    avatarUrl: item.sourceLink?.avatarUrl ?? null,
                    fetchUrl: item.sourceLink?.fetchUrl ?? null,
                    name: item.sourceName,
                    sourceType: item.sourceLink?.sourceType ?? "website",
                    sourceUrl: item.sourceLink?.sourceUrl ?? null,
                  }}
                />
                <div className="digest-headline-item-body">
                  <p className="digest-headline-source-name" title={item.sourceName}>
                    {item.sourceName}
                  </p>
                  <p className="digest-headline-item-text">{item.summary}</p>
                </div>
              </li>
            ))}
          </ul>
          {canExpand ? (
            <button
              aria-expanded={expanded}
              aria-label={expanded ? "Show fewer headline sources" : "Show all headline sources"}
              className="digest-headline-toggle"
              onClick={() => setExpanded((current) => !current)}
              type="button"
            >
              <ChevronDown aria-hidden="true" className="digest-headline-toggle-icon" />
            </button>
          ) : null}
        </div>
      ) : (
        <p className="digest-headline-text">{text}</p>
      )}
    </section>
  );
}

type DigestHeadlineSourceItem = {
  key: string;
  sourceLink?: DigestSourceLink;
  sourceName: string;
  summary: string;
};

function parseHeadlineSourceSummaries(
  text: string | undefined,
  sourceLinks: DigestSourceLink[],
  content?: string | null,
): DigestHeadlineSourceItem[] {
  const trimmed = text?.trim();
  if (!trimmed) return [];

  const lookup = buildHeadlineSourceLookup(sourceLinks);
  const items: DigestHeadlineSourceItem[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const listMarkerMatch = rawLine.match(/^\s*(?:[-*•]|\d+[.)])\s*/);
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line) continue;

    const separatorIndex = headlineSeparatorIndex(line);
    if (separatorIndex <= 0) continue;

    const rawSourceName = line.slice(0, separatorIndex).trim().replace(/^["“]|["”]$/g, "");
    const summary = line.slice(separatorIndex + 1).trim();
    if (!rawSourceName || !summary) continue;

    const sourceLink = lookup.get(headlineSourceKey(rawSourceName));
    if (!listMarkerMatch && !sourceLink) continue;
    items.push({
      key: `${headlineSourceKey(rawSourceName)}:${items.length}`,
      sourceLink,
      sourceName: sourceLink?.name ?? rawSourceName,
      summary,
    });
  }
  return sortHeadlineSourceItems(items, sourceLinks, content);
}

function headlineSeparatorIndex(line: string) {
  const zhIndex = line.indexOf("：");
  const asciiIndex = line.indexOf(":");
  if (zhIndex === -1) return asciiIndex;
  if (asciiIndex === -1) return zhIndex;
  return Math.min(zhIndex, asciiIndex);
}

function sortHeadlineSourceItems(
  items: DigestHeadlineSourceItem[],
  sourceLinks: DigestSourceLink[],
  content?: string | null,
) {
  const sourceOrder =
    headlineSourceOrderFromDigestContent(content, sourceLinks) ??
    headlineSourceOrderFromSourceLinks(sourceLinks);
  if (sourceOrder.size === 0) return items;

  return [...items].sort((a, b) => {
    const ai = headlineOrderForItem(a, sourceOrder) ?? Number.POSITIVE_INFINITY;
    const bi = headlineOrderForItem(b, sourceOrder) ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return 0;
  });
}

function headlineOrderForItem(
  item: DigestHeadlineSourceItem,
  sourceOrder: Map<string, number>,
) {
  for (const key of headlineSourceItemKeys(item)) {
    const rank = sourceOrder.get(key);
    if (rank !== undefined) return rank;
  }
  return undefined;
}

function headlineSourceItemKeys(item: DigestHeadlineSourceItem) {
  const keys = [
    item.sourceName,
    ...(item.sourceLink ? headlineSourceLinkKeys(item.sourceLink) : []),
  ].filter(Boolean);
  return [...keys, ...keys.map((key) => key.replace(/^@/, ""))]
    .map(headlineSourceKey)
    .filter(Boolean);
}

function headlineSourceOrderFromDigestContent(
  content: string | null | undefined,
  sourceLinks: DigestSourceLink[],
) {
  if (!content?.trim()) return null;
  const doc = parseDigest(content);
  if (!doc.hasStructure) return null;

  const lookup = buildHeadlineSourceLookup(sourceLinks);
  const order = new Map<string, number>();
  let index = 0;
  for (const section of doc.sections) {
    for (const group of section.groups) {
      if (!group.source) continue;
      addHeadlineOrderKeys(order, group.source, index);
      const sourceLink = headlineSourceLinkForSource(group.source, lookup);
      if (sourceLink) {
        for (const key of headlineSourceLinkKeys(sourceLink)) {
          addHeadlineOrderKeys(order, key, index);
        }
      }
      index += 1;
    }
  }
  return order.size > 0 ? order : null;
}

function headlineSourceOrderFromSourceLinks(sourceLinks: DigestSourceLink[]) {
  const order = new Map<string, number>();
  const sorted = [...sourceLinks].sort((a, b) => {
    const rank = headlineSourceTypeRank(a.sourceType) - headlineSourceTypeRank(b.sourceType);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
  sorted.forEach((link, index) => {
    for (const key of headlineSourceLinkKeys(link)) {
      addHeadlineOrderKeys(order, key, index);
    }
  });
  return order;
}

function addHeadlineOrderKeys(order: Map<string, number>, value: string, index: number) {
  const key = headlineSourceKey(value);
  if (key && !order.has(key)) order.set(key, index);
  const bareKey = headlineSourceKey(value.replace(/^@/, ""));
  if (bareKey && !order.has(bareKey)) order.set(bareKey, index);
}

function headlineSourceLinkForSource(
  source: string,
  lookup: Map<string, DigestSourceLink>,
) {
  const direct = lookup.get(headlineSourceKey(source));
  if (direct) return direct;

  const parts = source
    .normalize("NFKC")
    .split(/[()（）]/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const match = lookup.get(headlineSourceKey(part));
    if (match) return match;
  }
  return undefined;
}

function headlineSourceTypeRank(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_") || "website";
  const index = DEFAULT_HEADLINE_SOURCE_TYPE_ORDER.indexOf(normalized);
  return index === -1 ? DEFAULT_HEADLINE_SOURCE_TYPE_ORDER.length : index;
}

function buildHeadlineSourceLookup(sourceLinks: DigestSourceLink[]) {
  const lookup = new Map<string, DigestSourceLink>();
  for (const link of sourceLinks) {
    for (const value of headlineSourceLinkKeys(link)) {
      const key = headlineSourceKey(value);
      if (key && !lookup.has(key)) lookup.set(key, link);
    }
  }
  return lookup;
}

function headlineSourceLinkKeys(link: DigestSourceLink) {
  const keys = [
    link.name,
    ...(link.aliases ?? []),
    link.handle ?? "",
    headlineHostOf(link.sourceUrl ?? ""),
    headlineHostOf(link.fetchUrl ?? ""),
  ].filter(Boolean);
  return [...keys, ...keys.map((key) => key.replace(/^@/, ""))];
}

function headlineSourceKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineHostOf(value: string) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function resolveHeadlineSummary(
  headlineSummary: string | null,
  content: string | null,
  status: DigestLoadState["status"],
) {
  const stored = headlineSummary?.trim();
  if (stored) return stored;
  if (status !== "loaded" || !content?.trim()) return null;
  return digestPreviewFromContent(content);
}

function cleanOriginalSummaries(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([url, summary]) => [url, typeof summary === "string" ? summary.trim() : ""] as const)
    .filter(([url, summary]) => url.length > 0 && summary.length > 0);
  return Object.fromEntries(entries);
}

function omitUrl<T>(record: Record<string, T>, url: string): Record<string, T> {
  const next = { ...record };
  delete next[url];
  return next;
}

function removeUrl(urls: Set<string>, url: string): Set<string> {
  const next = new Set(urls);
  next.delete(url);
  return next;
}

function cleanFavoriteStateByUrl(value: unknown): DigestFavoriteStateByUrl {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([url, state]) => {
    if (!url || !state || typeof state !== "object" || Array.isArray(state)) return [];
    const record = state as Record<string, unknown>;
    const feedItemId = typeof record.feedItemId === "string" ? record.feedItemId.trim() : "";
    const favoritedAt =
      typeof record.favoritedAt === "string" && record.favoritedAt.trim()
        ? record.favoritedAt
        : null;
    return feedItemId ? [[url, { feedItemId, favoritedAt }] as const] : [];
  });
  return Object.fromEntries(entries);
}

function formatDateTime(value: string, hydrated: boolean) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(hydrated ? {} : { timeZone: "UTC", timeZoneName: "short" }),
  }).format(new Date(value));
}
