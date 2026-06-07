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

type TimelineResponse = {
  snapshots: RecommendationSnapshotEntry[];
  unreadRemaining: number;
  strategy: string;
};

export type FollowingSourceReadiness = {
  activeTokens: AgentTokenListItem[];
  digestMaxPostAgeDays: number | null;
  fetchedPostCount: number;
  followedSourceCount: number;
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
      const response = await fetch("/api/recommendations/timeline", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void loadTimeline(), 0);
    return () => window.clearTimeout(id);
  }, [loadTimeline]);

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
      key={visibleSnapshots.map((snapshot) => snapshot.id).join("|")}
      initialSnapshots={visibleSnapshots}
      showAdminActions={isAdmin}
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
          <Link className="fb-btn dark compact" href="/builders">
            Go to Sources
          </Link>
        }
        ariaLive="polite"
        body="Follow a source from the Sources page, or add a new one to start Following."
        className="is-actionable"
        title="No followed sources yet"
      />
    );
  }

  if (sourceReadiness.fetchedPostCount === 0) {
    return (
      <FeedEmptyState
        actions={<FetchSourcesPrompt sourceReadiness={sourceReadiness} />}
        ariaLive="polite"
        body="Ask your Local Agent to fetch and summarize your followed sources, then Following can show their latest posts."
        className="is-actionable"
        title="No posts have been fetched for your followed sources yet"
      />
    );
  }

  return (
    <FeedEmptyState
      actions={<FetchSourcesPrompt sourceReadiness={sourceReadiness} />}
      ariaLive="polite"
      body="Following will update after new unread posts are fetched from your followed sources."
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
      title="Could not load Following"
      tone="error"
    />
  );
}
