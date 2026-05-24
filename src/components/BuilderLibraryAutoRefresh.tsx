"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { builderLibraryStatsChanged } from "@/lib/builder-library-events";

type BuilderLibraryAutoRefreshProps = {
  initialVersion: string;
};

type LibraryStatePayload = {
  crawledItems: number;
  inLibrary: number;
  subscribed: number;
  version: string;
};

export function BuilderLibraryAutoRefresh({
  initialVersion,
}: BuilderLibraryAutoRefreshProps) {
  const router = useRouter();
  const versionRef = useRef(initialVersion);

  useEffect(() => {
    versionRef.current = initialVersion;
  }, [initialVersion]);

  useEffect(() => {
    let reconnectTimer: number | null = null;
    let closed = false;
    let eventSource: EventSource | null = null;

    function applyState(payload: LibraryStatePayload) {
      if (!payload.version || payload.version === versionRef.current) return;
      versionRef.current = payload.version;
      window.dispatchEvent(
        new CustomEvent(builderLibraryStatsChanged, {
          detail: {
            crawledCount: payload.crawledItems,
            inLibraryCount: payload.inLibrary,
            subscribedCount: payload.subscribed,
          },
        }),
      );
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
