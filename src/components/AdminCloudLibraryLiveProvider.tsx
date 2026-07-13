"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  contentSyncStateChanged,
  liveDataSignature,
  LIVE_POLL_IDLE_MS,
  LIVE_POLL_RUNNING_MS,
  requestWorkspaceRefresh,
} from "@/lib/content-sync-events";
import type {
  CloudLanguageLibraryAdmin,
  CloudLibraryAdminSnapshot,
} from "@/lib/cloud-library-overview";

type CloudLibraryLiveValue = CloudLibraryAdminSnapshot & {
  updateLanguageLibrary: (library: CloudLanguageLibraryAdmin) => void;
};

const CloudLibraryLiveContext = createContext<CloudLibraryLiveValue | null>(null);

export function AdminCloudLibraryLiveProvider({
  children,
  initialSnapshot,
}: {
  children: ReactNode;
  initialSnapshot: CloudLibraryAdminSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const livePayloadSignatureRef = useRef(liveDataSignature(initialSnapshot));
  const hasRunningSourceTask = useMemo(
    () => snapshot.libraries.some((library) =>
      library.sources.some((source) => source.latestRunTask?.status.toUpperCase() === "RUNNING"),
    ),
    [snapshot.libraries],
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/cloud-fetch/libraries", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json().catch(() => null)) as CloudLibraryAdminSnapshot | null;
      if (Array.isArray(body?.libraries) && Array.isArray(body.languageLibraries)) {
        const nextSignature = liveDataSignature(body);
        const changed = nextSignature !== livePayloadSignatureRef.current;
        livePayloadSignatureRef.current = nextSignature;
        setSnapshot(body);
        if (changed) requestWorkspaceRefresh("admin-cloud-library");
      }
    } catch {
      // Keep the last snapshot; the next visible refresh retries automatically.
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(id);
  }, [refresh]);

  useEffect(() => {
    const pollMs = hasRunningSourceTask ? LIVE_POLL_RUNNING_MS : LIVE_POLL_IDLE_MS;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [hasRunningSourceTask, refresh]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener(contentSyncStateChanged, refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener(contentSyncStateChanged, refreshWhenVisible);
    };
  }, [refresh]);

  const updateLanguageLibrary = useCallback((next: CloudLanguageLibraryAdmin) => {
    setSnapshot((current) => ({
      libraries: current.libraries.map((library) =>
        library.id === next.id ? { ...library, enabled: next.enabled } : library,
      ),
      languageLibraries: [
        next,
        ...current.languageLibraries.filter((library) => library.id !== next.id),
      ].sort((a, b) => a.summaryLanguage.localeCompare(b.summaryLanguage)),
    }));
  }, []);

  const value = useMemo(
    () => ({ ...snapshot, updateLanguageLibrary }),
    [snapshot, updateLanguageLibrary],
  );

  return (
    <CloudLibraryLiveContext.Provider value={value}>
      {children}
    </CloudLibraryLiveContext.Provider>
  );
}

export function useCloudLibraryLiveSnapshot(): CloudLibraryLiveValue {
  const value = useContext(CloudLibraryLiveContext);
  if (!value) throw new Error("Cloud library live data requires AdminCloudLibraryLiveProvider.");
  return value;
}
