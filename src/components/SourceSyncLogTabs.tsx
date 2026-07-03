"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import {
  FetchLogPanel,
  TaskRow,
  type FetchTaskLog,
  type FetchTaskProgress,
  type LibraryCronJobStatus,
  type LibraryFetchRunListItem,
} from "@/components/FetchLogPanel";
import { RelativeTime } from "@/components/RelativeTime";
import { SourceAvatar } from "@/components/SourceAvatar";
import { displayLanguagePreference } from "@/lib/language-preference";
import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import type { CloudFetchPostOutcome, CloudFetchRunLogTask } from "@/lib/cloud-fetch-run-log";
import type {
  UserCloudFetchLogData,
  UserCloudFetchSourceLog,
  UserCloudFetchDeadlineStatus,
} from "@/lib/user-cloud-fetch-log";

type SyncLogTab = "local" | "cloud";
type BuilderKind = "X" | "BLOG" | "PODCAST" | "WEBSITE";
type Tone = "ok" | "warn" | "fail" | "idle";

const EMPTY_LIVE_TASKS = new Map<string, FetchTaskProgress>();

export function SourceSyncLogTabs({
  actions,
  cloudLog,
  initialCronJob,
  initialCronRuns,
  initialHasMoreHistory,
  initialJobRuns,
  initialRuns,
  initialScheduledJobRuns,
  summaryLanguage,
}: {
  actions?: ReactNode;
  cloudLog: UserCloudFetchLogData;
  initialRuns: LibraryFetchRunListItem[];
  initialCronRuns: LibraryFetchRunListItem[];
  initialJobRuns?: AgentJobRunListItem[];
  initialScheduledJobRuns?: AgentJobRunListItem[];
  initialCronJob: LibraryCronJobStatus | null;
  initialHasMoreHistory?: boolean;
  summaryLanguage?: string | null;
}) {
  const [selected, setSelected] = useState<SyncLogTab>("local");

  return (
    <div className="source-sync-log-tabs">
      <div className="source-sync-log-tabs-head">
        <div
          aria-label="Fetch log type"
          className="fb-segmented-tabs source-sync-log-tablist"
          role="tablist"
        >
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
            Local Agent fetch log
          </button>
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
            Cloud fetch log
          </button>
        </div>
      </div>

      {selected === "local" ? (
        <section
          aria-labelledby="source-sync-local-log-tab"
          id="source-sync-local-log-panel"
          role="tabpanel"
        >
          <FetchLogPanel
            actionsPlacement="start"
            actions={actions}
            initialCronJob={initialCronJob}
            initialCronRuns={initialCronRuns}
            initialJobRuns={initialJobRuns}
            initialHasMoreHistory={initialHasMoreHistory}
            initialScheduledJobRuns={initialScheduledJobRuns}
            initialRuns={initialRuns}
            summaryLanguage={summaryLanguage}
          />
        </section>
      ) : (
        <section
          aria-labelledby="source-sync-cloud-log-tab"
          id="source-sync-cloud-log-panel"
          role="tabpanel"
        >
          <UserCloudFetchLogPanel cloudLog={cloudLog} />
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

  return (
    <section className="fb-panel digest-updates-panel user-cloud-fetch-log">
      <div className="source-fetch-overview">
        <dl className="fb-hub-digest-meta source-fetch-meta" aria-label="Cloud fetch details">
          <SourceFetchMetaItem
            label="Submitted sources"
            value={`${cloudLog.submittedSourceCount} ${sourceLabel}`}
          />
          <SourceFetchMetaItem
            label="Fetch frequency"
            value={frequencyLabel(cloudLog.frequency)}
          />
          <SourceFetchMetaItem
            label="Language"
            value={cloudLog.summaryLanguage ? displayLanguagePreference(cloudLog.summaryLanguage) : "N/A"}
          />
          <SourceFetchMetaItem
            label="Latest submission"
            value={<RelativeTime value={cloudLog.latestSubmittedAt} fallback="None yet" />}
          />
        </dl>
      </div>

      {cloudLog.sources.length === 0 ? (
        <p className="cron-field-hint">
          No cloud fetch submissions yet. Submit sources to Cloud from your source library to track
          their cloud fetch status here.
        </p>
      ) : (
        <ul className="cloud-source-list user-cloud-source-list">
          {cloudLog.sources.map((source) => {
            const isOpen = expanded === source.submissionId;
            return (
              <li key={source.submissionId} className="cloud-source-item">
                <button
                  type="button"
                  className="cloud-source-head"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : source.submissionId)}
                >
                  <SourceAvatar
                    className="builder-library-avatar"
                    imageSize={40}
                    source={avatarSource(source)}
                  />
                  <span className="builder-library-info">
                    <span className="builder-library-info-head">
                      <span className="builder-library-name">
                        {source.sourceName ?? source.cloudBuilderId}
                      </span>
                      <span className={`cloud-status-chip ${deadlineStatusClass(source.deadlineStatus)}`}>
                        {deadlineStatusLabel(source.deadlineStatus)}
                      </span>
                    </span>
                    <span className="builder-library-meta">
                      <span>{frequencyLabel(source.frequency)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        submitted <RelativeTime value={source.submittedAt} />
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        latest fetch{" "}
                        <RelativeTime
                          value={source.latestRunTask?.finishedAt ?? source.latestRunTask?.startedAt}
                          fallback="none yet"
                        />
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        deadline <RelativeTime value={source.mustSucceedBy} fallback="not scheduled" />
                      </span>
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="cloud-source-chevron"
                    data-open={isOpen ? "true" : undefined}
                  />
                </button>

                {isOpen ? <CloudSourceDetail source={source} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CloudSourceDetail({ source }: { source: UserCloudFetchSourceLog }) {
  const feedBuilderId = source.userBuilderId ?? source.cloudBuilderId;
  const mappedPosts = useMemo(
    () =>
      source.latestRunTask?.posts.map((post, index) =>
        postToFetchTaskLog(post, source, index),
      ) ?? [],
    [source],
  );

  return (
    <div className="cloud-source-detail user-cloud-source-detail">
      <p className="cloud-source-status-line">
        Last success <RelativeTime value={source.lastSuccessAt} fallback="-" /> · Last failure{" "}
        <RelativeTime value={source.lastFailureAt} fallback="-" />
        {source.lastFailureReason ? ` (${source.lastFailureReason})` : ""} · Next attempt{" "}
        <RelativeTime value={source.nextAttemptAt} fallback="-" />
      </p>

      <p className="cloud-source-detail-label">Latest cloud fetch log</p>
      {source.latestRunTask ? (
        <div className="user-cloud-run-task">
          <div className="cloud-fetch-log-task-facts" aria-label="Latest cloud source task details">
            <span>
              <strong>Status</strong>
              {source.latestRunTask.status}
            </span>
            <span>
              <strong>Started</strong>
              <RelativeTime value={source.latestRunTask.startedAt} fallback="-" />
            </span>
            <span>
              <strong>Finished</strong>
              <RelativeTime value={source.latestRunTask.finishedAt} fallback="Still running" />
            </span>
            <span>
              <strong>Posts</strong>
              {postOutcomeSummary(source.latestRunTask)}
            </span>
          </div>
          {source.latestRunTask.failureReason ? (
            <p className="cloud-fetch-log-task-error">{source.latestRunTask.failureReason}</p>
          ) : null}
          {mappedPosts.length > 0 ? (
            <ul className="sync-panel-run-card-candidate-list">
              {mappedPosts.map((task, index) => (
                <TaskRow
                  key={task.id ?? index}
                  groupTasks={mappedPosts}
                  liveTask={null}
                  liveTasks={EMPTY_LIVE_TASKS}
                  task={task}
                />
              ))}
            </ul>
          ) : (
            <CloudSourceLifecycle task={source.latestRunTask} />
          )}
        </div>
      ) : (
        <p className="cron-field-hint">No cloud fetch run has handled this source yet.</p>
      )}

      <p className="cloud-source-detail-label">Recent posts</p>
      <BuilderFeedItems
        builder={builderSummary(source, feedBuilderId)}
        builderId={feedBuilderId}
        isOpen
        listId={`cloud-user-posts-${source.submissionId}`}
        totalCount={source.postCount}
      />
    </div>
  );
}

function CloudSourceLifecycle({ task }: { task: CloudFetchRunLogTask }) {
  const status = task.status.toLowerCase();
  const failed = status === "failed";
  const running = status === "running";
  const noPosts = task.noGeneratedFetchTasks || task.plannedPosts === 0;
  const fetchTone: Tone = failed ? "fail" : running ? "warn" : "ok";
  const summarizeTone: Tone = noPosts ? "idle" : failed ? "fail" : task.pendingPosts > 0 ? "warn" : "ok";
  const syncTone: Tone = failed ? "fail" : running ? "warn" : "ok";
  const steps: Array<{
    children?: ReactNode;
    key: string;
    label: string;
    meta?: string;
    outcome: string;
    tone: Tone;
  }> = [
    {
      key: "planned",
      label: "Planned",
      outcome: "Source task",
      tone: "ok",
      children: (
        <dl className="sync-panel-task-fact-list">
          <FactRow label="Source type" value={task.sourceType ?? "-"} />
          <FactRow label="Language" value={displayLanguagePreference(task.summaryLanguage)} />
        </dl>
      ),
    },
    {
      key: "fetch",
      label: "Fetch",
      outcome: noPosts ? "No posts planned" : failed ? "Failed" : running ? "Running" : "Fetched",
      tone: fetchTone,
      meta: task.durationMs != null ? formatDuration(task.durationMs) : undefined,
      children: noPosts ? (
        <p className="sync-panel-task-note">
          Cloud worker fetched this source but generated 0 post tasks.
        </p>
      ) : undefined,
    },
    {
      key: "summarize",
      label: "Summarize",
      outcome: noPosts ? "Not reached" : failed ? "Failed" : task.pendingPosts > 0 ? "Pending" : "Completed",
      tone: summarizeTone,
      children: noPosts ? (
        <p className="sync-panel-task-note">
          No summary exists because there were no fetched posts to summarize or save.
        </p>
      ) : undefined,
    },
    {
      key: "sync",
      label: "Sync",
      outcome: failed ? "Failed" : running ? "Running" : "Synced",
      tone: syncTone,
      meta: postOutcomeSummary(task),
    },
  ];

  return (
    <ol aria-label="Cloud source fetch lifecycle" className="sync-panel-lifecycle user-cloud-source-lifecycle">
      {steps.map((step, index) => (
        <li key={step.key} className="sync-panel-lifecycle-item">
          <details className={`sync-panel-lifecycle-step is-${step.tone}`} open={Boolean(step.children)}>
            <summary className="sync-panel-lifecycle-summary">
              <span aria-hidden="true" className="sync-panel-lifecycle-dot" />
              <span className="sync-panel-lifecycle-copy">
                <span className="sync-panel-lifecycle-label">{step.label}</span>
                <span className="mono sync-panel-lifecycle-outcome">{step.outcome}</span>
              </span>
              {step.meta ? (
                <span className="mono sync-panel-lifecycle-meta">{step.meta}</span>
              ) : null}
            </summary>
            {step.children ? (
              <div className="sync-panel-lifecycle-detail">{step.children}</div>
            ) : null}
          </details>
          {index < steps.length - 1 ? <span aria-hidden="true" className="sync-panel-lifecycle-rail" /> : null}
        </li>
      ))}
    </ol>
  );
}

function FactRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="sync-panel-task-fact-row">
      <dt className="sync-panel-task-fact-label">{label}</dt>
      <dd className="sync-panel-task-fact-value">{value}</dd>
    </div>
  );
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

function avatarSource(source: UserCloudFetchSourceLog) {
  return {
    avatarDataUrl: source.avatarDataUrl,
    avatarUrl: source.avatarUrl,
    fetchUrl: source.fetchUrl,
    name: source.sourceName ?? source.cloudBuilderId,
    sourceType: source.sourceType ?? "website",
    sourceUrl: source.sourceUrl,
  };
}

function builderSummary(source: UserCloudFetchSourceLog, builderId: string) {
  return {
    id: builderId,
    entityId: source.entityId,
    name: source.sourceName ?? source.cloudBuilderId,
    kind: toBuilderKind(source.kind),
    sourceType: source.sourceType ?? "website",
    sourceUrl: source.sourceUrl,
    fetchUrl: source.fetchUrl,
  };
}

function toBuilderKind(kind: string | null): BuilderKind {
  if (kind === "X" || kind === "BLOG" || kind === "PODCAST" || kind === "WEBSITE") return kind;
  return "BLOG";
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

function postOutcomeSummary(task: NonNullable<UserCloudFetchSourceLog["latestRunTask"]>) {
  const parts = [`${task.syncedPosts}/${task.plannedPosts} synced`];
  if (task.pendingPosts > 0) parts.push(`${task.pendingPosts} pending`);
  if (task.skippedPosts > 0) parts.push(`${task.skippedPosts} skipped`);
  if (task.failedPosts > 0) parts.push(`${task.failedPosts} failed`);
  return parts.join(" · ");
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds - minutes * 60}s`;
}

function postToFetchTaskLog(
  post: CloudFetchPostOutcome,
  source: UserCloudFetchSourceLog,
  index: number,
): FetchTaskLog {
  return {
    id: post.id ?? `${source.submissionId}:${index}`,
    builder: source.sourceName,
    builderId: source.cloudBuilderId,
    sourceType: source.sourceType,
    contentStatus: post.contentStatus,
    agentWorkType: post.agentWorkType,
    title: post.title,
    url: post.url,
    status: post.status,
    failureReason: post.failureReason,
    fetchTool: post.fetchTool,
    agentRuntime: post.agentRuntime,
    agentModel: post.model,
    bodyChars: post.bodyChars,
    bodyWords: post.bodyWords,
    summaryChars: post.summaryChars,
    summaryWords: post.summaryWords,
    readMethod: post.readMethod,
    summaryMethod: post.summaryMethod,
    hubSharedReuse: post.hubSharedReuse,
    workerId: post.workerId,
  };
}
