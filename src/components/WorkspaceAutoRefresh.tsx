"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  contentSyncStateChanged,
  workspaceRefreshRequested,
  type ContentSyncStateChange,
} from "@/lib/content-sync-events";

type ContentStatePayload = {
  version: string;
};

const visibleCheckIntervalMs = 15_000;

export function WorkspaceAutoRefresh({
  initialVersion,
}: {
  initialVersion: string;
}) {
  const router = useRouter();
  const versionRef = useRef(initialVersion);

  useEffect(() => {
    versionRef.current = initialVersion;
  }, [initialVersion]);

  useEffect(() => {
    let closed = false;
    let inFlight: AbortController | null = null;
    let timer: number | null = null;
    let queuedForceRefresh = false;

    function publishChange(version: string) {
      const detail: ContentSyncStateChange = { version };
      window.dispatchEvent(new CustomEvent(contentSyncStateChanged, { detail }));
    }

    async function checkForChanges(forceRefresh = false) {
      if (closed || document.visibilityState !== "visible") return;
      if (inFlight) {
        queuedForceRefresh ||= forceRefresh;
        return;
      }
      const controller = new AbortController();
      inFlight = controller;
      let refreshPerformed = false;
      try {
        const response = await fetch("/api/content-state", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as ContentStatePayload;
        if (!payload.version) return;
        const versionChanged = payload.version !== versionRef.current;
        if (!versionChanged && !forceRefresh) return;
        versionRef.current = payload.version;
        publishChange(payload.version);
        router.refresh();
        refreshPerformed = true;
      } catch {
        /* retry on the next visible check */
      } finally {
        if (inFlight === controller) inFlight = null;
        const shouldRunQueuedForce = queuedForceRefresh && !refreshPerformed;
        queuedForceRefresh = false;
        if (shouldRunQueuedForce && !closed) {
          window.setTimeout(() => void checkForChanges(true), 0);
        }
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

    function refreshWhenRequested() {
      if (document.visibilityState === "visible") {
        void checkForChanges(true);
      }
    }

    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    window.addEventListener(workspaceRefreshRequested, refreshWhenRequested);
    const initialCheck = window.setTimeout(() => void checkForChanges(), 0);
    scheduleNextCheck();

    return () => {
      closed = true;
      inFlight?.abort();
      window.clearTimeout(initialCheck);
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("pageshow", checkWhenVisible);
      window.removeEventListener(workspaceRefreshRequested, refreshWhenRequested);
    };
  }, [router]);

  return null;
}
