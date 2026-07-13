"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";
import { FeedEmptyState, FeedLoadingState } from "@/components/FeedState";
import {
  RecommendationFeed,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";
import { SkillPromptActions } from "@/components/SkillPromptActions";
import {
  defaultRecommendationSortMode,
  type RecommendationSortMode,
} from "@/lib/recommendation-sort";
import { contentSyncStateChanged, liveDataSignature } from "@/lib/content-sync-events";

type TimelineResponse = {
  snapshots: RecommendationSnapshotEntry[];
  unreadRemaining: number;
  strategy: string;
};

const NO_FOLLOWED_SOURCES_BODY =
  "Add sources for AI Brief and Following.";

export type FollowingSourceReadiness = {
  activeTokens: AgentTokenListItem[];
  digestMaxPostAgeDays: number | null;
  fetchedPostCount: number;
  followedSourceCount: number;
  summarizedPostCount: number;
  summaryLanguage: string | null;
};

export function FollowingRecommendationSection({
  isAdmin = false,
  sourceReadiness,
}: {
  isAdmin?: boolean;
  sourceReadiness: FollowingSourceReadiness;
}) {
  return <FollowingRecommendationLoader isAdmin={isAdmin} sourceReadiness={sourceReadiness} />;
}

function FollowingRecommendationLoader({
  isAdmin,
  sourceReadiness,
}: {
  isAdmin: boolean;
  sourceReadiness: FollowingSourceReadiness;
}) {
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sortMode, setSortMode] = useState<RecommendationSortMode>(defaultRecommendationSortMode);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadTimeline = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus("loading");

    try {
      const params = new URLSearchParams({ sort: sortMode });
      const response = await fetch(`/api/recommendations/timeline?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not load Following posts.");
      const data = (await response.json()) as TimelineResponse;
      if (mountedRef.current && requestIdRef.current === requestId) {
        setTimeline(data);
        setStatus("ready");
      }
    } catch {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setStatus("error");
      }
    }
  }, [sortMode]);

  useEffect(() => {
    const id = window.setTimeout(() => void loadTimeline(), 0);
    return () => window.clearTimeout(id);
  }, [loadTimeline]);

  useEffect(() => {
    function handleContentSyncStateChanged() {
      if (document.visibilityState !== "visible") return;
      void loadTimeline();
    }

    window.addEventListener(contentSyncStateChanged, handleContentSyncStateChanged);
    return () => {
      window.removeEventListener(contentSyncStateChanged, handleContentSyncStateChanged);
    };
  }, [loadTimeline]);

  const handleSortModeChange = useCallback((nextSortMode: RecommendationSortMode) => {
    setTimeline(null);
    setStatus("loading");
    setSortMode(nextSortMode);
  }, []);

  if (status === "loading") {
    return <FeedLoadingState label="Loading Following" />;
  }

  // A fetch failure is distinct from "ready but nothing to show": the former is
  // an error the user can retry, the latter is the normal empty state.
  if (status === "error") {
    return <FollowingError onRetry={() => void loadTimeline()} />;
  }
  const visibleSnapshots = timeline?.snapshots.filter(snapshotHasPosts) ?? [];
  if (visibleSnapshots.length === 0) {
    return <FollowingUnavailable sourceReadiness={sourceReadiness} />;
  }

  return (
    <RecommendationFeed
      key={`${sortMode}:${liveDataSignature(visibleSnapshots)}`}
      initialSnapshots={visibleSnapshots}
      onSortModeChange={handleSortModeChange}
      showAdminActions={isAdmin}
      sortMode={sortMode}
    />
  );
}

function snapshotHasPosts(snapshot: RecommendationSnapshotEntry) {
  return snapshot.items.length > 0;
}

function FollowingUnavailable({
  sourceReadiness,
}: {
  sourceReadiness: FollowingSourceReadiness;
}) {
  if (sourceReadiness.followedSourceCount === 0) {
    return (
      <FeedEmptyState
        actions={
          <Link className="fb-btn dark compact" href="/builders?tab=fetch">
            Choose sources
          </Link>
        }
        ariaLive="polite"
        body={NO_FOLLOWED_SOURCES_BODY}
        className="is-actionable"
        title="No followed sources yet"
      />
    );
  }

  if (sourceReadiness.summarizedPostCount === 0) {
    return (
      <FeedEmptyState
        actions={<FetchSourcesPrompt sourceReadiness={sourceReadiness} />}
        ariaLive="polite"
        body="Copy a Fetch sources prompt to summarize followed posts."
        className="is-actionable"
        title="No summarized posts yet"
      />
    );
  }

  return (
    <FeedEmptyState
      actions={<FetchSourcesPrompt sourceReadiness={sourceReadiness} />}
      ariaLive="polite"
      body="Copy a Fetch sources prompt to check for new posts."
      className="is-actionable"
      title="No unread posts yet"
    />
  );
}

function FetchSourcesPrompt({
  sourceReadiness,
}: {
  sourceReadiness: FollowingSourceReadiness;
}) {
  return (
    <SkillPromptActions
      compactOnly
      context="library"
      digestMaxPostAgeDays={sourceReadiness.digestMaxPostAgeDays}
      showStop={false}
      summaryLanguage={sourceReadiness.summaryLanguage}
      tokens={sourceReadiness.activeTokens}
    />
  );
}

function FollowingError({ onRetry }: { onRetry: () => void }) {
  return (
    <FeedEmptyState
      actions={
        <button className="fb-btn light compact" onClick={onRetry} type="button">
          <RefreshCcw aria-hidden="true" className="feed-action-icon" />
          Retry
        </button>
      }
      ariaLive="assertive"
      body="Check your connection, then try again."
      role="alert"
      title="Could not load Following posts"
      tone="error"
    />
  );
}
