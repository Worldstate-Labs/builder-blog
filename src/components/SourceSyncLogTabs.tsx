"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CloudSourceLogItem,
  type CloudSourceLogSource,
} from "@/components/CloudSourceLogItem";
import {
  FetchLogPanel,
  type LibraryCronJobStatus,
  type LibraryFetchRunListItem,
} from "@/components/FetchLogPanel";
import { RelativeTime } from "@/components/RelativeTime";
import { displayLanguagePreference } from "@/lib/language-preference";
import {
  contentSyncStateChanged,
  liveDataSignature,
  LIVE_POLL_IDLE_MS,
  LIVE_POLL_RUNNING_MS,
  hasUnseenLogRecords,
  logRecordKeys,
  requestWorkspaceRefresh,
} from "@/lib/content-sync-events";
import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import type {
  UserCloudFetchLogData,
  UserCloudFetchSourceLog,
  UserCloudFetchDeadlineStatus,
} from "@/lib/user-cloud-fetch-log";

type SyncLogTab = "local" | "cloud";
type LogReadMarkers = Record<SyncLogTab, string[]>;

const logReadMarkerStoragePrefix = "followbrief:source-log-read-markers:";

const USER_CLOUD_SOURCE_LIMIT = 5;

export function SourceSyncLogTabs({
  cloudLog,
  initialCronJob,
  initialCronRuns,
  initialHasMoreHistory,
  initialJobRuns,
  initialRuns,
  initialScheduledJobRuns,
  summaryLanguage,
  userId,
}: {
  cloudLog: UserCloudFetchLogData;
  initialRuns: LibraryFetchRunListItem[];
  initialCronRuns: LibraryFetchRunListItem[];
  initialJobRuns?: AgentJobRunListItem[];
  initialScheduledJobRuns?: AgentJobRunListItem[];
  initialCronJob: LibraryCronJobStatus | null;
  initialHasMoreHistory?: boolean;
  summaryLanguage?: string | null;
  userId: string;
}) {
  const [selected, setSelected] = useState<SyncLogTab>("cloud");
  const selectedRef = useRef<SyncLogTab>("cloud");
  const cloudSignature = useMemo(() => liveDataSignature(cloudLog), [cloudLog]);
  const [cloudState, setCloudState] = useState(() => ({
    baseSignature: cloudSignature,
    log: cloudLog,
  }));
  const liveCloudLog = cloudState.baseSignature === cloudSignature ? cloudState.log : cloudLog;
  const cloudLogRecords = useMemo(
    () => cloudLogRecordKeys(liveCloudLog),
    [liveCloudLog],
  );
  const initialAgentLogRecords = useMemo(
    () => logRecordKeys([
      ...initialRuns.map((run) => `fetch:${run.id}`),
      ...initialCronRuns.map((run) => `fetch:${run.id}`),
      ...(initialJobRuns ?? []).map((run) => `job:${run.id}`),
      ...(initialScheduledJobRuns ?? []).map((run) => `job:${run.id}`),
    ]),
    [initialCronRuns, initialJobRuns, initialRuns, initialScheduledJobRuns],
  );
  const [agentLogRecords, setAgentLogRecords] = useState(initialAgentLogRecords);
  const [readMarkers, setReadMarkers] = useState<LogReadMarkers | null>(null);
  const storageKey = `${logReadMarkerStoragePrefix}${userId}`;
  const initialLogRecordsRef = useRef<LogReadMarkers>({
    cloud: cloudLogRecords,
    local: initialAgentLogRecords,
  });
  const cloudPropSignatureRef = useRef(cloudSignature);
  const liveCloudSignatureRef = useRef(cloudSignature);
  const cloudRefreshInFlight = useRef(false);
  const hasRunningCloudSource = liveCloudLog.sources.some(
    (source) => source.deadlineStatus === "RUNNING",
  );
  const markLogRecordsSeen = useCallback((tab: SyncLogTab, keys: string[]) => {
    setReadMarkers((current) => {
      if (!current || sameLogRecordKeys(current[tab], keys)) return current;
      const next = { ...current, [tab]: keys };
      writeLogReadMarkers(storageKey, next);
      return next;
    });
  }, [storageKey]);
  const handleLatestAgentLogRecordChange = useCallback((keys: string[]) => {
    setAgentLogRecords((current) => sameLogRecordKeys(current, keys) ? current : keys);
    if (selectedRef.current === "local") markLogRecordsSeen("local", keys);
  }, [markLogRecordsSeen]);
  const selectLogTab = useCallback((tab: SyncLogTab) => {
    const previous = selectedRef.current;
    const previousKeys = previous === "cloud" ? cloudLogRecords : agentLogRecords;
    const nextKeys = tab === "cloud" ? cloudLogRecords : agentLogRecords;
    markLogRecordsSeen(previous, previousKeys);
    selectedRef.current = tab;
    setSelected(tab);
    markLogRecordsSeen(tab, nextKeys);
  }, [agentLogRecords, cloudLogRecords, markLogRecordsSeen]);
  const cloudHasUnread = selected !== "cloud" && Boolean(
    readMarkers && hasUnseenLogRecords(cloudLogRecords, readMarkers.cloud),
  );
  const localHasUnread = selected !== "local" && Boolean(
    readMarkers && hasUnseenLogRecords(agentLogRecords, readMarkers.local),
  );

  useEffect(() => {
    const initial = initialLogRecordsRef.current;
    const stored = readLogReadMarkers(storageKey);
    const next = stored
      ? { ...stored, cloud: initial.cloud }
      : initial;
    setReadMarkers(next);
    writeLogReadMarkers(storageKey, next);
  }, [storageKey]);

  useEffect(() => {
    cloudPropSignatureRef.current = cloudSignature;
    liveCloudSignatureRef.current = cloudSignature;
  }, [cloudSignature]);

  const refreshCloudLog = useCallback(async () => {
    if (cloudRefreshInFlight.current) return;
    cloudRefreshInFlight.current = true;
    // Capture the prop signature at request time. A router.refresh can deliver
    // a fresher SSR prop while this poll is in flight; stamping the response
    // with the request-time signature lets that fresher prop win at render.
    const requestPropSignature = cloudPropSignatureRef.current;
    try {
      const response = await fetch("/api/cloud-library/fetch-log", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const nextLog = (await response.json()) as UserCloudFetchLogData;
      const nextSignature = liveDataSignature(nextLog);
      if (nextSignature === liveCloudSignatureRef.current) return;
      if (selectedRef.current === "cloud") {
        markLogRecordsSeen("cloud", cloudLogRecordKeys(nextLog));
      }
      liveCloudSignatureRef.current = nextSignature;
      setCloudState({
        baseSignature: requestPropSignature,
        log: nextLog,
      });
      requestWorkspaceRefresh("user-cloud-fetch-log");
    } catch {
      // Keep the last successful snapshot and retry on the next visible check.
    } finally {
      cloudRefreshInFlight.current = false;
    }
  }, [markLogRecordsSeen]);

  useEffect(() => {
    let closed = false;
    let timer = 0;
    const pollMs = hasRunningCloudSource ? LIVE_POLL_RUNNING_MS : LIVE_POLL_IDLE_MS;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (closed) return;
        if (document.visibilityState === "visible") await refreshCloudLog();
        if (!closed) schedule();
      }, pollMs);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshCloudLog();
    };
    const initialRefresh = window.setTimeout(refreshWhenVisible, 0);
    schedule();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener(contentSyncStateChanged, refreshWhenVisible);
    return () => {
      closed = true;
      window.clearTimeout(initialRefresh);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener(contentSyncStateChanged, refreshWhenVisible);
    };
  }, [hasRunningCloudSource, refreshCloudLog]);

  return (
    <div className="source-sync-log-tabs">
      <div className="source-sync-log-tabs-head">
        <div
          aria-label="Sync log type"
          className="fb-segmented-tabs source-sync-log-tablist"
          role="tablist"
        >
          <button
            aria-controls="source-sync-cloud-log-panel"
            aria-selected={selected === "cloud"}
            className="fb-btn compact"
            id="source-sync-cloud-log-tab"
            onClick={() => selectLogTab("cloud")}
            role="tab"
            tabIndex={selected === "cloud" ? 0 : -1}
            type="button"
          >
            <LogTabLabel label="FollowBrief fetch log" unread={cloudHasUnread} />
          </button>
          <button
            aria-controls="source-sync-local-log-panel"
            aria-selected={selected === "local"}
            className="fb-btn compact"
            id="source-sync-local-log-tab"
            onClick={() => selectLogTab("local")}
            role="tab"
            tabIndex={selected === "local" ? 0 : -1}
            type="button"
          >
            <LogTabLabel label="Agent fetch log" unread={localHasUnread} />
          </button>
        </div>
      </div>

      <section
        aria-labelledby="source-sync-cloud-log-tab"
        hidden={selected !== "cloud"}
        id="source-sync-cloud-log-panel"
        role="tabpanel"
      >
        <UserCloudFetchLogPanel cloudLog={liveCloudLog} />
      </section>
      <section
        aria-labelledby="source-sync-local-log-tab"
        hidden={selected !== "local"}
        id="source-sync-local-log-panel"
        role="tabpanel"
      >
        <FetchLogPanel
          initialCronJob={initialCronJob}
          initialCronRuns={initialCronRuns}
          initialJobRuns={initialJobRuns}
          initialHasMoreHistory={initialHasMoreHistory}
          initialScheduledJobRuns={initialScheduledJobRuns}
          initialRuns={initialRuns}
          onLogRecordKeysChange={handleLatestAgentLogRecordChange}
          summaryLanguage={summaryLanguage}
        />
      </section>
    </div>
  );
}

function LogTabLabel({ label, unread }: { label: string; unread: boolean }) {
  return (
    <span className="source-sync-log-tab-label">
      <span>{label}</span>
      {unread ? (
        <>
          <span aria-hidden="true" className="source-sync-log-unread-dot" />
          <span className="sr-only">New logs</span>
        </>
      ) : null}
    </span>
  );
}

function UserCloudFetchLogPanel({
  cloudLog,
}: {
  cloudLog: UserCloudFetchLogData;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const sourceLabel = cloudLog.submittedSourceCount === 1 ? "source" : "sources";
  const onTimeSourceCount = cloudLog.sources.filter((source) => source.deadlineStatus === "ON_TIME").length;
  const onTimeSourceLabel = onTimeSourceCount === 1 ? "source" : "sources";
  const visibleSources = sourcesExpanded
    ? cloudLog.sources
    : cloudLog.sources.slice(0, USER_CLOUD_SOURCE_LIMIT);
  const hiddenSourceCount = Math.max(0, cloudLog.sources.length - USER_CLOUD_SOURCE_LIMIT);

  return (
    <section className="fb-panel digest-updates-panel user-cloud-fetch-log">
      <div className="source-fetch-overview">
        <dl className="fb-hub-digest-meta source-fetch-meta" aria-label="FollowBrief fetch details">
          <SourceFetchMetaItem
            label="Fetch frequency"
            value={frequencyLabel(cloudLog.frequency)}
          />
          <SourceFetchMetaItem
            label="Language"
            value={cloudLog.summaryLanguage ? displayLanguagePreference(cloudLog.summaryLanguage) : "N/A"}
          />
          <SourceFetchMetaItem
            label="FollowBrief sources"
            value={<>{cloudLog.submittedSourceCount} <span>{sourceLabel}</span></>}
          />
          <SourceFetchMetaItem
            label="On time sources"
            value={<>{onTimeSourceCount} <span>{onTimeSourceLabel}</span></>}
          />
        </dl>
      </div>

      {cloudLog.sources.length > 0 ? (
        <div className="user-cloud-source-list-shell">
          <ul
            className="cloud-source-list user-cloud-source-list"
            id="user-cloud-source-list"
          >
            {visibleSources.map((source) => {
              const isOpen = expanded === source.submissionId;
              return (
                <CloudSourceLogItem
                  key={source.submissionId}
                  isOpen={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : source.submissionId)}
                  showSubmitters={false}
                  source={toUserCloudSourceLogItem(source)}
                />
              );
            })}
          </ul>
          {hiddenSourceCount > 0 ? (
            <button
              aria-controls="user-cloud-source-list"
              aria-expanded={sourcesExpanded}
              aria-label={
                sourcesExpanded
                  ? "Collapse to the first 5 sources"
                  : `Show ${hiddenSourceCount} more sources`
              }
              className="sync-panel-run-card-reveal user-cloud-source-list-toggle"
              onClick={() => setSourcesExpanded((value) => !value)}
              type="button"
            >
              {sourcesExpanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function toUserCloudSourceLogItem(source: UserCloudFetchSourceLog): CloudSourceLogSource {
  const feedBuilderId = source.userBuilderId ?? source.cloudBuilderId;
  return {
    id: source.submissionId,
    cloudBuilderId: source.cloudBuilderId,
    feedBuilderId,
    entityId: source.entityId,
    kind: source.kind,
    sourceName: source.sourceName,
    sourceType: source.sourceType,
    sourceUrl: source.sourceUrl,
    fetchUrl: source.fetchUrl,
    avatarUrl: source.avatarUrl,
    avatarDataUrl: source.avatarDataUrl,
    postCount: source.postCount,
    statusChipLabel: deadlineStatusLabel(source.deadlineStatus),
    statusChipClassName: deadlineStatusClass(source.deadlineStatus),
    metaItems: [
      frequencyLabel(source.frequency),
      <>added <RelativeTime value={source.submittedAt} /></>,
      <>
        latest fetch{" "}
        <RelativeTime
          value={source.latestRunTask?.finishedAt ?? source.latestRunTask?.startedAt}
          fallback="none yet"
        />
      </>,
      <>deadline <RelativeTime value={source.mustSucceedBy} fallback="not scheduled" /></>,
    ],
    lastSuccessAt: source.lastSuccessAt,
    lastFailureAt: source.lastFailureAt,
    lastFailureReason: source.lastFailureReason,
    nextAttemptAt: source.nextAttemptAt,
    latestRunTask: source.latestRunTask,
  };
}

function SourceFetchMetaItem({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="fb-hub-digest-meta-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function frequencyLabel(frequency: string | null): string {
  if (frequency === "DAILY") return "Daily";
  if (frequency === "WEEKLY") return "Weekly";
  return frequency ?? "N/A";
}

function deadlineStatusLabel(status: UserCloudFetchDeadlineStatus): string {
  if (status === "ON_TIME") return "ON TIME";
  if (status === "RUNNING") return "RUNNING";
  if (status === "MISSED") return "MISSED";
  if (status === "FAILED") return "FAILED";
  return "WAITING";
}

function sameLogRecordKeys(left: string[], right: string[]) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function cloudLogRecordKeys(log: UserCloudFetchLogData) {
  return logRecordKeys(
    log.sources.flatMap((source) => source.latestRunTask
      ? [`cloud:${source.latestRunTask.id}`]
      : []),
  );
}

function readLogReadMarkers(storageKey: string): LogReadMarkers | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    const cloud = parseLogRecordKeys(value.cloud);
    const local = parseLogRecordKeys(value.local);
    if (!cloud || !local) return null;
    return { cloud, local };
  } catch {
    return null;
  }
}

function parseLogRecordKeys(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((key) => typeof key !== "string")) return null;
  return logRecordKeys(value);
}

function writeLogReadMarkers(storageKey: string, markers: LogReadMarkers) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(markers));
  } catch {
    // Private browsing or storage quotas can block persistence. The in-memory
    // read state still works for the current page session.
  }
}

function deadlineStatusClass(status: UserCloudFetchDeadlineStatus): string {
  if (status === "ON_TIME") return "is-ok";
  if (status === "MISSED" || status === "FAILED") return "is-failed";
  return "is-partial";
}
