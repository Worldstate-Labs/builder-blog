"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  RecommendationFeed,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";

type TimelineResponse = {
  snapshots: RecommendationSnapshotEntry[];
  unreadRemaining: number;
  strategy: string;
};

export function ForYouRecommendationSection() {
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    async function loadTimeline() {
      try {
        const response = await fetch("/api/recommendations/timeline", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as TimelineResponse;
        if (!cancelled) {
          setTimeline(data);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void loadTimeline();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="empty-panel mt-6 border-dashed md:p-8" aria-live="polite" aria-busy="true">
        <span className="status-chip">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading recommendations
        </span>
      </div>
    );
  }

  if (status === "error" || !timeline || timeline.snapshots.length === 0) {
    return <ForYouUnavailable />;
  }

  return <RecommendationFeed initialSnapshots={timeline.snapshots} />;
}

function ForYouUnavailable() {
  return (
    <div className="empty-panel mt-6 border-dashed md:p-8" aria-live="polite">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 h-5 w-5 text-[var(--accent)]" />
        <div>
          <h2 className="font-serif text-2xl text-[var(--ink)]">For You is not ready yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
            Recommendation snapshots will appear here after the recommendation store is available.
          </p>
        </div>
      </div>
    </div>
  );
}
