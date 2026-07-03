// Serialization for the admin cloud library explorer: each cloud language
// library and its sources (one CloudSourceTask per cloud-owner Builder) with
// fetch status and counts. Recent posts are shown with the shared
// BuilderFeedItems component (which reads /api/builders/[id]/feed-items), so
// they are not serialized here. Pure mapping so it stays unit-testable without
// a database.

import {
  serializeCloudFetchRunTask,
  type CloudFetchRunLogTask,
} from "@/lib/cloud-fetch-run-log";

export type CloudLibrarySource = {
  builderId: string;
  entityId: string | null;
  kind: string | null;
  sourceName: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  status: string;
  effectiveFrequency: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  nextAttemptAt: string | null;
  consecutiveFailures: number;
  circuitBreakerUntil: string | null;
  submitterCount: number;
  postCount: number;
  latestRunTask: CloudFetchRunLogTask | null;
};

export type CloudLibraryOverview = {
  id: string;
  summaryLanguage: string;
  ownerEmail: string | null;
  enabled: boolean;
  sourceCount: number;
  sources: CloudLibrarySource[];
};

export type CloudSourceSubmitter = {
  email: string | null;
  name: string | null;
  frequency: string;
  submittedAt: string;
  active: boolean;
};

type CloudSourceTaskRow = {
  builderId: string;
  status: string;
  effectiveFrequency: string;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
  nextAttemptAt: Date | null;
  consecutiveFailures: number;
  circuitBreakerUntil: Date | null;
  runTasks?: CloudFetchRunTaskRow[];
  builder?: {
    entityId: string | null;
    kind: string | null;
    name: string | null;
    sourceType: string | null;
    sourceUrl: string | null;
    fetchUrl: string | null;
    avatarUrl: string | null;
    avatarDataUrl: string | null;
  } | null;
};

type DecimalLike = { toString(): string } | number;

type CloudFetchRunTaskRow = {
  id: string;
  builderId: string;
  summaryLanguage: string;
  status: string;
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  actualDurationSeconds: number | null;
  estimatedDurationSeconds: number | null;
  successProbabilitySnapshot: number | null;
  usageTokens: number | null;
  usageCostUsd: DecimalLike | null;
  failureReason: string | null;
  details: unknown;
  builder?: { name: string | null; sourceType: string | null } | null;
};

export function serializeCloudLibrarySource(
  task: CloudSourceTaskRow,
  counts: { submitterCount: number; postCount: number },
): CloudLibrarySource {
  return {
    builderId: task.builderId,
    entityId: task.builder?.entityId ?? null,
    kind: task.builder?.kind ?? null,
    sourceName: task.builder?.name ?? null,
    sourceType: task.builder?.sourceType ?? null,
    sourceUrl: task.builder?.sourceUrl ?? null,
    fetchUrl: task.builder?.fetchUrl ?? null,
    avatarUrl: task.builder?.avatarUrl ?? null,
    avatarDataUrl: task.builder?.avatarDataUrl ?? null,
    status: task.status,
    effectiveFrequency: task.effectiveFrequency,
    lastSuccessAt: task.lastSuccessAt ? task.lastSuccessAt.toISOString() : null,
    lastFailureAt: task.lastFailureAt ? task.lastFailureAt.toISOString() : null,
    lastFailureReason: task.lastFailureReason ?? null,
    nextAttemptAt: task.nextAttemptAt ? task.nextAttemptAt.toISOString() : null,
    consecutiveFailures: task.consecutiveFailures,
    circuitBreakerUntil: task.circuitBreakerUntil ? task.circuitBreakerUntil.toISOString() : null,
    submitterCount: counts.submitterCount,
    postCount: counts.postCount,
    latestRunTask: task.runTasks?.[0] ? serializeCloudFetchRunTask(task.runTasks[0]) : null,
  };
}

export function serializeCloudLibrary(
  library: { id: string; summaryLanguage: string; enabled: boolean; owner?: { email: string | null } | null },
  sources: CloudLibrarySource[],
): CloudLibraryOverview {
  return {
    id: library.id,
    summaryLanguage: library.summaryLanguage,
    ownerEmail: library.owner?.email ?? null,
    enabled: library.enabled,
    sourceCount: sources.length,
    sources,
  };
}

export function serializeCloudSourceSubmitter(submission: {
  frequency: string;
  submittedAt: Date;
  active: boolean;
  user?: { email: string | null; name: string | null } | null;
}): CloudSourceSubmitter {
  return {
    email: submission.user?.email ?? null,
    name: submission.user?.name ?? null,
    frequency: submission.frequency,
    submittedAt: submission.submittedAt.toISOString(),
    active: submission.active,
  };
}
