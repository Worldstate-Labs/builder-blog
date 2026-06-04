"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { FeedEmptyState, FeedLoadingState } from "@/components/FeedState";
import {
  RecommendationFeed,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";

type TimelineResponse = {
  snapshots: RecommendationSnapshotEntry[];
  unreadRemaining: number;
  strategy: string;
};

export function FollowingRecommendationSection({ isAdmin = false }: { isAdmin?: boolean }) {
  return <FollowingRecommendationLoader isAdmin={isAdmin} />;
}

function FollowingRecommendationLoader({ isAdmin }: { isAdmin: boolean }) {
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
    return <FeedLoadingState label="Loading Following recommendations" />;
  }

  // A fetch failure is distinct from "ready but nothing to show": the former is
  // an error the user can retry, the latter is the normal empty state.
  if (status === "error") {
    return <FollowingError onRetry={() => void loadTimeline()} />;
  }
  if (!timeline || timeline.snapshots.length === 0) {
    return <FollowingUnavailable />;
  }

  return (
    <RecommendationFeed
      key={timeline.snapshots.map((snapshot) => snapshot.id).join("|")}
      initialSnapshots={timeline.snapshots}
      showAdminActions={isAdmin}
    />
  );
}

function FollowingUnavailable() {
  return (
    <FeedEmptyState
      ariaLive="polite"
      body="Recommendation snapshots will appear here after matching unread posts are available."
      title="Following is not ready yet"
    />
  );
}

function FollowingError({ onRetry }: { onRetry: () => void }) {
  return (
    <FeedEmptyState
      actions={
        <button className="fb-btn light compact" onClick={onRetry} type="button">
          <RefreshCcw aria-hidden="true" className="h-3.5 w-3.5" />
          Retry
        </button>
      }
      ariaLive="assertive"
      body="Something went wrong fetching recommendations."
      role="alert"
      title="Couldn't load Following"
      tone="error"
    />
  );
}
