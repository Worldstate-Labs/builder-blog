// Serialization for the admin cloud library explorer: each cloud language
// library, its sources (one CloudSourceTask per cloud-owner Builder) with fetch
// status and counts, and the per-source submitters and recent posts. Pure
// mapping so it stays unit-testable without a database.

const SUMMARY_EXCERPT_MAX = 160;

export type CloudLibrarySource = {
  builderId: string;
  sourceName: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
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

export type CloudSourcePost = {
  id: string;
  title: string | null;
  url: string;
  publishedAt: string | null;
  summaryExcerpt: string | null;
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
  builder?: { name: string | null; sourceType: string | null; sourceUrl: string | null } | null;
};

export function serializeCloudLibrarySource(
  task: CloudSourceTaskRow,
  counts: { submitterCount: number; postCount: number },
): CloudLibrarySource {
  return {
    builderId: task.builderId,
    sourceName: task.builder?.name ?? null,
    sourceType: task.builder?.sourceType ?? null,
    sourceUrl: task.builder?.sourceUrl ?? null,
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

export function serializeCloudSourcePost(item: {
  id: string;
  title: string | null;
  url: string;
  publishedAt: Date | null;
  summary: string | null;
}): CloudSourcePost {
  return {
    id: item.id,
    title: item.title ?? null,
    url: item.url,
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    summaryExcerpt: excerpt(item.summary),
  };
}

function excerpt(summary: string | null): string | null {
  if (!summary) return null;
  const trimmed = summary.trim();
  if (trimmed.length <= SUMMARY_EXCERPT_MAX) return trimmed;
  return `${trimmed.slice(0, SUMMARY_EXCERPT_MAX)}…`;
}
