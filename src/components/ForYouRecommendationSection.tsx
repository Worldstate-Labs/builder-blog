"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  RecommendationFeed,
  type RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";
import { followBriefDataChanged } from "@/lib/builder-library-events";

type TimelineResponse = {
  snapshots: RecommendationSnapshotEntry[];
  unreadRemaining: number;
  strategy: string;
};

export function ForYouRecommendationSection() {
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const loadTimeline = useCallback(async ({ keepCurrent = false } = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!keepCurrent) setStatus("loading");

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
      if (mountedRef.current && requestIdRef.current === requestId && !keepCurrent) {
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    async function loadInitialTimeline() {
      try {
        const response = await fetch("/api/recommendations/timeline", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as TimelineResponse;
        if (!cancelled && mountedRef.current && requestIdRef.current === requestId) {
          setTimeline(data);
          setStatus("ready");
        }
      } catch {
        if (!cancelled && mountedRef.current && requestIdRef.current === requestId) {
          setStatus("error");
        }
      }
    }

    void loadInitialTimeline();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDataChanged() {
      void loadTimeline({ keepCurrent: true });
    }

    window.addEventListener(followBriefDataChanged, onDataChanged);
    return () => {
      window.removeEventListener(followBriefDataChanged, onDataChanged);
    };
  }, [loadTimeline]);

  if (status === "loading") {
    return (
      <div className="item-list mt-6" aria-live="polite" aria-busy="true">
        <div className="h-24 rounded-lg bg-black/10" />
        <div className="h-24 rounded-lg bg-black/10" />
        <span className="sr-only">Loading recommendations</span>
      </div>
    );
  }

  if (status === "error" || !timeline || timeline.snapshots.length === 0) {
    return <ForYouUnavailable />;
  }

  return (
    <RecommendationFeed
      key={timeline.snapshots.map((snapshot) => snapshot.id).join("|")}
      initialSnapshots={timeline.snapshots}
    />
  );
}

function ForYouUnavailable() {
  return (
    <div className="empty-panel mt-6 border-dashed md:p-8" aria-live="polite">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 h-5 w-5 text-[var(--accent)]" />
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">For You is not ready yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
            Recommendation snapshots will appear here after the recommendation store is available.
          </p>
        </div>
      </div>
    </div>
  );
}
