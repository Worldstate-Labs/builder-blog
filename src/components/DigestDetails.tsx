"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { CountMeta } from "@/components/Count";
import {
  DigestContent,
  type DigestFavoriteStateByFeedItemId,
} from "@/components/DigestContent";
import { DigestHeadlineSummary } from "@/components/DigestHeadlineSummary";
import { RelativeTime } from "@/components/RelativeTime";
import type { DigestSourceLink } from "@/lib/digest-source-links";
import { displayLanguagePreference } from "@/lib/language-preference";
import {
  cleanStructuredDigestItems,
  type StructuredDigestItem,
} from "@/lib/structured-digest";

export type DigestSummary = {
  id: string;
  title: string;
  headlineSummary: string | null;
  itemCount: number;
  language: string;
  createdAt: string;
};

type DigestLoadState = {
  favoriteErrorByFeedItemId: Record<string, string>;
  favoriteStateByFeedItemId: DigestFavoriteStateByFeedItemId;
  isOpen: boolean;
  items: StructuredDigestItem[];
  key: string;
  pendingFavoriteFeedItemIds: Set<string>;
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
      favoriteErrorByFeedItemId: {},
      favoriteStateByFeedItemId: {},
      isOpen: defaultOpen,
      items: [],
      key: stateKey,
      pendingFavoriteFeedItemIds: new Set<string>(),
      status: initialStatus,
    }),
    [defaultOpen, initialStatus, stateKey],
  );
  const [digestState, setDigestState] = useState<DigestLoadState>(initialState);
  const currentState = digestState.key === stateKey ? digestState : initialState;
  const { favoriteErrorByFeedItemId, isOpen, items, pendingFavoriteFeedItemIds, status } = currentState;
  const favoriteStateByFeedItemId = currentState.favoriteStateByFeedItemId;
  const headerHeadline = resolveHeadlineSummary(digest.headlineSummary);

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
        favoriteStateByFeedItemId: cleanFavoriteStateByFeedItemId(body.favoriteStateByFeedItemId),
        items: cleanStructuredDigestItems(body.items),
        status: "loaded",
      }));
    } catch {
      updateDigestState((current) => ({
        ...current,
        status: "error",
      }));
    }
  }, [digestId, updateDigestState]);

  const toggleFavorite = useCallback(async (feedItemId: string, nextFavorite: boolean) => {
    if (pendingFavoriteFeedItemIds.has(feedItemId)) return;
    const fallbackFavoritedAt = nextFavorite ? new Date().toISOString() : null;
    const previousFavoritedAt = favoriteStateByFeedItemId[feedItemId]?.favoritedAt ?? null;
    updateDigestState((current) => ({
      ...current,
      favoriteErrorByFeedItemId: omitFeedItemId(current.favoriteErrorByFeedItemId, feedItemId),
      favoriteStateByFeedItemId: {
        ...current.favoriteStateByFeedItemId,
        [feedItemId]: {
          feedItemId,
          favoritedAt: fallbackFavoritedAt,
        },
      },
      pendingFavoriteFeedItemIds: new Set([...current.pendingFavoriteFeedItemIds, feedItemId]),
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
        favoriteStateByFeedItemId: {
          ...current.favoriteStateByFeedItemId,
          [feedItemId]: {
            feedItemId,
            favoritedAt,
          },
        },
      }));
    } catch {
      updateDigestState((current) => ({
        ...current,
        favoriteErrorByFeedItemId: {
          ...current.favoriteErrorByFeedItemId,
          [feedItemId]: "Could not update Favorites. Try again.",
        },
        favoriteStateByFeedItemId: {
          ...current.favoriteStateByFeedItemId,
          [feedItemId]: {
            feedItemId,
            favoritedAt: previousFavoritedAt,
          },
        },
      }));
    } finally {
      updateDigestState((current) => ({
        ...current,
        pendingFavoriteFeedItemIds: removeFeedItemId(current.pendingFavoriteFeedItemIds, feedItemId),
      }));
    }
  }, [favoriteStateByFeedItemId, pendingFavoriteFeedItemIds, updateDigestState]);

  function loadDigest() {
    if (items.length > 0 || status === "loading") return;
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
    const headlineIsLoading = status === "loading" && items.length === 0;
    return (
      <article className="fb-digest">
        <div className="fb-digest-head">
          {headlineIsLoading ? (
            <DigestHeadlineSummary headerAction={headerAction} loading />
          ) : headerHeadline ? (
            <DigestHeadlineSummary
              headerAction={headerAction}
              sourceLinks={sourceLinks}
              text={headerHeadline}
            />
          ) : null}
        </div>
        <div className="fb-digest-body">
          <DigestBody
            favoriteErrorByFeedItemId={favoriteErrorByFeedItemId}
            favoriteStateByFeedItemId={favoriteStateByFeedItemId}
            items={items}
            onFavoriteToggle={toggleFavorite}
            pendingFavoriteFeedItemIds={pendingFavoriteFeedItemIds}
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
            View AI Brief
          </span>
        </summary>
        <DigestBody
          favoriteErrorByFeedItemId={favoriteErrorByFeedItemId}
          favoriteStateByFeedItemId={favoriteStateByFeedItemId}
          items={items}
          onFavoriteToggle={toggleFavorite}
          pendingFavoriteFeedItemIds={pendingFavoriteFeedItemIds}
          sourceLinks={sourceLinks}
          status={status}
        />
      </details>
    </article>
  );
}

function DigestBody({
  favoriteErrorByFeedItemId,
  favoriteStateByFeedItemId,
  items,
  onFavoriteToggle,
  pendingFavoriteFeedItemIds,
  sourceLinks,
  status,
  variant = "archive",
}: {
  favoriteErrorByFeedItemId: Record<string, string>;
  favoriteStateByFeedItemId: DigestFavoriteStateByFeedItemId;
  items: StructuredDigestItem[];
  onFavoriteToggle: (feedItemId: string, nextFavorite: boolean) => void;
  pendingFavoriteFeedItemIds: Set<string>;
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
        Loading AI Brief
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
    const errorNode = <span>Could not load AI Brief.</span>;
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
        favoriteErrorByFeedItemId={favoriteErrorByFeedItemId}
        favoriteStateByFeedItemId={favoriteStateByFeedItemId}
        items={items}
        onFavoriteToggle={onFavoriteToggle}
        pendingFavoriteFeedItemIds={pendingFavoriteFeedItemIds}
        sourceLinks={sourceLinks}
        tone="paper"
      />
    );
  }
  return (
    <div className="item-details">
      <DigestContent
        favoriteErrorByFeedItemId={favoriteErrorByFeedItemId}
        favoriteStateByFeedItemId={favoriteStateByFeedItemId}
        items={items}
        onFavoriteToggle={onFavoriteToggle}
        pendingFavoriteFeedItemIds={pendingFavoriteFeedItemIds}
        sourceLinks={sourceLinks}
        tone="paper"
      />
    </div>
  );
}

function resolveHeadlineSummary(
  headlineSummary: string | null,
) {
  const stored = headlineSummary?.trim();
  if (stored) return stored;
  return null;
}

function omitFeedItemId<T>(record: Record<string, T>, feedItemId: string): Record<string, T> {
  const next = { ...record };
  delete next[feedItemId];
  return next;
}

function removeFeedItemId(feedItemIds: Set<string>, feedItemId: string): Set<string> {
  const next = new Set(feedItemIds);
  next.delete(feedItemId);
  return next;
}

function cleanFavoriteStateByFeedItemId(value: unknown): DigestFavoriteStateByFeedItemId {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([feedItemIdKey, state]) => {
    if (!feedItemIdKey || !state || typeof state !== "object" || Array.isArray(state)) return [];
    const record = state as Record<string, unknown>;
    const feedItemId = typeof record.feedItemId === "string" ? record.feedItemId.trim() : "";
    const favoritedAt =
      typeof record.favoritedAt === "string" && record.favoritedAt.trim()
        ? record.favoritedAt
        : null;
    return feedItemId ? [[feedItemIdKey, { feedItemId, favoritedAt }] as const] : [];
  });
  return Object.fromEntries(entries);
}
