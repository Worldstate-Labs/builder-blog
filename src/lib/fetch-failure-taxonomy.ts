export type FetchFailureCategory =
  | "content"
  | "summary"
  | "sync"
  | "runtime"
  | "worker"
  | "discovery"
  | "internal"
  | "unknown";

export type FetchFailureStage = "read" | "summarize" | "sync" | "runtime" | "internal" | "unknown";

type FetchFailureVisibility = "user" | "hidden";

type FetchFailureDefinition = {
  category: FetchFailureCategory;
  stage: FetchFailureStage;
  userMessage: string;
  operatorMessage: string;
  retryable: boolean;
  visibility?: FetchFailureVisibility;
  contentFailure?: boolean;
  notCompleted?: boolean;
};

export type FetchFailureInfo = FetchFailureDefinition & {
  code: string;
  known: boolean;
  visibility: FetchFailureVisibility;
};

const FETCH_FAILURE_TAXONOMY = {
  summary_missing: {
    category: "summary",
    stage: "summarize",
    userMessage: "No summary was produced",
    operatorMessage: "The worker returned or synced a post without a persisted summary.",
    retryable: true,
  },
  headline_missing: {
    category: "summary",
    stage: "summarize",
    userMessage: "No headline was produced",
    operatorMessage: "The worker returned or synced a post without a persisted headline.",
    retryable: true,
  },
  headline_too_long: {
    category: "summary",
    stage: "summarize",
    userMessage: "The headline was too long",
    operatorMessage: "The generated post headline exceeded the 20-word or character limit.",
    retryable: true,
  },
  headline_duplicates_title: {
    category: "summary",
    stage: "summarize",
    userMessage: "The headline duplicated the title",
    operatorMessage: "The generated post headline was too close to the original title.",
    retryable: true,
  },
  headline_duplicates_summary: {
    category: "summary",
    stage: "summarize",
    userMessage: "The headline duplicated the summary",
    operatorMessage: "The generated post headline duplicated the full summary.",
    retryable: true,
  },
  not_summarized: {
    category: "summary",
    stage: "summarize",
    userMessage: "Read but no summary was created",
    operatorMessage: "Primary content was available, but the summary stage did not produce usable output.",
    retryable: true,
  },
  not_synced: {
    category: "sync",
    stage: "sync",
    userMessage: "Not synced",
    operatorMessage: "The post did not reach the sync endpoint with a successful result.",
    retryable: true,
  },
  content_missing: {
    category: "content",
    stage: "read",
    userMessage: "No readable content was found",
    operatorMessage: "The fetch stage found no usable primary body text.",
    retryable: false,
    contentFailure: true,
  },
  no_primary_content: {
    category: "content",
    stage: "read",
    userMessage: "No primary content",
    operatorMessage: "The source did not provide primary content that met the fetch contract.",
    retryable: false,
    contentFailure: true,
  },
  content_too_short: {
    category: "content",
    stage: "read",
    userMessage: "The readable content was too short",
    operatorMessage: "The extracted primary content did not meet the minimum quality threshold.",
    retryable: false,
    contentFailure: true,
  },
  content_validation_failed: {
    category: "content",
    stage: "read",
    userMessage: "Fetched content failed validation",
    operatorMessage: "The fetch stage produced content, but validation rejected it.",
    retryable: false,
    contentFailure: true,
  },
  primary_content_unavailable: {
    category: "content",
    stage: "read",
    userMessage: "Primary content was unavailable",
    operatorMessage: "The worker exhausted allowed primary-source extraction methods.",
    retryable: false,
    contentFailure: true,
  },
  workload_exceeds_max_budget: {
    category: "content",
    stage: "read",
    userMessage: "This source exceeded the maximum supported extraction workload",
    operatorMessage: "The planned extraction workload exceeded the supported four-hour execution ceiling, so the run stopped before attempting extraction.",
    retryable: false,
    contentFailure: true,
  },
  extraction_exceeds_shard_timeout: {
    category: "content",
    stage: "read",
    userMessage: "This source could not finish extraction within the current shard budget",
    operatorMessage: "The extraction plan could not safely complete within the shard's remaining execution budget, so the run stopped before starting extraction.",
    retryable: true,
    contentFailure: true,
  },
  runtime_auth_failed: {
    category: "runtime",
    stage: "runtime",
    userMessage: "Agent authentication failed before this post could be fetched",
    operatorMessage: "The local runtime could not authenticate before or during worker execution.",
    retryable: true,
    notCompleted: true,
  },
  runtime_timeout: {
    category: "runtime",
    stage: "runtime",
    userMessage: "Local Agent runtime timed out before this post finished",
    operatorMessage: "The whole local runtime exceeded its timeout before this post reached a terminal result.",
    retryable: true,
    notCompleted: true,
  },
  runtime_timeout_no_fetch_result: {
    category: "runtime",
    stage: "runtime",
    userMessage: "Local Agent runtime timed out before source planning finished",
    operatorMessage: "The local runtime timed out before it wrote the library fetch plan.",
    retryable: true,
    notCompleted: true,
  },
  runtime_timeout_flush_failed: {
    category: "runtime",
    stage: "runtime",
    userMessage: "Local Agent runtime timed out and could not sync all terminal results",
    operatorMessage: "The timeout cleanup tried to sync terminal task outcomes but at least one slice failed.",
    retryable: true,
    notCompleted: true,
  },
  runtime_timeout_flush_finished: {
    category: "runtime",
    stage: "runtime",
    userMessage: "Local Agent runtime timed out after syncing terminal fetch results",
    operatorMessage: "The timeout cleanup synced terminal outcomes for the remaining planned post tasks.",
    retryable: true,
    notCompleted: true,
  },
  task_validation_failed: {
    category: "sync",
    stage: "sync",
    userMessage: "Sync payload for this post failed validation",
    operatorMessage: "The post task payload was rejected before sync.",
    retryable: false,
  },
  task_sync_failed: {
    category: "sync",
    stage: "sync",
    userMessage: "FollowBrief could not sync this post",
    operatorMessage: "The sync endpoint rejected or failed this task.",
    retryable: true,
  },
  slice_sync_failed: {
    category: "sync",
    stage: "sync",
    userMessage: "FollowBrief could not sync this post",
    operatorMessage: "The sync slice failed after task processing.",
    retryable: true,
  },
  cloud_feed_sync_rejected: {
    category: "sync",
    stage: "sync",
    userMessage: "FollowBrief rejected this post during sync",
    operatorMessage: "The cloud feed sync result rejected a post that the worker expected to sync.",
    retryable: false,
  },
  worker_missing_result: {
    category: "worker",
    stage: "runtime",
    userMessage: "Local Agent shard did not write a result file for this post",
    operatorMessage: "The shard result file was missing, so unfinished tasks were backfilled as failed.",
    retryable: true,
    notCompleted: true,
  },
  worker_shard_timeout: {
    category: "worker",
    stage: "runtime",
    userMessage: "Local Agent shard timed out before this post finished",
    operatorMessage: "The shard exceeded its timeout and was terminated.",
    retryable: true,
    notCompleted: true,
  },
  worker_no_progress_timeout: {
    category: "worker",
    stage: "runtime",
    userMessage: "Worker watchdog stopped this post before any checkpoint progress",
    operatorMessage: "The per-worker watchdog, separate from the whole-job timeout, stopped a worker that did not write a result, task checkpoint, or progress checkpoint.",
    retryable: true,
    notCompleted: true,
  },
  worker_stalled_timeout: {
    category: "worker",
    stage: "runtime",
    userMessage: "Worker watchdog stopped this post after checkpoint progress stalled",
    operatorMessage: "The per-worker watchdog, separate from the whole-job timeout, stopped a worker that had written progress but stopped updating result, task checkpoint, or progress files.",
    retryable: true,
    notCompleted: true,
  },
  worker_stopped_before_task_started: {
    category: "worker",
    stage: "runtime",
    userMessage: "Local Agent stopped before starting this post",
    operatorMessage: "A shard worker stopped while handling another post, so this assigned post was never started.",
    retryable: true,
    notCompleted: true,
  },
  worker_incomplete_result: {
    category: "worker",
    stage: "runtime",
    userMessage: "Local Agent shard ended without reporting this post",
    operatorMessage: "The shard produced a result file, but did not cover every assigned task.",
    retryable: true,
    notCompleted: true,
  },
  worker_backgrounded_tool: {
    category: "worker",
    stage: "runtime",
    userMessage: "Local Agent started a background tool before this post finished",
    operatorMessage: "The worker emitted a structured background-tool event and was terminated.",
    retryable: true,
    notCompleted: true,
  },
  discovery_not_expanded: {
    category: "discovery",
    stage: "summarize",
    userMessage: "Candidate discovery did not complete",
    operatorMessage: "A discovery task did not expand into concrete post tasks.",
    retryable: true,
  },
  heartbeat: {
    category: "internal",
    stage: "internal",
    userMessage: "Runtime heartbeat",
    operatorMessage: "Internal liveness marker.",
    retryable: false,
    visibility: "hidden",
  },
  timeout_seconds_for_job: {
    category: "internal",
    stage: "internal",
    userMessage: "Runtime timeout marker",
    operatorMessage: "Internal timeout bookkeeping marker.",
    retryable: false,
    visibility: "hidden",
  },
  runtime_finished: {
    category: "internal",
    stage: "internal",
    userMessage: "Runtime finished",
    operatorMessage: "Internal completion marker.",
    retryable: false,
    visibility: "hidden",
  },
} as const satisfies Record<string, FetchFailureDefinition>;

export const KNOWN_FETCH_FAILURE_CODES = Object.keys(FETCH_FAILURE_TAXONOMY);

function normalizedCode(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function humanizeCode(code: string): string {
  return code.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "unknown";
}

export function fetchFailureInfo(value: string | null | undefined): FetchFailureInfo {
  const code = normalizedCode(value);
  const known = FETCH_FAILURE_TAXONOMY[code as keyof typeof FETCH_FAILURE_TAXONOMY];
  if (known) {
    return {
      ...known,
      code,
      known: true,
      visibility: "visibility" in known ? known.visibility : "user",
    };
  }
  const label = humanizeCode(code);
  return {
    code,
    known: false,
    category: "unknown",
    stage: "unknown",
    userMessage: `Unknown failure: ${label}`,
    operatorMessage: code ? `Unmapped failure reason: ${code}` : "Failure reason was not provided.",
    retryable: true,
    visibility: "user",
  };
}

export function fetchFailureMessage(value: string | null | undefined): string | null {
  const code = normalizedCode(value);
  if (!code) return null;
  return fetchFailureInfo(code).userMessage;
}

export function isHiddenFailureReason(value: string | null | undefined): boolean {
  const code = normalizedCode(value);
  return Boolean(code && fetchFailureInfo(code).visibility === "hidden");
}

export function isContentFailureReason(value: string | null | undefined): boolean {
  const code = normalizedCode(value);
  return Boolean(code && fetchFailureInfo(code).contentFailure === true);
}

export function isNotCompletedFailureReason(value: string | null | undefined): boolean {
  const code = normalizedCode(value);
  return Boolean(code && fetchFailureInfo(code).notCompleted === true);
}
