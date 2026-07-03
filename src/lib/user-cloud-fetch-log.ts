import {
  serializeCloudFetchRunTask,
  type CloudFetchRunLogTask,
} from "@/lib/cloud-fetch-run-log";
import type { CloudFetchFrequency } from "@/lib/cloud-source-contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

type DecimalLike = { toString(): string } | number;

export type UserCloudFetchDeadlineStatus =
  | "ON_TIME"
  | "RUNNING"
  | "MISSED"
  | "WAITING"
  | "FAILED";

export type UserCloudFetchSourceLog = {
  submissionId: string;
  userBuilderId: string | null;
  cloudBuilderId: string;
  entityId: string | null;
  kind: string | null;
  sourceName: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  frequency: CloudFetchFrequency;
  summaryLanguage: string;
  submittedAt: string;
  sourceStatus: string | null;
  effectiveFrequency: CloudFetchFrequency | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  nextAttemptAt: string | null;
  mustSucceedBy: string | null;
  consecutiveFailures: number | null;
  deadlineStatus: UserCloudFetchDeadlineStatus;
  latestRunTask: CloudFetchRunLogTask | null;
  postCount: number;
};

export type UserCloudFetchLogData = {
  sources: UserCloudFetchSourceLog[];
  submittedSourceCount: number;
  latestSubmittedAt: string | null;
  summaryLanguage: string | null;
  frequency: CloudFetchFrequency | null;
};

type BuilderRow = {
  id: string;
  entityId: string | null;
  kind: string | null;
  name: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  _count?: { feedItems: number } | null;
};

type CloudSourceTaskRow = {
  id: string;
  builderId: string;
  status: string;
  effectiveFrequency: CloudFetchFrequency;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
  nextAttemptAt: Date | null;
  mustSucceedBy: Date | null;
  consecutiveFailures: number;
  runTasks: CloudFetchRunTaskRow[];
};

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

export type UserCloudFetchSubmissionRow = {
  id: string;
  userBuilderId: string | null;
  cloudBuilderId: string;
  summaryLanguage: string;
  frequency: CloudFetchFrequency;
  submittedAt: Date;
  userBuilder?: BuilderRow | null;
  cloudBuilder: BuilderRow & {
    cloudSourceTask?: CloudSourceTaskRow | null;
  };
};

export function serializeUserCloudFetchLog(
  submissions: UserCloudFetchSubmissionRow[],
  now = new Date(),
): UserCloudFetchLogData {
  const sources = submissions.map((submission) =>
    serializeUserCloudFetchSource(submission, now),
  );
  const latestSubmittedAt = submissions.reduce<Date | null>((latest, submission) => {
    if (!latest || submission.submittedAt > latest) return submission.submittedAt;
    return latest;
  }, null);
  const summaryLanguage = submissions[0]?.summaryLanguage ?? null;
  return {
    sources,
    submittedSourceCount: sources.length,
    latestSubmittedAt: latestSubmittedAt ? latestSubmittedAt.toISOString() : null,
    summaryLanguage,
    frequency: effectiveFrequency(submissions.map((submission) => submission.frequency)),
  };
}

function serializeUserCloudFetchSource(
  submission: UserCloudFetchSubmissionRow,
  now: Date,
): UserCloudFetchSourceLog {
  const source = submission.userBuilder ?? submission.cloudBuilder;
  const task = submission.cloudBuilder.cloudSourceTask ?? null;
  const latestRunTask = task?.runTasks[0] ?? null;
  const latestRunTaskLog = latestRunTask ? serializeCloudFetchRunTask(latestRunTask) : null;
  const latestLegacyFailureIsSkipped =
    latestRunTask &&
    latestRunTaskLog?.status.toLowerCase() === "succeeded" &&
    latestRunTask.status.toLowerCase() === "failed" &&
    latestRunTaskLog.failedPosts === 0 &&
    latestRunTaskLog.skippedPosts > 0;
  const effectiveLastSuccessAt =
    task?.lastSuccessAt ?? (latestLegacyFailureIsSkipped ? latestRunTask.finishedAt : null);
  const lastFailureAt = latestLegacyFailureIsSkipped ? null : task?.lastFailureAt ?? null;
  const lastFailureReason = latestLegacyFailureIsSkipped ? null : task?.lastFailureReason ?? null;
  return {
    submissionId: submission.id,
    userBuilderId: submission.userBuilderId,
    cloudBuilderId: submission.cloudBuilderId,
    entityId: source.entityId,
    kind: source.kind,
    sourceName: source.name,
    sourceType: source.sourceType,
    sourceUrl: source.sourceUrl,
    fetchUrl: source.fetchUrl,
    avatarUrl: source.avatarUrl,
    avatarDataUrl: source.avatarDataUrl,
    frequency: submission.frequency,
    summaryLanguage: submission.summaryLanguage,
    submittedAt: submission.submittedAt.toISOString(),
    sourceStatus: task?.status ?? null,
    effectiveFrequency: task?.effectiveFrequency ?? null,
    lastSuccessAt: effectiveLastSuccessAt ? effectiveLastSuccessAt.toISOString() : null,
    lastFailureAt: lastFailureAt ? lastFailureAt.toISOString() : null,
    lastFailureReason,
    nextAttemptAt: task?.nextAttemptAt ? task.nextAttemptAt.toISOString() : null,
    mustSucceedBy: task?.mustSucceedBy ? task.mustSucceedBy.toISOString() : null,
    consecutiveFailures: latestLegacyFailureIsSkipped ? 0 : task?.consecutiveFailures ?? null,
    deadlineStatus: deadlineStatus({
      frequency: task?.effectiveFrequency ?? submission.frequency,
      lastSuccessAt: effectiveLastSuccessAt,
      latestRunTask: latestRunTaskLog,
      mustSucceedBy: task?.mustSucceedBy ?? null,
      now,
    }),
    latestRunTask: latestRunTaskLog,
    postCount: submission.cloudBuilder._count?.feedItems ?? 0,
  };
}

function effectiveFrequency(frequencies: CloudFetchFrequency[]): CloudFetchFrequency | null {
  if (frequencies.includes("DAILY")) return "DAILY";
  if (frequencies.includes("WEEKLY")) return "WEEKLY";
  return null;
}

function deadlineStatus({
  frequency,
  lastSuccessAt,
  latestRunTask,
  mustSucceedBy,
  now,
}: {
  frequency: CloudFetchFrequency;
  lastSuccessAt: Date | null;
  latestRunTask: CloudFetchRunLogTask | null;
  mustSucceedBy: Date | null;
  now: Date;
}): UserCloudFetchDeadlineStatus {
  const latestStatus = latestRunTask?.status.toLowerCase() ?? null;
  if (latestStatus === "running") return "RUNNING";
  if (latestStatus === "failed") return "FAILED";
  if (!mustSucceedBy) return lastSuccessAt ? "ON_TIME" : "WAITING";

  const windowStart = new Date(mustSucceedBy.getTime() - intervalMs(frequency));
  if (
    lastSuccessAt &&
    lastSuccessAt.getTime() >= windowStart.getTime() &&
    lastSuccessAt.getTime() <= mustSucceedBy.getTime()
  ) {
    return "ON_TIME";
  }
  if (now.getTime() > mustSucceedBy.getTime()) return "MISSED";
  return "WAITING";
}

function intervalMs(frequency: CloudFetchFrequency) {
  return frequency === "DAILY" ? DAY_MS : 7 * DAY_MS;
}
