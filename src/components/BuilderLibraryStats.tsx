"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { SubscribeAllLibraryBuildersButton } from "@/components/BuilderLibraryActions";
import {
  builderLibraryStatsChanged,
  builderLibrarySubscribeAll,
  type BuilderLibraryStatsChange,
} from "@/lib/builder-library-events";

type BuilderLibraryStatsProps = {
  initialCrawledItems: number;
  initialInLibrary: number;
  initialSubscribed: number;
};

type BuilderLibraryStatsValue = {
  crawledItems: number;
  inLibrary: number;
  subscribed: number;
};

export function BuilderLibraryStats({
  initialCrawledItems,
  initialInLibrary,
  initialSubscribed,
}: BuilderLibraryStatsProps) {
  const propKey = `${initialCrawledItems}:${initialInLibrary}:${initialSubscribed}`;
  const propStats: BuilderLibraryStatsValue = {
    crawledItems: initialCrawledItems,
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
      crawledItems: initialCrawledItems,
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
            crawledItems:
              detail.crawledCount ??
              Math.max(0, currentStats.crawledItems + (detail.crawledDelta ?? 0)),
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
  }, [initialCrawledItems, initialInLibrary, initialSubscribed, propKey]);

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
      <div className="hidden lg:flex page-toolbar">
        <span className="status-chip">{stats.inLibrary} in library</span>
        <span className="status-chip">
          <Bell className="h-3.5 w-3.5" />
          {stats.subscribed} subscribed
        </span>
        <span className="status-chip">{stats.crawledItems} crawled</span>
        <SubscribeAllLibraryBuildersButton onSubscribedAll={onSubscribedAll} />
      </div>
      <div className="grid w-full grid-cols-3 gap-2 lg:hidden">
        <div className="fb-stat" style={{ padding: "0.625rem 0.75rem" }}>
          <div className="min-w-0">
            <div className="fb-stat-value" style={{ fontSize: "1.0625rem" }}>
              {stats.inLibrary}
            </div>
            <div className="fb-stat-label" style={{ fontSize: "0.625rem" }}>
              In library
            </div>
          </div>
        </div>
        <div className="fb-stat" style={{ padding: "0.625rem 0.75rem" }}>
          <div className="min-w-0">
            <div className="fb-stat-value" style={{ fontSize: "1.0625rem" }}>
              {stats.subscribed}
            </div>
            <div className="fb-stat-label" style={{ fontSize: "0.625rem" }}>
              Subscribed
            </div>
          </div>
        </div>
        <div className="fb-stat" style={{ padding: "0.625rem 0.75rem" }}>
          <div className="min-w-0">
            <div className="fb-stat-value" style={{ fontSize: "1.0625rem" }}>
              {stats.crawledItems.toLocaleString()}
            </div>
            <div className="fb-stat-label" style={{ fontSize: "0.625rem" }}>
              Crawled
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
