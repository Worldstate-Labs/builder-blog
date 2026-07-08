"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { PostCard } from "@/components/PostCard";
import { PostFavoriteButton, postFavoriteActionLabel } from "@/components/PostFavoriteButton";
import { RelativeTime } from "@/components/RelativeTime";
import { markPostRead } from "@/lib/mark-read";
import { postDetailHref } from "@/lib/navigation";
import type { RecommendationSortMode } from "@/lib/recommendation-sort";

export type RecommendationFeedEntry = {
  score: number;
  reasons: string[];
  rank: number;
  favoritedAt: string | null;
  readAt: string | null;
  item: {
    id: string;
    title: string | null;
    headline: string | null;
    body: string;
    summary: string | null;
    url: string;
    publishedAt: string | null;
    createdAt: string;
    sourceName: string | null;
    fetchTool: string | null;
    builder: {
      id: string;
      entityId: string | null;
      avatarUrl: string | null;
      avatarDataUrl: string | null;
      name: string;
      sourceType: string;
      kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
      sourceUrl: string | null;
      fetchUrl: string | null;
    } | null;
  };
};

export type RecommendationSnapshotEntry = {
  id: string;
  createdAt: string;
  reason: string;
  items: RecommendationFeedEntry[];
};

const followingPositionStorageKey = "followbrief.following.last-position.v1";
const jumpLoadAttemptLimit = 10;

type StoredFollowingPosition = PublishedCursor & {
  savedAt: string;
  snapshotId: string;
};

export function RecommendationFeed({
  initialSnapshots,
  onSortModeChange,
  showAdminActions = false,
  sortMode,
}: {
  initialSnapshots: RecommendationSnapshotEntry[];
  onSortModeChange: (sortMode: RecommendationSortMode) => void;
  showAdminActions?: boolean;
  sortMode: RecommendationSortMode;
}) {
  const [snapshots, setSnapshots] = useState(() => nonEmptySnapshots(initialSnapshots));
  const snapshotsRef = useRef(snapshots);
  const [loadingDirection, setLoadingDirection] = useState<"append" | "prepend" | null>(null);
  const [loadErrorDirection, setLoadErrorDirection] = useState<"append" | "prepend" | null>(null);
  const [favoriteError, setFavoriteError] = useState("");
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<string>>(() => new Set());
  const [resumePosition, setResumePosition] = useState<StoredFollowingPosition | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [jumpingToResumePosition, setJumpingToResumePosition] = useState(false);
  const loadingGuard = useRef<"append" | "prepend" | null>(null);
  const exhaustedRef = useRef(initialSnapshots.length === 0);
  const [exhausted, setExhausted] = useState(initialSnapshots.length === 0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const suppressPositionWritesRef = useRef(false);
  const favoriteStateByItemId = useMemo(() => {
    const stateByItemId = new Map<string, string | null>();
    for (const snapshot of snapshots) {
      for (const entry of snapshot.items) {
        if (!stateByItemId.has(entry.item.id)) {
          stateByItemId.set(entry.item.id, entry.favoritedAt);
        }
      }
    }
    return stateByItemId;
  }, [snapshots]);

  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setResumePosition(readStoredFollowingPosition());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const newestCursor = useMemo(() => newestPublishedCursor(snapshots), [snapshots]);
  const showResumeJump =
    sortMode === "recent" &&
    Boolean(resumePosition) &&
    !resumeDismissed &&
    Boolean(newestCursor && resumePosition && comparePublishedCursor(newestCursor, resumePosition) > 0);

  useEffect(() => {
    suppressPositionWritesRef.current = showResumeJump;
  }, [showResumeJump]);

  const updateExhausted = useCallback((nextExhausted: boolean) => {
    exhaustedRef.current = nextExhausted;
    setExhausted(nextExhausted);
  }, []);

  const markRead = useCallback(async (feedItemId: string) => {
    const fallbackReadAt = new Date().toISOString();
    setSnapshots((current) =>
      current.map((snapshot) => ({
        ...snapshot,
        items: snapshot.items.map((entry) =>
          entry.item.id === feedItemId
            ? { ...entry, readAt: entry.readAt ?? fallbackReadAt }
            : entry,
        ),
      })),
    );
    await markPostRead(feedItemId);
  }, []);

  const toggleFavorite = useCallback(async (feedItemId: string, nextFavorite: boolean) => {
    if (pendingFavoriteIds.has(feedItemId)) return;
    const fallbackFavoritedAt = nextFavorite ? new Date().toISOString() : null;
    const previousFavoritedAt = favoriteStateByItemId.get(feedItemId) ?? null;
    setFavoriteError("");
    setPendingFavoriteIds((current) => new Set([...current, feedItemId]));
    setSnapshots((current) =>
      current.map((snapshot) => ({
        ...snapshot,
        items: snapshot.items.map((entry) =>
          entry.item.id === feedItemId
            ? { ...entry, favoritedAt: fallbackFavoritedAt }
            : entry,
        ),
      })),
    );
    try {
      await setPostFavorite(feedItemId, nextFavorite);
    } catch {
      setSnapshots((current) => restoreFavoriteState(current, feedItemId, previousFavoritedAt));
      setFavoriteError("Could not update Favorites. Try again.");
    } finally {
      setPendingFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(feedItemId);
        return next;
      });
    }
  }, [favoriteStateByItemId, pendingFavoriteIds]);

  const requestSnapshot = useCallback(
    async (direction: "append" | "prepend") => {
      if (loadingGuard.current) return null;
      loadingGuard.current = direction;
      setLoadingDirection(direction);
      setLoadErrorDirection(null);
      try {
        const params = new URLSearchParams({
          direction,
          limit: "6",
          sort: sortMode,
        });
        if (sortMode === "recent") {
          const cursor = direction === "append"
            ? oldestPublishedCursor(snapshotsRef.current)
            : newestPublishedCursor(snapshotsRef.current);
          if (!cursor) {
            if (direction === "append") updateExhausted(true);
            return null;
          }
          const prefix = direction === "append" ? "before" : "after";
          params.set(`${prefix}PublishedAt`, cursor.publishedAt);
          params.set(`${prefix}ItemId`, cursor.itemId);
        }
        const response = await fetch(`/api/recommendations?${params.toString()}`);
        if (!response.ok) throw new Error("Could not load Following posts.");
        const data = await response.json();
        const snapshot = data.snapshot as RecommendationSnapshotEntry | null | undefined;
        if (!snapshot || snapshot.items.length === 0) {
          if (direction === "append") updateExhausted(true);
          return null;
        }
        setSnapshots((current) => {
          const next = direction === "prepend"
            ? mergeSnapshots([snapshot, ...current])
            : mergeSnapshots([...current, snapshot]);
          snapshotsRef.current = next;
          return next;
        });
        updateExhausted(false);
        return snapshot;
      } catch {
        setLoadErrorDirection(direction);
        return null;
      } finally {
        loadingGuard.current = null;
        setLoadingDirection(null);
      }
    },
    [sortMode, updateExhausted],
  );

  const recordVisiblePosition = useCallback((
    entry: RecommendationFeedEntry,
    snapshotId: string,
  ) => {
    if (sortMode !== "recent" || showResumeJump || suppressPositionWritesRef.current) return;
    if (!entry.item.publishedAt) return;
    writeStoredFollowingPosition({
      itemId: entry.item.id,
      publishedAt: entry.item.publishedAt,
      savedAt: new Date().toISOString(),
      snapshotId,
    });
  }, [showResumeJump, sortMode]);

  const jumpToResumePosition = useCallback(async () => {
    if (!resumePosition || jumpingToResumePosition) return;
    setJumpingToResumePosition(true);
    suppressPositionWritesRef.current = false;

    try {
      for (let attempt = 0; attempt < jumpLoadAttemptLimit; attempt += 1) {
        if (scrollToFollowingItem(resumePosition.itemId)) {
          writeStoredFollowingPosition({
            ...resumePosition,
            savedAt: new Date().toISOString(),
          });
          setResumeDismissed(true);
          return;
        }
        if (exhaustedRef.current || loadingGuard.current) break;
        const snapshot = await requestSnapshot("append");
        if (!snapshot) break;
        await nextFrame();
      }
      setResumeDismissed(true);
    } finally {
      setJumpingToResumePosition(false);
    }
  }, [jumpingToResumePosition, requestSnapshot, resumePosition]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || exhausted) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void requestSnapshot("append");
      },
      { rootMargin: "520px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [exhausted, requestSnapshot]);

  return (
    <section className="feed-content-stack recommendation-feed">
      <div className="recommendation-feed-toolbar">
        {showResumeJump ? (
          <button
            className="fb-btn light compact recommendation-jump-button"
            disabled={jumpingToResumePosition || loadingDirection !== null}
            onClick={() => void jumpToResumePosition()}
            type="button"
          >
            {jumpingToResumePosition ? "Jumping" : "Jump to last position"}
          </button>
        ) : null}
        <label className="recommendation-sort-control">
          <span>Sort</span>
          <select
            aria-label="Sort Following posts"
            onChange={(event) =>
              onSortModeChange(event.currentTarget.value as RecommendationSortMode)
            }
            value={sortMode}
          >
            <option value="relevant">Most relevant</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
      </div>
      {favoriteError ? (
        <p className="feed-load-error recommendation-favorite-error" role="status">
          {favoriteError}
        </p>
      ) : null}
      <div className="recommendation-snapshot-list">
        {snapshots.map((snapshot) => (
          <section className="recommendation-snapshot" key={snapshot.id}>
            <div className="recommendation-snapshot-header">
              <span className="recommendation-snapshot-meta">
                <span>Update</span>
                <RelativeTime value={snapshot.createdAt} />
                <CountMeta
                  label={snapshot.items.length === 1 ? "post" : "posts"}
                  value={snapshot.items.length}
                />
              </span>
            </div>
            {snapshot.items.map((entry) => (
              <RecommendationPositionMarker
                entry={entry}
                key={`${snapshot.id}:${entry.item.id}`}
                onVisible={recordVisiblePosition}
                snapshotId={snapshot.id}
              >
                <RecommendationCard
                  entry={entry}
                  markRead={markRead}
                  pendingFavorite={pendingFavoriteIds.has(entry.item.id)}
                  showAdminActions={showAdminActions}
                  toggleFavorite={toggleFavorite}
                />
              </RecommendationPositionMarker>
            ))}
          </section>
        ))}
      </div>
      <div ref={loadMoreRef} className="feed-load-more">
        {loadingDirection ? (
          <span className="status-chip">
            <Loader2 className="feed-loading-icon" />
            Loading Following posts
          </span>
        ) : loadErrorDirection ? (
          <span className="feed-load-error" role="status">
            Could not load Following posts.
            <button
              className="feed-inline-retry"
              onClick={() => void requestSnapshot(loadErrorDirection)}
              type="button"
            >
              Retry
            </button>
          </span>
        ) : exhausted ? (
          <span className="feed-end-note">No more unread Following posts.</span>
        ) : null}
      </div>
    </section>
  );
}

function RecommendationCard({
  entry,
  markRead,
  pendingFavorite,
  showAdminActions,
  toggleFavorite,
}: {
  entry: RecommendationFeedEntry;
  markRead: (feedItemId: string) => Promise<void>;
  pendingFavorite: boolean;
  showAdminActions: boolean;
  toggleFavorite: (feedItemId: string, nextFavorite: boolean) => Promise<void>;
}) {
  const isRead = Boolean(entry.readAt);
  const isFavorite = Boolean(entry.favoritedAt);

  return (
    <PostCard
      dataRead={isRead}
      extraActions={
        <PostFavoriteButton
          ariaLabel={postFavoriteActionLabel(isFavorite, recommendationTargetLabel(entry.item))}
          disabled={pendingFavorite}
          isFavorite={isFavorite}
          onToggle={() => void toggleFavorite(entry.item.id, !isFavorite)}
        />
      }
      onInteract={() => markRead(entry.item.id)}
      post={{
        ...entry.item,
        detailUrl: postDetailHref(
          entry.item.id,
          "/dashboard?tab=following",
          "Following",
        ),
      }}
      reasons={showAdminActions ? entry.reasons : undefined}
      showDebugActions={showAdminActions}
      stackActionsOnMobile={showAdminActions}
    />
  );
}

function RecommendationPositionMarker({
  children,
  entry,
  onVisible,
  snapshotId,
}: {
  children: ReactNode;
  entry: RecommendationFeedEntry;
  onVisible: (entry: RecommendationFeedEntry, snapshotId: string) => void;
  snapshotId: string;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !entry.item.publishedAt) return;
    const observer = new IntersectionObserver(
      ([observed]) => {
        if (observed?.isIntersecting) onVisible(entry, snapshotId);
      },
      { rootMargin: "-18% 0px -42% 0px", threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [entry, onVisible, snapshotId]);

  return (
    <div
      className="recommendation-position-marker"
      data-following-feed-item-id={entry.item.id}
      ref={nodeRef}
    >
      {children}
    </div>
  );
}

function recommendationTargetLabel(item: RecommendationFeedEntry["item"]) {
  return item.title?.trim() || item.sourceName?.trim() || "this post";
}

async function setPostFavorite(feedItemId: string, favorite: boolean) {
  const response = await fetch("/api/favorites", {
    method: favorite ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedItemId }),
  });
  if (!response.ok) throw new Error("Could not update Favorites.");
}

function restoreFavoriteState(
  snapshots: RecommendationSnapshotEntry[],
  feedItemId: string,
  favoritedAt: string | null,
): RecommendationSnapshotEntry[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    items: snapshot.items.map((entry) =>
      entry.item.id === feedItemId ? { ...entry, favoritedAt } : entry,
    ),
  }));
}

function mergeSnapshots(snapshots: RecommendationSnapshotEntry[]) {
  const seen = new Set<string>();
  return nonEmptySnapshots(snapshots).filter((snapshot) => {
    if (seen.has(snapshot.id)) return false;
    seen.add(snapshot.id);
    return true;
  });
}

function nonEmptySnapshots(snapshots: RecommendationSnapshotEntry[]) {
  return snapshots.filter((snapshot) => snapshot.items.length > 0);
}

type PublishedCursor = {
  itemId: string;
  publishedAt: string;
};

function newestPublishedCursor(snapshots: RecommendationSnapshotEntry[]) {
  let cursor: PublishedCursor | null = null;
  for (const candidate of publishedCursors(snapshots)) {
    if (!cursor || comparePublishedCursor(candidate, cursor) > 0) {
      cursor = candidate;
    }
  }
  return cursor;
}

function oldestPublishedCursor(snapshots: RecommendationSnapshotEntry[]) {
  let cursor: PublishedCursor | null = null;
  for (const candidate of publishedCursors(snapshots)) {
    if (!cursor || comparePublishedCursor(candidate, cursor) < 0) {
      cursor = candidate;
    }
  }
  return cursor;
}

function publishedCursors(snapshots: RecommendationSnapshotEntry[]) {
  return snapshots.flatMap((snapshot) =>
    snapshot.items.flatMap((entry) =>
      entry.item.publishedAt
        ? [{ itemId: entry.item.id, publishedAt: entry.item.publishedAt }]
        : [],
    ),
  );
}

function comparePublishedCursor(a: PublishedCursor, b: PublishedCursor) {
  const timeDiff = Date.parse(a.publishedAt) - Date.parse(b.publishedAt);
  return timeDiff || a.itemId.localeCompare(b.itemId);
}

function readStoredFollowingPosition(): StoredFollowingPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(followingPositionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredFollowingPosition>;
    if (
      typeof parsed.itemId !== "string" ||
      typeof parsed.publishedAt !== "string" ||
      typeof parsed.savedAt !== "string" ||
      typeof parsed.snapshotId !== "string" ||
      Number.isNaN(Date.parse(parsed.publishedAt))
    ) {
      return null;
    }
    return {
      itemId: parsed.itemId,
      publishedAt: parsed.publishedAt,
      savedAt: parsed.savedAt,
      snapshotId: parsed.snapshotId,
    };
  } catch {
    return null;
  }
}

function writeStoredFollowingPosition(position: StoredFollowingPosition) {
  try {
    window.localStorage.setItem(followingPositionStorageKey, JSON.stringify(position));
  } catch {
    // Reading position persistence is a progressive enhancement.
  }
}

function scrollToFollowingItem(itemId: string) {
  const target = Array.from(
    document.querySelectorAll<HTMLElement>("[data-following-feed-item-id]"),
  ).find((node) => node.dataset.followingFeedItemId === itemId);
  if (!target) return false;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
