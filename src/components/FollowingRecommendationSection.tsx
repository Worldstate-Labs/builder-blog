"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import {
  RecommendationFeed,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";

type TimelineResponse = {
  snapshots: RecommendationSnapshotEntry[];
  unreadRemaining: number;
  strategy: string;
};

export function FollowingRecommendationSection() {
  return <FollowingRecommendationLoader />;
}

function FollowingRecommendationLoader() {
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
    return (
      <div className="feed-content-stack">
        <div className="feed-skeleton-list" aria-live="polite" aria-busy="true">
          <div className="feed-skeleton-card" />
          <div className="feed-skeleton-card" />
          <span className="sr-only">Loading Following recommendations</span>
        </div>
      </div>
    );
  }

  // A fetch failure is distinct from "ready but nothing to show": the former is
  // an error the user can retry, the latter is the normal empty state.
  if (status === "error") {
    return <FollowingError />;
  }
  if (!timeline || timeline.snapshots.length === 0) {
    return <FollowingUnavailable />;
  }

  return (
    <RecommendationFeed
      key={timeline.snapshots.map((snapshot) => snapshot.id).join("|")}
      initialSnapshots={timeline.snapshots}
    />
  );
}

function FollowingUnavailable() {
  return (
    <div className="feed-content-stack">
      <EmptyState
        ariaLive="polite"
        body="Recommendation snapshots will appear here after matching unread posts are available."
        className="feed-state-panel"
        title="Following is not ready yet"
        tone="empty"
      />
    </div>
  );
}

function FollowingError() {
  return (
    <div className="feed-content-stack">
      <EmptyState
        ariaLive="assertive"
        body="Something went wrong fetching recommendations. Use Refresh to try again."
        className="feed-state-panel"
        role="alert"
        title="Couldn't load Following"
        tone="error"
      />
    </div>
  );
}
