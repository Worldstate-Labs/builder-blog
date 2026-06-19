"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { CountMeta } from "@/components/Count";
import {
  DigestContent,
  type DigestFavoriteStateByUrl,
} from "@/components/DigestContent";
import { DigestHeadlineSummary } from "@/components/DigestHeadlineSummary";
import { RelativeTime } from "@/components/RelativeTime";
import { digestPreviewFromContent } from "@/lib/digest-headline";
import type { DigestSourceLink } from "@/lib/digest-source-links";
import { displayLanguagePreference } from "@/lib/language-preference";

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
  favoriteStateByPostKey: DigestFavoriteStateByUrl;
  favoriteStateByUrl: DigestFavoriteStateByUrl;
  isOpen: boolean;
  key: string;
  originalSummariesByPostKey: Record<string, string>;
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
  const stateKey = `${digestId}:${defaultOpen ? "open" : "closed"}:${mode}`;
  const initialStatus = defaultOpen || mode === "today" ? "loading" : "idle";
  const initialState: DigestLoadState = useMemo(
    () => ({
      content: null,
      favoriteErrorByUrl: {},
      favoriteStateByPostKey: {},
      favoriteStateByUrl: {},
      isOpen: defaultOpen,
      key: stateKey,
      originalSummariesByPostKey: {},
      originalSummariesByUrl: {},
      pendingFavoriteUrls: new Set<string>(),
      status: initialStatus,
    }),
    [defaultOpen, initialStatus, stateKey],
  );
  const [digestState, setDigestState] = useState<DigestLoadState>(initialState);
  const currentState = digestState.key === stateKey ? digestState : initialState;
  const { content, favoriteErrorByUrl, isOpen, pendingFavoriteUrls, status } = currentState;
  const favoriteStateByPostKey = currentState.favoriteStateByPostKey;
  const favoriteStateByUrl = currentState.favoriteStateByUrl;
  const originalSummariesByPostKey = currentState.originalSummariesByPostKey;
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
      if (!response.ok) {
        updateDigestState((current) => ({
          ...current,
          status: "error",
        }));
        return;
      }
      updateDigestState((current) => ({
        ...current,
        content: String(body.content ?? ""),
        favoriteStateByPostKey: cleanFavoriteStateByUrl(body.favoriteStateByPostKey),
        favoriteStateByUrl: cleanFavoriteStateByUrl(body.favoriteStateByUrl),
        originalSummariesByPostKey: cleanOriginalSummaries(body.originalSummariesByPostKey),
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
      if (!response.ok) throw new Error("Could not update Favorites.");
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
          [url]: "Could not update Favorites. Try again.",
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
            favoriteStateByPostKey={favoriteStateByPostKey}
            favoriteStateByUrl={favoriteStateByUrl}
            onFavoriteToggle={toggleFavorite}
            originalSummariesByPostKey={originalSummariesByPostKey}
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
              <RelativeTime value={digest.createdAt} />
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
          favoriteStateByPostKey={favoriteStateByPostKey}
          favoriteStateByUrl={favoriteStateByUrl}
          onFavoriteToggle={toggleFavorite}
          originalSummariesByPostKey={originalSummariesByPostKey}
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
  favoriteStateByPostKey,
  favoriteStateByUrl,
  onFavoriteToggle,
  originalSummariesByPostKey,
  originalSummariesByUrl,
  pendingFavoriteUrls,
  sourceLinks,
  status,
  variant = "archive",
}: {
  content: string | null;
  favoriteErrorByUrl: Record<string, string>;
  favoriteStateByPostKey: DigestFavoriteStateByUrl;
  favoriteStateByUrl: DigestFavoriteStateByUrl;
  onFavoriteToggle: (url: string, feedItemId: string, nextFavorite: boolean) => void;
  originalSummariesByPostKey: Record<string, string>;
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
        favoriteStateByPostKey={favoriteStateByPostKey}
        favoriteStateByUrl={favoriteStateByUrl}
        onFavoriteToggle={onFavoriteToggle}
        originalSummariesByPostKey={originalSummariesByPostKey}
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
        favoriteStateByPostKey={favoriteStateByPostKey}
        favoriteStateByUrl={favoriteStateByUrl}
        onFavoriteToggle={onFavoriteToggle}
        originalSummariesByPostKey={originalSummariesByPostKey}
        originalSummariesByUrl={originalSummariesByUrl}
        pendingFavoriteUrls={pendingFavoriteUrls}
        sourceLinks={sourceLinks}
        tone="paper"
      />
    </div>
  );
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
