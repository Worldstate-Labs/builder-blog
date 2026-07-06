export type CloudFetchOutcomePost = {
  status?: string | null;
  failureReason?: string | null;
  reason?: string | null;
};

export type CloudFetchOutcomeSummary = {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "RUNNING";
  plannedPosts: number;
  syncedPosts: number;
  skippedPosts: number;
  failedPosts: number;
  pendingPosts: number;
  failureReason: string | null;
};

export function deriveCloudFetchOutcomeSummary({
  failureReason,
  failedPosts = 0,
  plannedPosts,
  posts = [],
  status,
  syncedPosts = 0,
}: {
  failureReason?: string | null;
  failedPosts?: number | null;
  plannedPosts: number;
  posts?: CloudFetchOutcomePost[];
  status?: string | null;
  syncedPosts?: number | null;
}): CloudFetchOutcomeSummary {
  const planned = nonNegativeInteger(plannedPosts);
  const postSynced = countByStatus(posts, isSyncedPostStatus);
  const synced = Math.min(planned, Math.max(nonNegativeInteger(syncedPosts), postSynced));
  const skipped = countByStatus(posts, isSkippedPostStatus);
  const failedFromPosts = countByStatus(posts, isFailedPostStatus);
  const rawFailed = nonNegativeInteger(failedPosts);
  const failedOutsidePostedOutcomes = Math.max(0, rawFailed - failedFromPosts - skipped);
  const failed = Math.min(planned, failedFromPosts + failedOutsidePostedOutcomes);
  const pending = Math.max(0, planned - synced - skipped - failed);
  const normalizedStatus = normalizeSourceStatus({
    failedPosts: failed,
    pendingPosts: pending,
    plannedPosts: planned,
    rawStatus: status,
    skippedPosts: skipped,
    syncedPosts: synced,
  });

  return {
    status: normalizedStatus,
    plannedPosts: planned,
    syncedPosts: synced,
    skippedPosts: skipped,
    failedPosts: failed,
    pendingPosts: pending,
    failureReason: failed > 0 ? firstFailureReason(posts) ?? cleanString(failureReason) : null,
  };
}

function normalizeSourceStatus({
  failedPosts,
  pendingPosts,
  plannedPosts,
  rawStatus,
  skippedPosts,
  syncedPosts,
}: {
  failedPosts: number;
  pendingPosts: number;
  plannedPosts: number;
  rawStatus?: string | null;
  skippedPosts: number;
  syncedPosts: number;
}): CloudFetchOutcomeSummary["status"] {
  const normalized = String(rawStatus ?? "").toLowerCase();
  if (normalized === "running" && (pendingPosts > 0 || plannedPosts === 0)) return "RUNNING";
  if (failedPosts > 0) {
    return syncedPosts === 0 && skippedPosts === 0 && failedPosts >= plannedPosts
      ? "FAILED"
      : "PARTIAL";
  }
  if (pendingPosts > 0) return normalized === "running" ? "RUNNING" : "PARTIAL";
  return "SUCCEEDED";
}

function countByStatus(
  posts: CloudFetchOutcomePost[],
  predicate: (status: string | null) => boolean,
): number {
  return posts.reduce((sum, post) => sum + (predicate(normalizePostStatus(post.status)) ? 1 : 0), 0);
}

function normalizePostStatus(status: string | null | undefined): string | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized || null;
}

function isSyncedPostStatus(status: string | null): boolean {
  return status === "synced";
}

function isSkippedPostStatus(status: string | null): boolean {
  return status === "skipped";
}

function isFailedPostStatus(status: string | null): boolean {
  return status === "failed" || status === "blocked" || status === "action_needed";
}

function firstFailureReason(posts: CloudFetchOutcomePost[]): string | null {
  for (const post of posts) {
    if (!isFailedPostStatus(normalizePostStatus(post.status))) continue;
    const reason = cleanString(post.failureReason ?? post.reason);
    if (reason) return reason;
  }
  return null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}
