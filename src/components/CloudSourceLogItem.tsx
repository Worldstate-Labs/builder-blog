"use client";

import { useMemo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import {
  TaskRow,
  type FetchTaskLog,
  type FetchTaskProgress,
} from "@/components/FetchLogPanel";
import { RelativeTime } from "@/components/RelativeTime";
import { SourceAvatar } from "@/components/SourceAvatar";
import { displayLanguagePreference } from "@/lib/language-preference";
import type { CloudFetchPostOutcome, CloudFetchRunLogTask } from "@/lib/cloud-fetch-run-log";

type BuilderKind = "X" | "BLOG" | "PODCAST" | "WEBSITE";
type Tone = "ok" | "warn" | "fail" | "idle";

const EMPTY_LIVE_TASKS = new Map<string, FetchTaskProgress>();

export type CloudSourceLogSubmitter = {
  email: string | null;
  name: string | null;
  frequency: string;
};

export type CloudSourceLogSource = {
  id: string;
  cloudBuilderId: string;
  feedBuilderId: string;
  entityId: string | null;
  kind: string | null;
  sourceName: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  postCount: number;
  statusChipLabel: string;
  statusChipClassName: string;
  metaItems: ReactNode[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  nextAttemptAt: string | null;
  circuitBreakerUntil?: string | null;
  latestRunTask: CloudFetchRunLogTask | null;
  submitterCount?: number;
  submitters?: CloudSourceLogSubmitter[];
};

export function CloudSourceLogItem({
  isOpen,
  onToggle,
  showSubmitters = true,
  source,
}: {
  isOpen: boolean;
  onToggle: () => void;
  showSubmitters?: boolean;
  source: CloudSourceLogSource;
}) {
  return (
    <li className="cloud-source-item">
      <button
        type="button"
        className="cloud-source-head"
        aria-expanded={isOpen}
        onClick={onToggle}
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
            <span className={`cloud-status-chip ${source.statusChipClassName}`}>
              {source.statusChipLabel}
            </span>
          </span>
          <span className="builder-library-meta">
            {source.metaItems.map((item, index) => (
              <span key={index}>
                {index > 0 ? <span aria-hidden="true"> · </span> : null}
                {item}
              </span>
            ))}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="cloud-source-chevron"
          data-open={isOpen ? "true" : undefined}
        />
      </button>

      {isOpen ? (
        <CloudSourceLogDetail source={source} showSubmitters={showSubmitters} />
      ) : null}
    </li>
  );
}

function CloudSourceLogDetail({
  showSubmitters,
  source,
}: {
  showSubmitters: boolean;
  source: CloudSourceLogSource;
}) {
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
        {source.circuitBreakerUntil ? (
          <>
            {" · "}circuit-broken until{" "}
            <RelativeTime value={source.circuitBreakerUntil} fallback="-" />
          </>
        ) : null}
      </p>

      {showSubmitters ? <Submitters source={source} /> : null}

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
        builder={builderSummary(source)}
        builderId={source.feedBuilderId}
        isOpen
        listId={`cloud-posts-${source.id}`}
        totalCount={source.postCount}
      />
    </div>
  );
}

function Submitters({ source }: { source: CloudSourceLogSource }) {
  const submitters = source.submitters;
  const count = submitters?.length ?? source.submitterCount ?? 0;
  return (
    <>
      <p className="cloud-source-detail-label">Submitters ({count})</p>
      {submitters == null ? null : submitters.length === 0 ? (
        <p className="cron-field-hint">No active submitters.</p>
      ) : (
        <ul className="cloud-source-submitters">
          {submitters.map((submitter, index) => (
            <li key={submitter.email ?? `submitter-${index}`}>
              <span className="cloud-source-submitter-id">
                {submitter.email ?? submitter.name ?? "unknown"}
              </span>
              <span className="cloud-source-submitter-freq">
                {frequencyLabel(submitter.frequency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CloudSourceLifecycle({ task }: { task: CloudFetchRunLogTask }) {
  const status = task.status.toLowerCase();
  const failed = status === "failed";
  const running = status === "running";
  const stillAwaitingPostResults = running && task.plannedPosts === 0 && !task.noGeneratedFetchTasks;
  const noPosts = task.noGeneratedFetchTasks || (!running && task.plannedPosts === 0);
  const fetchTone: Tone = failed ? "fail" : running ? "warn" : "ok";
  const summarizeTone: Tone = noPosts
    ? "idle"
    : failed
      ? "fail"
      : running
        ? "warn"
        : task.pendingPosts > 0
          ? "warn"
          : "ok";
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
      outcome: noPosts
        ? "Not reached"
        : failed
          ? "Failed"
          : running
            ? "Pending"
            : task.pendingPosts > 0
              ? "Pending"
              : "Completed",
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
      meta: stillAwaitingPostResults ? "Waiting for results" : postOutcomeSummary(task),
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

function avatarSource(source: CloudSourceLogSource) {
  return {
    avatarDataUrl: source.avatarDataUrl,
    avatarUrl: source.avatarUrl,
    fetchUrl: source.fetchUrl,
    name: source.sourceName ?? source.cloudBuilderId,
    sourceType: source.sourceType ?? "website",
    sourceUrl: source.sourceUrl,
  };
}

function builderSummary(source: CloudSourceLogSource) {
  return {
    id: source.feedBuilderId,
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

function postOutcomeSummary(task: CloudFetchRunLogTask) {
  if (task.status.toLowerCase() === "running" && task.plannedPosts === 0 && !task.noGeneratedFetchTasks) {
    return "Waiting for results";
  }
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
  source: CloudSourceLogSource,
  index: number,
): FetchTaskLog {
  return {
    id: post.id ?? `${source.id}:${index}`,
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
