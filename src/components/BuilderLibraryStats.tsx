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

export function BuilderLibraryStats({
  initialCrawledItems,
  initialInLibrary,
  initialSubscribed,
}: BuilderLibraryStatsProps) {
  const [stats, setStats] = useState({
    crawledItems: initialCrawledItems,
    inLibrary: initialInLibrary,
    subscribed: initialSubscribed,
  });

  useEffect(() => {
    function onStatsChanged(event: Event) {
      const detail = (event as CustomEvent<BuilderLibraryStatsChange>).detail ?? {};
      setStats((current) => ({
        crawledItems: Math.max(0, current.crawledItems + (detail.crawledDelta ?? 0)),
        inLibrary: Math.max(0, current.inLibrary + (detail.inLibraryDelta ?? 0)),
        subscribed:
          detail.subscribedCount ?? Math.max(0, current.subscribed + (detail.subscribedDelta ?? 0)),
      }));
    }

    window.addEventListener(builderLibraryStatsChanged, onStatsChanged);
    return () => window.removeEventListener(builderLibraryStatsChanged, onStatsChanged);
  }, []);

  function onSubscribedAll() {
    window.dispatchEvent(new CustomEvent(builderLibrarySubscribeAll));
    window.dispatchEvent(
      new CustomEvent<BuilderLibraryStatsChange>(builderLibraryStatsChanged, {
        detail: { subscribedCount: stats.inLibrary },
      }),
    );
  }

  return (
    <div className="page-toolbar">
      <span className="status-chip">{stats.inLibrary} in library</span>
      <span className="status-chip">
        <Bell className="h-3.5 w-3.5" />
        {stats.subscribed} subscribed
      </span>
      <span className="status-chip">{stats.crawledItems} crawled</span>
      <SubscribeAllLibraryBuildersButton onSubscribedAll={onSubscribedAll} />
    </div>
  );
}
