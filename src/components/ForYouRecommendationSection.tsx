"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  RecommendationFeed,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";

type TimelineResponse = {
  snapshots: RecommendationSnapshotEntry[];
  unreadRemaining: number;
  strategy: string;
};

type RecommendationScope = "for-you" | "subscription";

export function ForYouRecommendationSection({
  scope = "for-you",
}: {
  scope?: RecommendationScope;
}) {
  return <ForYouRecommendationLoader key={scope} scope={scope} />;
}

function ForYouRecommendationLoader({ scope }: { scope: RecommendationScope }) {
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
      const response = await fetch(`/api/recommendations/timeline?scope=${scope}`, {
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
  }, [scope]);

  useEffect(() => {
    const id = window.setTimeout(() => void loadTimeline(), 0);
    return () => window.clearTimeout(id);
  }, [loadTimeline]);

  if (status === "loading") {
    return (
      <div className="item-list mt-6" aria-live="polite" aria-busy="true">
        <div className="h-24 rounded-lg bg-black/10" />
        <div className="h-24 rounded-lg bg-black/10" />
        <span className="sr-only">Loading {scopeLabel(scope)} recommendations</span>
      </div>
    );
  }

  // A fetch failure is distinct from "ready but nothing to show": the former is
  // an error the user can retry, the latter is the normal empty state.
  if (status === "error") {
    return <ForYouError scope={scope} />;
  }
  if (!timeline || timeline.snapshots.length === 0) {
    return <ForYouUnavailable scope={scope} />;
  }

  return (
    <RecommendationFeed
      key={timeline.snapshots.map((snapshot) => snapshot.id).join("|")}
      initialSnapshots={timeline.snapshots}
      scope={scope}
    />
  );
}

function ForYouUnavailable({ scope }: { scope: RecommendationScope }) {
  return (
    <div className="empty-panel mt-6 border-dashed md:p-8" aria-live="polite">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 h-5 w-5 text-[var(--accent)]" />
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            {scopeLabel(scope)} is not ready yet
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
            Recommendation snapshots will appear here after matching unread posts are available.
          </p>
        </div>
      </div>
    </div>
  );
}

function ForYouError({ scope }: { scope: RecommendationScope }) {
  return (
    <div className="empty-panel mt-6 border-dashed md:p-8" role="alert" aria-live="assertive">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 h-5 w-5 text-[var(--danger)]" />
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            Couldn&rsquo;t load {scopeLabel(scope)}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
            Something went wrong fetching recommendations. Use Refresh snapshot to try again.
          </p>
        </div>
      </div>
    </div>
  );
}

function scopeLabel(scope: RecommendationScope) {
  return scope === "subscription" ? "Following" : "For You";
}
