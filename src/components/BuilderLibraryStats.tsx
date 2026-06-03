"use client";

import { useEffect, useState } from "react";
import { SubscribeAllLibraryBuildersButton } from "@/components/BuilderLibraryActions";
import { CountMetric } from "@/components/Count";
import {
  builderLibraryStatsChanged,
  builderLibrarySubscribeAll,
  type BuilderLibraryStatsChange,
} from "@/lib/builder-library-events";

type BuilderLibraryStatsProps = {
  initialFetchedItems: number;
  initialInLibrary: number;
  initialSubscribed: number;
};

type BuilderLibraryStatsValue = {
  fetchedItems: number;
  inLibrary: number;
  subscribed: number;
};

export function BuilderLibraryStats({
  initialFetchedItems,
  initialInLibrary,
  initialSubscribed,
}: BuilderLibraryStatsProps) {
  const propKey = `${initialFetchedItems}:${initialInLibrary}:${initialSubscribed}`;
  const propStats: BuilderLibraryStatsValue = {
    fetchedItems: initialFetchedItems,
    inLibrary: initialInLibrary,
    subscribed: initialSubscribed,
  };
  const [statsState, setStatsState] = useState<{
    key: string;
    stats: BuilderLibraryStatsValue;
  }>({
    key: propKey,
    stats: propStats,
  });
  const stats = statsState.key === propKey ? statsState.stats : propStats;

  useEffect(() => {
    const currentPropStats = {
      fetchedItems: initialFetchedItems,
      inLibrary: initialInLibrary,
      subscribed: initialSubscribed,
    };

    function onStatsChanged(event: Event) {
      const detail = (event as CustomEvent<BuilderLibraryStatsChange>).detail ?? {};
      setStatsState((current) => {
        const currentStats = current.key === propKey ? current.stats : currentPropStats;
        return {
          key: propKey,
          stats: {
            fetchedItems:
              detail.fetchedCount ??
              Math.max(0, currentStats.fetchedItems + (detail.fetchedDelta ?? 0)),
            inLibrary:
              detail.inLibraryCount ??
              Math.max(0, currentStats.inLibrary + (detail.inLibraryDelta ?? 0)),
            subscribed:
              detail.subscribedCount ??
              Math.max(0, currentStats.subscribed + (detail.subscribedDelta ?? 0)),
          },
        };
      });
    }

    window.addEventListener(builderLibraryStatsChanged, onStatsChanged);
    return () => window.removeEventListener(builderLibraryStatsChanged, onStatsChanged);
  }, [initialFetchedItems, initialInLibrary, initialSubscribed, propKey]);

  function onSubscribedAll() {
    window.dispatchEvent(new CustomEvent(builderLibrarySubscribeAll));
    window.dispatchEvent(
      new CustomEvent<BuilderLibraryStatsChange>(builderLibraryStatsChanged, {
        detail: { subscribedCount: stats.inLibrary },
      }),
    );
  }

  return (
    <>
      <div className="at-desktop page-toolbar">
        <div className="source-summary-line" aria-label="Source library counts">
          <CountMetric label="in library" value={stats.inLibrary} />
          <CountMetric label="followed" value={stats.subscribed} />
          <CountMetric label="summarized" value={stats.fetchedItems} />
        </div>
        <SubscribeAllLibraryBuildersButton onSubscribedAll={onSubscribedAll} />
      </div>
      <div className="at-mobile grid w-full grid-cols-3 gap-2">
        <CountMetric label="In library" value={stats.inLibrary} />
        <CountMetric label="Followed" value={stats.subscribed} />
        <CountMetric label="Summarized" value={stats.fetchedItems} />
      </div>
    </>
  );
}
