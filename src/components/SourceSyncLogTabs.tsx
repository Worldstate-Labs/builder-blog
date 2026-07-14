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
  requestWorkspaceRefresh,
} from "@/lib/content-sync-events";
import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import type {
  UserCloudFetchLogData,
  UserCloudFetchSourceLog,
  UserCloudFetchDeadlineStatus,
} from "@/lib/user-cloud-fetch-log";

type SyncLogTab = "local" | "cloud";

export function SourceSyncLogTabs({
  cloudLog,
  initialCronJob,
  initialCronRuns,
  initialHasMoreHistory,
  initialJobRuns,
  initialRuns,
  initialScheduledJobRuns,
  summaryLanguage,
}: {
  cloudLog: UserCloudFetchLogData;
  initialRuns: LibraryFetchRunListItem[];
  initialCronRuns: LibraryFetchRunListItem[];
  initialJobRuns?: AgentJobRunListItem[];
  initialScheduledJobRuns?: AgentJobRunListItem[];
  initialCronJob: LibraryCronJobStatus | null;
  initialHasMoreHistory?: boolean;
  summaryLanguage?: string | null;
}) {
  const [selected, setSelected] = useState<SyncLogTab>("cloud");
  const cloudSignature = useMemo(() => liveDataSignature(cloudLog), [cloudLog]);
  const [cloudState, setCloudState] = useState(() => ({
    baseSignature: cloudSignature,
    log: cloudLog,
  }));
  const liveCloudLog = cloudState.baseSignature === cloudSignature ? cloudState.log : cloudLog;
  const cloudPropSignatureRef = useRef(cloudSignature);
  const liveCloudSignatureRef = useRef(cloudSignature);
  const cloudRefreshInFlight = useRef(false);
  const hasRunningCloudSource = liveCloudLog.sources.some(
    (source) => source.deadlineStatus === "RUNNING",
  );

  useEffect(() => {
    cloudPropSignatureRef.current = cloudSignature;
    liveCloudSignatureRef.current = cloudSignature;
  }, [cloudSignature]);

  const refreshCloudLog = useCallback(async () => {
    if (cloudRefreshInFlight.current) return;
    cloudRefreshInFlight.current = true;
    try {
      const response = await fetch("/api/cloud-library/fetch-log", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const nextLog = (await response.json()) as UserCloudFetchLogData;
      const nextSignature = liveDataSignature(nextLog);
      if (nextSignature === liveCloudSignatureRef.current) return;
      liveCloudSignatureRef.current = nextSignature;
      setCloudState({
        baseSignature: cloudPropSignatureRef.current,
        log: nextLog,
      });
      requestWorkspaceRefresh("user-cloud-fetch-log");
    } catch {
      // Keep the last successful snapshot and retry on the next visible check.
    } finally {
      cloudRefreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (selected !== "cloud") return;
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
  }, [hasRunningCloudSource, refreshCloudLog, selected]);

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
            onClick={() => setSelected("cloud")}
            role="tab"
            tabIndex={selected === "cloud" ? 0 : -1}
            type="button"
          >
            FollowBrief fetch log
          </button>
          <button
            aria-controls="source-sync-local-log-panel"
            aria-selected={selected === "local"}
            className="fb-btn compact"
            id="source-sync-local-log-tab"
            onClick={() => setSelected("local")}
            role="tab"
            tabIndex={selected === "local" ? 0 : -1}
            type="button"
          >
            Agent fetch log
          </button>
        </div>
      </div>

      {selected === "cloud" ? (
        <section
          aria-labelledby="source-sync-cloud-log-tab"
          id="source-sync-cloud-log-panel"
          role="tabpanel"
        >
          <UserCloudFetchLogPanel cloudLog={liveCloudLog} />
        </section>
      ) : (
        <section
          aria-labelledby="source-sync-local-log-tab"
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
            summaryLanguage={summaryLanguage}
          />
        </section>
      )}
    </div>
  );
}

function UserCloudFetchLogPanel({
  cloudLog,
}: {
  cloudLog: UserCloudFetchLogData;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sourceLabel = cloudLog.submittedSourceCount === 1 ? "source" : "sources";
  const onTimeSourceCount = cloudLog.sources.filter((source) => source.deadlineStatus === "ON_TIME").length;
  const onTimeSourceLabel = onTimeSourceCount === 1 ? "source" : "sources";

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

      {cloudLog.sources.length === 0 ? (
        <p className="cron-field-hint">
          No FollowBrief fetching yet. Ask FollowBrief to fetch sources from your library to track
          their status here.
        </p>
      ) : (
        <ul className="cloud-source-list user-cloud-source-list">
          {cloudLog.sources.map((source) => {
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
      )}
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

function deadlineStatusClass(status: UserCloudFetchDeadlineStatus): string {
  if (status === "ON_TIME") return "is-ok";
  if (status === "MISSED" || status === "FAILED") return "is-failed";
  return "is-partial";
}
