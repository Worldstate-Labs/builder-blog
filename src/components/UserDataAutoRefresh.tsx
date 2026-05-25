"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  builderLibraryStatsChanged,
  followBriefDataChanged,
  type BuilderLibraryStatsChange,
  type FollowBriefDataChange,
} from "@/lib/builder-library-events";

type UserDataAutoRefreshProps = {
  initialVersion?: string;
};

type LibraryStatePayload = {
  crawledItems: number;
  inLibrary: number;
  subscribed: number;
  version: string;
};

export function UserDataAutoRefresh({ initialVersion = "" }: UserDataAutoRefreshProps) {
  const router = useRouter();
  const versionRef = useRef(initialVersion);
  const hasBaselineRef = useRef(Boolean(initialVersion));

  useEffect(() => {
    versionRef.current = initialVersion;
    hasBaselineRef.current = Boolean(initialVersion);
  }, [initialVersion]);

  useEffect(() => {
    let reconnectTimer: number | null = null;
    let closed = false;
    let eventSource: EventSource | null = null;

    function emitState(payload: LibraryStatePayload) {
      const statsDetail: BuilderLibraryStatsChange = {
        crawledCount: payload.crawledItems,
        inLibraryCount: payload.inLibrary,
        subscribedCount: payload.subscribed,
      };
      const dataDetail: FollowBriefDataChange = {
        ...statsDetail,
        version: payload.version,
      };

      window.dispatchEvent(
        new CustomEvent(builderLibraryStatsChanged, { detail: statsDetail }),
      );
      window.dispatchEvent(new CustomEvent(followBriefDataChanged, { detail: dataDetail }));
    }

    function applyState(payload: LibraryStatePayload) {
      if (!payload.version) return;
      if (!hasBaselineRef.current) {
        hasBaselineRef.current = true;
        versionRef.current = payload.version;
        return;
      }
      if (payload.version === versionRef.current) return;

      versionRef.current = payload.version;
      emitState(payload);
      router.refresh();
    }

    function connect() {
      if (closed) return;
      eventSource?.close();
      eventSource = new EventSource("/api/builders/library-stream", { withCredentials: true });
      eventSource.addEventListener("library-state", (event) => {
        try {
          applyState(JSON.parse((event as MessageEvent).data) as LibraryStatePayload);
        } catch {
          /* ignore malformed stream events */
        }
      });
      eventSource.onerror = () => {
        eventSource?.close();
        if (!closed) reconnectTimer = window.setTimeout(connect, 2500);
      };
    }

    connect();
    return () => {
      closed = true;
      eventSource?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    };
  }, [router]);

  return null;
}
