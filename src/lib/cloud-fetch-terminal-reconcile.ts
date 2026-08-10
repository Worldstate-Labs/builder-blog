import { createHash } from "node:crypto";

import type { BuilderFeedSyncItemResult } from "@/lib/builder-feed-sync";
import { CloudFetchConflictError } from "@/lib/cloud-fetch-conflict";

type JsonRecord = Record<string, unknown>;

type ClientTaskResult = {
  cloudSourceTaskId: string;
  status: "succeeded" | "partial" | "failed" | "deferred";
  plannedPosts: number;
  syncedPosts: number;
  failedPosts: number;
  actualDurationSeconds?: number | null;
  failureReason?: string | null;
  usageTokens?: number | null;
  usageCostUsd?: number | null;
  details: JsonRecord;
};

type SubmittedItemFacts = {
  fetchTaskId: string;
  title?: string | null;
  url?: string | null;
  body?: string | null;
  summary?: string | null;
  headline?: string | null;
};

type TerminalTaskOutcome = {
  fetchTaskId: string;
  status: "skipped" | "failed" | "blocked" | "action_needed";
  reason: string;
};

type PlanPost = JsonRecord & {
  postTaskId?: unknown;
  title?: unknown;
  url?: unknown;
  workerId?: unknown;
};

export type CloudFetchTerminalPost = JsonRecord & {
  id: string;
  title: string | null;
  url: string | null;
  workerId: string | null;
  status: "synced" | "skipped" | "failed" | "blocked" | "action_needed";
  failureReason: string | null;
  completedStage: "summarize" | null;
  bodyChars: number | null;
  bodyWords: number | null;
  summaryChars: number | null;
  summaryWords: number | null;
  headlineChars: number | null;
  headlineWords: number | null;
};

export class CloudSourceResultIncompleteError extends Error {
  readonly code = "cloud_source_result_incomplete";
  readonly statusCode = 409;
  readonly retryable = true;

  constructor(
    message: string,
    readonly missingPostTaskIds: string[] = [],
    readonly unexpectedPostTaskIds: string[] = [],
    readonly duplicatePostTaskIds: string[] = [],
  ) {
    super(message);
    this.name = "CloudSourceResultIncompleteError";
  }
}

export function reconcileCloudFetchTerminalResult(params: {
  cloudSourceTaskId: string;
  executionPlanPosts: Record<string, PlanPost>;
  clientResult: ClientTaskResult;
  submittedItems: SubmittedItemFacts[];
  itemResults: BuilderFeedSyncItemResult[];
  taskOutcomes: TerminalTaskOutcome[];
}) {
  const expectedPosts = normalizedPlanPosts(params.executionPlanPosts);
  const submittedById = uniqueEvidenceMap(
    params.submittedItems,
    (item) => item.fetchTaskId,
    "submitted item",
  );
  const outcomeById = uniqueEvidenceMap(
    params.taskOutcomes,
    (outcome) => outcome.fetchTaskId,
    "task outcome",
  );
  const itemResultById = uniqueEvidenceMap(
    params.itemResults,
    (item) => item.fetchTaskId,
    "feed sync result",
  );
  validateTerminalCoverage({
    expectedPostTaskIds: expectedPosts.map(([id]) => id),
    submittedPostTaskIds: [...submittedById.keys()],
    outcomePostTaskIds: [...outcomeById.keys()],
  });

  const clientPosts = clientPostMap(params.clientResult.details.posts);
  const posts = expectedPosts.map(([postTaskId, planPost]) => {
    const submitted = submittedById.get(postTaskId);
    const itemResult = itemResultById.get(postTaskId);
    const outcome = outcomeById.get(postTaskId);
    const clientPost = clientPosts.get(postTaskId) ?? {};
    const identity = {
      id: postTaskId,
      title: stringValue(submitted?.title) ?? stringValue(clientPost.title) ?? stringValue(planPost.title),
      url: stringValue(submitted?.url) ?? stringValue(clientPost.url) ?? stringValue(planPost.url),
      workerId: stringValue(clientPost.workerId) ?? stringValue(planPost.workerId),
    };

    if (submitted && itemResult?.status === "synced") {
      const body = textStats(submitted.body);
      const summary = textStats(submitted.summary);
      const headline = textStats(submitted.headline);
      return {
        ...terminalEvidence(clientPost),
        ...identity,
        status: "synced" as const,
        failureReason: null,
        completedStage: "summarize" as const,
        bodyChars: body.chars,
        bodyWords: body.words,
        summaryChars: summary.chars,
        summaryWords: summary.words,
        headlineChars: headline.chars,
        headlineWords: headline.words,
      };
    }

    if (submitted) {
      return {
        ...terminalEvidence(clientPost),
        ...identity,
        status: "failed" as const,
        failureReason: itemResult?.reason?.trim() || "cloud_feed_sync_rejected",
        completedStage: completedStage(clientPost),
        ...clientTextStats(clientPost),
      };
    }

    const status = outcome?.status ?? "failed";
    return {
      ...terminalEvidence(clientPost),
      ...identity,
      status,
      failureReason: outcome?.reason?.trim() || "cloud_source_terminal_outcome_missing",
      completedStage: completedStage(clientPost),
      ...clientTextStats(clientPost),
    };
  });

  const syncedPosts = posts.filter((post) => post.status === "synced").length;
  const skippedPosts = posts.filter((post) => post.status === "skipped").length;
  const deferredPosts = posts.filter((post) =>
    post.status === "blocked" && post.failureReason === "asr_capability_missing",
  ).length;
  const failedPosts = posts.filter((post) =>
    post.status === "failed" ||
    post.status === "action_needed" ||
    (post.status === "blocked" && post.failureReason !== "asr_capability_missing"),
  ).length;
  // Keep the source on the short capability-retry cadence even when other posts
  // synced. Those posts are idempotently deduplicated when the deferred media is retried.
  const status = posts.length === 0
    ? params.clientResult.status
    : deferredPosts > 0 && failedPosts === 0
      ? "deferred"
      : failedPosts === 0
      ? "succeeded"
      : syncedPosts > 0 || skippedPosts > 0
        ? "partial"
        : "failed";
  const failureReason = status === "succeeded"
    ? null
    : posts.find((post) => post.failureReason)?.failureReason
      ?? params.clientResult.failureReason?.trim()
      ?? "cloud_sync_failed";
  const requestDigest = cloudFetchTerminalRequestDigest({
    cloudSourceTaskId: params.cloudSourceTaskId,
    expectedPostTaskIds: expectedPosts.map(([id]) => id),
    submittedItems: params.submittedItems,
    taskOutcomes: params.taskOutcomes,
  });

  return {
    cloudSourceTaskId: params.cloudSourceTaskId,
    status,
    plannedPosts: posts.length,
    syncedPosts,
    skippedPosts,
    deferredPosts,
    failedPosts,
    actualDurationSeconds: params.clientResult.actualDurationSeconds ?? null,
    failureReason,
    usageTokens: params.clientResult.usageTokens ?? null,
    usageCostUsd: params.clientResult.usageCostUsd ?? null,
    requestDigest,
    details: {
      ...params.clientResult.details,
      requestDigest,
      fetchTaskIds: posts.map((post) => post.id),
      posts,
    },
  };
}

export function validateTerminalCoverage(params: {
  expectedPostTaskIds: string[];
  submittedPostTaskIds: string[];
  outcomePostTaskIds: string[];
}) {
  const expected = new Set(params.expectedPostTaskIds.map(normalizedId).filter(Boolean));
  const submitted = params.submittedPostTaskIds.map(normalizedId).filter(Boolean);
  const outcomes = params.outcomePostTaskIds.map(normalizedId).filter(Boolean);
  const counts = new Map<string, number>();
  for (const id of [...submitted, ...outcomes]) counts.set(id, (counts.get(id) ?? 0) + 1);
  const missing = [...expected].filter((id) => !counts.has(id)).sort();
  const unexpected = [...counts.keys()].filter((id) => !expected.has(id)).sort();
  const duplicate = [...counts].filter(([, count]) => count > 1).map(([id]) => id).sort();
  if (missing.length === 0 && unexpected.length === 0 && duplicate.length === 0) return;
  throw new CloudSourceResultIncompleteError(
    [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : "",
      duplicate.length ? `duplicate: ${duplicate.join(", ")}` : "",
    ].filter(Boolean).join("; "),
    missing,
    unexpected,
    duplicate,
  );
}

export function cloudFetchTerminalRequestDigest(params: {
  cloudSourceTaskId: string;
  expectedPostTaskIds: string[];
  submittedItems: SubmittedItemFacts[];
  taskOutcomes: TerminalTaskOutcome[];
}) {
  const evidence = {
    cloudSourceTaskId: params.cloudSourceTaskId,
    expectedPostTaskIds: [...params.expectedPostTaskIds].map(normalizedId).filter(Boolean).sort(),
    submittedItems: params.submittedItems
      .map((item) => ({
        fetchTaskId: normalizedId(item.fetchTaskId),
        title: stringValue(item.title),
        url: stringValue(item.url),
        body: stringValue(item.body),
        summary: stringValue(item.summary),
        headline: stringValue(item.headline),
      }))
      .sort((a, b) => a.fetchTaskId.localeCompare(b.fetchTaskId)),
    taskOutcomes: params.taskOutcomes
      .map((outcome) => ({
        fetchTaskId: normalizedId(outcome.fetchTaskId),
        status: outcome.status,
        reason: outcome.reason.trim(),
      }))
      .sort((a, b) => a.fetchTaskId.localeCompare(b.fetchTaskId)),
  };
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export function classifyCloudFetchTerminalWrite(params: {
  status: string;
  storedRequestDigest: string | null;
  requestDigest: string;
}) {
  if (params.status === "RUNNING") return { action: "finalize" as const };
  if (
    params.storedRequestDigest
    && params.storedRequestDigest === params.requestDigest
  ) {
    return { action: "replay" as const };
  }
  throw new CloudFetchConflictError(
    "cloud_source_already_finalized",
    "The cloud source was already finalized with different evidence.",
    false,
  );
}

function normalizedPlanPosts(posts: Record<string, PlanPost>) {
  return Object.entries(posts)
    .map(([key, post]) => [normalizedId(post?.postTaskId) || normalizedId(key), post] as const)
    .filter(([id]) => Boolean(id));
}

function uniqueEvidenceMap<T>(items: T[], idFor: (item: T) => string, label: string) {
  const map = new Map<string, T>();
  for (const item of items) {
    const id = normalizedId(idFor(item));
    if (!id) continue;
    if (map.has(id)) {
      throw new CloudSourceResultIncompleteError(
        `duplicate ${label}: ${id}`,
        [],
        [],
        [id],
      );
    }
    map.set(id, item);
  }
  return map;
}

function clientPostMap(value: unknown) {
  const map = new Map<string, JsonRecord>();
  if (!Array.isArray(value)) return map;
  for (const raw of value) {
    const post = record(raw);
    const id = normalizedId(post?.id ?? post?.postTaskId ?? post?.fetchTaskId);
    if (id && post) map.set(id, post);
  }
  return map;
}

function terminalEvidence(post: JsonRecord) {
  const allowed = [
    "contentStatus",
    "agentWorkType",
    "fetchTool",
    "agentRuntime",
    "agentModel",
    "model",
    "readMethod",
    "summaryMethod",
    "hubSharedReuse",
    "estimatedWorkSeconds",
    "executionBudgetSeconds",
    "workloadClass",
    "budgetReason",
    "deadlineState",
    "mediaDurationSeconds",
    "plannedExtractionMethod",
    "mustSucceedBy",
    "estimateEvidence",
    "evidence",
  ];
  return Object.fromEntries(allowed.flatMap((key) => post[key] === undefined ? [] : [[key, post[key]]]));
}

function clientTextStats(post: JsonRecord) {
  return {
    bodyChars: numberValue(post.bodyChars),
    bodyWords: numberValue(post.bodyWords),
    summaryChars: numberValue(post.summaryChars),
    summaryWords: numberValue(post.summaryWords),
    headlineChars: numberValue(post.headlineChars),
    headlineWords: numberValue(post.headlineWords),
  };
}

function completedStage(post: JsonRecord): "summarize" | null {
  return post.completedStage === "summarize" ? "summarize" : null;
}

function textStats(value: unknown) {
  const text = stringValue(value) ?? "";
  return {
    chars: text.length || null,
    words: text ? text.split(/\s+/u).filter(Boolean).length : null,
  };
}

function normalizedId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}
