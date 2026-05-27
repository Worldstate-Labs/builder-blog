"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  builderLibraryStatsChanged,
  type BuilderLibraryStatsChange,
} from "@/lib/builder-library-events";

type BuilderLibraryAutoRefreshProps = {
  initialVersion: string;
};

type LibraryStatePayload = {
  fetchedItems: number;
  inLibrary: number;
  subscribed: number;
  version: string;
};

const visibleCheckIntervalMs = 30_000;

export function BuilderLibraryAutoRefresh({
  initialVersion,
}: BuilderLibraryAutoRefreshProps) {
  const router = useRouter();
  const versionRef = useRef(initialVersion);

  useEffect(() => {
    versionRef.current = initialVersion;
  }, [initialVersion]);

  useEffect(() => {
    let closed = false;
    let inFlight: AbortController | null = null;
    let timer: number | null = null;

    function emitState(payload: LibraryStatePayload) {
      const detail: BuilderLibraryStatsChange = {
        fetchedCount: payload.fetchedItems,
        inLibraryCount: payload.inLibrary,
        subscribedCount: payload.subscribed,
      };
      window.dispatchEvent(new CustomEvent(builderLibraryStatsChanged, { detail }));
    }

    async function checkForChanges() {
      if (closed || document.visibilityState !== "visible" || inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      try {
        const response = await fetch("/api/builders/library-state", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as LibraryStatePayload;
        if (!payload.version || payload.version === versionRef.current) return;
        versionRef.current = payload.version;
        emitState(payload);
        router.refresh();
      } catch {
        /* retry on the next visible check */
      } finally {
        if (inFlight === controller) inFlight = null;
      }
    }

    function scheduleNextCheck() {
      if (closed) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void checkForChanges().finally(scheduleNextCheck);
      }, visibleCheckIntervalMs);
    }

    function checkWhenVisible() {
      if (document.visibilityState === "visible") {
        void checkForChanges();
      }
    }

    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    scheduleNextCheck();

    return () => {
      closed = true;
      inFlight?.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("pageshow", checkWhenVisible);
    };
  }, [router]);

  return null;
}
