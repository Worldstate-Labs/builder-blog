#!/usr/bin/env node
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, hostname, platform, release, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Best-effort machine identity reported to the server on every call so
// the user can recognize which laptop / VM / container is using which
// token in the Settings UI. These are NOT used for auth.
const MACHINE_HEADERS = (() => {
  const headers = {};
  try {
    const host = hostname();
    if (host) headers["x-machine-hostname"] = String(host).slice(0, 120);
  } catch {}
  try {
    const plat = `${platform()} ${release()}`.trim();
    if (plat) headers["x-machine-platform"] = plat.slice(0, 120);
  } catch {}
  try {
    const user = userInfo().username;
    if (user) headers["x-machine-user"] = String(user).slice(0, 80);
  } catch {}
  return headers;
})();

// Bump when the CLI emits a meaningfully different fetch-run record
// shape or behavior. The server stores this verbatim so the user can
// see which CLI build produced a given run.
const CLI_VERSION = "0.6.0";

// Cached for fetch-run logging so a single CLI run shares one host /
// platform identity across success and failure paths.
const RUN_HOSTNAME = (() => {
  try { return hostname() || null; } catch { return null; }
})();
const RUN_PLATFORM = (() => {
  try { return `${platform()} ${release()}`.trim() || null; } catch { return null; }
})();
const JOB_RUN_UPDATE_TIMEOUT_MS = (() => {
  const value = Number(process.env.BUILDER_BLOG_JOB_RUN_UPDATE_TIMEOUT_MS || 10_000);
  return Number.isFinite(value) && value > 0 ? value : 10_000;
})();
const DEFAULT_HTTP_SYNC_TIMEOUT_MS = 30_000;
const DEFAULT_LARGE_HTTP_SYNC_TIMEOUT_MS = 120_000;
const HTTP_SYNC_TIMEOUT_MS = envClampedMs(
  "BUILDER_BLOG_HTTP_SYNC_TIMEOUT_MS",
  DEFAULT_HTTP_SYNC_TIMEOUT_MS,
  { min: 1_000, max: 5 * 60 * 1000 },
);
const HTTP_SYNC_LARGE_TIMEOUT_MS = envClampedMs(
  "BUILDER_BLOG_HTTP_SYNC_LARGE_TIMEOUT_MS",
  DEFAULT_LARGE_HTTP_SYNC_TIMEOUT_MS,
  { min: 5_000, max: 5 * 60 * 1000 },
);
const HTTP_SYNC_RETRY_DELAYS_MS = envRetryDelaysMs(
  "BUILDER_BLOG_HTTP_SYNC_RETRY_DELAYS_MS",
  [500, 1500],
);

function envClampedMs(name, fallback, { min, max }) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function envRetryDelaysMs(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const delays = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.min(30_000, Math.floor(value)));
  return delays.length > 0 ? delays.slice(0, 5) : fallback;
}

const CONFIG_DIR = join(homedir(), ".builder-blog");
function agentDir() {
  return process.env.BUILDER_BLOG_AGENT_DIR?.trim() || CONFIG_DIR;
}
function accountsDir() {
  return join(agentDir(), "accounts");
}
function accountFilePath(email) {
  const safeName = email.replace(/[^a-zA-Z0-9._@+-]/g, "_");
  return join(accountsDir(), `${safeName}.json`);
}
function sourcesConfigPath() {
  return join(agentDir(), "sources.json");
}
function accountSlug() {
  const fromEnv = process.env.BUILDER_BLOG_ACCOUNT_SLUG?.trim();
  if (fromEnv) return fromEnv;
  const account = process.env.BUILDER_BLOG_ACCOUNT?.trim() || "default";
  const base = account.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "default";
  const hash = createHash("sha256").update(account).digest("hex").slice(0, 8);
  return `${base}_${hash}`;
}
function jobTmpDir(defaultJobName = "") {
  const explicit = process.env.BUILDER_BLOG_JOB_TMP_DIR?.trim();
  if (explicit) return explicit;
  const jobName =
    process.env.BUILDER_BLOG_JOB?.trim() ||
    process.env.BUILDER_BLOG_SCHEDULE_JOB?.trim() ||
    defaultJobName;
  if (jobName) return join(agentDir(), "tmp", "accounts", accountSlug(), jobName);
  return join(agentDir(), "tmp");
}
// Secrets that can't ride along in the copy-paste setup prompt — e.g. an X API
// bearer token — live in a local, git-ignored secrets file the user fills in
// once, so scheduled cron runs (which see a bare environment) can read them.
// An exported env var still wins, so a one-off `export X_BEARER_TOKEN=...`
// overrides the file. One token per machine (an X bearer token is app-scoped,
// so it serves every account on the host). Shape: { "X_BEARER_TOKEN": "..." }
let agentSecretsCache;
function agentSecrets() {
  if (agentSecretsCache !== undefined) return agentSecretsCache;
  const path = join(agentDir(), "secrets.json");
  try {
    agentSecretsCache = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    agentSecretsCache = null; // malformed file → behave as if absent
  }
  return agentSecretsCache;
}
function agentSecret(key) {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  const secrets = agentSecrets();
  const value = secrets && typeof secrets[key] === "string" ? secrets[key].trim() : "";
  return value || null;
}
function libraryFetchRunIdFile() {
  // fetch-personal writes the emitted run's id here so the later, separate
  // sync-builders step can PATCH per-post fetch/summary outcomes onto the same
  // fetch-log record (the two run in the same job on the same machine).
  return join(jobTmpDir("library-once"), "library-fetch-run-id");
}
function defaultLibraryFetchResultFile() {
  return join(jobTmpDir("library-once"), "library-fetch-result.json");
}
function defaultLibraryFetchProgressFile() {
  return join(jobTmpDir("library-once"), "library-fetch-progress.json");
}
function defaultDigestContextFile() {
  return join(jobTmpDir("digest-once"), "builder-blog-context.json");
}
const GITHUB_TRENDING_URL = "https://github.com/trending?since=daily";
const PRODUCT_HUNT_TOP_PRODUCTS_URL = "https://www.producthunt.com/";
const MAX_DIGEST_CONTENT_CHARS = 200_000;
const MAX_DIGEST_HEADLINE_SUMMARY_CHARS = 1200;
const MAX_DIGEST_ITEMS = 5_000;
const MAX_POST_HEADLINE_CHARS = 180;
const MAX_POST_HEADLINE_WORDS = 20;
const ORIGINAL_CONTENT_LANGUAGE_VALUE = "source";
const DEFAULT_SOURCE_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_YOUTUBE_TOOL_TIMEOUT_MS = 120_000;
const DEFAULT_YOUTUBE_ASR_TIMEOUT_MS = 45 * 60 * 1000;

let _sourcesConfig = null;

function sourceFetchTimeoutMs() {
  const raw = Number(process.env.BUILDER_BLOG_SOURCE_FETCH_TIMEOUT_MS || DEFAULT_SOURCE_FETCH_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SOURCE_FETCH_TIMEOUT_MS;
  return Math.min(5 * 60 * 1000, Math.max(1_000, Math.floor(raw)));
}

function inputUrlForError(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input?.url === "string") return input.url;
  return String(input || "");
}

async function timedSourceFetch(input, init = {}, fetchImpl = fetch) {
  const timeoutMs = sourceFetchTimeoutMs();
  if (init?.signal) return fetchImpl(input, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Source fetch timed out after ${Math.round(timeoutMs / 1000)}s: ${inputUrlForError(input)}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function isUserActionAgentWorkType(kind) {
  const value = String(kind || "");
  return value.startsWith("user_action_") || value === "x_token_missing" || value === "x_token_invalid";
}

export function isCandidateDiscoveryAgentWorkType(kind) {
  return String(kind || "") === "candidate_discovery_fallback";
}

function isCandidateDiscoveryTaskId(id) {
  return String(id || "").startsWith("candidate_discovery:");
}

function isCandidateDiscoveryFetchTask(task) {
  return (
    isCandidateDiscoveryAgentWorkType(task?.agentWorkType) ||
    task?.type === "candidate_discovery" ||
    isCandidateDiscoveryTaskId(task?.id)
  );
}

function isCandidateDiscoveryOutcome(outcome) {
  return (
    isCandidateDiscoveryTaskId(outcome?.fetchTaskId) ||
    isCandidateDiscoveryFetchTask(outcome?.plannedTask)
  );
}

export function timedSourceFetchForTest(input, init = {}, fetchImpl = fetch) {
  return timedSourceFetch(input, init, fetchImpl);
}

function loadSourcesConfig() {
  if (_sourcesConfig) return _sourcesConfig;
  const path = sourcesConfigPath();
  try {
    _sourcesConfig = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // No embedded fallback: config/sources.json (served verbatim) is the single
    // source of truth, and both entry points now guarantee it locally — the
    // runner refreshes it every run, and bootstrap downloads it on install. If
    // it's still missing the install is incomplete, so fail loud and actionable
    // rather than silently running on stale/guessed values.
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not read ${path} (${reason}). Re-run the FollowBrief ` +
        `skill bootstrap to download it: /bin/sh -c "$(curl -fsSL ` +
        `${process.env.BUILDER_BLOG_URL || DEFAULT_APP_URL}/api/skill/bootstrap)"`,
    );
  }
  return _sourcesConfig;
}

export function sourceConfigFor(builderOrSourceTypeId) {
  const config = loadSourcesConfig();
  const id = typeof builderOrSourceTypeId === "string"
    ? builderOrSourceTypeId
    : normalizeSourceType(builderOrSourceTypeId?.sourceType) || sourceTypeIdForBuilder(builderOrSourceTypeId);
  return config.sources.find((s) => s.id === id) ?? config.sources.find((s) => s.id === "website");
}
const REPO_LOCAL_AGENT_TIMEOUTS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "local-agent-timeouts.json",
);
const DEFAULT_MEDIA_ESTIMATION_POLICY = {
  conservativeFallbackAsrRealtimeFactor: 1.25,
  backendAsrRealtimeFactors: {
    faster_whisper: 0.55,
    mlx_whisper: 0.45,
    whisper: 1,
  },
  audioPreparationRealtimeFactor: 0.15,
  fixedOverheadSeconds: 90,
};
const DEFAULT_CLOUD_SHARD_BUDGET_POLICY = {
  minimumSeconds: 3_600,
  standardMaximumSeconds: 7_200,
  longMediaMaximumSeconds: 14_400,
  safetyMultiplier: 1.5,
  completionAllowanceSeconds: 600,
  roundingSeconds: 300,
  progressHeartbeatSeconds: 60,
};
let _installedLocalAgentTimeoutPolicy;

function installedLocalAgentTimeoutPolicy() {
  if (_installedLocalAgentTimeoutPolicy !== undefined) return _installedLocalAgentTimeoutPolicy;
  const installedPath = join(agentDir(), "local-agent-timeouts.json");
  if (existsSync(installedPath)) {
    try {
      _installedLocalAgentTimeoutPolicy = JSON.parse(readFileSync(installedPath, "utf8"));
      return _installedLocalAgentTimeoutPolicy;
    } catch {
      _installedLocalAgentTimeoutPolicy = null;
      return _installedLocalAgentTimeoutPolicy;
    }
  }
  if (installedPath !== REPO_LOCAL_AGENT_TIMEOUTS_PATH && existsSync(REPO_LOCAL_AGENT_TIMEOUTS_PATH)) {
    try {
      _installedLocalAgentTimeoutPolicy = JSON.parse(readFileSync(REPO_LOCAL_AGENT_TIMEOUTS_PATH, "utf8"));
      return _installedLocalAgentTimeoutPolicy;
    } catch {
      _installedLocalAgentTimeoutPolicy = null;
      return _installedLocalAgentTimeoutPolicy;
    }
  }
  _installedLocalAgentTimeoutPolicy = null;
  return _installedLocalAgentTimeoutPolicy;
}

export function resetInstalledLocalAgentTimeoutPolicyCacheForTest() {
  _installedLocalAgentTimeoutPolicy = undefined;
}

function nonNegativeIntegerValue(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return fallback;
  return Math.floor(numericValue);
}

function positiveNumberValue(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

function positiveIntegerValue(value, fallback) {
  const numericValue = nonNegativeIntegerValue(value, fallback);
  return numericValue > 0 ? numericValue : fallback;
}

function roundUpToIncrement(value, increment) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(increment) || increment <= 0) return Math.ceil(value);
  return Math.ceil(value / increment) * increment;
}

export function parseMediaDurationSeconds(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Math.floor(Number(text));
  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) return null;
  const parts = text.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 2 && (parts[0] >= 60 || parts[1] >= 60)) return null;
  if (parts.length === 3 && (parts[1] >= 60 || parts[2] >= 60)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function firstMediaDurationSeconds(...candidates) {
  for (const candidate of candidates) {
    const parsed = parseMediaDurationSeconds(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

function resolvedMediaEstimationPolicy(policy = null) {
  const configured = policy?.mediaEstimation ?? installedLocalAgentTimeoutPolicy()?.mediaEstimation ?? {};
  const backendAsrRealtimeFactors = Object.fromEntries(
    Object.entries(configured.backendAsrRealtimeFactors ?? {}).flatMap(([backend, factor]) => {
      const normalized = positiveNumberValue(factor, 0);
      return normalized > 0 ? [[String(backend).trim(), normalized]] : [];
    }),
  );
  return {
    conservativeFallbackAsrRealtimeFactor: positiveNumberValue(
      configured.conservativeFallbackAsrRealtimeFactor,
      DEFAULT_MEDIA_ESTIMATION_POLICY.conservativeFallbackAsrRealtimeFactor,
    ),
    backendAsrRealtimeFactors: {
      ...DEFAULT_MEDIA_ESTIMATION_POLICY.backendAsrRealtimeFactors,
      ...backendAsrRealtimeFactors,
    },
    audioPreparationRealtimeFactor: positiveNumberValue(
      configured.audioPreparationRealtimeFactor,
      DEFAULT_MEDIA_ESTIMATION_POLICY.audioPreparationRealtimeFactor,
    ),
    fixedOverheadSeconds: nonNegativeIntegerValue(
      configured.fixedOverheadSeconds,
      DEFAULT_MEDIA_ESTIMATION_POLICY.fixedOverheadSeconds,
    ),
  };
}

function resolvedCloudShardBudgetPolicy(policy = null) {
  const configured = policy?.cloudShardBudget ?? installedLocalAgentTimeoutPolicy()?.cloudShardBudget ?? {};
  return {
    minimumSeconds: positiveIntegerValue(configured.minimumSeconds, DEFAULT_CLOUD_SHARD_BUDGET_POLICY.minimumSeconds),
    standardMaximumSeconds: positiveIntegerValue(
      configured.standardMaximumSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.standardMaximumSeconds,
    ),
    longMediaMaximumSeconds: positiveIntegerValue(
      configured.longMediaMaximumSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.longMediaMaximumSeconds,
    ),
    safetyMultiplier: positiveNumberValue(
      configured.safetyMultiplier,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.safetyMultiplier,
    ),
    completionAllowanceSeconds: nonNegativeIntegerValue(
      configured.completionAllowanceSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.completionAllowanceSeconds,
    ),
    roundingSeconds: positiveIntegerValue(configured.roundingSeconds, DEFAULT_CLOUD_SHARD_BUDGET_POLICY.roundingSeconds),
    progressHeartbeatSeconds: nonNegativeIntegerValue(
      configured.progressHeartbeatSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.progressHeartbeatSeconds,
    ),
  };
}

/**
 * @param {{ mediaDurationSeconds?: number | null, backend?: string | null, model?: string | null }} [input]
 * @param {any} [policy]
 */
export function estimateMediaWorkSeconds(input = {}, policy = null) {
  const mediaDurationSeconds = nonNegativeIntegerValue(input.mediaDurationSeconds, 0);
  const backend = String(input.backend || "fallback").trim() || "fallback";
  const model = String(input.model || "").trim() || null;
  const estimatePolicy = resolvedMediaEstimationPolicy(policy);
  const asrRealtimeFactor =
    estimatePolicy.backendAsrRealtimeFactors[backend] ??
    estimatePolicy.conservativeFallbackAsrRealtimeFactor;
  const audioPreparationFactor = estimatePolicy.audioPreparationRealtimeFactor;
  const fixedOverheadSeconds = estimatePolicy.fixedOverheadSeconds;
  const estimatedWorkSeconds = Math.ceil(
    mediaDurationSeconds * (asrRealtimeFactor + audioPreparationFactor) + fixedOverheadSeconds,
  );
  return {
    estimatedWorkSeconds,
    estimateEvidence: {
      backend,
      model,
      mediaDurationSeconds,
      asrRealtimeFactor,
      audioPreparationFactor,
      fixedOverheadSeconds,
    },
  };
}

function cloudDeadlineStateForTask({
  now,
  mustSucceedBy,
  executionBudgetSeconds,
  policy = null,
} = {}) {
  const deadline = mustSucceedBy ? new Date(mustSucceedBy) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) return "on_time";
  if (now.getTime() > deadline.getTime()) return "missed";
  const budgetPolicy = resolvedCloudShardBudgetPolicy(policy);
  const projectedCompletionAt =
    now.getTime() + (nonNegativeIntegerValue(executionBudgetSeconds, 0) + budgetPolicy.progressHeartbeatSeconds) * 1000;
  return projectedCompletionAt > deadline.getTime() ? "at_risk" : "on_time";
}

function plannedCloudWorkloadClass(task) {
  if (task?.workloadClass === "standard" || task?.workloadClass === "long_media") return task.workloadClass;
  const sourceType = String(task?.sourceType || task?.builderSync?.sourceType || "").trim().toLowerCase();
  return sourceType === "podcast" || sourceType === "youtube" || sourceType === "video"
    ? "long_media"
    : "standard";
}

function sourceEstimatedWorkSeconds(task, metadata) {
  return nonNegativeIntegerValue(
    task?.estimatedWorkSeconds ??
      metadata?.estimatedWorkSeconds ??
      task?.estimatedDurationSeconds ??
      metadata?.estimatedDurationSeconds,
    0,
  );
}

function plannedMediaDurationSeconds(task, metadata) {
  return firstMediaDurationSeconds(
    task?.mediaDurationSeconds,
    task?.item?.mediaDurationSeconds,
    task?.item?.rawJson?.mediaDurationSeconds,
    metadata?.mediaDurationSeconds,
  );
}

function finalizeCloudTaskExecutionPlan(task, metadata = {}, { now = new Date(), policy = null } = {}) {
  const budgetPolicy = resolvedCloudShardBudgetPolicy(policy);
  const workloadClass = plannedCloudWorkloadClass(task);
  const mediaDurationSeconds = plannedMediaDurationSeconds(task, metadata);
  const mediaEstimate = mediaDurationSeconds != null
    ? estimateMediaWorkSeconds(
      {
        mediaDurationSeconds,
        backend: task?.estimateEvidence?.backend ?? metadata?.estimateEvidence?.backend ?? "fallback",
        model: task?.estimateEvidence?.model ?? metadata?.estimateEvidence?.model ?? null,
      },
      policy,
    )
    : null;
  const estimatedWorkSeconds = mediaEstimate?.estimatedWorkSeconds ?? sourceEstimatedWorkSeconds(task, metadata);
  const estimateEvidence = mediaEstimate?.estimateEvidence ?? {
    backend: task?.estimateEvidence?.backend ?? metadata?.estimateEvidence?.backend ?? null,
    model: task?.estimateEvidence?.model ?? metadata?.estimateEvidence?.model ?? null,
    mediaDurationSeconds: mediaDurationSeconds ?? null,
    sourceEstimatedWorkSeconds: sourceEstimatedWorkSeconds(task, metadata),
  };
  const rawBudgetSeconds =
    estimatedWorkSeconds * budgetPolicy.safetyMultiplier + budgetPolicy.completionAllowanceSeconds;
  const roundedBudgetSeconds = roundUpToIncrement(rawBudgetSeconds, budgetPolicy.roundingSeconds);
  const minimumAppliedBudgetSeconds = Math.max(
    estimatedWorkSeconds,
    budgetPolicy.minimumSeconds,
    roundedBudgetSeconds,
  );
  const maximumBudgetSeconds =
    workloadClass === "long_media"
      ? budgetPolicy.longMediaMaximumSeconds
      : budgetPolicy.standardMaximumSeconds;
  const executionBudgetSeconds = Math.min(maximumBudgetSeconds, minimumAppliedBudgetSeconds);
  let budgetReason = "scaled_and_rounded";
  if (executionBudgetSeconds === budgetPolicy.minimumSeconds && executionBudgetSeconds > roundedBudgetSeconds) {
    budgetReason = "minimum_budget";
  } else if (executionBudgetSeconds === budgetPolicy.standardMaximumSeconds && workloadClass === "standard") {
    budgetReason = "capped_standard_maximum";
  } else if (
    executionBudgetSeconds === budgetPolicy.longMediaMaximumSeconds &&
    workloadClass === "long_media"
  ) {
    budgetReason = "capped_long_media_maximum";
  }
  const deadlineState = cloudDeadlineStateForTask({
    now,
    mustSucceedBy: task?.mustSucceedBy ?? metadata?.mustSucceedBy ?? null,
    executionBudgetSeconds,
    policy,
  });

  const plannedTask = {
    ...task,
    ...(mediaDurationSeconds != null ? { mediaDurationSeconds } : {}),
    estimatedWorkSeconds,
    executionBudgetSeconds,
    workloadClass,
    budgetReason,
    deadlineState,
    estimateEvidence,
  };

  if (workloadClass === "long_media" && estimatedWorkSeconds > budgetPolicy.longMediaMaximumSeconds) {
    return {
      plannedTask: null,
      taskOutcome: {
        fetchTaskId: plannedTask.id || fetchTaskId(plannedTask),
        status: "failed",
        reason: "workload_exceeds_max_budget",
        plannedTask,
        evidence: {
          uncappedEstimatedWorkSeconds: estimatedWorkSeconds,
          mediaDurationSeconds: mediaDurationSeconds ?? null,
          backend: estimateEvidence.backend ?? null,
          model: estimateEvidence.model ?? null,
          asrRealtimeFactor: estimateEvidence.asrRealtimeFactor ?? null,
          audioPreparationFactor: estimateEvidence.audioPreparationFactor ?? null,
          maximumBudgetSeconds: budgetPolicy.longMediaMaximumSeconds,
        },
      },
    };
  }

  return { plannedTask, taskOutcome: null };
}

function finalizePlannedCloudTask(task, cloudMetadata, taskOutcomes, runStartedAt) {
  if (!cloudMetadata) return task;
  const cloudFetchTask = buildCloudFetchTask(task, cloudMetadata);
  const planned = finalizeCloudTaskExecutionPlan(cloudFetchTask, cloudMetadata, { now: runStartedAt });
  if (planned.taskOutcome) {
    taskOutcomes.push(planned.taskOutcome);
    return null;
  }
  return planned.plannedTask;
}
const DEFAULT_APP_URL = "https://followbrief.worldstatelabs.com";
const DEFAULT_AGENT_RUNTIME = detectedAgentRuntime();
const DEFAULT_AGENT_MODEL = detectedAgentModel();
const DEFAULT_PERSONAL_FETCH_DAYS = 30;
// Single source of truth for source metadata lives in config/sources.json.
// This map only carries the per-source fetcher function — the part that can't be
// expressed as JSON. Source id is the join key with sources.json.
const FETCH_FN_BY_SOURCE_ID = {
  x: fetchPersonalXBuilder,
  blog: fetchPersonalBlogBuilder,
  github_trending: fetchPersonalGithubTrendingBuilder,
  product_hunt_top_products: fetchPersonalProductHuntTopProductsBuilder,
  youtube: fetchPersonalYouTubeBuilder,
  podcast: fetchPersonalPodcastBuilder,
  website: fetchPersonalWebsiteBuilder,
};

function usage() {
  console.log(`builder-digest commands:
  exchange --ec <code> [--app-url ${DEFAULT_APP_URL}]
  fetch-personal [--days ${DEFAULT_PERSONAL_FETCH_DAYS}] [--limit 3] [--force] [--agent-model gpt-5.5]
  expand-discovery --tasks fetch-result.json --file discovery-result.json [--out expanded-fetch-result.json]
  patch-fetch-run-plan --tasks fetch-result.json
  shard-tasks --tasks fetch-result.json --out-dir shards/ [--max-workers 3]
  assign-fetch-tasks --tasks fetch-result.json --out-dir shards/ [--max-workers 3] [--assigned-task-ids-file assigned.txt] [--active-group-keys-file active-groups.txt]
  merge-fetch-results --base fetch-result.json --next next-fetch-result.json --out fetch-result.json
  merge-task-results --tasks fetch-result.json --results-dir shards/results/ [--assigned-only] [--complete-sources-only] --out library-agent-sync.json
  split-sync-slices --tasks fetch-result.json --file library-agent-sync.json --out-dir sync-slices/ [--granularity source|task|cloud-run]
  fail-sync-slice --tasks slice-tasks.json --out failed-payload.json [--tasks-out failed-tasks.json] [--exclude-task-ids-file synced-ids.txt] [--reason slice_sync_failed] [--message "..."]
  prepare [--regenerate]
  validate-agent-sync --tasks fetch-result.json --file personal-builders.json
  lease-cloud-builders [--limit 10] [--lease-owner local-cloud-runner]
  fetch-cloud-library [--limit 10] [--days ${DEFAULT_PERSONAL_FETCH_DAYS}] [--post-limit 5] [--force] [--agent-model gpt-5.5]
  heartbeat-cloud-fetch --cloud-run-id <id> [--lease-owner local-cloud-runner]
  sync-builders --file personal-builders.json [--tasks fetch-result.json] [--agent-model gpt-5.5] [--partial-outcomes]
  sync-cloud-builders --file personal-builders.json --cloud-run-id <id> [--agent-model gpt-5.5]
  render-digest --context builder-blog-context.json --agent-output digest-agent-output.json --out builder-blog-digest.json --summary-out digest-headlines.txt
  sync --file builder-blog-digest.json [--summary-file digest-headlines.txt] [--title "AI Builder Digest"] [--regenerate] [--context builder-blog-context.json]
  schedule-spec --freq daily --anchor-file schedule-anchor-library-cron-user [--cron-out cron.txt] [--launchd-out launchd.xml] [--status-out status.txt]
  cron-status --job library-cron|digest-cron --status active|stopped [--freq daily] [--schedule "0 8 * * *"]
  cron-state --job library-cron|digest-cron
  cron-guard --job library-cron|digest-cron --owner-id <local-owner-id>
  fetch-status-audit
  digest-status-audit
  parse-runtime-usage --file runtime-output.log [--runtime codex|claude|openclaw|hermes] [--provider openai-codex] [--model gpt-5.4-mini] [--out runtime-usage.jsonl]
  aggregate-runtime-usage --out runtime-usage.json runtime-output-1.log runtime-output-2.log
  job-run-start --job-type library-fetch|digest-build --trigger scheduled|one_time|manual_cli --instance-id <id>
  job-run-update --job-type library-fetch|digest-build --trigger scheduled|one_time|manual_cli --instance-id <id> --status running|succeeded|failed|timed_out|killed|replaced|stale
  status

To set up an account, use the Copy-prompt button in the FollowBrief web app.
The first command in the prompt exchanges a one-time code for an agent token
saved under ${accountsDir()}.`);
}

export function skillFetchTool(detail = "", agentModel = DEFAULT_AGENT_MODEL) {
  const override = process.env.BUILDER_BLOG_FETCH_TOOL?.trim();
  if (override) return override;
  const modelLabel = agentModel ? ` (model ${agentModel})` : "";
  const suffix = detail ? ` (${detail})` : "";
  return `${DEFAULT_AGENT_RUNTIME}${modelLabel} FollowBrief skill fetcher${suffix}`;
}

function detectedAgentRuntime() {
  // The runner exports BUILDER_BLOG_RUNTIME with the pinned runtime for cron
  // jobs. It's authoritative and covers hermes/openclaw, which the env sniff
  // below can't detect. Fall back to per-agent env signals for interactive
  // (un-pinned) runs.
  const pinned = process.env.BUILDER_BLOG_RUNTIME?.trim().toLowerCase();
  const pinnedLabels = {
    claude: "Claude Code",
    codex: "Codex",
    hermes: "Hermes",
    openclaw: "OpenClaw",
  };
  if (pinned && pinnedLabels[pinned]) return pinnedLabels[pinned];
  if (process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) {
    return process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
  }
  if (process.env.CODEX_SHELL || process.env.CODEX_CI) return "Codex";
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE) return "Claude Code";
  return "Local agent";
}

function detectedAgentModel(runtime = DEFAULT_AGENT_RUNTIME) {
  // An explicit override always wins, regardless of which runtime is active.
  const override = process.env.BUILDER_BLOG_AGENT_MODEL?.trim();
  if (override) return override;

  // Model detection must match the runtime — otherwise a Hermes run would report
  // a model sniffed from Codex's config (e.g. "Hermes (model gpt-5.5)").
  // Each runtime reads only its own sources; an unknown source yields "" so the
  // label degrades to just the runtime name.
  switch (runtime) {
    case "Codex":
      return detectedCodexModel();
    case "Claude Code":
      return process.env.ANTHROPIC_MODEL?.trim() || process.env.CLAUDE_MODEL?.trim() || "";
    case "Hermes":
      return detectedHermesModel();
    case "OpenClaw":
      return detectedOpenClawModel();
    default:
      return "";
  }
}

function detectedCodexModel() {
  const envModel =
    process.env.CODEX_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.OMX_DEFAULT_FRONTIER_MODEL;
  if (envModel?.trim()) return envModel.trim();

  const codexConfigPath = join(homedir(), ".codex", "config.toml");
  if (!existsSync(codexConfigPath)) return "";
  const modelMatch = readFileSync(codexConfigPath, "utf8").match(/^\s*model\s*=\s*"([^"]+)"/m);
  return modelMatch?.[1]?.trim() ?? "";
}

function detectedOpenClawModel() {
  const envModel = process.env.OPENCLAW_MODEL?.trim();
  if (envModel) return envModel;

  // OPENCLAW_CONFIG_PATH is set by `--profile`/`--dev`; default to ~/.openclaw.
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH?.trim() || join(homedir(), ".openclaw", "openclaw.json");
  if (!existsSync(configPath)) return "";
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const agents = config?.agents ?? {};
    // The runner selects the agent via OPENCLAW_AGENT (default "main"); a
    // per-agent model overrides the shared default.
    const agentName = process.env.OPENCLAW_AGENT?.trim() || "main";
    const primary = agents?.[agentName]?.model?.primary ?? agents?.defaults?.model?.primary;
    return typeof primary === "string" ? primary.trim() : "";
  } catch {
    return "";
  }
}

function detectedHermesModel() {
  const envModel = process.env.HERMES_MODEL?.trim();
  if (envModel) return envModel;

  const hermesConfigPath =
    process.env.HERMES_CONFIG_PATH?.trim() || join(homedir(), ".hermes", "config.yaml");
  if (!existsSync(hermesConfigPath)) return "";
  try {
    const config = readFileSync(hermesConfigPath, "utf8");
    let inModelBlock = false;
    for (const line of config.split(/\r?\n/)) {
      if (/^\S/.test(line)) inModelBlock = /^model:\s*(?:#.*)?$/.test(line);
      if (!inModelBlock) continue;
      const modelMatch = line.match(/^\s+default\s*:\s*["']?([^"'\n#]+)["']?/);
      if (modelMatch?.[1]) return modelMatch[1].trim();
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Load an account file from the configured agent accounts directory.
 * Returns { email, token, appUrl } or throws with a clear error.
 */
async function loadAccountFile(email) {
  const accountPath = accountFilePath(email);
  if (!existsSync(accountPath)) {
    throw new Error(
      `Account file not found for ${email} (expected ${accountPath}). ` +
      `Use the Copy-prompt button in the FollowBrief web app to set up this account.`,
    );
  }
  const data = JSON.parse(await readFile(accountPath, "utf8"));
  if (!data.token) {
    throw new Error(`Account file ${accountPath} is missing the token field.`);
  }
  return {
    email: data.email ?? email,
    token: data.token,
    appUrl: (data.appUrl ?? DEFAULT_APP_URL).replace(/\/$/, ""),
  };
}

/**
 * Resolve token and appUrl.
 * Priority:
 *   1. BUILDER_BLOG_ACCOUNT env — read accounts/<email>.json
 *   2. BUILDER_BLOG_TOKEN env — direct token override for adhoc/debug runs
 *   3. Error
 */
async function readConfig() {
  const envToken = process.env.BUILDER_BLOG_TOKEN?.trim();
  const envUrl = process.env.BUILDER_BLOG_URL?.trim().replace(/\/$/, "");
  const envAccount = process.env.BUILDER_BLOG_ACCOUNT?.trim();

  if (envAccount) {
    const account = await loadAccountFile(envAccount);
    return {
      token: account.token,
      appUrl: envUrl ?? account.appUrl,
    };
  }

  if (envToken) {
    return {
      token: envToken,
      appUrl: envUrl ?? DEFAULT_APP_URL,
    };
  }

  return { token: null, appUrl: envUrl ?? DEFAULT_APP_URL };
}

function argValue(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function webSyncDisabled() {
  return process.env.BUILDER_BLOG_DISABLE_WEB_SYNC?.trim() === "1";
}

function envJobRunId() {
  return process.env.BUILDER_BLOG_JOB_RUN_ID?.trim() || "";
}

function envJobTrigger() {
  const trigger = process.env.BUILDER_BLOG_JOB_TRIGGER?.trim();
  return trigger === "scheduled" || trigger === "one_time" || trigger === "manual_cli"
    ? trigger
    : "manual_cli";
}

function envScheduleJob() {
  const scheduleJob = process.env.BUILDER_BLOG_SCHEDULE_JOB?.trim();
  return scheduleJob === "library-cron" || scheduleJob === "digest-cron" ? scheduleJob : null;
}

// Cloud library fetches reuse the shared fetch pipeline (buildFetchTasksForBuilders
// → emitFetchJobProgress) but must NOT surface in a user's personal fetch log.
// The runner marks cloud rounds with BUILDER_BLOG_RUN_SOURCE=cloud; tag their live
// progress records with a distinct jobType so the personal log query skips them and
// the cloud management page can read them.
function envJobType() {
  return process.env.BUILDER_BLOG_RUN_SOURCE?.trim() === "cloud"
    ? "cloud-library-fetch"
    : "library-fetch";
}

function envIso(name, fallback = null) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value) {
  const numeric = Number(value || 0);
  return numeric || null;
}

function exitCodeOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const code = Math.trunc(numeric);
  return code >= 0 && code <= 255 ? code : null;
}

function usageNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[$,\s]/g, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function usageInt(value) {
  const parsed = usageNumber(value);
  return parsed === null ? null : Math.max(0, Math.round(parsed));
}

function usageRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function usageBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return false;
}

function usageString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function usageEnvKeyPart(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function usageRateModelKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Public OpenAI API text-token prices per 1M tokens. Runtime env overrides
// below still win; this table exists so OpenClaw/Gateway logs that include
// provider+model can produce a useful estimated cost without per-user setup.
const DEFAULT_USAGE_PRICES_PER_1M = {
  "openai-codex:gpt-5-5": { input: 5, cachedInput: 0.5, output: 30 },
  "openai:gpt-5-5": { input: 5, cachedInput: 0.5, output: 30 },
  "openai-codex:gpt-5-4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "openai:gpt-5-4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "openai-codex:gpt-5-4-mini": { input: 0.375, cachedInput: 0.0375, output: 2.25 },
  "openai:gpt-5-4-mini": { input: 0.375, cachedInput: 0.0375, output: 2.25 },
  "openai-codex:gpt-5-4-nano": { input: 0.1, cachedInput: 0.01, output: 0.625 },
  "openai:gpt-5-4-nano": { input: 0.1, cachedInput: 0.01, output: 0.625 },
};

function usagePriceEnvValue(names) {
  for (const name of names) {
    const value = process.env[name];
    const parsed = usageNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function usagePricePerMillion(kind, { runtime, provider, model }) {
  const runtimeKey = usageEnvKeyPart(runtime);
  const providerKey = usageEnvKeyPart(provider);
  const modelKey = usageEnvKeyPart(model);
  const kindKey = usageEnvKeyPart(kind);
  const names = [];
  if (runtimeKey && providerKey && modelKey) {
    names.push(`BUILDER_BLOG_USAGE_${runtimeKey}_${providerKey}_${modelKey}_${kindKey}_PER_1M`);
  }
  if (runtimeKey && modelKey) {
    names.push(`BUILDER_BLOG_USAGE_${runtimeKey}_${modelKey}_${kindKey}_PER_1M`);
  }
  if (runtimeKey) names.push(`BUILDER_BLOG_USAGE_${runtimeKey}_${kindKey}_PER_1M`);
  names.push(`BUILDER_BLOG_USAGE_${kindKey}_PER_1M`);
  const envValue = usagePriceEnvValue(names);
  if (envValue !== null) return envValue;

  const rateProviderKey = usageRateModelKey(provider);
  const rateModelKey = usageRateModelKey(model);
  const rates =
    DEFAULT_USAGE_PRICES_PER_1M[`${rateProviderKey}:${rateModelKey}`] ??
    DEFAULT_USAGE_PRICES_PER_1M[`openai:${rateModelKey}`];
  if (!rates) return null;
  if (kind === "input") return rates.input ?? null;
  if (kind === "output") return rates.output ?? null;
  if (kind === "cached_input") return rates.cachedInput ?? null;
  if (kind === "reasoning") return rates.output ?? null;
  return null;
}

function runtimeFromUsageSource(source) {
  const value = String(source || "").trim();
  const match = value.match(/^([a-z0-9]+)(?:_|$)/i);
  return match?.[1] ?? null;
}

function estimateRuntimeUsageCost({
  cachedInputTokens,
  inputTokens,
  outputTokens,
  reasoningTokens,
  source,
  provider,
  model,
}) {
  const runtime = runtimeFromUsageSource(source);
  const context = { runtime, provider, model };
  const rates = {
    input: usagePricePerMillion("input", context),
    output: usagePricePerMillion("output", context),
    cachedInput: usagePricePerMillion("cached_input", context),
    reasoning: usagePricePerMillion("reasoning", context),
  };
  let cost = 0;
  let hasRate = false;
  const add = (tokens, rate) => {
    if (tokens === null || rate === null) return;
    hasRate = true;
    cost += (tokens * rate) / 1_000_000;
  };
  add(inputTokens, rates.input);
  add(outputTokens, rates.output);
  add(cachedInputTokens, rates.cachedInput);
  add(reasoningTokens, rates.reasoning);
  return hasRate ? cost : null;
}

function normalizeRuntimeUsage(value, source = "runtime_output") {
  const root = usageRecord(value);
  if (!root) return null;
  const message = usageRecord(root.message);
  const response = usageRecord(root.response);
  const result = usageRecord(root.result);
  const data = usageRecord(root.data);
  const usage =
    usageRecord(root.usage) ??
    usageRecord(root.tokenUsage) ??
    usageRecord(root.token_usage) ??
    usageRecord(message?.usage) ??
    usageRecord(response?.usage) ??
    usageRecord(result?.usage) ??
    usageRecord(data?.usage) ??
    root;
  const inputDetails = usageRecord(usage.inputTokenDetails) ??
    usageRecord(usage.input_token_details) ??
    usageRecord(usage.input_tokens_details) ??
    usageRecord(root.inputTokenDetails) ??
    usageRecord(root.input_token_details) ??
    usageRecord(root.input_tokens_details);
  const outputDetails = usageRecord(usage.outputTokenDetails) ??
    usageRecord(usage.output_token_details) ??
    usageRecord(usage.output_tokens_details) ??
    usageRecord(root.outputTokenDetails) ??
    usageRecord(root.output_token_details) ??
    usageRecord(root.output_tokens_details);
  const inputTokens = usageInt(
    usage.inputTokens ??
      usage.input_tokens ??
      usage.input ??
      usage.promptTokens ??
      usage.prompt_tokens ??
      usage.prompt ??
      root.inputTokens ??
      root.input_tokens ??
      root.input ??
      root.promptTokens ??
      root.prompt_tokens,
  );
  const outputTokens = usageInt(
    usage.outputTokens ??
      usage.output_tokens ??
      usage.output ??
      usage.completionTokens ??
      usage.completion_tokens ??
      usage.completion ??
      root.outputTokens ??
      root.output_tokens ??
      root.output ??
      root.completionTokens ??
      root.completion_tokens,
  );
  const cachedInputTokens = usageInt(
    usage.cachedInputTokens ??
      usage.cached_input_tokens ??
      usage.cacheReadInputTokens ??
      usage.cache_read_input_tokens ??
      usage.cacheRead ??
      usage.cache_read ??
      usage.cacheReadTokens ??
      usage.cache_read_tokens ??
      usage.cache_read_tokens ??
      usage.cached_tokens ??
      usage.cacheCreationInputTokens ??
      usage.cache_creation_input_tokens ??
      inputDetails?.cachedTokens ??
      inputDetails?.cached_tokens ??
      inputDetails?.cacheReadInputTokens ??
      inputDetails?.cache_read_input_tokens ??
      inputDetails?.cacheRead ??
      inputDetails?.cache_read ??
      root.cachedInputTokens ??
      root.cached_input_tokens,
  );
  const reasoningTokens = usageInt(
    usage.reasoningTokens ??
      usage.reasoning_tokens ??
      usage.reasoningOutputTokens ??
      usage.reasoning_output_tokens ??
      outputDetails?.reasoningTokens ??
      outputDetails?.reasoning_tokens ??
      root.reasoningTokens ??
      root.reasoning_tokens,
  );
  const explicitTotal = usageInt(usage.totalTokens ?? usage.total_tokens ?? usage.total ?? root.totalTokens ?? root.total_tokens ?? root.total);
  const totalTokens = explicitTotal ?? (
    inputTokens !== null || outputTokens !== null || cachedInputTokens !== null || reasoningTokens !== null
      ? (inputTokens ?? cachedInputTokens ?? 0) + (outputTokens ?? 0) + (reasoningTokens ?? 0)
      : null
  );
  let costUsd = usageNumber(
    usage.costUsd ??
      usage.cost_usd ??
      usage.totalCostUsd ??
      usage.total_cost_usd ??
      usage.totalCost ??
      usage.total_cost ??
      root.costUsd ??
      root.cost_usd ??
      root.totalCostUsd ??
      root.total_cost_usd ??
      root.totalCost ??
      root.total_cost,
  );
  let costEstimated = usageBoolean(
    usage.costEstimated ??
      usage.cost_estimated ??
      usage.estimatedCost ??
      usage.estimated_cost ??
      root.costEstimated ??
      root.cost_estimated ??
      root.estimatedCost ??
      root.estimated_cost,
  );
  const provider = usageString(usage.provider) ?? usageString(root.provider);
  const model = usageString(usage.model) ?? usageString(root.model);
  if (costUsd === null) {
    const estimatedCost = estimateRuntimeUsageCost({
      cachedInputTokens,
      inputTokens,
      outputTokens,
      reasoningTokens,
      source,
      provider,
      model,
    });
    if (estimatedCost !== null) {
      costUsd = estimatedCost;
      costEstimated = true;
    }
  }
  const currencyValue = usage.currency ?? root.currency;
  const currency = typeof currencyValue === "string" && currencyValue.trim()
    ? currencyValue.trim()
    : costUsd !== null
      ? "USD"
      : null;

  if (
    inputTokens === null &&
    outputTokens === null &&
    cachedInputTokens === null &&
    reasoningTokens === null &&
    totalTokens === null &&
    costUsd === null
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens,
    costUsd,
    costEstimated,
    currency,
    provider,
    model,
    source: typeof usage.source === "string" && usage.source.trim() ? usage.source.trim() : source,
  };
}

function applyRuntimeUsageFallbacks(usage, { provider = null, model = null } = {}) {
  if (!usage) return null;
  const fallbackProvider = usageString(provider);
  const fallbackModel = usageString(model);
  const resolvedProvider = usage.provider ?? fallbackProvider;
  const resolvedModel = usage.model ?? fallbackModel;
  let costUsd = usage.costUsd;
  let costEstimated = usage.costEstimated;
  if (costUsd === null && (resolvedProvider || resolvedModel)) {
    const estimatedCost = estimateRuntimeUsageCost({
      cachedInputTokens: usage.cachedInputTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      source: usage.source,
      provider: resolvedProvider,
      model: resolvedModel,
    });
    if (estimatedCost !== null) {
      costUsd = estimatedCost;
      costEstimated = true;
    }
  }
  return {
    ...usage,
    costUsd,
    costEstimated,
    currency: usage.currency ?? (costUsd !== null ? "USD" : null),
    provider: resolvedProvider,
    model: resolvedModel,
  };
}

function runtimeUsageSource(runtime, format = "runtime_output") {
  const normalized = String(runtime || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return format;
  if (format.startsWith("runtime_")) return format.replace("runtime", normalized);
  return `${normalized}_${format}`;
}

function addUsageSummaries(left, right) {
  if (!left) return right;
  if (!right) return left;
  const sum = (key) => (
    left[key] === null && right[key] === null ? null : (left[key] ?? 0) + (right[key] ?? 0)
  );
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    costUsd: sum("costUsd"),
    costEstimated: Boolean(left.costEstimated || right.costEstimated),
    currency: left.currency ?? right.currency ?? null,
    provider: left.provider === right.provider ? left.provider : left.provider ?? right.provider ?? null,
    model: left.model === right.model ? left.model : left.model ?? right.model ?? null,
    source: left.source === right.source ? left.source : "runtime_output",
  };
}

function usageFromTextLine(line, runtime = null) {
  const numberPattern = String.raw`([\d][\d,]*(?:\.\d+)?)`;
  const inputTokens = usageInt(line.match(new RegExp(String.raw`(?:input|prompt)\s*tokens?[^0-9]+${numberPattern}`, "i"))?.[1]);
  const outputTokens = usageInt(line.match(new RegExp(String.raw`(?:output|completion)\s*tokens?[^0-9]+${numberPattern}`, "i"))?.[1]);
  const totalTokens = usageInt(line.match(new RegExp(String.raw`total\s*tokens?[^0-9]+${numberPattern}`, "i"))?.[1]);
  const costUsd = usageNumber(line.match(new RegExp(String.raw`(?:total\s*)?cost[^0-9$]*\$?${numberPattern}`, "i"))?.[1]);
  return normalizeRuntimeUsage({ inputTokens, outputTokens, totalTokens, costUsd }, runtimeUsageSource(runtime, "runtime_text"));
}

function jsonRuntimeUsages(value, runtime = null) {
  const source = runtimeUsageSource(runtime, "runtime_jsonl");
  const seen = new WeakSet();
  function visit(node) {
    if (!node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      let usage = null;
      for (const item of node) usage = addUsageSummaries(usage, visit(item));
      return usage;
    }

    const normalized = normalizeRuntimeUsage(node, source);
    if (normalized) return normalized;

    let usage = null;
    for (const [key, child] of Object.entries(node)) {
      if (key === "delta" || key === "content" || key === "text") continue;
      usage = addUsageSummaries(usage, visit(child));
    }
    return usage;
  }
  return visit(value);
}

function jsonValuesFromText(text) {
  const values = [];
  const input = String(text || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (start === -1) {
      if (char === "{" || char === "[") {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        const candidate = input.slice(start, i + 1);
        try {
          values.push(JSON.parse(candidate));
          i = start + candidate.length - 1;
        } catch {}
        start = -1;
      }
    }
  }
  return values;
}

function runtimeUsageFromText(text, runtime = null) {
  const jsonValues = jsonValuesFromText(text);
  if (jsonValues.length > 0) {
    let usage = null;
    for (const value of jsonValues) usage = addUsageSummaries(usage, jsonRuntimeUsages(value, runtime));
    if (usage) return usage;
  }
  let usage = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        usage = addUsageSummaries(usage, jsonRuntimeUsages(JSON.parse(line), runtime));
        continue;
      } catch {}
    }
    usage = addUsageSummaries(usage, usageFromTextLine(line, runtime));
  }
  return usage;
}

function runtimeUsageFromFile(path, runtime = null) {
  if (!path || !existsSync(path)) return null;
  try {
    return runtimeUsageFromText(readFileSync(path, "utf8"), runtime);
  } catch {
    return null;
  }
}

function aggregateRuntimeUsageFromFiles(files) {
  let usage = null;
  for (const file of files) usage = addUsageSummaries(usage, runtimeUsageFromFile(file));
  return usage;
}

async function postJson(url, body, token, options = {}) {
  return requestJson(url, {
    method: "POST",
    body,
    token,
    ...options,
  });
}

async function patchJson(url, body, token, options = {}) {
  return requestJson(url, {
    method: "PATCH",
    body,
    token,
    retries: HTTP_SYNC_RETRY_DELAYS_MS.length,
    ...options,
  });
}

async function getJson(url, token, options = {}) {
  return requestJson(url, {
    method: "GET",
    token,
    retries: HTTP_SYNC_RETRY_DELAYS_MS.length,
    allowPendingStatus: true,
    ...options,
  });
}

async function requestJson(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const timeoutMs = Number(options.timeoutMs || HTTP_SYNC_TIMEOUT_MS);
  const retryDelays = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs
    : HTTP_SYNC_RETRY_DELAYS_MS;
  const retries = Math.max(0, Math.min(Number(options.retries ?? 0), retryDelays.length));
  const label = options.label || "HTTP sync";
  const logUrl = httpUrlForLog(url);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestJsonOnce(url, {
        method,
        body: options.body,
        token: options.token,
        timeoutMs,
        allowPendingStatus: Boolean(options.allowPendingStatus),
        logUrl,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableHttpSyncError(error)) break;
      const delayMs = retryDelays[attempt] ?? 0;
      console.error(
        `[FollowBrief sync] ${label} ${method} ${logUrl} failed ` +
          `(${httpSyncErrorSummary(error)}); retrying in ${delayMs}ms ` +
          `(attempt ${attempt + 2}/${retries + 1}).`,
      );
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  throw lastError;
}

async function requestJsonOnce(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        "content-type": "application/json",
        ...MACHINE_HEADERS,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !(options.allowPendingStatus && data.status === "pending")) {
      throw httpSyncError(
        data.error || data.status || `HTTP ${response.status}`,
        {
          method: options.method,
          url: options.logUrl,
          status: response.status,
          code: "http_status",
        },
      );
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw httpSyncError(
        `timed out after ${Math.round(options.timeoutMs / 1000)}s`,
        {
          method: options.method,
          url: options.logUrl,
          code: "timeout",
          cause: error,
        },
      );
    }
    if (error?.isHttpSyncError) throw error;
    throw httpSyncError(error instanceof Error ? error.message : String(error), {
      method: options.method,
      url: options.logUrl,
      code: "network",
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

function httpSyncError(message, details) {
  const error = new Error(`HTTP ${details.method} ${details.url} ${message}`);
  error.isHttpSyncError = true;
  error.httpStatus = details.status ?? null;
  error.httpSyncCode = details.code ?? "unknown";
  if (details.cause) error.cause = details.cause;
  return error;
}

function httpUrlForLog(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url);
  }
}

function isRetryableHttpSyncError(error) {
  if (!error?.isHttpSyncError) return false;
  if (error.httpSyncCode === "timeout" || error.httpSyncCode === "network") return true;
  return [408, 429, 500, 502, 503, 504].includes(Number(error.httpStatus || 0));
}

function httpSyncErrorSummary(error) {
  if (!error?.isHttpSyncError) return error instanceof Error ? error.message : String(error);
  if (error.httpSyncCode === "timeout") return "timeout";
  if (error.httpStatus) return `HTTP ${error.httpStatus}`;
  return error.httpSyncCode || "network";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitAgentJobRunRecord(config, record) {
  if (webSyncDisabled()) return null;
  if (!config?.appUrl || !config?.token) return null;
  const startedAt =
    record.startedAt ||
    envIso("BUILDER_BLOG_JOB_STARTED_AT") ||
    new Date().toISOString();
  const body = {
    jobType: record.jobType,
    trigger: record.trigger || envJobTrigger(),
    scheduleJob: record.scheduleJob ?? envScheduleJob(),
    instanceId: record.instanceId || envJobRunId(),
    expectedAt: record.expectedAt ?? envIso("BUILDER_BLOG_EXPECTED_AT"),
    startedAt,
    heartbeatAt: record.heartbeatAt ?? new Date().toISOString(),
    finishedAt: record.finishedAt ?? null,
    status: record.status,
    exitCode: record.exitCode ?? null,
    signal: record.signal ?? null,
    runtime: record.runtime ?? DEFAULT_AGENT_RUNTIME,
    runnerPid: record.runnerPid ?? numberOrNull(process.env.BUILDER_BLOG_RUNNER_PID),
    workerPid: record.workerPid ?? numberOrNull(process.env.BUILDER_BLOG_WORKER_PID),
    hostname: RUN_HOSTNAME,
    platform: RUN_PLATFORM,
    stage: record.stage ?? null,
    summary: record.summary ?? null,
    details: {
      agentModel: DEFAULT_AGENT_MODEL || null,
      ...(record.details ?? {}),
    },
  };
  if (!body.instanceId) return null;
  return postJson(`${config.appUrl}/api/skill/job-runs`, body, config.token, {
    label: "job run update",
    timeoutMs: JOB_RUN_UPDATE_TIMEOUT_MS,
    retries: HTTP_SYNC_RETRY_DELAYS_MS.length,
  });
}

async function jobRunCommand(args, defaultStatus = "running") {
  const config = await readConfig();
  requireLoggedIn(config);
  const jobType = argValue(args, "--job-type");
  const trigger = argValue(args, "--trigger", envJobTrigger());
  const instanceId = argValue(args, "--instance-id", envJobRunId());
  const scheduleJobRaw = argValue(args, "--schedule-job", envScheduleJob() ?? undefined);
  const scheduleJob =
    scheduleJobRaw === "library-cron" || scheduleJobRaw === "digest-cron" ? scheduleJobRaw : null;
  const statusValue = argValue(args, "--status", defaultStatus);
  const usage = runtimeUsageFromFile(argValue(args, "--usage-file", null));
  const startedAt = stringOrNull(argValue(args, "--started-at", envIso("BUILDER_BLOG_JOB_STARTED_AT"))) ?? new Date().toISOString();
  const expectedAt = stringOrNull(argValue(args, "--expected-at", envIso("BUILDER_BLOG_EXPECTED_AT")));
  const finishedAt = stringOrNull(argValue(args, "--finished-at"));
  const result = await emitAgentJobRunRecord(config, {
    jobType,
    trigger,
    scheduleJob,
    instanceId,
    expectedAt,
    startedAt,
    heartbeatAt: stringOrNull(argValue(args, "--heartbeat-at", new Date().toISOString())) ?? new Date().toISOString(),
    finishedAt,
    status: statusValue,
    exitCode: exitCodeOrNull(argValue(args, "--exit-code", "")),
    signal: argValue(args, "--signal", null),
    runtime: argValue(args, "--runtime", DEFAULT_AGENT_RUNTIME),
    runnerPid: Number(argValue(args, "--runner-pid", "")) || null,
    workerPid: Number(argValue(args, "--worker-pid", "")) || null,
    stage: argValue(args, "--stage", null),
    summary: argValue(args, "--summary", null),
    details: {
      reason: argValue(args, "--reason", null),
      cliVersion: CLI_VERSION,
      timeoutSeconds: numberOrNull(argValue(args, "--timeout-seconds", null)),
      timeoutStage: argValue(args, "--timeout-stage", null),
      timedOutWorker: argValue(args, "--timed-out-worker", null),
      timedOutWorkerPid: numberOrNull(argValue(args, "--timed-out-worker-pid", null)),
      termination: argValue(args, "--termination", null),
      providerError: argValue(args, "--provider-error", null),
      skippedWaitPids: argValue(args, "--skipped-wait-pids", null),
      localWorkers: numberOrNull(argValue(args, "--local-workers", null)),
      ...(usage ? { usage } : {}),
    },
  });
  console.log(JSON.stringify(result ?? { status: "skipped" }, null, 2));
}

async function parseRuntimeUsageCommand(args) {
  const out = argValue(args, "--out", null);
  const usage = applyRuntimeUsageFallbacks(
    runtimeUsageFromFile(argValue(args, "--file", null), argValue(args, "--runtime", null)),
    {
      provider: argValue(args, "--provider", null),
      model: argValue(args, "--model", null),
    },
  );
  const payload = usage ? { usage } : { usage: null };
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    if (usage) await writeFile(out, `${JSON.stringify(payload)}\n`);
    else await rm(out, { force: true });
  }
  console.log(JSON.stringify(payload, null, 2));
}

async function aggregateRuntimeUsageCommand(args) {
  const out = argValue(args, "--out", null);
  const outIndex = args.indexOf("--out");
  const files = args.filter((arg, index) => {
    if (outIndex !== -1 && (index === outIndex || index === outIndex + 1)) return false;
    return !String(arg).startsWith("--");
  });
  const usage = aggregateRuntimeUsageFromFiles(files);
  const payload = usage ? { usage } : { usage: null };
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    if (usage) await writeFile(out, `${JSON.stringify(payload)}\n`);
    else await rm(out, { force: true });
  }
  console.log(JSON.stringify(payload, null, 2));
}

const FETCH_PROGRESS_VERSION = 1;
const FETCH_PROGRESS_RECENT_EVENT_LIMIT = 60;
const FETCH_PROGRESS_SOURCE_LIMIT = 120;
const FETCH_PROGRESS_TASK_LIMIT = 120;
const FETCH_PROGRESS_WEB_RECENT_EVENT_LIMIT = 20;
const FETCH_PROGRESS_WEB_SOURCE_LIMIT = 32;
const FETCH_PROGRESS_WEB_TASK_LIMIT = 24;

function createFetchProgressState(initial = {}) {
  return {
    version: FETCH_PROGRESS_VERSION,
    stage: initial.stage ?? "starting",
    updatedAt: new Date().toISOString(),
    counters: {
      sourcesTotal: 0,
      sourcesChecked: 0,
      candidatesFound: 0,
      tasksPlanned: 0,
      tasksDone: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      actionNeeded: 0,
      ...(initial.counters ?? {}),
    },
    current: initial.current ?? {},
    sources: Array.isArray(initial.sources) ? initial.sources : [],
    tasks: Array.isArray(initial.tasks) ? initial.tasks : [],
    recentEvents: Array.isArray(initial.recentEvents)
      ? initial.recentEvents.slice(-FETCH_PROGRESS_RECENT_EVENT_LIMIT)
      : [],
    completedTaskIds: Array.isArray(initial.completedTaskIds)
      ? initial.completedTaskIds.map((id) => String(id)).filter(Boolean)
      : [],
  };
}

function fetchProgressSnapshot(progress, options = {}) {
  const sourceLimit = options.includeInternal
    ? undefined
    : options.web
      ? FETCH_PROGRESS_WEB_SOURCE_LIMIT
      : FETCH_PROGRESS_SOURCE_LIMIT;
  const taskLimit = options.includeInternal
    ? undefined
    : options.web
      ? FETCH_PROGRESS_WEB_TASK_LIMIT
      : FETCH_PROGRESS_TASK_LIMIT;
  const eventLimit = options.web
    ? FETCH_PROGRESS_WEB_RECENT_EVENT_LIMIT
    : FETCH_PROGRESS_RECENT_EVENT_LIMIT;
  const snapshot = {
    version: FETCH_PROGRESS_VERSION,
    stage: progress.stage,
    updatedAt: new Date().toISOString(),
    counters: { ...(progress.counters ?? {}) },
    current: { ...(progress.current ?? {}) },
    sources: Array.isArray(progress.sources)
      ? progress.sources.slice(sourceLimit === undefined ? undefined : -sourceLimit).map((source) =>
          options.web
            ? {
                builderId: compactProgressText(source.builderId, 120),
                name: compactProgressText(source.name, 160),
                sourceType: compactProgressText(source.sourceType, 80),
                status: compactProgressText(source.status, 80),
                itemsFetched: source.itemsFetched,
                tasksGenerated: source.tasksGenerated,
                discoveryTasksGenerated: source.discoveryTasksGenerated,
                error: compactProgressText(source.error, 180),
                updatedAt: compactProgressText(source.updatedAt, 80),
              }
            : source)
      : [],
    tasks: Array.isArray(progress.tasks)
      ? progress.tasks.slice(taskLimit === undefined ? undefined : -taskLimit).map((task) =>
          options.web
            ? {
                id: compactProgressText(task.id ?? task.taskId, 500),
                status: compactProgressText(task.status, 80),
                phase: compactProgressText(task.phase, 80),
                message: compactProgressText(task.message, 180),
                reason: compactProgressText(task.reason, 160),
                builder: compactProgressText(task.builder, 160),
                builderId: compactProgressText(task.builderId, 120),
                sourceType: compactProgressText(task.sourceType, 80),
                title: compactProgressText(task.title, 180),
                url: compactProgressText(task.url, 240),
                workerId: compactProgressText(task.workerId, 80),
                bodyChars: task.bodyChars,
                bodyWords: task.bodyWords,
                headlineChars: task.headlineChars,
                headlineWords: task.headlineWords,
                summaryChars: task.summaryChars,
                summaryWords: task.summaryWords,
                updatedAt: compactProgressText(task.updatedAt, 80),
              }
            : task)
      : [],
    recentEvents: Array.isArray(progress.recentEvents)
      ? progress.recentEvents.slice(-eventLimit).map((event) =>
          options.web
            ? {
                at: compactProgressText(event.at, 80),
                type: compactProgressText(event.type, 80),
                message: compactProgressText(event.message, 220),
                taskId: compactProgressText(event.taskId, 500),
                builderId: compactProgressText(event.builderId, 120),
                status: compactProgressText(event.status, 80),
                reason: compactProgressText(event.reason, 180),
              }
            : event)
      : [],
  };
  if (options.includeInternal && Array.isArray(progress.completedTaskIds)) {
    snapshot.completedTaskIds = progress.completedTaskIds;
  }
  return snapshot;
}

export function appendFetchProgressEvent(progress, event) {
  const recentEvents = Array.isArray(progress.recentEvents) ? progress.recentEvents : [];
  const identityKeys = ["type", "message", "builderId", "taskId", "status", "reason"];
  const sameIdentity = (candidate) => identityKeys
    .every((key) => (candidate?.[key] ?? null) === (event[key] ?? null));
  if (event.type === "tasks_planned" && recentEvents.some(sameIdentity)) return;
  const previous = recentEvents.at(-1);
  const duplicate = previous && sameIdentity(previous);
  if (duplicate) return;

  progress.recentEvents = [
    ...recentEvents,
    {
      at: new Date().toISOString(),
      type: event.type,
      message: event.message,
      ...(event.builderId ? { builderId: event.builderId } : {}),
      ...(event.taskId ? { taskId: event.taskId } : {}),
      ...(event.status ? { status: event.status } : {}),
      ...(event.reason ? { reason: event.reason } : {}),
    },
  ].slice(-FETCH_PROGRESS_RECENT_EVENT_LIMIT);
}

function upsertFetchProgressSource(progress, source) {
  const sources = Array.isArray(progress.sources) ? progress.sources : [];
  const key = source.builderId ?? source.name;
  const index = sources.findIndex((item) => (item.builderId ?? item.name) === key);
  const value = {
    ...(index >= 0 ? sources[index] : {}),
    ...source,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) sources[index] = value;
  else sources.push(value);
  progress.sources = sources;
}

function compactProgressText(value, max = 260) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function upsertFetchProgressTask(progress, task) {
  const id = compactProgressText(task?.id ?? task?.taskId, 500);
  if (!id) return false;
  const tasks = Array.isArray(progress.tasks) ? progress.tasks : [];
  const index = tasks.findIndex((item) => String(item.id ?? item.taskId ?? "") === id);
  const previous = index >= 0 ? tasks[index] : {};
  const workerId = compactProgressText(task.workerId, 80) ?? previous.workerId ?? null;
  const value = {
    ...previous,
    id,
    status: compactProgressText(task.status, 80),
    phase: compactProgressText(task.phase, 80),
    message: compactProgressText(task.message, 260),
    reason: compactProgressText(task.reason ?? task.failureReason, 160),
    builder: compactProgressText(task.builder, 160),
    builderId: compactProgressText(task.builderId, 120),
    sourceType: compactProgressText(task.sourceType, 80),
    title: compactProgressText(task.title, 220),
    url: compactProgressText(task.url, 500),
    workerId,
    bodyChars: Number.isFinite(Number(task.bodyChars)) ? Number(task.bodyChars) : previous.bodyChars ?? null,
    bodyWords: Number.isFinite(Number(task.bodyWords)) ? Number(task.bodyWords) : previous.bodyWords ?? null,
    headlineChars: Number.isFinite(Number(task.headlineChars)) ? Number(task.headlineChars) : previous.headlineChars ?? null,
    headlineWords: Number.isFinite(Number(task.headlineWords)) ? Number(task.headlineWords) : previous.headlineWords ?? null,
    summaryChars: Number.isFinite(Number(task.summaryChars)) ? Number(task.summaryChars) : previous.summaryChars ?? null,
    summaryWords: Number.isFinite(Number(task.summaryWords)) ? Number(task.summaryWords) : previous.summaryWords ?? null,
    updatedAt: compactProgressText(task.updatedAt, 80) ?? new Date().toISOString(),
  };
  const changed =
    !previous ||
    previous.status !== value.status ||
    previous.phase !== value.phase ||
    previous.message !== value.message ||
    previous.reason !== value.reason ||
    previous.workerId !== value.workerId ||
    previous.bodyChars !== value.bodyChars ||
    previous.headlineChars !== value.headlineChars ||
    previous.summaryChars !== value.summaryChars;
  if (index >= 0) tasks[index] = value;
  else tasks.push(value);
  progress.tasks = tasks
    .sort((a, b) => String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")))
    .slice(-FETCH_PROGRESS_TASK_LIMIT);
  return changed;
}

function seedFetchProgressPlannedTasks(progress, plannedTasks) {
  if (!progress || !Array.isArray(plannedTasks)) return;
  const existingById = new Map(
    (Array.isArray(progress.tasks) ? progress.tasks : [])
      .map((task) => [String(task?.id ?? task?.taskId ?? ""), task])
      .filter(([id]) => id),
  );
  const liveStatuses = new Set(["reading", "summarizing", "summarized", "synced", "skipped", "failed", "action_needed"]);
  for (const task of plannedTasks) {
    const id = String(task?.id || fetchTaskId(task));
    if (!id) continue;
    const existing = existingById.get(id);
    const keepLiveStatus = existing?.status && liveStatuses.has(String(existing.status));
    upsertFetchProgressTask(progress, {
      id,
      status: keepLiveStatus ? existing.status : task.status === "fetched" ? "fetched" : "planned",
      phase: keepLiveStatus ? existing.phase ?? "read" : "plan",
      message: keepLiveStatus
        ? existing.message ?? null
        : task.workerId
          ? `Assigned to ${task.workerId}.`
          : "Queued for worker assignment.",
      builder: task.builder,
      builderId: task.builderId,
      sourceType: task.sourceType,
      title: task.title,
      url: task.url,
      workerId: task.workerId,
      bodyChars: task.bodyChars,
      bodyWords: task.bodyWords,
      headlineChars: task.headlineChars,
      headlineWords: task.headlineWords,
      summaryChars: task.summaryChars,
      summaryWords: task.summaryWords,
      updatedAt: existing?.updatedAt ?? new Date().toISOString(),
    });
  }
}

async function writeFetchProgressState(progress) {
  try {
    const file = defaultLibraryFetchProgressFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(fetchProgressSnapshot(progress, { includeInternal: true }), null, 2)}\n`, "utf8");
  } catch {
    // Local progress continuity is best-effort; never fail the fetch pipeline.
  }
}

async function readFetchProgressState() {
  try {
    const raw = JSON.parse(await readFile(defaultLibraryFetchProgressFile(), "utf8"));
    if (raw?.version !== FETCH_PROGRESS_VERSION) return null;
    return createFetchProgressState(raw);
  } catch {
    return null;
  }
}

async function emitFetchJobProgress(config, progress, update = {}) {
  if (!progress) return;
  if (update.stage) progress.stage = update.stage;
  if (update.current) progress.current = update.current;
  if (update.counters) progress.counters = { ...(progress.counters ?? {}), ...update.counters };
  if (update.source) upsertFetchProgressSource(progress, update.source);
  if (update.event) appendFetchProgressEvent(progress, update.event);
  progress.updatedAt = new Date().toISOString();
  await writeFetchProgressState(progress);

  if (webSyncDisabled() || !config?.appUrl || !config?.token || !envJobRunId()) return;
  try {
    const fetchProgressSnapshotValue = fetchProgressSnapshot(progress, { web: true });
    await emitAgentJobRunRecord(config, {
      jobType: envJobType(),
      trigger: envJobTrigger(),
      scheduleJob: envScheduleJob(),
      instanceId: envJobRunId(),
      status: "running",
      stage: progress.stage,
      summary: update.summary ?? progressSummary(fetchProgressSnapshotValue),
      details: {
        cliVersion: CLI_VERSION,
        progress: fetchProgressSnapshotValue,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to update live fetch progress: ${message}`);
  }
}

export function progressSummary(progress) {
  const counters = progress.counters ?? {};
  const stage = String(progress.stage ?? "running").replace(/_/g, " ");
  const sourcePart = counters.sourcesTotal
    ? `${formatProgressCount(counters.sourcesChecked ?? 0)}/${formatProgressCount(counters.sourcesTotal)} sources`
    : null;
  const taskPart = counters.tasksPlanned
    ? `${formatProgressCount(counters.tasksDone ?? 0)}/${formatProgressCount(counters.tasksPlanned)} tasks`
    : null;
  const outcomeParts = [
    ["synced", counters.synced],
    ["failed", counters.failed],
    ["skipped", counters.skipped],
    ["action needed", counters.actionNeeded],
  ]
    .map(([label, value]) => {
      const count = Number(value);
      return Number.isFinite(count) && count > 0 ? `${formatProgressCount(count)} ${label}` : null;
    })
    .filter(Boolean);
  return [stage, sourcePart, taskPart, ...outcomeParts].filter(Boolean).join(" · ").slice(0, 500);
}

function formatProgressCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.max(0, Math.floor(n))) : "0";
}

export function applyFetchProgressTaskOutcomes(progress, taskOutcomes, taskIds = []) {
  if (!progress) return;
  const discoveryOutcomeIds = new Set(
    (Array.isArray(taskOutcomes) ? taskOutcomes : [])
      .filter(isCandidateDiscoveryOutcome)
      .map((outcome) => String(outcome?.fetchTaskId ?? ""))
      .filter(Boolean),
  );
  const postTaskIds = taskIds
    .map((id) => String(id))
    .filter((id) => id && !isCandidateDiscoveryTaskId(id) && !discoveryOutcomeIds.has(id));
  const completed = new Set(
    Array.isArray(progress.completedTaskIds)
      ? progress.completedTaskIds.map((id) => String(id)).filter(Boolean)
      : [],
  );
  const delta = { tasksDone: 0, synced: 0, skipped: 0, failed: 0, actionNeeded: 0 };
  for (const outcome of taskOutcomes) {
    const id = String(outcome?.fetchTaskId ?? "");
    if (!id) continue;
    if (isCandidateDiscoveryOutcome(outcome)) continue;
    const alreadyCompleted = completed.has(id);
    if (!alreadyCompleted) {
      completed.add(id);
      delta.tasksDone += 1;
      if (outcome.status === "synced") delta.synced += 1;
      else if (outcome.status === "skipped") delta.skipped += 1;
      else if (outcome.status === "action_needed") delta.actionNeeded += 1;
      else if (outcome.status === "failed") delta.failed += 1;
      appendFetchProgressEvent(progress, {
        type: "task_completed",
        taskId: id,
        status: outcome.status,
        reason: outcome.failureReason ?? null,
        message: `${id}: ${String(outcome.status ?? "done").replace(/_/g, " ")}.`,
      });
    }
    upsertFetchProgressTask(progress, {
      id,
      status: outcome.status,
      phase: "synced",
      message: `${String(outcome.status ?? "done").replace(/_/g, " ")}.`,
      reason: outcome.failureReason,
      workerId: outcome.workerId,
      bodyChars: outcome.bodyChars,
      bodyWords: outcome.bodyWords,
      headlineChars: outcome.headlineChars,
      headlineWords: outcome.headlineWords,
      summaryChars: outcome.summaryChars,
      summaryWords: outcome.summaryWords,
    });
  }
  const counters = progress.counters ?? {};
  const tasksPlanned = Math.max(counters.tasksPlanned ?? 0, postTaskIds.length, completed.size);
  progress.completedTaskIds = [...completed];
  progress.counters = {
    ...counters,
    tasksPlanned,
    tasksDone: Math.min(tasksPlanned, Math.max(counters.tasksDone ?? 0, completed.size)),
    synced: (counters.synced ?? 0) + delta.synced,
    skipped: (counters.skipped ?? 0) + delta.skipped,
    failed: (counters.failed ?? 0) + delta.failed,
    actionNeeded: (counters.actionNeeded ?? 0) + delta.actionNeeded,
  };
}


function requireLoggedIn(config) {
  if (!config.token) {
    throw new Error(
      `No agent token. Set BUILDER_BLOG_TOKEN in your environment, ` +
      `or set BUILDER_BLOG_ACCOUNT to an email that has an account file under ${accountsDir()}. ` +
      `Use the Copy-prompt button in the FollowBrief web app to set up this account.`,
    );
  }
}

async function exchange(args) {
  const ec = argValue(args, "--ec");
  if (!ec) {
    throw new Error("Missing --ec <code>. Run the Copy-prompt from the FollowBrief web app.");
  }
  const appUrl = argValue(args, "--app-url", process.env.BUILDER_BLOG_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  const data = await postJson(`${appUrl}/api/skill/exchange`, { code: ec }, null, {
    label: "exchange code",
    retries: 0,
  });
  if (!data.token || !data.email) {
    throw new Error("Exchange response missing token or email.");
  }
  const safeName = data.email.replace(/[^a-zA-Z0-9._@+-]/g, "_");
  const accountPath = accountFilePath(data.email);
  await mkdir(accountsDir(), { recursive: true });
  await writeFile(accountPath, JSON.stringify({ email: data.email, token: data.token, userId: data.userId, appUrl: data.appUrl ?? appUrl }, null, 2), { mode: 0o600 });
  console.log(`Exchanged for account ${data.email}; saved to accounts/${safeName}.json`);
}

async function prepare(args = []) {
  const config = await readConfig();
  requireLoggedIn(config);
  // --regenerate ("re-generate today's digest"): pass ?regenerate=1 so the
  // context route bypasses the per-user DigestedItem marker gate (re-includes
  // already-digested posts). The publishedAt lookback floor still applies.
  const regenerate = args.includes("--regenerate");
  const runSource = process.env.BUILDER_BLOG_RUN_SOURCE?.trim() === "cron" ? "cron" : "manual";
  const contextUrl =
    `${config.appUrl}/api/skill/context?intent=digest` +
    (regenerate ? "&regenerate=1" : "") +
    (webSyncDisabled() ? "&dryRun=1" : `&source=${encodeURIComponent(runSource)}`) +
    (envJobRunId() ? `&jobRunId=${encodeURIComponent(envJobRunId())}` : "");
  // The digest-intent context route is NOT a pure GET: each successful call
  // inserts a "prepared" DigestRun row server-side. Retrying is therefore
  // unsafe — a request that commits server-side but times out client-side would
  // create a second DigestRun on retry, and only the retry's runId reaches the
  // sync step, leaving the first row "prepared" forever (the exact pollution the
  // intent split was added to prevent). Disable retries so a transient failure
  // fails the run cleanly and the next schedule tick starts fresh.
  const context = await getJson(contextUrl, config.token, {
    label: "digest context",
    retries: 0,
  });
  console.log(JSON.stringify(context, null, 2));
}

function sourceConfigsForSummaryLanguage(sources = {}, summaryLanguage = null) {
  if (!summaryLanguage) return sources;
  return Object.fromEntries(
    Object.entries(sources).map(([id, source]) => [
      id,
      {
        ...source,
        summaryPrompt: source?.summaryPrompt
          ? { ...source.summaryPrompt, language: summaryLanguage }
          : source?.summaryPrompt,
      },
    ]),
  );
}

function cloudLanguageLabel(language) {
  const normalized = String(language || "").trim().toLowerCase();
  if (normalized === "zh" || normalized === "zh-cn") return "Chinese";
  if (normalized === "zh-tw") return "Traditional Chinese";
  if (normalized === "en") return "English";
  if (normalized === "ja") return "Japanese";
  if (normalized === "ko") return "Korean";
  if (normalized === "es") return "Spanish";
  return language || "the configured language";
}

function ensureSummaryInstructionsLanguage(instructions, summaryLanguage) {
  if (!instructions || typeof instructions !== "object" || !summaryLanguage) return instructions;
  if (String(instructions.language || "").trim().toLowerCase() === String(summaryLanguage).trim().toLowerCase()) {
    return instructions;
  }
  return {
    ...instructions,
    language: summaryLanguage,
    prompt: [
      `Write one concise FollowBrief single-post summary in ${cloudLanguageLabel(summaryLanguage)} (${summaryLanguage}).`,
      "",
      String(instructions.prompt || ""),
    ].filter(Boolean).join("\n"),
  };
}

function buildCloudFetchTask(task, metadata) {
  const summaryLanguage = metadata?.summaryLanguage ?? task?.summaryLanguage ?? task?.summaryInstructions?.language ?? null;
  return {
    ...task,
    cloudRunId: metadata?.cloudRunId ?? task?.cloudRunId ?? null,
    cloudSourceTaskId: metadata?.cloudSourceTaskId ?? task?.cloudSourceTaskId ?? null,
    mustSucceedBy: metadata?.mustSucceedBy ?? task?.mustSucceedBy ?? null,
    estimatedDurationSeconds: metadata?.estimatedDurationSeconds ?? task?.estimatedDurationSeconds ?? null,
    estimatedWorkSeconds: task?.estimatedWorkSeconds ?? metadata?.estimatedWorkSeconds ?? null,
    provisionalExecutionBudgetSeconds:
      metadata?.provisionalExecutionBudgetSeconds ?? task?.provisionalExecutionBudgetSeconds ?? null,
    executionBudgetSeconds: task?.executionBudgetSeconds ?? metadata?.executionBudgetSeconds ?? null,
    workloadClass: task?.workloadClass ?? metadata?.workloadClass ?? null,
    budgetReason: task?.budgetReason ?? metadata?.budgetReason ?? null,
    deadlineState: task?.deadlineState ?? metadata?.deadlineState ?? null,
    estimateEvidence: task?.estimateEvidence ?? metadata?.estimateEvidence ?? null,
    mediaDurationSeconds: task?.mediaDurationSeconds ?? metadata?.mediaDurationSeconds ?? null,
    captionAvailability: task?.captionAvailability ?? metadata?.captionAvailability ?? null,
    plannedExtractionMethod: task?.plannedExtractionMethod ?? metadata?.plannedExtractionMethod ?? null,
    summaryLanguage,
    builderSync: {
      ...(task?.builderSync ?? {}),
      builderId: task?.builderSync?.builderId ?? task?.builderId ?? metadata?.builderId ?? null,
      cloudSourceTaskId: metadata?.cloudSourceTaskId ?? task?.builderSync?.cloudSourceTaskId ?? null,
    },
    summaryInstructions: ensureSummaryInstructionsLanguage(task?.summaryInstructions, summaryLanguage),
  };
}

export function buildCloudFetchTaskForTest(task, metadata) {
  return buildCloudFetchTask(task, metadata);
}

async function applySharedPostReuseBySummaryLanguage(fetchTasks, { config, defaultSummaryLanguage }) {
  if (!config || webSyncDisabled()) return fetchTasks;
  const grouped = new Map();
  for (const task of fetchTasks) {
    const language = String(task?.summaryLanguage || task?.summaryInstructions?.language || defaultSummaryLanguage || "zh");
    const group = grouped.get(language) ?? [];
    group.push(task);
    grouped.set(language, group);
  }
  const rewritten = [];
  for (const [summaryLanguage, tasks] of grouped) {
    rewritten.push(...await applySharedPostReuseToFetchTasks(tasks, { config, summaryLanguage }));
  }
  const byId = new Map(rewritten.map((task) => [String(task?.id || fetchTaskId(task)), task]));
  return fetchTasks.map((task) => byId.get(String(task?.id || fetchTaskId(task))) ?? task);
}

export async function buildFetchTasksForBuilders({
  builders,
  context,
  force = false,
  days = DEFAULT_PERSONAL_FETCH_DAYS,
  limit = 3,
  runStartedAt = new Date(),
  agentModel = DEFAULT_AGENT_MODEL,
  subscribedBuilderIds = null,
  config = null,
  defaultSummaryLanguage = null,
  cloudTaskMetadataByBuilderId = new Map(),
  onSourceProgress = null,
} = {}) {
  const sources = context?.sources ?? {};
  const commonFetchRules = context?.commonFetchRules ?? context?.digest?.commonFetchRules ?? DEFAULT_FETCH_GUIDANCE;
  const commonSummaryRules = context?.commonSummaryRules ?? context?.digest?.commonSummaryRules ?? "";
  const subscriptions = subscribedBuilderIds ?? new Set(
    (context?.subscriptions ?? []).map((builder) => builder.id),
  );
  const fallbackCutoff = new Date(runStartedAt.getTime() - days * 24 * 60 * 60 * 1000);
  const readyBuilders = [];
  const fetchTasks = [];
  const taskOutcomes = [];
  const builderStats = new Map();
  let errorCount = 0;

  for (const builder of builders) {
    const cloudMetadata = cloudTaskMetadataByBuilderId.get(builder.id) ?? null;
    const summaryLanguage = cloudMetadata?.summaryLanguage ?? defaultSummaryLanguage ?? context?.language ?? "zh";
    const languageSources = sourceConfigsForSummaryLanguage(sources, summaryLanguage);
    const builderStat = {
      builderId: builder.id,
      name: builder.name,
      sourceType: sourceTypeIdForBuilder(builder),
      summaryLanguage,
      itemsFetched: 0,
      tasksGenerated: 0,
      discoveryTasksGenerated: 0,
    };
    builderStats.set(builder.id, builderStat);

    const fallbackBuilderSync = {
      builderId: builder.id,
      kind: builder.kind,
      sourceType: builderStat.sourceType,
      name: builder.name,
      handle: builder.handle,
      sourceUrl: builder.sourceUrl,
      fetchUrl: builder.fetchUrl,
      bio: builder.bio,
      subscribe: subscriptions.has(builder.id),
      ...(cloudMetadata ? { cloudSourceTaskId: cloudMetadata.cloudSourceTaskId } : {}),
    };
    try {
      const source = personalFetcherSourceForBuilder(builder);
      if (!source) {
        const builderCutoff = force ? null : cutoffForBuilder(context, builder.id, fallbackCutoff);
        const externalItems = await fetchPersonalWithExternalCommand(builder, {
          fallbackCutoff,
          force,
          limit,
          context,
          agentModel,
        });
        if (!externalItems) {
          const task = buildPersonalFetchErrorTask(builder, {
            builderSync: fallbackBuilderSync,
            error: new Error("No local fetcher configured for this personal source."),
            limit,
            now: runStartedAt,
            sources: languageSources,
            commonFetchRules,
            commonSummaryRules,
          });
          const plannedTask = finalizePlannedCloudTask(task, cloudMetadata, taskOutcomes, runStartedAt);
          if (plannedTask) fetchTasks.push(plannedTask);
          if (plannedTask && isCandidateDiscoveryFetchTask(plannedTask)) builderStat.discoveryTasksGenerated += 1;
          else if (plannedTask) builderStat.tasksGenerated += 1;
          continue;
        }
        const filtered = filterFetchedItems(externalItems, {
          builderId: builder.id,
          cutoff: builderCutoff,
          limit,
          fetchedItemKeys: force ? new Set() : fetchedItemKeysForBuilder(context, builder.id),
        });
        readyBuilders.push({
          ...fallbackBuilderSync,
          summaryLanguage,
          fetchCutoff: builderCutoff?.toISOString() ?? null,
          items: filtered,
        });
        builderStat.itemsFetched += filtered.length;
        continue;
      }
      const builderCutoff = force ? null : cutoffForBuilder(context, builder.id, fallbackCutoff);
      const fetched = await source.fetch(builder, {
        cutoff: builderCutoff,
        limit,
        agentModel,
        fetchedItemKeys: force ? new Set() : fetchedItemKeysForBuilder(context, builder.id),
        sources: languageSources,
      });
      const { items, agentTasks: sourceAgentTasks } = normalizePersonalFetchResult(fetched);
      const filteredItems = filterFinalFetchedItemsByCutoff(items, builderCutoff);
      const filteredAgentTasks = filterFinalAgentTasksByCutoff(sourceAgentTasks, builderCutoff);
      const builderSync = {
        ...fallbackBuilderSync,
        kind: source.syncKind,
        sourceType: source.id,
      };
      const fetchTasksFromAgentTasks = filteredAgentTasks.map((task) => {
        const fetchTask = {
          ...fetchTaskFromAgentTask(task, builderSync, languageSources, commonFetchRules, commonSummaryRules),
          fetchCutoff: builderCutoff?.toISOString() ?? null,
        };
        return finalizePlannedCloudTask(fetchTask, cloudMetadata, taskOutcomes, runStartedAt);
      });
      const runnableFetchTasks = fetchTasksFromAgentTasks.filter(Boolean);
      fetchTasks.push(...runnableFetchTasks);
      builderStat.tasksGenerated += runnableFetchTasks.filter((task) => !isCandidateDiscoveryFetchTask(task)).length;
      builderStat.discoveryTasksGenerated += runnableFetchTasks.filter(isCandidateDiscoveryFetchTask).length;
      readyBuilders.push({
        ...builderSync,
        summaryLanguage,
        fetchCutoff: builderCutoff?.toISOString() ?? null,
        items: filteredItems,
      });
      builderStat.itemsFetched += filteredItems.length;
      builderStat.sourceType = source.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const task = buildPersonalFetchErrorTask(builder, {
        builderSync: fallbackBuilderSync,
        error,
        limit,
        now: runStartedAt,
        sources: languageSources,
        commonFetchRules,
        commonSummaryRules,
      });
      if (isRecoverableFetchFallback(task)) {
        builderStat.fallback = sourceFallbackNotice(task, message);
      } else {
        builderStat.error = message;
        errorCount += 1;
      }
      const plannedTask = finalizePlannedCloudTask(task, cloudMetadata, taskOutcomes, runStartedAt);
      if (plannedTask) fetchTasks.push(plannedTask);
      if (plannedTask && isCandidateDiscoveryFetchTask(plannedTask)) builderStat.discoveryTasksGenerated += 1;
      else if (plannedTask) builderStat.tasksGenerated += 1;
    } finally {
      if (onSourceProgress) await onSourceProgress(builderStat);
    }
  }

  for (const builder of readyBuilders) {
    const builderSources = sourceConfigsForSummaryLanguage(sources, builder.summaryLanguage);
    const readyTasks = fetchTasksForReadyBuilders([builder], builderSources, commonSummaryRules)
      .map((task) =>
        finalizePlannedCloudTask(
          task,
          cloudTaskMetadataByBuilderId.get(task.builderId) ?? null,
          taskOutcomes,
          runStartedAt,
        ))
      .filter(Boolean);
    fetchTasks.push(...readyTasks);
  }

  const rewrittenFetchTasks = await applySharedPostReuseBySummaryLanguage(fetchTasks, {
    config,
    defaultSummaryLanguage: defaultSummaryLanguage ?? context?.language ?? "zh",
  });
  fetchTasks.splice(0, fetchTasks.length, ...rewrittenFetchTasks);

  const postFetchTasks = fetchTasks.filter((task) => !isCandidateDiscoveryFetchTask(task));
  return {
    builders: readyBuilders,
    fetchTasks,
    taskOutcomes,
    builderStats,
    errorCount,
    itemsFetched: readyBuilders.reduce((sum, builder) => sum + (builder.items?.length ?? 0), 0),
    tasksGenerated: postFetchTasks.length,
    agentTasks: postFetchTasks.filter((task) => task?.contentStatus !== "ready"),
  };
}

async function fetchPersonal(args) {
  const startedAt = new Date();
  // Cron-driven invocations export BUILDER_BLOG_RUN_SOURCE=cron from
  // builder-agent-runner.sh; anything else (manual terminal usage,
  // ad-hoc agent runs) is recorded as "manual".
  const runSource = process.env.BUILDER_BLOG_RUN_SOURCE?.trim() === "cron" ? "cron" : "manual";
  const rawDays = Number(argValue(args, "--days", String(DEFAULT_PERSONAL_FETCH_DAYS)));
  const days = Number.isFinite(rawDays)
    ? Math.min(90, Math.max(1, Math.floor(rawDays)))
    : DEFAULT_PERSONAL_FETCH_DAYS;
  const limit = Math.max(1, Number(argValue(args, "--limit", "3")));
  const force = args.includes("--force");
  const agentModel = argValue(args, "--agent-model", DEFAULT_AGENT_MODEL);
  const cliFlags = { days, limit, force, agentModel };

  const config = await readConfig();
  // No token → no upload possible; let the original error bubble so
  // the user sees the actionable login message.
  requireLoggedIn(config);
  const fetchProgress = createFetchProgressState({
    stage: "starting",
    counters: { sourcesTotal: 0, sourcesChecked: 0 },
    current: { source: null },
  });

  let perBuilder = [];
  const userActions = [];
  const localErrors = [];
  let buildersAttempted = 0;
  let itemsFetched = 0;
  let tasksGenerated = 0;
  let errorCount = 0;
  // Audit trail uploaded with the fetch run so users can later see
  // exactly which tasks were queued and which prompts the agent was
  // asked to follow. Filled before each emitFetchRunRecord call so the
  // catch path also reports whatever made it into the queue.
  let slimFetchTasks = [];

  try {
    const context = await getJson(
      `${config.appUrl}/api/skill/context?intent=library&days=${encodeURIComponent(String(days))}`,
      config.token,
      { label: "library context" },
    );
    const subscribedBuilderIds = new Set(
      (context.subscriptions ?? []).map((builder) => builder.id),
    );
    const personalBuilders = personalBuildersForFetch(context);
    buildersAttempted = personalBuilders.length;
    await emitFetchJobProgress(config, fetchProgress, {
      stage: "scanning_sources",
      counters: {
        sourcesTotal: personalBuilders.length,
        sourcesChecked: 0,
      },
      current: { source: personalBuilders[0]?.name ?? null },
      event: {
        type: "scanning_sources",
        message: `Scanning ${personalBuilders.length} source${personalBuilders.length === 1 ? "" : "s"}.`,
      },
    });

    if (personalBuilders.length === 0) {
      const payload = { status: "ok", localErrors: [], fetchTasks: [] };
      console.log(JSON.stringify(payload, null, 2));
      await emitFetchJobProgress(config, fetchProgress, {
        stage: "reconciled",
        counters: {
          sourcesTotal: 0,
          sourcesChecked: 0,
          tasksPlanned: 0,
          tasksDone: 0,
        },
        current: {},
        event: {
          type: "reconciled",
          message: "No personal sources to fetch.",
        },
      });
      await emitFetchRunRecord(config, {
        startedAt,
        status: "ok",
        source: runSource,
        buildersAttempted: 0,
        itemsFetched: 0,
        tasksGenerated: 0,
        userActionsCount: 0,
        errorCount: 0,
        summary: "No personal builders to fetch.",
        details: {
          perBuilder: [],
          userActions: [],
          localErrors: [],
          cliFlags,
        },
      });
      return;
    }

    const planned = await buildFetchTasksForBuilders({
      builders: personalBuilders,
      context,
      force,
      days,
      limit,
      runStartedAt: startedAt,
      agentModel,
      subscribedBuilderIds,
      config,
      defaultSummaryLanguage: context.language ?? "zh",
      onSourceProgress: async (builderStat) => {
        const checked = (fetchProgress.counters.sourcesChecked ?? 0) + 1;
        const sourceStatus = builderStat.error
          ? "failed"
          : builderStat.fallback
            ? "fallback"
            : "checked";
        await emitFetchJobProgress(config, fetchProgress, {
          counters: {
            sourcesChecked: checked,
            candidatesFound:
              (fetchProgress.counters.candidatesFound ?? 0) +
              builderStat.itemsFetched +
              builderStat.tasksGenerated,
          },
          current: {
            source: personalBuilders[checked]?.name ?? null,
          },
          source: {
            builderId: builderStat.builderId,
            name: builderStat.name,
            sourceType: builderStat.sourceType,
            status: sourceStatus,
            itemsFetched: builderStat.itemsFetched,
            tasksGenerated: builderStat.tasksGenerated,
            discoveryTasksGenerated: builderStat.discoveryTasksGenerated,
            error: builderStat.error ?? null,
          },
          event: {
            type: "source_checked",
            builderId: builderStat.builderId,
            status: sourceStatus,
            reason: builderStat.error ?? builderStat.fallback?.reason ?? null,
            message: sourceProgressMessage(builderStat),
          },
        });
      },
    });
    const fetchTasks = planned.fetchTasks;
    const agentTasks = planned.agentTasks;
    itemsFetched = planned.itemsFetched;
    tasksGenerated = planned.tasksGenerated;
    errorCount = planned.errorCount;
    await emitFetchJobProgress(config, fetchProgress, {
      stage: "tasks_planned",
      counters: {
        tasksPlanned: tasksGenerated,
        tasksDone: 0,
      },
      current: { source: null },
      event: {
        type: "tasks_planned",
        message: `Planned ${tasksGenerated} post task${tasksGenerated === 1 ? "" : "s"}.`,
      },
    });

    // Extract user-action items (e.g. x_token_missing) into a
    // first-class collection so the UI can surface them prominently.
    for (const task of agentTasks) {
      const kind = task?.agentWorkType ?? "";
      if (isUserActionAgentWorkType(kind)) {
        userActions.push({
          kind,
          builder: task.builder ?? task.builderId ?? "unknown",
          message: task.agentMessage ?? task.fallbackReason ?? "",
          ...(task.agentHelpUrl ? { helpUrl: task.agentHelpUrl } : {}),
        });
      }
    }

    perBuilder = [...planned.builderStats.values()];
    ({ slimFetchTasks } = summarizeFetchTasksForLog(fetchTasks));

    const payload = { status: "ok", localErrors, summaryLanguage: context.language ?? "zh", fetchTasks };
    console.log(JSON.stringify(payload, null, 2));

    const status = errorCount > 0 ? "partial" : "ok";
    const summary = buildFetchRunSummary({
      itemsFetched,
      agentTaskCount: agentTasks.length - userActions.length,
      userActions,
      buildersAttempted,
    });

    await emitFetchRunRecord(config, {
      startedAt,
      status,
      source: runSource,
      buildersAttempted,
      itemsFetched,
      tasksGenerated,
      userActionsCount: userActions.length,
      errorCount,
      summary,
      details: {
        perBuilder,
        userActions,
        localErrors,
        cliFlags,
        fetchTasks: slimFetchTasks,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Always surface the original failure to the user — the upload is
    // pure observability and must never replace the real error.
    console.error(message);
    await emitFetchRunRecord(config, {
      startedAt,
      status: "failed",
      source: runSource,
      buildersAttempted,
      itemsFetched,
      tasksGenerated,
      userActionsCount: userActions.length,
      errorCount: errorCount + 1,
      summary: `Run failed: ${message}`.slice(0, 280),
      details: {
        perBuilder,
        userActions,
        localErrors,
        cliFlags,
        fetchTasks: slimFetchTasks,
        error: {
          message,
          stack: error instanceof Error ? error.stack : undefined,
        },
      },
    });
    throw error;
  }
}

// Build the audit-trail companion to a fetch run: a slim per-task
// summary (no body) of the queued tasks. This is what the user sees in
// the Fetch log details panel.
export function textStats(value) {
  const s = typeof value === "string" ? value : "";
  const trimmed = s.trim();
  return { chars: s.length, words: trimmed ? trimmed.split(/\s+/).length : 0 };
}

export function summarizeFetchTasksForLog(fetchTasks) {
  const logFetchTasks = fetchTasks.filter((task) => !isCandidateDiscoveryFetchTask(task));
  const slimFetchTasks = logFetchTasks.map((task) => {
    const ready = task?.contentStatus === "ready";
    const isUserAction = isUserActionAgentWorkType(task?.agentWorkType);
    // Stage 1: fetch-personal knows the plan and, for `ready` posts, the body
    // it already fetched. The agent-stage fields (summary size, model, final
    // status) stay null until sync-builders PATCHes them by matching `id`.
    const readyBody = ready ? textStats(task?.item?.body) : { chars: null, words: null };
    const readyHeadline = ready ? textStats(task?.item?.headline) : { chars: null, words: null };
    const readySummary = ready ? textStats(task?.item?.summary) : { chars: null, words: null };
    const rawJson = objectRecord(task?.item?.rawJson);
    return {
      id: task?.id ?? null,
      builder: task?.builder ?? null,
      builderId: task?.builderId ?? null,
      sourceType: task?.sourceType ?? null,
      contentStatus: task?.contentStatus ?? null,
      agentWorkType: task?.agentWorkType ?? null,
      title: task?.item?.title ?? null,
      url: task?.item?.url ?? null,
      fetchTool: task?.fetchTool ?? null,
      bodyChars: readyBody.chars,
      bodyWords: readyBody.words,
      headlineChars: readyHeadline.chars || null,
      headlineWords: readyHeadline.words || null,
      summaryChars: readySummary.chars || null,
      summaryWords: readySummary.words || null,
      agentRuntime: null,
      agentModel: null,
      readMethod: task?.readMethod ?? rawJson.readMethod ?? null,
      summaryMethod: task?.summaryMethod ?? rawJson.summaryMethod ?? null,
      hubSharedReuse: nonEmptyObjectRecord(rawJson.hubSharedReuse),
      status: isUserAction ? "action_needed" : ready ? "fetched" : "pending",
    };
  });
  return { slimFetchTasks };
}

function isRecoverableFetchFallback(task) {
  return (
    task?.contentStatus === "requires_agent" &&
    (task?.agentWorkType === "candidate_discovery_fallback" ||
      task?.agentWorkType === "fetch_builder_fallback")
  );
}

function sourceFallbackNotice(task, reason) {
  if (task?.agentWorkType === "fetch_builder_fallback") {
    return {
      kind: "fetch_builder_fallback",
      message: "Initial source scan stopped; Local Agent fallback was queued.",
      reason,
    };
  }
  const status = task?.discovery?.failureEvidence?.status;
  return {
    kind: "candidate_discovery_fallback",
    message: `Direct discovery was blocked${status ? ` (HTTP ${status})` : ""}; using Local Agent discovery.`,
    reason,
  };
}

function sourceProgressMessage(builderStat) {
  const posts = `${builderStat.itemsFetched} post${builderStat.itemsFetched === 1 ? "" : "s"}`;
  const tasks = `${builderStat.tasksGenerated} post task${builderStat.tasksGenerated === 1 ? "" : "s"}`;
  if ((builderStat.discoveryTasksGenerated ?? 0) > 0 && builderStat.tasksGenerated === 0) {
    return `${builderStat.name}: ${posts}, candidate discovery queued.`;
  }
  if ((builderStat.discoveryTasksGenerated ?? 0) > 0) {
    return `${builderStat.name}: ${posts}, ${tasks}, candidate discovery queued.`;
  }
  return `${builderStat.name}: ${posts}, ${tasks}.`;
}

function buildFetchRunSummary({
  itemsFetched,
  agentTaskCount,
  userActions,
  buildersAttempted,
}) {
  const parts = [];
  if (itemsFetched > 0) {
    parts.push(
      `Read ${itemsFetched} post${itemsFetched === 1 ? "" : "s"} from ${buildersAttempted} source${buildersAttempted === 1 ? "" : "s"}`,
    );
  } else {
    parts.push(`Read 0 new posts from ${buildersAttempted} source${buildersAttempted === 1 ? "" : "s"}`);
  }
  if (agentTaskCount > 0) {
    parts.push(`${agentTaskCount} post task${agentTaskCount === 1 ? "" : "s"} need Local Agent extraction`);
  }
  if (userActions.length > 0) {
    parts.push(`${userActions.length} action${userActions.length === 1 ? "" : "s"} need attention`);
  }
  return parts.join(" · ").slice(0, 280);
}

async function emitFetchRunRecord(config, record) {
  if (webSyncDisabled()) return;
  if (!config?.appUrl || !config?.token) return;
  try {
    await rm(libraryFetchRunIdFile(), { force: true });
  } catch {
    // ignore — a stale id is best-effort cleanup only
  }
  const finishedAt = new Date();
  const body = {
    startedAt: record.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status: record.status,
    source: record.source,
    jobRunId: envJobRunId() || record.jobRunId || null,
    cliVersion: CLI_VERSION,
    hostname: RUN_HOSTNAME,
    platform: RUN_PLATFORM,
    buildersAttempted: record.buildersAttempted,
    itemsFetched: record.itemsFetched,
    tasksGenerated: record.tasksGenerated,
    userActionsCount: record.userActionsCount,
    errorCount: record.errorCount,
    summary: record.summary,
    // Record which agent ran this fetch and the model it used, so the web
    // fetch log can show "Codex · gpt-5-codex" instead of the static CLI
    // version. Stored in details (free-form JSON) to avoid a schema change.
    details: {
      ...(record.details ?? {}),
      jobRunId: envJobRunId() || record.jobRunId || null,
      agentRuntime: DEFAULT_AGENT_RUNTIME || null,
      agentModel: DEFAULT_AGENT_MODEL || null,
    },
  };
  try {
    // The builders route refuses to persist posts without an existing fetch
    // run (reset fence), so this upload is load-bearing for the whole sync,
    // not just the fetch log. Retry once on transient failures: a rare
    // duplicate log row (committed POST + lost response) is far cheaper than
    // discarding every fetched post when sync later has no run id.
    const result = await postJson(`${config.appUrl}/api/skill/fetch-runs`, body, config.token, {
      label: "fetch log upload",
      retries: 1,
    });
    if (result?.id) {
      // Hand the run id to the later sync-builders step so it can attach
      // per-post outcomes. The builders route hard-requires this id, so
      // sync-builders fails fast with an actionable error when the file is
      // missing instead of uploading a payload the server will 409.
      try {
        const runIdFile = libraryFetchRunIdFile();
        await mkdir(dirname(runIdFile), { recursive: true });
        await writeFile(runIdFile, String(result.id), "utf8");
      } catch (persistError) {
        const message = persistError instanceof Error ? persistError.message : String(persistError);
        console.error(`Failed to persist fetch run id (sync-builders will refuse to run): ${message}`);
      }
    }
  } catch (uploadError) {
    const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
    // Upload failure is non-fatal here: the CLI's primary contract (JSON
    // output + downstream agent steps) must keep working even when the
    // server is unreachable. The later sync-builders step will fail fast on
    // the missing run id rather than losing posts to a server-side 409.
    console.error(`Failed to upload fetch log: ${message}`);
  }
}

function normalizePersonalFetchResult(result) {
  if (Array.isArray(result)) return { items: result, agentTasks: [] };
  return {
    items: Array.isArray(result?.items) ? result.items : [],
    agentTasks: Array.isArray(result?.agentTasks) ? result.agentTasks : [],
  };
}

function filterFinalFetchedItemsByCutoff(items, cutoff) {
  return items.filter((item) => itemIsWithinFetchCutoff(item, cutoff));
}

function filterFinalAgentTasksByCutoff(agentTasks, cutoff) {
  return agentTasks.filter((task) => itemIsWithinFetchCutoff(task?.item, cutoff));
}

export function itemIsWithinFetchCutoff(item, cutoff) {
  return isAfterCutoff(item?.publishedAt, cutoff);
}

export function fetchTasksForReadyBuilders(builders, sources = {}, commonSummaryRules = "") {
  return builders.flatMap((builder) =>
    (builder.items ?? []).map((item) => ({
      type: "fetch_post",
      contentStatus: "ready",
      builder: builder.name,
      builderId: builder.builderId,
      sourceType: builder.sourceType,
      fetchCutoff: builder.fetchCutoff ?? null,
      builderSync: {
        builderId: builder.builderId,
        kind: builder.kind,
        sourceType: builder.sourceType,
        name: builder.name,
        handle: builder.handle ?? null,
        sourceUrl: builder.sourceUrl ?? null,
        fetchUrl: builder.fetchUrl ?? null,
        bio: builder.bio ?? null,
        subscribe: Boolean(builder.subscribe),
      },
      item: {
        kind: item.kind,
        externalId: item.externalId,
        title: item.title ?? null,
        url: item.url,
        publishedAt: item.publishedAt ?? null,
        sourceName: item.sourceName ?? builder.name,
        body: String(item.body ?? "").slice(0, 12000),
        ...(item.mediaDurationSeconds != null ? { mediaDurationSeconds: item.mediaDurationSeconds } : {}),
      },
      ...(item.mediaDurationSeconds != null ? { mediaDurationSeconds: item.mediaDurationSeconds } : {}),
      ...(item.captionAvailability ? { captionAvailability: item.captionAvailability } : {}),
      ...(item.plannedExtractionMethod ? { plannedExtractionMethod: item.plannedExtractionMethod } : {}),
      ...(item.estimateEvidence ? { estimateEvidence: item.estimateEvidence } : {}),
      summaryInstructions: singlePostSummaryInstructions(builder.sourceType, sources, commonSummaryRules),
      id: fetchTaskId({ builderId: builder.builderId, builder: builder.name, item }),
    })),
  );
}

const HUB_SHARED_REUSE_READ_METHOD = "Copied body from a Hub-shared post with the same URL";
const HUB_SHARED_REUSE_SUMMARY_METHOD = "Copied matching-language summary from a Hub-shared post";
const HUB_SHARED_REUSE_TRANSLATE_SUMMARY_METHOD = "Translated summary from a Hub-shared post";

function sharedPostReuseCandidate(task) {
  if (!task || isCandidateDiscoveryFetchTask(task)) return null;
  if (isUserActionAgentWorkType(task?.agentWorkType)) return null;
  const id = String(task?.id || fetchTaskId(task));
  const url = stringValue(task?.item?.url);
  if (!id || !url) return null;
  return {
    id,
    url,
    title: task?.item?.title ?? null,
    kind: task?.item?.kind ?? null,
    sourceType: task?.sourceType ?? null,
  };
}

function chunkArray(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

async function fetchSharedPostReuseMatches(config, candidates, summaryLanguage) {
  if (candidates.length === 0) return new Map();
  const matches = new Map();
  for (const chunk of chunkArray(candidates, 500)) {
    const response = await postJson(
      `${config.appUrl}/api/skill/shared-post-reuse`,
      { summaryLanguage, candidates: chunk },
      config.token,
      { label: "shared post reuse", retries: 1 },
    );
    for (const match of Array.isArray(response?.matches) ? response.matches : []) {
      if (match?.id) matches.set(String(match.id), match);
    }
  }
  return matches;
}

function languageKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isOriginalContentLanguageAlias(value) {
  const normalized = languageKey(value);
  return (
    normalized === ORIGINAL_CONTENT_LANGUAGE_VALUE ||
    normalized === "original" ||
    normalized === "original content language"
  );
}

function sharedPostSummaryMatchesTarget(match, targetLanguage) {
  if (typeof match?.summaryMatchesTarget === "boolean") return match.summaryMatchesTarget;
  const stored = languageKey(match?.summaryLanguage);
  const target = languageKey(targetLanguage);
  if (isOriginalContentLanguageAlias(stored) || isOriginalContentLanguageAlias(target)) {
    return isOriginalContentLanguageAlias(stored) && isOriginalContentLanguageAlias(target);
  }
  return Boolean(stored && target && stored === target);
}

function translateSummaryOnlyInstructions(task, match, targetLanguage) {
  const sourceLanguage = String(match?.summaryLanguage || "source language").trim();
  const target = String(targetLanguage || task?.summaryInstructions?.language || "zh").trim();
  return {
    ...(task?.summaryInstructions && typeof task.summaryInstructions === "object" ? task.summaryInstructions : {}),
    language: target,
    scope: "single_post",
    sourceUrlRequired: false,
    useOnlySuppliedItem: true,
    prompt: [
      `Translate the Hub-shared summary only into ${target}.`,
      "",
      "Do not fetch task.item.url, download media, read task.item.body as source content, or use external pages.",
      "Use only task.summaryTranslation.sourceSummary as the source text.",
      sourceLanguage ? `The source summary language is ${sourceLanguage}.` : "",
      "",
      "Output one FollowBrief single-post summary and one post headline in the normal shard result item.",
      "Leave item.body empty or omit it; the runner will preserve the planned empty body.",
      "",
      "Hard validation rules for the output `summary` string:",
      "- Keep `summary` between 40 and 1200 characters.",
      "- Do not duplicate the title.",
      "- Do not copy the beginning of any body as the whole summary.",
      "",
      "Hard validation rules for the output `headline` string:",
      `- Include a non-empty one-sentence \`headline\` with ${MAX_POST_HEADLINE_WORDS} words or fewer and ${MAX_POST_HEADLINE_CHARS} characters or fewer.`,
      "- Write `headline` in the same language as `summary`.",
      "- Do not duplicate the title or the full summary.",
    ].filter(Boolean).join("\n"),
  };
}

function sharedPostReuseRawJson(task, match, { summaryReused, headlineReused = false, bodyReused, summaryTranslated = false }) {
  const rawJson = objectRecord(task?.item?.rawJson);
  return {
    ...rawJson,
    fetchTaskId: rawJson.fetchTaskId ?? String(task?.id || fetchTaskId(task)),
    ...(bodyReused ? { readMethod: HUB_SHARED_REUSE_READ_METHOD } : {}),
    ...(summaryReused ? { summaryMethod: HUB_SHARED_REUSE_SUMMARY_METHOD } : {}),
    ...(summaryTranslated ? { summaryMethod: HUB_SHARED_REUSE_TRANSLATE_SUMMARY_METHOD } : {}),
    ...(summaryTranslated ? { agentWorkType: "translate_summary_only" } : {}),
    hubSharedReuse: {
      source: "hub_shared_post",
      bodyReused,
      summaryReused,
      headlineReused,
      summaryTranslated,
      feedItemId: match?.source?.feedItemId ?? null,
      builderId: match?.source?.builderId ?? null,
      builderName: match?.source?.builderName ?? null,
      url: match?.source?.url ?? null,
      summaryLanguage: match?.summaryLanguage ?? null,
    },
  };
}

export function applySharedPostReuseToTask(task, match, options = {}) {
  const reusableBody = typeof match?.body === "string" && match.body.trim()
    ? match.body
    : "";
  const bodyReused = Boolean(reusableBody && match?.bodyReused !== false);
  const rawSummary = typeof match?.summary === "string" && match.summary.trim() ? match.summary.trim() : null;
  const rawHeadline = typeof match?.headline === "string" && match.headline.trim() ? match.headline.trim() : null;
  const title = stringValue(task?.item?.title);
  const reusableSummary = rawSummary && validateReusableSourceSummary(rawSummary, { title }).length === 0
    ? rawSummary
    : null;
  const reusableHeadline = rawHeadline && validateItemHeadline(rawHeadline, {
    title,
    summary: reusableSummary ?? "",
  }).length === 0
    ? rawHeadline
    : null;
  const summaryCanBeCopied = Boolean(
    reusableSummary &&
    reusableHeadline &&
    sharedPostSummaryMatchesTarget(match, options.summaryLanguage) &&
    validateFinalSummary(reusableSummary, { title, body: bodyReused ? reusableBody : task?.item?.body || "" }).length === 0,
  );
  const summaryCanBeTranslated = Boolean(
    reusableSummary &&
    !sharedPostSummaryMatchesTarget(match, options.summaryLanguage),
  );
  const summary = summaryCanBeCopied || summaryCanBeTranslated ? reusableSummary : null;
  if (!bodyReused && !summary) return task;
  const targetLanguage = options.summaryLanguage ?? task?.summaryInstructions?.language ?? null;
  const baseItem = {
    ...(task.item ?? {}),
    body: bodyReused ? reusableBody : "",
  };
  if (summaryCanBeCopied) {
    return {
      ...task,
      contentStatus: "ready",
      deterministicSync: true,
      readMethod: bodyReused ? HUB_SHARED_REUSE_READ_METHOD : task?.readMethod,
      summaryMethod: HUB_SHARED_REUSE_SUMMARY_METHOD,
      item: {
        ...baseItem,
        summary,
        headline: reusableHeadline,
        rawJson: sharedPostReuseRawJson(task, match, {
          summaryReused: true,
          headlineReused: true,
          bodyReused,
        }),
      },
    };
  }
  if (summaryCanBeTranslated && summary) {
    return {
      ...task,
      agentWorkType: "translate_summary_only",
      contentStatus: "ready",
      deterministicSync: false,
      readMethod: bodyReused ? HUB_SHARED_REUSE_READ_METHOD : task?.readMethod,
      summaryMethod: HUB_SHARED_REUSE_TRANSLATE_SUMMARY_METHOD,
      summaryTranslation: {
        sourceSummary: summary,
        sourceLanguage: match?.summaryLanguage ?? null,
        targetLanguage,
        sourceFeedItemId: match?.source?.feedItemId ?? null,
      },
      summaryInstructions: translateSummaryOnlyInstructions(task, match, targetLanguage),
      item: {
        ...baseItem,
        rawJson: sharedPostReuseRawJson(task, match, {
          summaryReused: false,
          bodyReused,
          summaryTranslated: true,
        }),
      },
    };
  }
  return {
    ...task,
    contentStatus: "ready",
    deterministicSync: false,
    readMethod: HUB_SHARED_REUSE_READ_METHOD,
    item: {
      ...baseItem,
      rawJson: sharedPostReuseRawJson(task, match, {
        summaryReused: false,
        bodyReused: true,
      }),
    },
  };
}

async function applySharedPostReuseToFetchTasks(fetchTasks, { config, summaryLanguage }) {
  const candidates = fetchTasks.map(sharedPostReuseCandidate).filter(Boolean);
  if (candidates.length === 0) return fetchTasks;
  let matches;
  try {
    matches = await fetchSharedPostReuseMatches(config, candidates, summaryLanguage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Shared Hub post reuse lookup failed; continuing without reuse: ${message}`);
    return fetchTasks;
  }
  if (matches.size === 0) return fetchTasks;
  return fetchTasks.map((task) => {
    const id = String(task?.id || fetchTaskId(task));
    return applySharedPostReuseToTask(task, matches.get(id), { summaryLanguage });
  });
}

const FALLBACK_FEED_ITEM_KIND_BY_BUILDER_KIND = {
  X: "TWEET",
  BLOG: "BLOG_POST",
  PODCAST: "PODCAST_EPISODE",
  WEBSITE: "OTHER",
};

const PRODUCT_HUNT_CANDIDATE_DISCOVERY_PROMPT = `# Product Hunt Top Products Candidate Discovery

You are discovering Product Hunt top-product candidates for FollowBrief after
the deterministic CLI discovery failed.

Use the supplied \`task.discovery.sourceUrl\`, \`task.discovery.date\`, and
\`task.discovery.limit\`. Try available browser/search/local methods, but only
return products you can verify as Product Hunt top products for that date or
current leaderboard. Do not invent products from general web search.

Return strict JSON only:

{
  "status": "ok",
  "candidates": [
    {
      "rank": 1,
      "productName": "Product name",
      "productUrl": "https://www.producthunt.com/products/product-slug",
      "tagline": "Short Product Hunt tagline when visible",
      "date": "YYYY-MM-DD",
      "evidenceUrls": ["https://www.producthunt.com/"]
    }
  ]
}

If you cannot verify concrete Product Hunt product candidates, return:

{
  "status": "blocked",
  "reason": "product_hunt_discovery_blocked",
  "evidence": { "blocker": "..." }
}`;

const CANDIDATE_DISCOVERY_FALLBACK_BY_SOURCE_ID = {
  product_hunt_top_products: {
    prompt: PRODUCT_HUNT_CANDIDATE_DISCOVERY_PROMPT,
    candidateSchema: {
      required: ["rank", "productName", "productUrl", "date", "evidenceUrls"],
      urlPattern: "^https://www\\.producthunt\\.com/products/",
    },
    normalizeCandidate(candidate, task) {
      const url = absoluteUrl(candidate?.productUrl, PRODUCT_HUNT_TOP_PRODUCTS_URL);
      const slug = productHuntSlugFromUrl(url);
      const name = String(candidate?.productName || "").trim();
      if (!slug || !name || !url.startsWith("https://www.producthunt.com/products/")) return null;
      const rank = Number.isFinite(Number(candidate?.rank)) && Number(candidate.rank) > 0
        ? Number(candidate.rank)
        : null;
      const date =
        normalizedDate(candidate?.date)?.slice(0, 10) ||
        task?.discovery?.date ||
        new Date().toISOString().slice(0, 10);
      return {
        slug,
        name,
        rank: rank || 0,
        url,
        externalId: productHuntTopProductExternalId(slug),
        title: `${rank ? `#${rank} ` : ""}${name}`,
        description: String(candidate?.tagline || "").trim() || null,
        comments: 0,
        upvotes: 0,
        date,
        leaderboardUrl: task?.discovery?.sourceUrl || PRODUCT_HUNT_TOP_PRODUCTS_URL,
        discovery: {
          fetchTaskId: task?.id || null,
          evidenceUrls: Array.isArray(candidate?.evidenceUrls)
            ? candidate.evidenceUrls.filter((url) => typeof url === "string" && url.trim())
            : [],
        },
      };
    },
    buildAgentTask(builder, candidate, options) {
      return productHuntAgentTaskForProduct(builder, candidate, options);
    },
  },
};

function buildPersonalFetchErrorTask(
  builder,
  {
    builderSync,
    error,
    limit,
    now = new Date(),
    sources = {},
    commonFetchRules = DEFAULT_FETCH_GUIDANCE,
    commonSummaryRules = "",
  } = {},
) {
  const sourceType = builderSync?.sourceType ?? sourceTypeIdForBuilder(builder);
  const discoveryFallback = CANDIDATE_DISCOVERY_FALLBACK_BY_SOURCE_ID[sourceType];
  if (discoveryFallback) {
    return buildCandidateDiscoveryFallbackTask(builder, builderSync, {
      error,
      limit,
      now,
      sourceType,
      sourceConfig: sources?.[sourceType] ?? null,
      discoveryFallback,
    });
  }
  return buildBuilderFallbackTask(builder, builderSync, {
    error,
    sources,
    commonFetchRules,
    commonSummaryRules,
  });
}

export function buildPersonalFetchErrorTaskForTest(builder, options = {}) {
  return buildPersonalFetchErrorTask(builder, {
    commonFetchRules: DEFAULT_FETCH_GUIDANCE,
    commonSummaryRules: "",
    ...options,
  });
}

function buildCandidateDiscoveryFallbackTask(
  builder,
  builderSync,
  { error, limit, now = new Date(), sourceType, sourceConfig = null, discoveryFallback } = {},
) {
  const task = {
    type: "candidate_discovery",
    agentWorkType: "candidate_discovery_fallback",
    contentStatus: "requires_agent",
    builder: builder.name,
    builderId: builder.id,
    sourceType,
    builderSync,
    discovery: {
      sourceUrl: builder.fetchUrl || builder.sourceUrl || builderSync?.fetchUrl || builderSync?.sourceUrl || "",
      fetchUrl: builder.fetchUrl || builderSync?.fetchUrl || null,
      limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
      date: now instanceof Date ? now.toISOString().slice(0, 10) : normalizedDate(now)?.slice(0, 10),
      candidateSchema: discoveryFallback?.candidateSchema ?? {},
      failureEvidence: fetchFailureEvidence(error),
    },
    discoveryInstructions: {
      scope: "candidate_discovery",
      prompt: discoveryFallback?.prompt ?? "",
    },
    ...(sourceConfig ? { sourceConfigSnapshot: compactSourceConfigSnapshot(sourceConfig) } : {}),
    fallbackReason: error?.message || String(error || "Personal fetcher failed"),
  };
  task.id = candidateDiscoveryTaskId(task);
  return task;
}

function compactSourceConfigSnapshot(sourceConfig) {
  return {
    id: sourceConfig.id,
    label: sourceConfig.label,
    contentQuality: sourceConfig.contentQuality,
    summaryPrompt: sourceConfig.summaryPrompt,
    fetchPrompt: sourceConfig.fetchPrompt,
  };
}

function candidateDiscoveryTaskId(task) {
  return [
    "candidate_discovery",
    task?.builderId || task?.builder || "builder",
    task?.sourceType || "source",
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}

function fetchFailureEvidence(error) {
  const message = error?.message || String(error || "");
  const status = Number(message.match(/\bHTTP\s+(\d{3})\b/i)?.[1] ?? NaN);
  return {
    message,
    ...(Number.isFinite(status) ? { status } : {}),
  };
}

function buildBuilderFallbackTask(
  builder,
  builderSync,
  { error, sources = {}, commonFetchRules = DEFAULT_FETCH_GUIDANCE, commonSummaryRules = "" } = {},
) {
  const kind = FALLBACK_FEED_ITEM_KIND_BY_BUILDER_KIND[builder.kind] || "OTHER";
  const handle = builder.handle ? String(builder.handle).replace(/^@/, "") : null;
  const url =
    builder.sourceUrl ||
    builder.fetchUrl ||
    (handle && builder.kind === "X" ? `https://x.com/${handle}` : null) ||
    "";
  const item = {
    kind,
    externalId: `agent-fallback:${builder.id}`,
    title: null,
    url,
    publishedAt: null,
    sourceName: builder.name,
    body: "",
  };
  const sourceType = builderSync.sourceType ?? sourceTypeIdForBuilder(builder);
  const fetchInstructions = singlePostFetchInstructions(sourceType, sources, commonFetchRules);
  const task = {
    type: "fetch_post",
    agentWorkType: "fetch_builder_fallback",
    contentStatus: "requires_agent",
    builder: builder.name,
    builderId: builder.id,
    sourceType,
    builderSync,
    item,
    minimumContentQuality: minimumContentQualityForSource(sourceType, sources),
    summaryInstructions: singlePostSummaryInstructions(sourceType, sources, commonSummaryRules),
    fetchInstructions,
    fallbackReason: error?.message || String(error || "Personal fetcher failed"),
  };
  task.id = fetchTaskId({ builderId: builder.id, builder: builder.name, item });
  return task;
}

function fetchTaskFromAgentTask(
  task,
  builderSync,
  sources = {},
  commonFetchRules = DEFAULT_FETCH_GUIDANCE,
  commonSummaryRules = "",
) {
  const item = task.item ?? {};
  const sourceType = task.sourceType ?? builderSync.sourceType;
  const fetchInstructions =
    task.fetchInstructions ?? singlePostFetchInstructions(sourceType, sources, commonFetchRules);
  const out = {
    type: "fetch_post",
    agentWorkType: task.type,
    contentStatus: "requires_agent",
    builder: task.builder ?? builderSync.name,
    builderId: task.builderId ?? builderSync.builderId,
    sourceType,
    builderSync,
    item,
    minimumContentQuality: task.minimumContentQuality ?? minimumContentQualityForSource(sourceType, sources),
    summaryInstructions: task.summaryInstructions ?? singlePostSummaryInstructions(sourceType, sources, commonSummaryRules),
    fetchInstructions,
    id: fetchTaskId({ builderId: task.builderId ?? builderSync.builderId, builder: task.builder ?? builderSync.name, item }),
  };
  // Pass-through optional fields used by user-action tasks
  // (e.g., x_token_missing) so the agent can surface them verbatim.
  if (task.agentMessage) out.agentMessage = task.agentMessage;
  if (task.agentHelpUrl) out.agentHelpUrl = task.agentHelpUrl;
  if (task.mediaDurationSeconds != null) out.mediaDurationSeconds = task.mediaDurationSeconds;
  if (task.captionAvailability) out.captionAvailability = task.captionAvailability;
  if (task.plannedExtractionMethod) out.plannedExtractionMethod = task.plannedExtractionMethod;
  if (task.estimateEvidence) out.estimateEvidence = task.estimateEvidence;
  if (Array.isArray(task.youtubeExtractionAttempts)) out.youtubeExtractionAttempts = task.youtubeExtractionAttempts;
  if (Array.isArray(task.podcastExtractionAttempts)) out.podcastExtractionAttempts = task.podcastExtractionAttempts;
  return out;
}

export function fetchTaskId(task) {
  return [
    "fetch_post",
    task?.builderId || task?.builder || "builder",
    task?.item?.kind || "item",
    task?.item?.externalId || task?.item?.url || task?.item?.title || "unknown",
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}

// Fallback extraction guidance used only when an older server does not provide
// an admin-editable common fetch prompt in the skill context.
export const DEFAULT_FETCH_GUIDANCE = [
  "Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to pick any",
  "extraction method available: web fetch, local CLI tools (yt-dlp, curl,",
  "ffmpeg, headless browser, etc.), transcription APIs - anything you have.",
  "Keep trying available methods until real primary content that meets",
  "`task.minimumContentQuality` is obtained, or no method remains.",
  "Primary content means content from `task.item.url`, the same origin, or a",
  "canonical/redirect URL reached from `task.item.url`. Do not use web search",
  "snippets or related reporting from another publisher/domain as replacement",
  "content for a blocked primary source. If primary content cannot be obtained,",
  "write a structured failed taskOutcome with reason `primary_content_unavailable`",
  "and evidence describing the blocked URL and attempted methods.",
].join("\n");

// Build the per-source extraction instructions the agent literally
// follows when a fetchTask is `requires_agent`. Always returns a
// non-null record. The common fetch rules are always included; a
// source-specific fetchPromptBody is appended when configured.
export function singlePostFetchInstructions(
  sourceId,
  sources = {},
  commonFetchRules = DEFAULT_FETCH_GUIDANCE,
) {
  const source = sources?.[sourceId];
  const label = source?.label || sourceId;
  const body = source?.fetchPrompt?.body;
  const common = typeof commonFetchRules === "string" && commonFetchRules.trim().length > 0
    ? commonFetchRules
    : DEFAULT_FETCH_GUIDANCE;
  const hasCustom = typeof body === "string" && body.trim().length > 0;
  if (hasCustom) {
    return {
      scope: "single_post",
      isDefault: false,
      prompt: [
        `Follow these extraction rules for one ${label} post.`,
        "",
        "Common fetching rules:",
        common,
        "",
        `Source-specific fetching rules (${label}):`,
        body,
      ].join("\n"),
    };
  }
  return {
    scope: "single_post",
    isDefault: true,
    prompt: [
      `Follow these extraction rules for one ${label} post.`,
      "",
      "Common fetching rules:",
      common,
    ].join("\n"),
  };
}

export function singlePostSummaryInstructions(sourceId, sources = {}, commonSummaryRules = "") {
  const source = sources?.[sourceId];
  if (!source || !source.summaryPrompt || !source.summaryPrompt.body) {
    throw new Error(
      `Missing summary prompt for sourceId="${sourceId}" in context.sources. ` +
        "The server must seed SourceTypeConfig rows before any once-skill runs.",
    );
  }
  const summaryPrompt = source.summaryPrompt;
  return {
    language: summaryPrompt.language || "zh",
    scope: "single_post",
    sourceUrlRequired: true,
    useOnlySuppliedItem: true,
    prompt: singlePostSummaryPrompt({
      label: source.label || sourceId,
      language: summaryPrompt.language || "zh",
      body: summaryPrompt.body,
      commonSummaryRules,
    }),
    summaryStyle: summaryPrompt.style,
  };
}

function isOriginalContentLanguage(value) {
  return isOriginalContentLanguageAlias(value);
}

function singlePostSummaryPrompt(source) {
  const languageInstruction = isOriginalContentLanguage(source.language)
    ? "Write one concise FollowBrief single-post summary and one one-sentence post headline in the same language as the task's final raw body. For ready tasks, use task.item.body's language. For requires_agent tasks, first fetch the primary content, then use the final body language."
    : `Write one concise FollowBrief single-post summary and one one-sentence post headline in ${source.language}.`;
  return [
    languageInstruction,
    "",
    source.commonSummaryRules,
    "",
    "Ready-task output rule:",
    "- If task.agentWorkType is `translate_summary_only`, do not fetch task.item.url, download media, transcribe audio/video, or use task.item.body as source content. Translate only task.summaryTranslation.sourceSummary into the requested language, and leave item.body empty or omit it.",
    "- If task.contentStatus is `ready`, do not fetch task.item.url, download media, transcribe audio/video, or rewrite task.item.body. The supplied task.item.body is already the fetched source body. To save tokens, omit `item.body` from your shard result for ready tasks; the runner restores the original body before sync. Write only the `summary` and `headline` from task.item.body.",
    "",
    "Hard validation rules for the output `summary` string:",
    "- Keep `summary` between 40 and 1200 characters. If it is over 1200 characters, shorten it before writing JSON; otherwise validation fails with `summary_too_long`.",
    "- Do not duplicate the title; otherwise validation fails with `summary_duplicates_title`.",
    "- Do not copy the beginning of the source body as the whole summary; otherwise validation fails with `summary_copies_body_prefix`.",
    "",
    "Hard validation rules for the output `headline` string:",
    `- Include a non-empty one-sentence \`headline\` with ${MAX_POST_HEADLINE_WORDS} words or fewer. If it has more than ${MAX_POST_HEADLINE_WORDS} words, shorten it before writing JSON; otherwise validation fails with \`headline_too_long\`.`,
    `- Keep \`headline\` at ${MAX_POST_HEADLINE_CHARS} characters or fewer; otherwise validation fails with \`headline_too_long\`.`,
    "- Write `headline` in the same language as `summary`.",
    "- Do not duplicate the title; otherwise validation fails with `headline_duplicates_title`.",
    "- Do not copy the full summary; otherwise validation fails with `headline_duplicates_summary`.",
    "",
    `Source-specific rules (${source.label}):`,
    source.body,
  ].join("\n");
}

export function personalBuildersForFetch(context) {
  if (Array.isArray(context.libraryFetchBuilders)) {
    return context.libraryFetchBuilders;
  }
  return (context.libraryBuilders ?? []).filter(
    (builder) => builder.scope === "PERSONAL",
  );
}

export function defaultLibraryFetchResultFileForTest() {
  return defaultLibraryFetchResultFile();
}

export function libraryFetchRunIdFileForTest() {
  return libraryFetchRunIdFile();
}

export function defaultDigestContextFileForTest() {
  return defaultDigestContextFile();
}

export function accountFilePathForTest(email) {
  return accountFilePath(email);
}

export function sourcesConfigPathForTest() {
  return sourcesConfigPath();
}

export function personalFetcherSourceForBuilder(builder) {
  const sourceId = sourceTypeIdForBuilder(builder);
  const fetch = FETCH_FN_BY_SOURCE_ID[sourceId];
  if (!fetch) return null;
  const config = sourceConfigFor(sourceId);
  // Returned shape kept compatible with existing callers that do
  // `source.fetch(builder, opts)` and read `source.id`.
  return {
    id: sourceId,
    label: config?.label ?? sourceId,
    builderKind: config?.builderKind ?? builder.kind,
    syncKind: config?.builderKind ?? builder.kind,
    fetch,
  };
}

export function fetchedItemKeysForBuilder(context, builderId) {
  return new Set(
    personalFetchedItemsForContext(context)
      .filter((item) => item?.builderId === builderId)
      .map((item) => personalItemKey(item.builderId, item.kind, item.externalId)),
  );
}

export function personalItemKey(builderId, kind, externalId) {
  return `${builderId}:${kind}:${externalId}`;
}

function githubTrendingExternalId(repo) {
  return `github-trending:${repo}`;
}

function productHuntTopProductExternalId(slug) {
  return `product-hunt-top-products:${slug}`;
}

function productHuntSlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/products\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function hasFetchedGithubTrendingRepository(fetchedItemKeys, builderId, repo) {
  return hasFetchedCanonicalOrLegacyDatedItem(fetchedItemKeys, {
    builderId,
    kind: "BLOG_POST",
    canonicalExternalId: githubTrendingExternalId(repo),
    legacyPrefix: "github-trending",
    entityId: repo,
  });
}

function hasFetchedProductHuntTopProduct(fetchedItemKeys, builderId, slug) {
  return hasFetchedCanonicalOrLegacyDatedItem(fetchedItemKeys, {
    builderId,
    kind: "BLOG_POST",
    canonicalExternalId: productHuntTopProductExternalId(slug),
    legacyPrefix: "product-hunt-top-products",
    entityId: slug,
  });
}

function hasFetchedCanonicalOrLegacyDatedItem(
  fetchedItemKeys,
  { builderId, kind, canonicalExternalId, legacyPrefix, entityId },
) {
  if (fetchedItemKeys.has(personalItemKey(builderId, kind, canonicalExternalId))) {
    return true;
  }

  const legacyPrefixKey = personalItemKey(builderId, kind, `${legacyPrefix}:`);
  const legacySuffix = `:${entityId}`;
  for (const key of fetchedItemKeys) {
    if (key.startsWith(legacyPrefixKey) && key.endsWith(legacySuffix)) {
      return true;
    }
  }
  return false;
}

function personalFetchedItemsForContext(context) {
  return context.personalFetchedItems ?? [];
}

function latestPersonalFetchedItemsForContext(context) {
  return context.latestPersonalFetchedItems ?? [];
}

export function latestPostTimeForBuilder(context, builderId) {
  const latest = latestPersonalFetchedItemsForContext(context).find(
    (item) => item?.builderId === builderId,
  )?.latestPostAt;
  if (latest) return normalizedDate(latest);

  const matchingItems = personalFetchedItemsForContext(context).filter(
    (item) => item?.builderId === builderId,
  );
  return matchingItems.reduce((latestDate, item) => {
    const candidate = normalizedDate(item.publishedAt || item.createdAt);
    if (!candidate) return latestDate;
    if (!latestDate || new Date(candidate) > new Date(latestDate)) return candidate;
    return latestDate;
  }, null);
}

export function cutoffForBuilder(context, builderId, fallbackCutoff) {
  const latestPostAt = latestPostTimeForBuilder(context, builderId);
  if (!latestPostAt) return fallbackCutoff;
  const latestDate = new Date(latestPostAt);
  return latestDate > fallbackCutoff ? latestDate : fallbackCutoff;
}

function sourceTypeIdForBuilder(builder) {
  const explicit = normalizeSourceType(builder.sourceType);
  if (explicit) return explicit;

  const sources = loadSourcesConfig().sources;
  const urlText = `${builder.sourceUrl || ""} ${builder.fetchUrl || ""}`;

  // First: URL-pattern matches scoped to the builder kind (catches YouTube).
  for (const source of sources) {
    if (source.builderKind !== builder.kind) continue;
    if (!Array.isArray(source.urlPatterns) || source.urlPatterns.length === 0) continue;
    for (const pattern of source.urlPatterns) {
      if (new RegExp(pattern, "i").test(urlText)) return source.id;
    }
  }

  // Second: first source matching the kind without URL patterns (blog/x/podcast/website).
  const kindDefault = sources.find(
    (s) => s.builderKind === builder.kind && (!s.urlPatterns || s.urlPatterns.length === 0),
  );
  return kindDefault?.id ?? "website";
}

function normalizeXHandle(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const urlMatch = text.match(/(?:x\.com|twitter\.com)\/@?([A-Za-z0-9_]+)/i);
  const handle = urlMatch?.[1] || text.replace(/^@/, "");
  return handle.match(/^[A-Za-z0-9_]{1,15}$/) ? handle : "";
}

function normalizeSourceType(sourceType) {
  const normalized = String(sourceType || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "pdf") return "website";
  return normalized === "auto" ? "" : normalized;
}

async function fetchPersonalYouTubeBuilder(
  builder,
  {
    cutoff,
    limit,
    agentModel,
    fetchedItemKeys = new Set(),
    fetcher = timedSourceFetch,
    sources = {},
    commandRunner = runTool,
  },
) {
  const sourceUrl = builder.fetchUrl || builder.sourceUrl;
  if (!sourceUrl) return { items: [], agentTasks: [] };
  const { videos: fetchedVideos, sourceDetail } = await fetchYouTubeVideos(sourceUrl, fetcher);
  const videos = fetchedVideos
    .filter((video) => isAfterCutoff(video.publishedAt, cutoff))
    .filter((video) => !fetchedItemKeys.has(personalItemKey(builder.id, "PODCAST_EPISODE", video.videoId || video.url)))
    .slice(0, limit);
  const items = [];
  const agentTasks = [];

  for (const video of videos) {
    const transcriptResult = await fetchYouTubePrimaryContent(video, {
      fetcher,
      commandRunner,
      metadata: {
        title: video.title,
        description: video.description,
      },
    });
    const transcript = transcriptResult.text || "";
    const transcriptSource = transcriptResult.transcriptSource || (transcript ? "youtube-captions" : "missing");
    const quality = youtubeContentQuality(transcript, {
      source: transcriptSource,
      title: video.title,
      description: video.description,
      standards: youtubeMinimumContentQuality(sources),
    });
    if (!quality.ok) {
      agentTasks.push(youtubeAgentTaskForVideo(builder, video, sources, {
        youtubeExtractionAttempts: transcriptResult.attempts || [],
        contentQuality: quality,
        mediaDurationSeconds: transcriptResult.mediaDurationSeconds ?? null,
        captionAvailability: transcriptResult.captionAvailability ?? "no_usable_captions",
        plannedExtractionMethod: transcriptResult.plannedExtractionMethod ?? "audio_transcription",
        estimateEvidence: transcriptResult.mediaDurationSeconds != null
          ? estimateMediaWorkSeconds({
            mediaDurationSeconds: transcriptResult.mediaDurationSeconds,
            backend: "fallback",
            model: null,
          }).estimateEvidence
          : null,
      }));
      continue;
    }
    items.push({
      kind: "PODCAST_EPISODE",
      externalId: video.videoId || video.url,
      title: video.title || "Untitled YouTube update",
      body: transcript,
      url: video.url,
      publishedAt: video.publishedAt,
      sourceName: builder.name,
      mediaDurationSeconds: transcriptResult.mediaDurationSeconds ?? null,
      captionAvailability: transcriptResult.captionAvailability ?? "usable_captions",
      plannedExtractionMethod: "captions",
      fetchTool: skillFetchTool(
        `${sourceDetail} + captions`,
        agentModel,
      ),
      rawJson: {
        source: "personal-youtube",
        builderId: builder.id,
        builderName: builder.name,
        title: video.title,
        url: video.url,
        publishedAt: video.publishedAt,
        transcriptSource,
        captionLanguageCode: transcriptResult.captionLanguageCode,
        inferredSourceLanguage: transcriptResult.inferredSourceLanguage,
        captionSelectionReason: transcriptResult.captionSelectionReason,
        youtubeExtractionAttempts: transcriptResult.attempts || [],
        mediaDurationSeconds: transcriptResult.mediaDurationSeconds ?? null,
        captionAvailability: transcriptResult.captionAvailability ?? "usable_captions",
        contentQuality: quality,
      },
    });
  }

  return { items, agentTasks };
}

export function fetchPersonalYouTubeBuilderForTest(builder, options) {
  return fetchPersonalYouTubeBuilder(builder, options);
}

const CJK_CONTENT_UNIT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ALNUM_CONTENT_UNIT = /[\p{Letter}\p{Number}]/u;
const TIMESTAMP_TOKEN_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

function readQualityNumber(standards, primaryField, legacyField, fallback) {
  const primary = standards?.[primaryField];
  if (typeof primary === "number" && Number.isFinite(primary)) return primary;
  const legacy = standards?.[legacyField];
  if (typeof legacy === "number" && Number.isFinite(legacy)) return legacy;
  return fallback;
}

function normalizedMinimumContentQuality(standards = {}) {
  const source = standards && typeof standards === "object" ? standards : {};
  const output = { ...source };
  delete output.minWords;
  delete output.minUniqueWordRatio;
  delete output.maxTimestampWordRatio;
  output.minChars = readQualityNumber(source, "minChars", "minChars", 0);
  output.minContentUnits = readQualityNumber(source, "minContentUnits", "minWords", 0);
  const minLocalDiversity = readQualityNumber(
    source,
    "minLocalDiversity",
    "minUniqueWordRatio",
    null,
  );
  if (typeof minLocalDiversity === "number") {
    output.minLocalDiversity = minLocalDiversity;
  }
  const maxTimestampDensity = readQualityNumber(
    source,
    "maxTimestampDensity",
    "maxTimestampWordRatio",
    null,
  );
  if (typeof maxTimestampDensity === "number") {
    output.maxTimestampDensity = maxTimestampDensity;
  }
  return output;
}

// Content units are language-neutral enough for quality gating: Latin/number
// runs count as one unit, while CJK scripts count per character. Timestamps are
// removed first so time-only transcripts don't satisfy the content floor.
function contentUnits(text) {
  const units = [];
  let current = "";
  for (const char of String(text || "").replace(TIMESTAMP_TOKEN_RE, " ")) {
    if (CJK_CONTENT_UNIT.test(char)) {
      if (current) {
        units.push(current.toLowerCase());
        current = "";
      }
      units.push(char);
    } else if (ALNUM_CONTENT_UNIT.test(char)) {
      current += char;
    } else if (current) {
      units.push(current.toLowerCase());
      current = "";
    }
  }
  if (current) units.push(current.toLowerCase());
  return units;
}

function countTimestamps(text) {
  return (String(text || "").match(TIMESTAMP_TOKEN_RE) ?? []).length;
}

// Average local diversity over fixed-size windows. Unlike the global type-token
// ratio \u2014 which decays ~1/sqrt(N) (Heaps' law) and so makes any long transcript
// look "repetitive" \u2014 this stays high for real speech (each window has fresh
// vocabulary) and only collapses for genuinely repetitive text. Length-invariant
// by construction.
function localDiversity(units, windowSize = 100) {
  if (units.length === 0) return 0;
  if (units.length <= windowSize) return new Set(units).size / units.length;
  let sum = 0;
  let windows = 0;
  for (let i = 0; i + windowSize <= units.length; i += windowSize) {
    const win = units.slice(i, i + windowSize);
    sum += new Set(win).size / windowSize;
    windows += 1;
  }
  // Fold in a trailing remainder window when it's big enough to be meaningful.
  const rem = units.length % windowSize;
  if (rem >= 20) {
    const win = units.slice(units.length - rem);
    sum += new Set(win).size / rem;
    windows += 1;
  }
  return windows ? sum / windows : 0;
}

/**
 * @param {string} text
 * @param {{ source?: string; title?: string; description?: string; standards?: object }} [options]
 */
export function youtubeContentQuality(text, { source = "", title = "", description = "", standards } = {}) {
  const normalized = normalizeContentText(text);
  const units = contentUnits(normalized);
  const timestampCount = countTimestamps(normalized);
  const qualityStandards = standards ?? youtubeMinimumContentQuality();
  const metrics = {
    chars: normalized.length,
    contentUnits: units.length,
    uniqueContentUnits: new Set(units).size,
    localDiversity: localDiversity(units),
    timestampCount,
    timestampDensity: timestampCount / Math.max(units.length, 1),
  };

  const transcriptSources = new Set([
    "youtube-captions",
    "agent-transcript",
    "openai-audio-transcription",
    "local-speech-to-text",
  ]);
  if (!transcriptSources.has(String(source || ""))) {
    return {
      ok: false,
      reason: "description_or_title_is_not_primary_content",
      metrics,
      standards: qualityStandards,
    };
  }
  const minChars = readQualityNumber(qualityStandards, "minChars", "minChars", 80);
  const minContentUnits = readQualityNumber(qualityStandards, "minContentUnits", "minWords", 12);
  if (metrics.chars < minChars || metrics.contentUnits < minContentUnits) {
    return {
      ok: false,
      reason: "transcript_too_short",
      metrics,
      standards: qualityStandards,
    };
  }
  const minLocalDiversity = readQualityNumber(
    qualityStandards,
    "minLocalDiversity",
    "minUniqueWordRatio",
    0.25,
  );
  if (metrics.contentUnits >= 40 && metrics.localDiversity < minLocalDiversity) {
    return {
      ok: false,
      reason: "transcript_too_repetitive",
      metrics,
      standards: qualityStandards,
    };
  }
  const maxTimestampDensity = readQualityNumber(
    qualityStandards,
    "maxTimestampDensity",
    "maxTimestampWordRatio",
    0.1,
  );
  if (metrics.timestampCount > 0 && metrics.timestampDensity > maxTimestampDensity) {
    return {
      ok: false,
      reason: "transcript_is_timestamp_heavy",
      metrics,
      standards: qualityStandards,
    };
  }
  if (isNearDuplicate(normalized, title) || isNearDuplicate(normalized, description)) {
    return {
      ok: false,
      reason: "transcript_duplicates_title_or_description",
      metrics,
      standards: qualityStandards,
    };
  }
  return { ok: true, reason: "ok", metrics, standards: qualityStandards };
}

function minimumContentQualityForSource(sourceId, sources = {}, fallbackSourceId = "website") {
  return normalizedMinimumContentQuality(
    sources?.[sourceId]?.contentQuality ??
      sourceConfigFor(sourceId)?.contentQuality ??
      sourceConfigFor(fallbackSourceId)?.contentQuality,
  );
}

function youtubeMinimumContentQuality(sources = {}) {
  return minimumContentQualityForSource("youtube", sources, "youtube");
}

function genericMinimumContentQuality(sources = {}, sourceId = "website") {
  return minimumContentQualityForSource(sourceId, sources, "website");
}

export function agentTaskId(task) {
  return [
    task?.type || "agent_task",
    task?.builderId || task?.builder || "builder",
    task?.item?.kind || "item",
    task?.item?.externalId || task?.item?.url || task?.item?.title || "unknown",
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}

function youtubeAgentTaskForVideo(builder, video, sources = {}, extra = {}) {
  const item = {
    kind: "PODCAST_EPISODE",
    externalId: video.videoId || video.url,
    title: video.title || "Untitled YouTube update",
    url: video.url,
    publishedAt: video.publishedAt,
    sourceName: builder.name,
    description: video.description || "",
  };
  const task = {
    type: "youtube_transcription",
    builder: builder.name,
    builderId: builder.id,
    sourceType: "youtube",
    item,
    minimumContentQuality: youtubeMinimumContentQuality(sources),
    mediaDurationSeconds: extra.mediaDurationSeconds ?? null,
    captionAvailability: extra.captionAvailability ?? "no_usable_captions",
    plannedExtractionMethod: extra.plannedExtractionMethod ?? "audio_transcription",
  };
  if (task.mediaDurationSeconds != null) {
    task.estimateEvidence = extra.estimateEvidence ?? estimateMediaWorkSeconds({
      mediaDurationSeconds: task.mediaDurationSeconds,
      backend: "fallback",
      model: null,
    }).estimateEvidence;
  } else if (extra.estimateEvidence) {
    task.estimateEvidence = extra.estimateEvidence;
  }
  if (Array.isArray(extra.youtubeExtractionAttempts) && extra.youtubeExtractionAttempts.length > 0) {
    task.youtubeExtractionAttempts = extra.youtubeExtractionAttempts;
  }
  if (extra.contentQuality) task.contentQuality = extra.contentQuality;
  return { ...task, id: agentTaskId(task) };
}

function normalizeContentText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isNearDuplicate(text, reference) {
  const normalizedReference = normalizeContentText(reference);
  if (!text || !normalizedReference) return false;
  if (text === normalizedReference) return true;
  return text.length <= normalizedReference.length + 20 && normalizedReference.includes(text);
}

const NON_PRIMARY_ACQUISITION_METHOD_TOKENS = new Set([
  "description",
  "feed",
  "index",
  "listing",
  "metadata",
  "search",
  "snippet",
]);
const PRIMARY_DOCUMENT_ACQUISITION_METHOD_TOKENS = new Set([
  "article",
  "browser",
  "curl",
  "document",
  "fetch",
  "get",
  "http",
  "https",
  "page",
  "web",
]);

function acquisitionHost(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hasSameOriginPrimaryDocumentAcquisition(task, candidate) {
  const rawJson = objectRecord(candidate?.item?.rawJson);
  const acquisition = objectRecord(rawJson.acquisition);
  const targetHost = acquisitionHost(task?.item?.url);
  const providerHost = acquisitionHost(acquisition.provider);
  if (
    !targetHost ||
    !providerHost ||
    targetHost !== providerHost ||
    acquisition.processedLocally !== true
  ) {
    return false;
  }

  const methodTokens = String(acquisition.method || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (methodTokens.some((token) => NON_PRIMARY_ACQUISITION_METHOD_TOKENS.has(token))) {
    return false;
  }
  return methodTokens.some((token) => PRIMARY_DOCUMENT_ACQUISITION_METHOD_TOKENS.has(token));
}

async function sourceFetchPolicy(url, fetcher = timedSourceFetch) {
  const robotsUrl = robotsTxtUrl(url);
  if (!robotsUrl) return { allowed: true, reason: "invalid_url" };
  try {
    const response = await fetcher(robotsUrl, {
      headers: { "User-Agent": "FollowBriefSkill/1.0 (robots check)" },
    });
    if (!response.ok) return { allowed: true, reason: `robots_http_${response.status}` };
    const body = await response.text();
    return robotsAllowsUrl(body, url, "FollowBriefSkill")
      ? { allowed: true, reason: "robots_allowed" }
      : { allowed: false, reason: "robots_disallow" };
  } catch {
    return { allowed: true, reason: "robots_unavailable" };
  }
}

function robotsTxtUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}/robots.txt`;
  } catch {
    return null;
  }
}

function robotsAllowsUrl(robotsText, rawUrl, userAgent = "FollowBriefSkill") {
  let path = "/";
  try {
    const url = new URL(rawUrl);
    path = `${url.pathname || "/"}${url.search || ""}`;
  } catch {
    return true;
  }
  const groups = parseRobotsGroups(robotsText);
  const matching = groups.filter((group) =>
    group.agents.some((agent) => agent === "*" || userAgent.toLowerCase().includes(agent)),
  );
  if (matching.length === 0) return true;
  let best = { type: "allow", length: -1 };
  for (const group of matching) {
    for (const rule of group.rules) {
      if (!path.startsWith(rule.path)) continue;
      if (
        rule.path.length > best.length ||
        (rule.path.length === best.length && rule.type === "allow")
      ) {
        best = { type: rule.type, length: rule.path.length };
      }
    }
  }
  return best.type !== "disallow";
}

function parseRobotsGroups(robotsText) {
  const groups = [];
  let pendingAgents = [];
  let current = null;
  for (const rawLine of String(robotsText || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (field === "user-agent") {
      if (current && current.rules.length > 0) {
        current = null;
        pendingAgents = [];
      }
      pendingAgents.push(value.toLowerCase());
      continue;
    }
    if (field === "allow" || field === "disallow") {
      if (!current) {
        current = { agents: pendingAgents.length > 0 ? pendingAgents : ["*"], rules: [] };
        groups.push(current);
      }
      if (!value && field === "disallow") continue;
      current.rules.push({ type: field, path: value || "/" });
    }
  }
  return groups;
}

function sourceResponseDisallowsRetention(headers, html) {
  const robotsHeader = typeof headers?.get === "function" ? headers.get("x-robots-tag") : "";
  return robotsDirectivesDisallow(robotsHeader) || robotsDirectivesDisallow(metaRobotsContent(html));
}

function metaRobotsContent(html) {
  const match = String(html || "").match(
    /<meta\b[^>]*(?:name|property)=["'](?:robots|googlebot)["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  ) || String(html || "").match(
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:robots|googlebot)["'][^>]*>/i,
  );
  return match?.[1] || "";
}

function robotsDirectivesDisallow(value) {
  const text = String(value || "").toLowerCase();
  return (
    /\bnosnippet\b/.test(text) ||
    /\bnoai\b/.test(text) ||
    /\bnoimageai\b/.test(text) ||
    /\bmax-snippet\s*:\s*0\b/.test(text)
  );
}

async function fetchPersonalBlogBuilder(
  builder,
  { cutoff, limit, agentModel, fetchedItemKeys = new Set(), fetcher = timedSourceFetch, sources = {} },
) {
  const indexUrl = builder.fetchUrl || builder.sourceUrl;
  if (!indexUrl) return { items: [], agentTasks: [] };
  const indexPolicy = await sourceFetchPolicy(indexUrl, fetcher);
  if (!indexPolicy.allowed) {
    return { items: [], agentTasks: [] };
  }

  const indexResponse = await fetcher(indexUrl, {
    headers: { "User-Agent": "FollowBriefSkill/1.0 (personal agent fetcher)" },
  });
  if (!indexResponse.ok) {
    throw new Error(`Failed to fetch ${indexUrl}: HTTP ${indexResponse.status}`);
  }

  const indexBody = await indexResponse.text();
  const discoveredCandidates = await discoverBlogArticleCandidates(indexBody, indexUrl, { fetcher, cutoff, limit });
  const candidates = discoveredCandidates
    .filter((article) => isAfterCutoff(article.publishedAt, cutoff))
    .filter((article) => !fetchedItemKeys.has(personalItemKey(builder.id, "BLOG_POST", article.url)))
    .slice(0, limit);
  const items = [];
  const agentTasks = [];
  const qualityStandards = genericMinimumContentQuality(sources, "blog");

  for (const article of candidates) {
    const articlePolicy = await sourceFetchPolicy(article.url, fetcher);
    if (!articlePolicy.allowed) continue;
    const articleResponse = await fetcher(article.url, {
      headers: { "User-Agent": "FollowBriefSkill/1.0 (personal agent fetcher)" },
    });
    if (!articleResponse.ok) {
      agentTasks.push(blogAgentTaskForArticle(builder, article, { sources, agentModel, reason: `HTTP ${articleResponse.status}` }));
      continue;
    }

    const html = await articleResponse.text();
    if (sourceResponseDisallowsRetention(articleResponse.headers, html)) {
      continue;
    }
    const extracted = extractBlogArticle(html, articleResponse.url || article.url);
    // Only article-page extraction can produce a deterministic ready body.
    // Feed descriptions remain discovery metadata; if page extraction fails,
    // the agent must obtain primary content instead of silently promoting them.
    const body = extracted.body || "";
    const title = extracted.title || article.title || "Untitled";
    const publishedAt = extracted.publishedAt || article.publishedAt;
    if (!isAfterCutoff(publishedAt, cutoff)) continue;
    const quality = genericContentQuality(body, {
      title,
      description: article.description,
      standards: qualityStandards,
      primaryContentAcquisitionVerified: Boolean(extracted.body?.trim()),
    });
    if (!body.trim() || !quality.ok) {
      agentTasks.push(
        blogAgentTaskForArticle(builder, article, {
          sources,
          agentModel,
          extracted,
          reason: quality.reason,
          metrics: quality.metrics,
        }),
      );
      continue;
    }

    items.push({
      kind: "BLOG_POST",
      externalId: article.url,
      title,
      body,
      url: article.url,
      publishedAt,
      sourceName: builder.name,
      fetchTool: skillFetchTool("RSS/HTML article extractor", agentModel),
      rawJson: {
        source: "personal-blog",
        builderId: builder.id,
        builderName: builder.name,
        title,
        url: article.url,
        publishedAt,
      },
    });
  }

  return { items, agentTasks };
}

export function fetchPersonalBlogBuilderForTest(builder, options) {
  return fetchPersonalBlogBuilder(builder, options);
}

function blogAgentTaskForArticle(
  builder,
  article,
  { sources = {}, agentModel, extracted = {}, reason = "deterministic_extract_incomplete", metrics } = {},
) {
  const item = {
    kind: "BLOG_POST",
    externalId: article.url,
    title: extracted.title || article.title || "Untitled",
    url: article.url,
    publishedAt: extracted.publishedAt || article.publishedAt || null,
    sourceName: builder.name,
    description: article.description || "",
    rawJson: {
      source: "personal-blog-agent-fallback",
      builderId: builder.id,
      builderName: builder.name,
      url: article.url,
      fetchTool: skillFetchTool("blog article fallback planner", agentModel),
      fallbackReason: reason,
      ...(metrics ? { deterministicExtractMetrics: metrics } : {}),
    },
  };
  const task = {
    type: "blog_article_fetch",
    builder: builder.name,
    builderId: builder.id,
    sourceType: "blog",
    item,
    minimumContentQuality: genericMinimumContentQuality(sources, "blog"),
  };
  return { ...task, id: agentTaskId(task) };
}

async function fetchPersonalPodcastBuilder(
  builder,
  { cutoff, limit, agentModel, fetchedItemKeys = new Set(), fetcher = timedSourceFetch, sources = {} },
) {
  const rawFeedUrl = builder.fetchUrl || builder.sourceUrl;
  if (!rawFeedUrl) return { items: [], agentTasks: [] };

  // Apple Podcasts pages aren't RSS — they're directory listings. Resolve
  // them to the publisher's actual RSS feedUrl via iTunes lookup so the
  // rest of this fetcher stays a single RSS code path regardless of which
  // platform URL the user pasted.
  const feedUrl = await resolveApplePodcastFeedUrl(rawFeedUrl, fetcher);

  const response = await fetcher(feedUrl, {
    headers: { "User-Agent": "FollowBriefSkill/1.0 (personal podcast fetcher)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch podcast feed ${feedUrl}: HTTP ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parsePodcastFeedItems(xml, feedUrl)
    .filter((item) => isAfterCutoff(item.publishedAt, cutoff))
    .filter((item) => !fetchedItemKeys.has(personalItemKey(builder.id, "PODCAST_EPISODE", item.externalId)))
    .slice(0, limit);

  const items = [];
  const agentTasks = [];
  for (const item of parsed) {
    // Partition by show-notes substance. Episodes with substantial body
    // copy ship as regular items. Episodes whose RSS body is a one-line
    // tagline, ad copy, or empty go to the agent as a fallback fetch
    // task carrying the audio enclosure URL — the agent decides whether
    // to ASR the audio per the per-source fetchPrompt.
    if (podcastShowNotesAreSubstantial(item.body)) {
      items.push({
        kind: item.kind,
        externalId: item.externalId,
        title: item.title,
        body: item.body,
        url: item.url,
        publishedAt: item.publishedAt,
        sourceName: builder.name,
        fetchTool: skillFetchTool("podcast RSS feed", agentModel),
        mediaDurationSeconds: item.mediaDurationSeconds ?? null,
        captionAvailability: "not_applicable",
        plannedExtractionMethod: "rss_show_notes",
        rawJson: {
          source: "personal-podcast",
          builderId: builder.id,
          builderName: builder.name,
          feedUrl,
          mediaDurationSeconds: item.mediaDurationSeconds ?? null,
        },
      });
    } else {
      agentTasks.push(podcastAgentTaskForEpisode(builder, item, feedUrl, sources));
    }
  }

  return { items, agentTasks };
}

async function fetchPersonalGithubTrendingBuilder(
  builder,
  {
    limit,
    agentModel,
    fetchedItemKeys = new Set(),
    fetcher = timedSourceFetch,
    sources = {},
    now = new Date(),
  },
) {
  const trendingUrl = builder.fetchUrl || builder.sourceUrl || GITHUB_TRENDING_URL;
  const response = await fetcher(trendingUrl, {
    headers: { "User-Agent": "FollowBriefSkill/1.0 (github trending fetcher)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub Trending ${trendingUrl}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const dateKey = now.toISOString().slice(0, 10);
  const candidates = parseGithubTrendingCandidates(html, trendingUrl, dateKey)
    .filter((repo) => !hasFetchedGithubTrendingRepository(fetchedItemKeys, builder.id, repo.repo))
    .slice(0, limit);

  return {
    items: [],
    agentTasks: candidates.map((repo) =>
      githubTrendingAgentTaskForRepository(builder, repo, { sources, agentModel }),
    ),
  };
}

export function fetchPersonalGithubTrendingBuilderForTest(builder, options) {
  return fetchPersonalGithubTrendingBuilder(builder, options);
}

export function parseGithubTrendingCandidates(html, trendingUrl = GITHUB_TRENDING_URL, dateKey = new Date().toISOString().slice(0, 10)) {
  const articleMatches = [...String(html || "").matchAll(/<article\b[\s\S]*?<\/article>/gi)];
  const candidates = [];

  for (const match of articleMatches) {
    const block = match[0];
    const h2 = block.match(/<h2\b[\s\S]*?<\/h2>/i)?.[0] ?? block;
    const href = h2.match(/href=["']\/([^/"'<>\s]+\/[^"'<>\s]+)["']/i)?.[1];
    if (!href) continue;

    const repo = href
      .replace(/^\/+/, "")
      .split("/")
      .slice(0, 2)
      .map((part) => decodeHtml(part.trim()))
      .join("/");
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) continue;

    const text = stripHtml(block);
    const starsToday = Number(
      (text.match(/(\d[\d,]*)\s+stars?\s+today/i)?.[1] ?? "0").replace(/,/g, ""),
    );
    const description =
      stripHtml(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "") || null;
    const language =
      stripHtml(
        block.match(/itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ??
          "",
      ) || null;

    candidates.push({
      repo,
      owner: repo.split("/")[0],
      name: repo.split("/")[1],
      url: absoluteUrl(`/${repo}`, trendingUrl),
      externalId: githubTrendingExternalId(repo),
      title: `${repo}${starsToday > 0 ? ` - ${starsToday} stars today` : ""}`,
      description,
      language,
      starsToday,
      date: dateKey,
      trendingUrl,
    });
  }

  return candidates.sort((a, b) => (b.starsToday || 0) - (a.starsToday || 0));
}

async function fetchPersonalProductHuntTopProductsBuilder(
  builder,
  {
    limit,
    agentModel,
    fetchedItemKeys = new Set(),
    fetcher = timedSourceFetch,
    sources = {},
    now = new Date(),
  },
) {
  const leaderboardUrl = builder.fetchUrl || builder.sourceUrl || PRODUCT_HUNT_TOP_PRODUCTS_URL;
  const response = await fetcher(leaderboardUrl, {
    headers: { "User-Agent": "FollowBriefSkill/1.0 (product hunt top products fetcher)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Product Hunt Top Products ${leaderboardUrl}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const dateKey = now.toISOString().slice(0, 10);
  const candidates = parseProductHuntTopProductCandidates(html, leaderboardUrl, dateKey)
    .filter((product) => !hasFetchedProductHuntTopProduct(fetchedItemKeys, builder.id, product.slug))
    .slice(0, limit);

  return {
    items: [],
    agentTasks: candidates.map((product) =>
      productHuntAgentTaskForProduct(builder, product, { sources, agentModel }),
    ),
  };
}

export function fetchPersonalProductHuntTopProductsBuilderForTest(builder, options) {
  return fetchPersonalProductHuntTopProductsBuilder(builder, options);
}

export function parseProductHuntTopProductCandidates(
  html,
  leaderboardUrl = PRODUCT_HUNT_TOP_PRODUCTS_URL,
  dateKey = new Date().toISOString().slice(0, 10),
) {
  const source = String(html || "");
  const linkMatches = [
    ...source.matchAll(/<a\b[^>]*href=["']\/products\/([^"'?#\s/]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi),
  ];
  const candidates = [];
  const seen = new Set();

  for (let i = 0; i < linkMatches.length; i += 1) {
    const match = linkMatches[i];
    const slug = decodeHtml(match[1].trim());
    if (!slug || seen.has(slug)) continue;
    const name = stripHtml(match[2]);
    if (!name) continue;
    seen.add(slug);

    const blockStart = match.index ?? 0;
    const blockEnd = linkMatches[i + 1]?.index ?? Math.min(source.length, blockStart + 2500);
    const block = source.slice(blockStart, blockEnd);
    const text = stripHtml(block);
    const comments = Number(
      (text.match(/(\d[\d,]*)\s+comments?/i)?.[1] ?? "0").replace(/,/g, ""),
    );
    const upvotes = Number(
      (text.match(/(\d[\d,]*)\s+upvotes?/i)?.[1] ?? "0").replace(/,/g, ""),
    );
    const description = productHuntDescriptionFromBlock(block, name);
    const rank = candidates.length + 1;

    candidates.push({
      slug,
      name,
      rank,
      url: absoluteUrl(`/products/${slug}`, leaderboardUrl),
      externalId: productHuntTopProductExternalId(slug),
      title: `#${rank} ${name}`,
      description,
      comments,
      upvotes,
      date: dateKey,
      leaderboardUrl,
    });
  }

  return candidates;
}

function productHuntDescriptionFromBlock(block, name) {
  const spans = [
    ...String(block || "").matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi),
    ...String(block || "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi),
  ]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean)
    .filter((text) => text !== name)
    .filter((text) => !/^\d[\d,]*\s+(comments?|upvotes?)$/i.test(text));
  return spans[0] || null;
}

function productHuntAgentTaskForProduct(builder, product, { sources = {}, agentModel } = {}) {
  const item = {
    kind: "BLOG_POST",
    externalId: product.externalId,
    title: product.title,
    url: product.url,
    publishedAt: `${product.date}T00:00:00.000Z`,
    sourceName: builder.name,
    description: product.description || "",
    rawJson: {
      source: "product-hunt-top-products",
      builderId: builder.id,
      builderName: builder.name,
      productSlug: product.slug,
      productName: product.name,
      rank: product.rank,
      comments: product.comments,
      upvotes: product.upvotes,
      date: product.date,
      leaderboardUrl: product.leaderboardUrl,
      fetchTool: skillFetchTool("Product Hunt top product planner", agentModel),
      ...(product.discovery?.fetchTaskId ? { discoveryFetchTaskId: product.discovery.fetchTaskId } : {}),
      ...(product.discovery?.evidenceUrls?.length ? { discoveryEvidenceUrls: product.discovery.evidenceUrls } : {}),
    },
  };
  const task = {
    type: "product_hunt_top_product_report",
    builder: builder.name,
    builderId: builder.id,
    sourceType: "product_hunt_top_products",
    item,
    minimumContentQuality: genericMinimumContentQuality(sources, "product_hunt_top_products"),
  };
  return { ...task, id: agentTaskId(task) };
}

export function expandCandidateDiscoveryFetchResult(
  fetchResult,
  discoveryPayload,
  {
    sources = {},
    commonFetchRules = DEFAULT_FETCH_GUIDANCE,
    commonSummaryRules = "",
    agentModel,
  } = {},
) {
  const discoveryByTaskId = new Map(
    (Array.isArray(discoveryPayload?.candidateDiscoveries)
      ? discoveryPayload.candidateDiscoveries
      : []
    )
      .filter((result) => result?.fetchTaskId)
      .map((result) => [String(result.fetchTaskId), result]),
  );
  const expandedTasks = [];
  const discoveryExpansions = [];
  const discoveryOutcomes = [];

  for (const task of extractFetchTasks(fetchResult)) {
    if (task?.agentWorkType !== "candidate_discovery_fallback") {
      expandedTasks.push(task);
      continue;
    }
    const sourceType = task.sourceType;
    const discoveryFallback = CANDIDATE_DISCOVERY_FALLBACK_BY_SOURCE_ID[sourceType];
    const discoveryTaskId = String(task.id || candidateDiscoveryTaskId(task));
    const discoveryResult = discoveryByTaskId.get(discoveryTaskId);
    if (!discoveryFallback || discoveryResult?.status !== "ok") {
      discoveryOutcomes.push(candidateDiscoveryOutcome(task, discoveryResult, {
        fallbackReason: discoveryFallback ? "candidate_discovery_result_missing" : "candidate_discovery_unsupported",
      }));
      continue;
    }

    const builderSync = task.builderSync || {};
    const builder = {
      id: task.builderId || builderSync.builderId,
      kind: builderSync.kind || "WEBSITE",
      sourceType,
      name: task.builder || builderSync.name,
      sourceUrl: builderSync.sourceUrl || task.discovery?.sourceUrl || null,
      fetchUrl: builderSync.fetchUrl || task.discovery?.fetchUrl || null,
    };
    const taskSources = {
      ...sources,
      ...(task.sourceConfigSnapshot && !sources?.[sourceType]
        ? { [sourceType]: task.sourceConfigSnapshot }
        : {}),
    };
    const candidates = [];
    for (const rawCandidate of Array.isArray(discoveryResult.candidates)
      ? discoveryResult.candidates
      : []) {
      const candidate = discoveryFallback.normalizeCandidate(rawCandidate, task);
      if (candidate) candidates.push(candidate);
      if (task.discovery?.limit && candidates.length >= Number(task.discovery.limit)) break;
    }
    const fetchTasks = candidates.map((candidate) =>
      fetchTaskFromAgentTask(
        discoveryFallback.buildAgentTask(builder, candidate, { sources: taskSources, agentModel }),
        builderSync,
        taskSources,
        commonFetchRules,
        commonSummaryRules,
      ),
    );
    if (fetchTasks.length > 0) expandedTasks.push(...fetchTasks);
    else discoveryOutcomes.push(candidateDiscoveryOutcome(task, discoveryResult, {
      fallbackReason: "candidate_discovery_no_usable_candidates",
    }));
    discoveryExpansions.push({
      fetchTaskId: discoveryTaskId,
      sourceType,
      candidates: candidates.length,
      fetchTasks: fetchTasks.length,
    });
  }

  return {
    ...fetchResult,
    fetchTasks: expandedTasks,
    taskOutcomes: [
      ...(Array.isArray(fetchResult?.taskOutcomes) ? fetchResult.taskOutcomes : []),
      ...discoveryOutcomes,
    ],
    discoveryExpansions,
  };
}

function candidateDiscoveryOutcome(task, discoveryResult, { fallbackReason } = {}) {
  const status = discoveryResult?.status === "blocked" ? "blocked" : "failed";
  return {
    fetchTaskId: String(task?.id || candidateDiscoveryTaskId(task)),
    status,
    reason: String(discoveryResult?.reason || fallbackReason || "candidate_discovery_failed"),
    ...(discoveryResult?.evidence && typeof discoveryResult.evidence === "object"
      ? { evidence: discoveryResult.evidence }
      : {}),
    plannedTask: fetchTaskLogPatch(task, String(task?.id || candidateDiscoveryTaskId(task))),
  };
}

function githubTrendingAgentTaskForRepository(builder, repo, { sources = {}, agentModel } = {}) {
  const item = {
    kind: "BLOG_POST",
    externalId: repo.externalId,
    title: repo.title,
    url: repo.url,
    publishedAt: `${repo.date}T00:00:00.000Z`,
    sourceName: builder.name,
    description: repo.description || "",
    rawJson: {
      source: "github-trending",
      builderId: builder.id,
      builderName: builder.name,
      repo: repo.repo,
      owner: repo.owner,
      name: repo.name,
      starsToday: repo.starsToday,
      language: repo.language,
      date: repo.date,
      trendingUrl: repo.trendingUrl,
      fetchTool: skillFetchTool("GitHub Trending repo planner", agentModel),
    },
  };
  const task = {
    type: "github_trending_repo_report",
    builder: builder.name,
    builderId: builder.id,
    sourceType: "github_trending",
    item,
    minimumContentQuality: genericMinimumContentQuality(sources, "github_trending"),
  };
  return { ...task, id: agentTaskId(task) };
}

const APPLE_PODCAST_URL_RE = /podcasts\.apple\.com\/[^?\s]*\/id(\d+)/i;

async function resolveApplePodcastFeedUrl(url, fetcher = timedSourceFetch) {
  const match = String(url || "").match(APPLE_PODCAST_URL_RE);
  if (!match) return url;
  const collectionId = match[1];
  try {
    const lookup = await fetcher(`https://itunes.apple.com/lookup?id=${collectionId}`, {
      headers: { "User-Agent": "FollowBriefSkill/1.0 (apple podcast resolver)" },
    });
    if (!lookup.ok) return url;
    const json = await lookup.json();
    const feedUrl = json?.results?.[0]?.feedUrl;
    return typeof feedUrl === "string" && feedUrl ? feedUrl : url;
  } catch {
    // Fall back to the original URL — the downstream RSS fetch will
    // surface a clearer error than "Apple lookup failed".
    return url;
  }
}

function podcastShowNotesAreSubstantial(body) {
  const text = String(body || "").trim();
  if (!text) return false;
  const units = contentUnits(text);
  // Mirrors the podcast contentQuality bar in config/sources.json
  // (minChars: 200, minContentUnits: 35). The agent's fetch prompt may apply a
  // stricter "substantial" threshold for the audio-fallback decision.
  return text.length >= 200 && units.length >= 35;
}

function podcastAgentTaskForEpisode(builder, item, feedUrl, sources = {}) {
  const taskItem = {
    kind: "PODCAST_EPISODE",
    externalId: item.externalId,
    title: item.title || "Untitled podcast episode",
    url: item.url,
    publishedAt: item.publishedAt,
    sourceName: builder.name,
    description: item.body || "",
    rawJson: {
      source: "personal-podcast-fallback",
      builderId: builder.id,
      builderName: builder.name,
      feedUrl,
      enclosureUrl: item.enclosureUrl ?? null,
      enclosureType: item.enclosureType ?? null,
      enclosureLength: item.enclosureLength ?? null,
      itunesDuration: item.itunesDuration ?? null,
      mediaDurationSeconds: item.mediaDurationSeconds ?? null,
      thinShowNotes: item.body || "",
    },
  };
  const task = {
    type: "podcast_audio_transcription",
    builder: builder.name,
    builderId: builder.id,
    sourceType: "podcast",
    item: taskItem,
    minimumContentQuality: genericMinimumContentQuality(sources, "podcast"),
    mediaDurationSeconds: item.mediaDurationSeconds ?? null,
    captionAvailability: "not_applicable",
    plannedExtractionMethod: "audio_transcription",
    podcastExtractionAttempts: [
      { method: "rss-show-notes", status: "insufficient", reason: "show_notes_too_thin" },
    ],
  };
  if (item.mediaDurationSeconds != null) {
    task.estimateEvidence = estimateMediaWorkSeconds({
      mediaDurationSeconds: item.mediaDurationSeconds,
      backend: "fallback",
      model: null,
    }).estimateEvidence;
  }
  return { ...task, id: agentTaskId(task) };
}

export function parsePodcastFeedItems(xml, feedUrl) {
  const entries = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ];
  return entries
    .map((match) => {
      const block = match[0];
      const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
      const enclosureMatch = block.match(/<enclosure\b([^>]*)>/i);
      const enclosureAttrs = enclosureMatch?.[1] ?? "";
      const enclosureUrl = enclosureAttrs.match(/\burl=["']([^"']+)["']/i)?.[1] ?? null;
      const enclosureType = enclosureAttrs.match(/\btype=["']([^"']+)["']/i)?.[1] ?? null;
      const enclosureLength = enclosureAttrs.match(/\blength=["']([^"']+)["']/i)?.[1] ?? null;
      const guid = tagText(block, "guid") || tagText(block, "id");
      const url = absoluteUrl(hrefMatch?.[1] || tagText(block, "link") || enclosureUrl, feedUrl);
      const externalId = guid || url || tagText(block, "title");
      const body = stripHtml(
        tagText(block, "content:encoded") ||
          tagText(block, "description") ||
          tagText(block, "summary") ||
          tagText(block, "itunes:summary"),
      );
      return {
        kind: "PODCAST_EPISODE",
        externalId,
        title: stripHtml(tagText(block, "title")) || "Untitled podcast episode",
        body,
        url,
        publishedAt: normalizedDate(
          tagText(block, "pubDate") ||
            tagText(block, "published") ||
            tagText(block, "updated"),
        ),
        enclosureUrl,
        enclosureType,
        enclosureLength,
        itunesDuration: tagText(block, "itunes:duration") || null,
        mediaDurationSeconds: parseMediaDurationSeconds(tagText(block, "itunes:duration") || null),
      };
    })
    // Keep episodes with at least an externalId + URL even if the body is
    // empty — the agent fallback path handles thin/missing show notes by
    // transcribing the audio enclosure.
    .filter((item) => item.externalId && (item.url || item.enclosureUrl));
}

async function fetchPersonalWebsiteBuilder(
  builder,
  { cutoff, limit, agentModel, fetchedItemKeys = new Set(), fetcher = timedSourceFetch },
) {
  const sourceUrl = builder.fetchUrl || builder.sourceUrl;
  if (!sourceUrl) return [];
  const fetchPolicy = await sourceFetchPolicy(sourceUrl, fetcher);
  if (!fetchPolicy.allowed) return [];

  const response = await fetcher(sourceUrl, {
    headers: { "User-Agent": "FollowBriefSkill/1.0 (personal website fetcher)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: HTTP ${response.status}`);
  }

  const html = await response.text();
  if (sourceResponseDisallowsRetention(response.headers, html)) return [];
  const extracted = extractBlogArticle(html, sourceUrl);
  const publishedAt = extracted.publishedAt || null;
  if (!isAfterCutoff(publishedAt, cutoff)) return [];
  if (fetchedItemKeys.has(personalItemKey(builder.id, "BLOG_POST", sourceUrl))) return [];
  const body = extracted.body || stripHtml(html).slice(0, 6000);
  if (!body.trim()) return [];

  return [
    {
      kind: "BLOG_POST",
      externalId: sourceUrl,
      title: extracted.title || builder.name,
      body,
      url: sourceUrl,
      publishedAt,
      sourceName: builder.name,
      fetchTool: skillFetchTool("website HTML extractor", agentModel),
      rawJson: {
        source: "personal-website",
        builderId: builder.id,
        builderName: builder.name,
        url: sourceUrl,
        publishedAt,
      },
    },
  ].slice(0, limit);
}

async function fetchPersonalXBuilder(
  builder,
  { cutoff, limit, agentModel, fetchedItemKeys = new Set(), fetcher = timedSourceFetch, sources = {} },
) {
  const bearerToken = agentSecret("X_BEARER_TOKEN");
  if (!bearerToken) {
    // No throw: unauthenticated x.com scraping doesn't yield usable post
    // content (login wall + JS challenge), so retry-with-agent is futile.
    // Surface a structured task the agent prints to the user instead.
    return xTokenActionResult(builder, sources, {
      type: "x_token_missing",
      message:
        `Action needed for X source "${builder.name}": personal X (Twitter) ` +
        `fetching requires an X API bearer token. The CLI cannot fetch posts ` +
        `without it, and unauthenticated x.com scraping does not return usable ` +
        `content. Get a free bearer token at ` +
        `https://developer.x.com/en/portal/dashboard (the Free tier covers ` +
        `read-only access). For a one-off run, export X_BEARER_TOKEN=... in ` +
        `the shell first. For scheduled cron runs (which see a bare ` +
        `environment), add it to ~/.builder-blog/secrets.json as ` +
        `{"X_BEARER_TOKEN":"..."} (chmod 600), then re-run.`,
    });
  }
  const handle = normalizeXHandle(builder.handle || builder.sourceUrl);
  if (!handle) return [];

  const userResponse = await fetcher(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=description`,
    { headers: { authorization: `Bearer ${bearerToken}` } },
  );
  if (xTokenRejected(userResponse.status)) {
    return xTokenActionResult(builder, sources, {
      type: "x_token_invalid",
      status: userResponse.status,
      message:
        `Action needed for X source "${builder.name}": the saved X API bearer ` +
        `token was rejected (HTTP ${userResponse.status}). Update X_BEARER_TOKEN ` +
        `in your shell or ~/.builder-blog/secrets.json, then re-run.`,
    });
  }
  if (!userResponse.ok) {
    throw new Error(`Failed to resolve X user ${handle}: HTTP ${userResponse.status}`);
  }
  const user = (await userResponse.json())?.data;
  if (!user?.id) return [];

  const tweetResponse = await fetcher(
    `https://api.x.com/2/users/${encodeURIComponent(user.id)}/tweets?max_results=${Math.min(100, Math.max(5, limit * 3))}&tweet.fields=created_at,note_tweet&exclude=retweets,replies`,
    { headers: { authorization: `Bearer ${bearerToken}` } },
  );
  if (xTokenRejected(tweetResponse.status)) {
    return xTokenActionResult(builder, sources, {
      type: "x_token_invalid",
      status: tweetResponse.status,
      message:
        `Action needed for X source "${builder.name}": the saved X API bearer ` +
        `token was rejected while fetching posts (HTTP ${tweetResponse.status}). ` +
        `Update X_BEARER_TOKEN in your shell or ~/.builder-blog/secrets.json, then re-run.`,
    });
  }
  if (!tweetResponse.ok) {
    throw new Error(`Failed to fetch X tweets for ${handle}: HTTP ${tweetResponse.status}`);
  }

  const tweets = (await tweetResponse.json())?.data ?? [];
  return tweets
    .map((tweet) => {
      const url = `https://x.com/${handle}/status/${tweet.id}`;
      return {
        kind: "TWEET",
        externalId: tweet.id,
        title: null,
        body: tweet.note_tweet?.text || tweet.text || "",
        url,
        publishedAt: normalizedDate(tweet.created_at),
        sourceName: builder.name,
        fetchTool: skillFetchTool("X API v2", agentModel),
        rawJson: {
          source: "personal-x",
          builderId: builder.id,
          builderName: builder.name,
          tweet,
        },
      };
    })
    .filter((item) => item.body.trim())
    .filter((item) => isAfterCutoff(item.publishedAt, cutoff))
    .filter((item) => !fetchedItemKeys.has(personalItemKey(builder.id, "TWEET", item.externalId)))
    .slice(0, limit);
}

function xTokenRejected(status) {
  return status === 401 || status === 403;
}

function xTokenActionResult(builder, sources = {}, { type, message, status = null }) {
  const handleString = normalizeXHandle(builder.handle || builder.sourceUrl) ?? "";
  const profileUrl = handleString ? `https://x.com/${handleString}` : (builder.sourceUrl ?? "");
  const task = {
    type,
    builder: builder.name,
    builderId: builder.id,
    sourceType: "x",
    agentMessage: message,
    agentHelpUrl: "https://developer.x.com/en/portal/dashboard",
    item: {
      kind: "TWEET",
      externalId: `${type}:${builder.id}`,
      title: builder.name,
      url: profileUrl,
      publishedAt: null,
      sourceName: builder.name,
      rawJson: {
        source: type,
        builderId: builder.id,
        builderName: builder.name,
        ...(status ? { httpStatus: status } : {}),
      },
    },
    minimumContentQuality: genericMinimumContentQuality(sources, "x"),
  };
  return {
    items: [],
    agentTasks: [{ ...task, id: agentTaskId(task) }],
  };
}

export function fetchPersonalXBuilderForTest(builder, options) {
  return fetchPersonalXBuilder(builder, options);
}

async function fetchPersonalWithExternalCommand(builder, { fallbackCutoff, force, limit, context, agentModel }) {
  const sourceType = sourceTypeIdForBuilder(builder);
  const command =
    process.env[`BUILDER_BLOG_FETCHER_${sourceType.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`] ||
    process.env.BUILDER_BLOG_FETCHER_COMMAND;
  if (!command?.trim()) return null;

  const cutoff = force ? null : cutoffForBuilder(context, builder.id, fallbackCutoff);
  const payload = {
    builder,
    sourceType,
    limit,
    force,
    cutoff: cutoff?.toISOString() ?? null,
    agentModel,
  };
  const output = await runExternalFetcher(command, payload);
  const parsed = JSON.parse(output || "{}");
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.items)) return parsed.items;
  throw new Error("External fetcher must return a JSON array or an object with an items array.");
}

function runExternalFetcher(command, payload) {
  return new Promise((resolve, reject) => {
    const timeoutMs = envToolTimeoutMs("BUILDER_BLOG_EXTERNAL_FETCHER_TIMEOUT_MS", 30 * 60 * 1000);
    const child = spawn(command, {
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateToolChild(child, "SIGTERM");
      killTimer = setTimeout(() => terminateToolChild(child, "SIGKILL"), envToolTimeoutMs("BUILDER_BLOG_TOOL_KILL_GRACE_MS", 5_000));
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimers();
      reject(error);
    });
    child.on("close", (code) => {
      clearTimers();
      if (timedOut) {
        reject(new Error(`External fetcher timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(
        new Error(
          Buffer.concat(stderr).toString("utf8").trim() ||
            `External fetcher exited with code ${code}`,
        ),
      );
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function envToolTimeoutMs(name, fallback) {
  const raw = Number(process.env[name] || fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(2 * 60 * 60 * 1000, Math.max(1_000, Math.floor(raw)));
}

function terminateToolChild(child, signal) {
  if (!child?.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  try {
    child.kill(signal);
  } catch {}
}

function runTool(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? envToolTimeoutMs("BUILDER_BLOG_YOUTUBE_TOOL_TIMEOUT_MS", DEFAULT_YOUTUBE_TOOL_TIMEOUT_MS);
  const killGraceMs = envToolTimeoutMs("BUILDER_BLOG_TOOL_KILL_GRACE_MS", 5_000);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateToolChild(child, "SIGTERM");
      killTimer = setTimeout(() => terminateToolChild(child, "SIGKILL"), killGraceMs);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ok: false,
        code: null,
        stdout: "",
        stderr: error?.code === "ENOENT" ? "command_not_found" : String(error?.message || error),
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
      });
    });
  });
}

async function commandExists(command, commandRunner = runTool) {
  const result = await commandRunner(command, ["--version"], { timeoutMs: 10_000 });
  return result.ok || (typeof result.stdout === "string" && result.stdout.trim().length > 0);
}

function filterFetchedItems(items, { builderId, cutoff, limit = Number.POSITIVE_INFINITY, fetchedItemKeys = new Set() }) {
  return items
    .filter((item) => item?.kind && item?.externalId && item?.body && item?.url)
    .filter((item) => isAfterCutoff(item.publishedAt, cutoff))
    .filter((item) => !fetchedItemKeys.has(personalItemKey(builderId, item.kind, item.externalId)))
    .slice(0, limit);
}

function isAfterCutoff(value, cutoff) {
  if (!cutoff || !value) return true;
  const date = new Date(value);
  const cutoffDate = new Date(cutoff);
  return !Number.isNaN(date.getTime()) && !Number.isNaN(cutoffDate.getTime()) && date > cutoffDate;
}

export function parseBlogCandidates(body, indexUrl) {
  return parseTypedBlogCandidates(body, indexUrl)
    .filter((candidate) => candidate.kind === "article")
    .map(stripCandidateKind);
}

export function parseTypedBlogCandidates(body, indexUrl) {
  if (/<rss[\s>]|<feed[\s>]/i.test(body)) {
    return parseFeedCandidates(body, indexUrl);
  }
  if (indexUrl.includes("anthropic.com")) return parseAnthropicEngineeringIndex(body).map(asArticleCandidate);
  if (indexUrl.includes("claude.com")) return parseClaudeBlogIndex(body).map(asArticleCandidate);
  return parseHtmlCandidates(body, indexUrl);
}

async function discoverBlogArticleCandidates(indexBody, indexUrl, { fetcher, cutoff, limit }) {
  const finalLimit = Math.max(Number(limit) || 0, 1);
  const candidateLimit = Math.min(Math.max(finalLimit * 4, finalLimit + 20), 100);
  const maxDiscoveryPages = Math.min(Math.max(finalLimit * 2, 8), 20);
  const queue = parseTypedBlogCandidates(indexBody, indexUrl).map((candidate) => ({
    ...candidate,
    depth: 0,
  }));
  const seenCandidates = new Set();
  const seenDiscoveryPages = new Set([canonicalUrlKey(indexUrl)]);
  const articles = [];
  let discoveryPagesFetched = 0;

  while (queue.length > 0 && articles.length < candidateLimit) {
    const candidate = queue.shift();
    if (!candidate?.url) continue;
    const candidateKey = canonicalUrlKey(candidate.url);
    if (!candidateKey || seenCandidates.has(candidateKey)) continue;
    seenCandidates.add(candidateKey);

    if (candidate.kind === "article") {
      if (isAfterCutoff(candidate.publishedAt, cutoff)) articles.push(stripCandidateKind(candidate));
      continue;
    }

    if (candidate.kind !== "feed" && candidate.kind !== "listing") continue;
    if (candidate.depth >= 2 || seenDiscoveryPages.has(candidateKey)) continue;
    if (discoveryPagesFetched >= maxDiscoveryPages) continue;
    seenDiscoveryPages.add(candidateKey);
    const policy = await sourceFetchPolicy(candidate.url, fetcher);
    if (!policy.allowed) continue;
    const response = await fetcher(candidate.url, {
      headers: { "User-Agent": "FollowBriefSkill/1.0 (personal agent fetcher)" },
    });
    if (!response.ok) continue;
    const body = await response.text();
    discoveryPagesFetched += 1;
    for (const discovered of parseTypedBlogCandidates(body, response.url || candidate.url)) {
      queue.push({ ...discovered, depth: candidate.depth + 1 });
    }
  }

  return dedupeByUrl(articles);
}

function parseFeedCandidates(xml, indexUrl) {
  const itemMatches = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ];
  return dedupeByUrl(
    itemMatches.map((match) => {
      const block = match[0];
      const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
      const linkText = tagText(block, "link");
      const url = absoluteUrl(hrefMatch?.[1] || linkText, indexUrl);
      return {
        kind: classifyBlogCandidateUrl(url, { feedEntry: true }),
        title: tagText(block, "title"),
        url,
        publishedAt: normalizedDate(
          tagText(block, "pubDate") ||
            tagText(block, "published") ||
            tagText(block, "updated"),
        ),
        description: stripHtml(
          tagText(block, "description") ||
            tagText(block, "summary") ||
            tagText(block, "content:encoded"),
        ),
      };
    }),
  ).filter((candidate) => candidate.url);
}

function parseHtmlCandidates(html, indexUrl) {
  const base = new URL(indexUrl);
  const candidates = [];
  const linkRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = absoluteUrl(match[1], indexUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== base.origin || parsed.href === base.href) continue;
    const kind = classifyBlogCandidateUrl(parsed.href);
    if (kind === "unknown") continue;
    candidates.push({
      kind,
      title: stripHtml(match[2]),
      url: parsed.href,
      publishedAt: null,
      description: "",
    });
  }
  return dedupeByUrl(candidates);
}

function parseAnthropicEngineeringIndex(html) {
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const posts =
        data?.props?.pageProps?.posts ||
        data?.props?.pageProps?.articles ||
        data?.props?.pageProps?.entries ||
        [];
      const articles = posts
        .map((post) => {
          const slug = post?.slug?.current || post?.slug || "";
          return {
            title: post?.title || "Untitled",
            url: slug ? `https://www.anthropic.com/engineering/${slug}` : "",
            publishedAt: normalizedDate(post?.publishedOn || post?.publishedAt || post?.date),
            description: post?.summary || post?.description || "",
          };
        })
        .filter((article) => article.url);
      if (articles.length > 0) return dedupeByUrl(articles);
    } catch {
      // Fall through to rendered links.
    }
  }
  const renderedArticles = parseAnthropicRenderedArticleCards(html);
  if (renderedArticles.length > 0) return renderedArticles;
  return linksByPattern(html, /href=["']\/engineering\/([a-z0-9-]+)["']/gi, "https://www.anthropic.com/engineering/");
}

function parseClaudeBlogIndex(html) {
  return linksByPattern(html, /href=["']\/blog\/([a-z0-9-]+)["']/gi, "https://claude.com/blog/");
}

function parseAnthropicRenderedArticleCards(html) {
  const articles = [];
  const articleRegex = /<article\b[\s\S]*?<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const block = match[0];
    const href = block.match(/href=["'](\/engineering\/[a-z0-9-]+)["']/i)?.[1];
    if (!href) continue;
    const heading =
      block.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ||
      block.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1] ||
      "";
    const dateText =
      block.match(/class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] ||
      block.match(/\b([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+20\d{2})\b/)?.[1] ||
      "";
    articles.push({
      title: stripHtml(heading),
      url: absoluteUrl(href, "https://www.anthropic.com/engineering"),
      publishedAt: normalizedDate(stripHtml(dateText)),
      description: "",
    });
  }
  return dedupeByUrl(articles);
}

function linksByPattern(html, pattern, prefix) {
  const articles = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    articles.push({
      title: "",
      url: `${prefix}${match[1]}`,
      publishedAt: null,
      description: "",
    });
  }
  return dedupeByUrl(articles);
}

export function extractBlogArticle(html, articleUrl = "") {
  if (articleUrl.includes("anthropic.com/engineering")) {
    return extractAnthropicArticle(html);
  }
  if (articleUrl.includes("claude.com/blog")) {
    return extractClaudeBlogArticle(html);
  }
  return extractGenericBlogArticle(html);
}

// Pull a publish date out of arbitrary article HTML using several
// framework-agnostic strategies, in priority order. Returns an ISO string or
// null. Built to survive site framework changes (e.g. Next.js Pages Router →
// App Router) where the date moves between containers but keeps the same field
// name. Strategies:
//   1. schema.org JSON-LD `datePublished` (most reliable when present)
//   2. a serialized "publishedOn"/"datePublished"/... JSON field — covers
//      Next.js __next_f (App Router) and the legacy __NEXT_DATA__ blob, raw or
//      backslash-escaped
//   3. standard <meta> publish-time tags
//   4. a visible "Published Mon DD, YYYY" line
export function extractAnyPublishedDate(html) {
  const source = String(html || "");

  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld;
  while ((ld = jsonLdRegex.exec(source)) !== null) {
    const norm = normalizedDate(findDatePublishedInJsonLd(ld[1]));
    if (norm) return norm;
  }

  // "publishedOn":"..." etc., raw or escaped (\"publishedOn\":\"...\").
  const fieldMatch = source.match(
    /\\?"(?:publishedOn|datePublished|publishedAt|publishDate|firstPublished|publicationDate|dateCreated)\\?"\s*:\s*\\?"([0-9][0-9T:.+\-Z]{3,40})\\?"/i,
  );
  if (fieldMatch) {
    const norm = normalizedDate(fieldMatch[1]);
    if (norm) return norm;
  }

  const metaDate =
    metaContent(source, "property", "article:published_time") ||
    metaContent(source, "name", "article:published_time") ||
    metaContent(source, "name", "date") ||
    metaContent(source, "itemprop", "datePublished") ||
    metaContent(source, "property", "og:published_time");
  if (metaDate) {
    const norm = normalizedDate(metaDate);
    if (norm) return norm;
  }

  // Visible "Published Mon DD, YYYY" — tags/comments between the label and the
  // date are skipped (e.g. `Published <!-- -->Apr 08, 2026`).
  const visible = source.match(
    /Published(?:\s|<[^>]*>)*([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+20\d{2})/,
  );
  if (visible) {
    const norm = normalizedDate(visible[1]);
    if (norm) return norm;
  }

  return null;
}

function findDatePublishedInJsonLd(raw) {
  try {
    const json = JSON.parse(raw);
    const nodes = Array.isArray(json)
      ? json
      : Array.isArray(json["@graph"])
        ? json["@graph"]
        : [json];
    for (const node of nodes) {
      if (node && typeof node === "object") {
        const value = node.datePublished || node.dateCreated || node.uploadDate;
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  } catch {
    // Not JSON / unexpected shape — fall through to the next strategy.
  }
  return null;
}

function extractGenericBlogArticle(html) {
  const title =
    metaContent(html, "property", "og:title") ||
    metaContent(html, "name", "twitter:title") ||
    tagText(html, "h1") ||
    tagText(html, "title");
  const publishedAt = extractAnyPublishedDate(html);
  const articleMatch =
    html.match(/<article\b[\s\S]*?<\/article>/i) ||
    html.match(/<main\b[\s\S]*?<\/main>/i);
  const source = articleMatch?.[0] || html;
  const paragraphs = extractParagraphLikeText(source);

  return {
    title: stripHtml(title),
    publishedAt,
    body: paragraphs.slice(0, 30).join("\n\n"),
  };
}

function extractParagraphLikeText(html) {
  return [
    ...String(html || "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi),
    ...String(html || "").matchAll(/<span\b[^>]*\bdata-as=["']p["'][^>]*>([\s\S]*?)<\/span>/gi),
  ]
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length > 40);
}

function extractAnthropicArticle(html) {
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const pageProps = data?.props?.pageProps;
      const post = pageProps?.post || pageProps?.article || pageProps?.entry || pageProps;
      const blocks = post?.body || post?.content || [];
      const body = Array.isArray(blocks)
        ? blocks
            .filter((block) => block?._type === "block" && Array.isArray(block.children))
            .map((block) => block.children.map((child) => child?.text || "").join("").trim())
            .filter(Boolean)
            .join("\n\n")
        : "";
      if (body) {
        return {
          title: stripHtml(post?.title || ""),
          publishedAt: normalizedDate(post?.publishedOn || post?.publishedAt || post?.date),
          body,
        };
      }
    } catch {
      // Fall through to generic extraction.
    }
  }
  return extractGenericBlogArticle(html);
}

function extractClaudeBlogArticle(html) {
  let title = "";
  let publishedAt = null;
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      if (json["@type"] === "BlogPosting" || json["@type"] === "Article") {
        title = json.headline || json.name || "";
        publishedAt = normalizedDate(json.datePublished);
        break;
      }
    } catch {
      // Skip invalid JSON-LD.
    }
  }

  const richTextMatch =
    html.match(/<div[^>]*class=["'][^"']*u-rich-text-blog[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
    html.match(/<div[^>]*class=["'][^"']*w-richtext[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const generic = extractGenericBlogArticle(html);
  return {
    title: stripHtml(title) || generic.title,
    publishedAt: publishedAt || generic.publishedAt,
    body: richTextMatch ? stripHtml(richTextMatch[1]) : generic.body,
  };
}

function looksLikeArticlePath(pathname) {
  return (
    /\/(blog|posts|post|news|article|articles|engineering|learn|writing)\//i.test(pathname) ||
    /\/20\d{2}\//.test(pathname)
  );
}

function asArticleCandidate(candidate) {
  return { kind: "article", ...candidate };
}

function stripCandidateKind(candidate) {
  const result = { ...candidate };
  delete result.kind;
  delete result.depth;
  return result;
}

function canonicalUrlKey(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function classifyBlogCandidateUrl(value, { feedEntry = false } = {}) {
  try {
    const pathname = new URL(value).pathname;
    if (isObviousBlogFeedPath(pathname)) return "feed";
    if (isObviousBlogListingPath(pathname)) return "listing";
    if (looksLikeArticlePath(pathname)) return "article";
    return feedEntry ? "article" : "unknown";
  } catch {
    return "unknown";
  }
}

function isObviousBlogListingPath(pathname) {
  const normalized = decodeURIComponent(String(pathname || ""))
    .toLowerCase()
    .replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  const listingSegments = new Set([
    "archive",
    "archives",
    "author",
    "authors",
    "category",
    "categories",
    "tag",
    "tags",
    "topic",
    "topics",
  ]);
  if (segments.some((segment) => listingSegments.has(segment))) return true;
  const last = segments[segments.length - 1] || "";
  if (/^index$/.test(last)) return true;
  const parent = segments[segments.length - 2] || "";
  if (/^20\d{2}$/.test(last) && /^(blog|blogs|engineering|learn|news|post|posts|writing)$/.test(parent)) {
    return true;
  }
  return false;
}

function isObviousBlogFeedPath(pathname) {
  const normalized = decodeURIComponent(String(pathname || ""))
    .toLowerCase()
    .replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  return (
    segments.some((segment) => segment === "feed" || segment === "feeds" || segment === "rss" || segment === "atom") ||
    /^(atom|feed|rss)$/.test(last) ||
    /\.(atom|rss|xml)$/.test(last)
  );
}

function tagText(text, tagName) {
  const escaped = escapeRegex(tagName);
  const match = text.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return decodeHtml(stripHtml(match?.[1] ?? ""));
}

function metaContent(html, attribute, value) {
  const regex = new RegExp(
    `<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegex(value)}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`,
    "i",
  );
  return decodeHtml(html.match(regex)?.[1] ?? "");
}

function stripHtml(html) {
  return decodeHtml(
    String(html)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtml(text) {
  // Decode &amp; LAST: decoding it first would double-decode correctly escaped
  // source text (e.g. the literal "&lt;script&gt;" arrives as "&amp;lt;script&amp;gt;"
  // and must stay literal, not turn into "<script>").
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value.trim(), baseUrl).href;
  } catch {
    return "";
  }
}

function dedupeByUrl(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function youtubeFeedUrl(sourceUrl, fetcher = timedSourceFetch) {
  if (!sourceUrl) return "";
  const parsed = new URL(sourceUrl);
  if (parsed.pathname.includes("/feeds/videos.xml")) return parsed.href;
  const playlistId = parsed.searchParams.get("list");
  if (playlistId) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
  }
  const channelMatch = parsed.pathname.match(/\/channel\/([^/?]+)/);
  if (channelMatch) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelMatch[1])}`;
  }

  const response = await fetcher(parsed.href, {
    headers: {
      "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) return "";
  const html = await response.text();
  const rssHref = html.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i)?.[1];
  if (rssHref) return decodeHtml(rssHref);
  const externalId = html.match(/"externalId"\s*:\s*"([^"]+)"/)?.[1];
  return externalId ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(externalId)}` : "";
}

/**
 * @param {string} sourceUrl
 * @param {(input: string, init?: RequestInit) => Promise<Response>} [fetcher]
 * @param {{ retryDelays?: number[] }} [options]
 */
export async function fetchYouTubeVideos(sourceUrl, fetcher = timedSourceFetch, options = {}) {
  const feedUrl = await youtubeFeedUrl(sourceUrl, fetcher);
  if (!feedUrl) {
    throw new Error(`Could not resolve a YouTube feed for ${sourceUrl}`);
  }

  const feedResponse = await fetchYouTubeFeedWithRetry(feedUrl, fetcher, options.retryDelays);
  if (feedResponse.ok) {
    return {
      videos: parseYouTubeFeed(await feedResponse.text(), feedUrl),
      sourceDetail: "YouTube RSS",
    };
  }

  const pageVideos = await fetchYouTubePageVideos(sourceUrl, fetcher);
  if (pageVideos.length > 0) {
    return {
      videos: pageVideos,
      sourceDetail: "YouTube channel page",
    };
  }

  throw new Error(`Failed to fetch YouTube feed ${feedUrl}: HTTP ${feedResponse.status}`);
}

async function fetchYouTubeFeedWithRetry(feedUrl, fetcher, retryDelays = [500, 1500]) {
  let response;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    response = await fetcher(feedUrl, {
      headers: { "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)" },
    });
    if (response.ok || !shouldRetryYouTubeFeedStatus(response.status) || attempt === retryDelays.length) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
  }
  return response;
}

function shouldRetryYouTubeFeedStatus(status) {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

async function fetchYouTubePageVideos(sourceUrl, fetcher) {
  const pageUrl = youtubeVideosPageUrl(sourceUrl);
  if (!pageUrl) return [];
  const response = await fetcher(pageUrl, {
    headers: {
      "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) return [];
  return parseYouTubePageData(await response.text());
}

function youtubeVideosPageUrl(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (!/youtube\.com$/i.test(parsed.hostname.replace(/^www\./i, ""))) return "";
    if (parsed.pathname.includes("/feeds/videos.xml")) return "";
    if (parsed.pathname === "/playlist" || parsed.searchParams.get("list")) return parsed.href;
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/videos`;
    return parsed.href;
  } catch {
    return "";
  }
}

export function parseYouTubeFeed(xml, feedUrl) {
  const entries = [
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
  ];
  return dedupeByUrl(
    entries.map((match) => {
      const block = match[0];
      const videoId = tagText(block, "yt:videoId") || tagText(block, "guid");
      const linkHref = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || tagText(block, "link");
      const url = absoluteUrl(linkHref || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ""), feedUrl);
      return {
        videoId: normalizeYouTubeVideoId(videoId) || youtubeVideoId(url),
        title: tagText(block, "title") || "Untitled YouTube update",
        url,
        publishedAt: normalizedDate(tagText(block, "published") || tagText(block, "updated") || tagText(block, "pubDate")),
        description: stripHtml(tagText(block, "media:description") || tagText(block, "description") || tagText(block, "summary")),
      };
    }),
  ).filter((candidate) => candidate.url);
}

export function parseYouTubePageData(html) {
  const initialData = extractYouTubeInitialData(html);
  const structuredVideos = initialData ? collectYouTubeVideosFromData(initialData) : [];
  if (structuredVideos.length > 0) return structuredVideos;

  const videos = [];
  const videoRegex =
    /"videoId":"([A-Za-z0-9_-]{6,})"[\s\S]{0,600}?"title":\{"runs":\[\{"text":"([^"]+)"/g;
  const seen = new Set();
  let match;
  while ((match = videoRegex.exec(html)) !== null) {
    const [, videoId, rawTitle] = match;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({
      videoId,
      title: decodeHtml(rawTitle.replace(/\\"/g, '"')),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: null,
      description: "",
    });
  }
  return videos;
}

function extractYouTubeInitialData(html) {
  return extractYouTubeJsonAssignment(html, "ytInitialData");
}

function collectYouTubeVideosFromData(data) {
  const videos = [];
  const seen = new Set();

  walkYouTubeData(data, (node) => {
    const renderer =
      node.lockupViewModel ||
      node.videoRenderer ||
      node.gridVideoRenderer ||
      node.reelItemRenderer ||
      node.shortsLockupViewModel;
    if (!renderer) return;

    const videoId = youtubeRendererVideoId(renderer);
    if (!videoId || seen.has(videoId)) return;

    const title =
      formattedYouTubeText(renderer.metadata?.lockupMetadataViewModel?.title) ||
      formattedYouTubeText(renderer.title) ||
      formattedYouTubeText(renderer.headline) ||
      "";
    if (!title) return;

    seen.add(videoId);
    videos.push({
      videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: null,
      description: youtubeRendererMetadataText(renderer),
    });
  });

  return dedupeByUrl(videos);
}

function walkYouTubeData(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walkYouTubeData(item, visitor);
    return;
  }
  for (const item of Object.values(value)) walkYouTubeData(item, visitor);
}

function youtubeRendererVideoId(renderer) {
  if (typeof renderer.videoId === "string") return normalizeYouTubeVideoId(renderer.videoId);
  const json = JSON.stringify(renderer);
  const watchMatch = json.match(/"url":"\/watch\?v=([A-Za-z0-9_-]{6,})/);
  if (watchMatch) return watchMatch[1];
  const thumbnailMatch = json.match(/(?:\/vi\/|%2Fvi%2F)([A-Za-z0-9_-]{6,})/i);
  if (thumbnailMatch) return thumbnailMatch[1];
  const videoIdMatch = json.match(/"videoId":"([A-Za-z0-9_-]{6,})"/);
  return videoIdMatch ? videoIdMatch[1] : "";
}

function formattedYouTubeText(value) {
  if (!value) return "";
  if (typeof value === "string") return decodeHtml(value);
  if (typeof value.content === "string") return decodeHtml(value.content);
  if (typeof value.simpleText === "string") return decodeHtml(value.simpleText);
  if (Array.isArray(value.runs)) {
    return decodeHtml(value.runs.map((run) => run?.text || "").join("").trim());
  }
  if (typeof value.accessibility?.accessibilityData?.label === "string") {
    return decodeHtml(value.accessibility.accessibilityData.label);
  }
  return "";
}

function youtubeRendererMetadataText(renderer) {
  const rows = renderer.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
  if (!Array.isArray(rows)) return "";
  return rows
    .flatMap((row) => row?.metadataParts ?? [])
    .map((part) => formattedYouTubeText(part?.text))
    .filter(Boolean)
    .join(" · ");
}

async function fetchYouTubePrimaryContent(video, {
  fetcher = timedSourceFetch,
  commandRunner = runTool,
  metadata = {},
} = {}) {
  const attempts = [];
  let mediaDurationSeconds = null;
  const ytdlp = await fetchYouTubeTranscriptWithYtDlp(video.url, {
    fetcher,
    commandRunner,
    metadata,
    attempts,
  });
  mediaDurationSeconds = firstMediaDurationSeconds(mediaDurationSeconds, ytdlp.mediaDurationSeconds);
  if (ytdlp.text) {
    return {
      ...ytdlp,
      mediaDurationSeconds,
      captionAvailability: "usable_captions",
      plannedExtractionMethod: "captions",
    };
  }

  const watch = await fetchYouTubeTranscript(video.url, fetcher, metadata)
    .catch((error) => ({ text: "", error: errorMessage(error) }));
  mediaDurationSeconds = firstMediaDurationSeconds(mediaDurationSeconds, watch.mediaDurationSeconds);
  attempts.push({
    method: "youtube-watch-captions",
    status: watch.text ? "ok" : "unavailable",
    reason: watch.text ? watch.captionSelectionReason || "caption_selected" : watch.error || "no_usable_caption_track",
    captionLanguageCode: watch.captionLanguageCode || null,
  });
  if (watch.text) {
    return {
      ...watch,
      attempts,
      mediaDurationSeconds,
      captionAvailability: "usable_captions",
      plannedExtractionMethod: "captions",
    };
  }

  const transcriptApi = await fetchYouTubeTranscriptApi(video.url, {
    commandRunner,
    metadata,
    attempts,
  });
  if (transcriptApi.text) {
    return {
      ...transcriptApi,
      mediaDurationSeconds,
      captionAvailability: "usable_captions",
      plannedExtractionMethod: "captions",
    };
  }

  return {
    text: "",
    attempts,
    mediaDurationSeconds,
    captionAvailability: "no_usable_captions",
    plannedExtractionMethod: "audio_transcription",
  };
}

async function fetchYouTubeTranscriptWithYtDlp(videoUrl, {
  fetcher = timedSourceFetch,
  commandRunner = runTool,
  metadata = {},
  attempts = [],
} = {}) {
  if (!(await commandExists("yt-dlp", commandRunner))) {
    attempts.push({ method: "yt-dlp-captions", status: "skipped", reason: "yt-dlp_missing" });
    return { text: "" };
  }
  const metadataResult = await commandRunner("yt-dlp", ["-J", "--skip-download", videoUrl], {
    timeoutMs: envToolTimeoutMs("BUILDER_BLOG_YOUTUBE_METADATA_TIMEOUT_MS", DEFAULT_YOUTUBE_TOOL_TIMEOUT_MS),
  });
  if (!metadataResult.ok) {
    attempts.push({ method: "yt-dlp-captions", status: "failed", reason: commandFailureReason(metadataResult) });
    return { text: "" };
  }
  let data = null;
  try {
    data = JSON.parse(metadataResult.stdout || "{}");
  } catch (error) {
    attempts.push({ method: "yt-dlp-captions", status: "failed", reason: `metadata_json_invalid:${errorMessage(error)}` });
    return { text: "" };
  }
  const mediaDurationSeconds = firstMediaDurationSeconds(
    data?.duration,
    data?.duration_string,
    data?.durationString,
  );
  const tracks = ytDlpCaptionTracks(data);
  if (tracks.length === 0) {
    attempts.push({ method: "yt-dlp-captions", status: "unavailable", reason: "no_caption_tracks" });
    return { text: "", mediaDurationSeconds };
  }
  const selection = preferredCaptionTrack(tracks, {
    title: metadata.title || data.title || "",
    description: metadata.description || data.description || "",
  });
  if (!selection?.track?.baseUrl) {
    attempts.push({
      method: "yt-dlp-captions",
      status: "ambiguous",
      reason: "caption_source_language_uncertain",
      availableCaptionLanguages: [...new Set(tracks.map((track) => track.languageCode).filter(Boolean))],
    });
    return { text: "", mediaDurationSeconds };
  }
  const text = await fetchYouTubeCaptionTrackText(selection.track, fetcher).catch(() => "");
  attempts.push({
    method: "yt-dlp-captions",
    status: text ? "ok" : "failed",
    reason: text ? selection.reason : "selected_caption_download_failed",
    captionLanguageCode: selection.track.languageCode || null,
    captionKind: selection.track.kind === "asr" ? "automatic" : "manual",
  });
  if (!text) return { text: "", mediaDurationSeconds };
  return {
    text,
    transcriptSource: "youtube-captions",
    captionLanguageCode: selection.track.languageCode || "",
    inferredSourceLanguage: selection.inferredSourceLanguage,
    captionSelectionReason: selection.reason,
    mediaDurationSeconds,
    attempts,
  };
}

function ytDlpCaptionTracks(data) {
  return [
    ...ytDlpCaptionTracksFromMap(data?.subtitles, "manual"),
    ...ytDlpCaptionTracksFromMap(data?.automatic_captions, "asr"),
  ];
}

function ytDlpCaptionTracksFromMap(map, kind) {
  if (!map || typeof map !== "object") return [];
  const tracks = [];
  for (const [languageCode, formats] of Object.entries(map)) {
    const format = bestYtDlpCaptionFormat(Array.isArray(formats) ? formats : []);
    if (!format?.url) continue;
    tracks.push({
      languageCode,
      baseUrl: format.url,
      ext: format.ext || "",
      name: format.name || "",
      kind,
    });
  }
  return tracks;
}

function bestYtDlpCaptionFormat(formats) {
  const priority = ["json3", "vtt", "srv3", "ttml", "srt"];
  return [...formats]
    .filter((format) => format?.url)
    .sort((a, b) => priorityIndex(a?.ext, priority) - priorityIndex(b?.ext, priority))[0] || null;
}

function priorityIndex(value, priority) {
  const index = priority.indexOf(String(value || "").toLowerCase());
  return index === -1 ? priority.length : index;
}

async function fetchYouTubeCaptionTrackText(track, fetcher = timedSourceFetch) {
  const response = await fetcher(track.baseUrl, {
    headers: {
      "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)",
    },
  });
  if (!response.ok) return "";
  const body = await response.text();
  const ext = String(track.ext || "").toLowerCase();
  if (body.trim().startsWith("{") || ext === "json3") return parseYouTubeJsonTranscript(body);
  if (body.trim().startsWith("<") || ext === "srv3" || ext === "ttml") return parseYouTubeXmlTranscript(body);
  if (ext === "srt") return parseYouTubeSrtTranscript(body);
  return parseYouTubeVttTranscript(body);
}

async function fetchYouTubeTranscriptApi(videoUrl, {
  commandRunner = runTool,
  metadata = {},
  attempts = [],
} = {}) {
  const videoId = youtubeVideoId(videoUrl);
  if (!videoId) {
    attempts.push({ method: "youtube-transcript-api", status: "skipped", reason: "video_id_missing" });
    return { text: "" };
  }
  const script = youtubeTranscriptApiPythonScript();
  for (const python of ["python3", "python"]) {
    const result = await commandRunner(python, ["-c", script, videoId, inferSourceLanguageFromMetadata(metadata)], {
      timeoutMs: envToolTimeoutMs("BUILDER_BLOG_YOUTUBE_TRANSCRIPT_API_TIMEOUT_MS", DEFAULT_YOUTUBE_TOOL_TIMEOUT_MS),
    });
    if (!result.ok) {
      const reason = commandFailureReason(result);
      if (reason === "command_not_found") continue;
      if (/ModuleNotFoundError|No module named ['"]youtube_transcript_api/.test(`${result.stderr}\n${result.stdout}`)) {
        attempts.push({ method: "youtube-transcript-api", status: "skipped", reason: "youtube_transcript_api_missing" });
        return { text: "" };
      }
      attempts.push({ method: "youtube-transcript-api", status: "failed", reason });
      return { text: "" };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch (error) {
      attempts.push({ method: "youtube-transcript-api", status: "failed", reason: `result_json_invalid:${errorMessage(error)}` });
      return { text: "" };
    }
    attempts.push({
      method: "youtube-transcript-api",
      status: parsed.text ? "ok" : parsed.status || "unavailable",
      reason: parsed.reason || null,
      captionLanguageCode: parsed.languageCode || null,
    });
    if (!parsed.text) return { text: "" };
    return {
      text: cleanTranscriptText(parsed.text),
      transcriptSource: "youtube-captions",
      captionLanguageCode: parsed.languageCode || "",
      inferredSourceLanguage: parsed.inferredSourceLanguage || "",
      captionSelectionReason: parsed.reason || "youtube_transcript_api_selected",
      attempts,
    };
  }
  attempts.push({ method: "youtube-transcript-api", status: "skipped", reason: "python_missing" });
  return { text: "" };
}

function youtubeTranscriptApiPythonScript() {
  return String.raw`
import json, sys
video_id = sys.argv[1]
metadata_language = sys.argv[2] if len(sys.argv) > 2 else ""
try:
    from youtube_transcript_api import YouTubeTranscriptApi
except Exception:
    print(json.dumps({"status":"skipped","reason":"youtube_transcript_api_missing"}))
    raise SystemExit(0)

def base(code):
    code = (code or "").lower()
    if code.startswith("zh"): return "zh"
    if code.startswith("ja"): return "ja"
    if code.startswith("ko"): return "ko"
    if code.startswith("en"): return "en"
    return code.split("-")[0].split("_")[0]

try:
    api = YouTubeTranscriptApi()
    if hasattr(api, "list"):
        transcript_list = api.list(video_id)
    else:
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
    transcripts = list(transcript_list)
    languages = sorted(set(base(getattr(t, "language_code", "")) for t in transcripts if base(getattr(t, "language_code", ""))))
    if not transcripts:
        print(json.dumps({"status":"unavailable","reason":"no_transcripts"}))
        raise SystemExit(0)
    if len(languages) == 1:
        wanted = languages[0]
    elif metadata_language and metadata_language in languages:
        wanted = metadata_language
    else:
        print(json.dumps({"status":"ambiguous","reason":"transcript_source_language_uncertain","languages":languages}))
        raise SystemExit(0)
    matching = [t for t in transcripts if base(getattr(t, "language_code", "")) == wanted]
    matching.sort(key=lambda t: 1 if getattr(t, "is_generated", False) else 0)
    chosen = matching[0]
    rows = chosen.fetch()
    texts = []
    for row in rows:
        if isinstance(row, dict):
            texts.append(row.get("text", ""))
        else:
            texts.append(getattr(row, "text", ""))
    print(json.dumps({
        "status":"ok",
        "text":" ".join(texts),
        "languageCode":getattr(chosen, "language_code", wanted),
        "inferredSourceLanguage":wanted,
        "reason":"youtube_transcript_api_source_language_selected"
    }, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"status":"failed","reason":str(exc)[:500]}))
`;
}

// Reserved for future worker-side audio transcription; personal-source planning
// must not invoke this path during discovery.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchYouTubeLocalAsr(videoUrl, {
  commandRunner = runTool,
  attempts = [],
} = {}) {
  if (!(await commandExists("yt-dlp", commandRunner))) {
    attempts.push({ method: "local-asr", status: "skipped", reason: "yt-dlp_missing" });
    return { text: "" };
  }
  if (!(await commandExists("ffmpeg", commandRunner))) {
    attempts.push({ method: "local-asr", status: "skipped", reason: "ffmpeg_missing" });
    return { text: "" };
  }

  const asrRoot = join(jobTmpDir("library-cron"), "youtube-asr");
  await mkdir(asrRoot, { recursive: true });
  const workDir = await mkdtemp(join(asrRoot, "run-"));
  try {
    const rawTemplate = join(workDir, "audio.%(ext)s");
    const download = await commandRunner(
      "yt-dlp",
      ["-f", "ba", "-x", "--audio-format", "mp3", "--audio-quality", "64K", "-o", rawTemplate, videoUrl],
      { timeoutMs: envToolTimeoutMs("BUILDER_BLOG_YOUTUBE_AUDIO_DOWNLOAD_TIMEOUT_MS", DEFAULT_YOUTUBE_ASR_TIMEOUT_MS) },
    );
    if (!download.ok) {
      attempts.push({ method: "local-asr", status: "failed", reason: `audio_download:${commandFailureReason(download)}` });
      return { text: "" };
    }
    const files = await readdir(workDir);
    const audioFile = files.map((file) => join(workDir, file)).find((file) => basename(file).startsWith("audio."));
    if (!audioFile) {
      attempts.push({ method: "local-asr", status: "failed", reason: "audio_download_missing_file" });
      return { text: "" };
    }
    const monoAudio = join(workDir, "audio-mono.wav");
    const convert = await commandRunner("ffmpeg", ["-y", "-i", audioFile, "-ac", "1", "-ar", "16000", monoAudio], {
      timeoutMs: envToolTimeoutMs("BUILDER_BLOG_YOUTUBE_AUDIO_CONVERT_TIMEOUT_MS", DEFAULT_YOUTUBE_TOOL_TIMEOUT_MS),
    });
    if (!convert.ok) {
      attempts.push({ method: "local-asr", status: "failed", reason: `audio_convert:${commandFailureReason(convert)}` });
      return { text: "" };
    }

    const asr = await transcribeLocalAudio(monoAudio, workDir, commandRunner);
    attempts.push({ method: "local-asr", status: asr.text ? "ok" : "skipped", reason: asr.reason, backend: asr.backend || null });
    if (!asr.text) return { text: "" };
    return {
      text: cleanTranscriptText(asr.text),
      transcriptSource: "local-speech-to-text",
      captionLanguageCode: "",
      inferredSourceLanguage: "",
      captionSelectionReason: asr.backend,
      attempts,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeLocalAudio(audioFile, workDir, commandRunner = runTool) {
  const faster = await transcribeWithPythonModule("faster_whisper", audioFile, commandRunner);
  if (faster.text) return { ...faster, backend: "faster-whisper" };

  const mlx = await transcribeWithPythonModule("mlx_whisper", audioFile, commandRunner);
  if (mlx.text) return { ...mlx, backend: "mlx-whisper" };

  if (await commandExists("whisper", commandRunner)) {
    const model = process.env.BUILDER_BLOG_WHISPER_MODEL?.trim() || "base";
    const result = await commandRunner(
      "whisper",
      [audioFile, "--model", model, "--output_format", "txt", "--output_dir", workDir, "--fp16", "False"],
      { timeoutMs: envToolTimeoutMs("BUILDER_BLOG_YOUTUBE_ASR_TIMEOUT_MS", DEFAULT_YOUTUBE_ASR_TIMEOUT_MS) },
    );
    if (result.ok) {
      const txtFiles = (await readdir(workDir)).filter((file) => file.endsWith(".txt"));
      for (const file of txtFiles) {
        const text = await readFile(join(workDir, file), "utf8").catch(() => "");
        if (cleanTranscriptText(text)) return { text, backend: "whisper-cli", reason: "whisper_cli_transcribed" };
      }
    }
    return { text: "", reason: `whisper_cli_failed:${commandFailureReason(result)}` };
  }
  return { text: "", reason: faster.reason || mlx.reason || "asr_backend_missing" };
}

async function transcribeWithPythonModule(moduleName, audioFile, commandRunner = runTool) {
  const script = moduleName === "faster_whisper"
    ? fasterWhisperPythonScript()
    : mlxWhisperPythonScript();
  for (const python of ["python3", "python"]) {
    const result = await commandRunner(python, ["-c", script, audioFile], {
      timeoutMs: envToolTimeoutMs("BUILDER_BLOG_YOUTUBE_ASR_TIMEOUT_MS", DEFAULT_YOUTUBE_ASR_TIMEOUT_MS),
    });
    if (!result.ok) {
      const reason = commandFailureReason(result);
      if (reason === "command_not_found") continue;
      if (new RegExp(`No module named ['"]${moduleName}|ModuleNotFoundError`).test(`${result.stderr}\n${result.stdout}`)) {
        return { text: "", reason: `${moduleName}_missing` };
      }
      return { text: "", reason: `${moduleName}_failed:${reason}` };
    }
    try {
      const parsed = JSON.parse(result.stdout || "{}");
      return { text: parsed.text || "", reason: parsed.reason || `${moduleName}_transcribed` };
    } catch (error) {
      return { text: "", reason: `${moduleName}_json_invalid:${errorMessage(error)}` };
    }
  }
  return { text: "", reason: "python_missing" };
}

function fasterWhisperPythonScript() {
  return String.raw`
import json, os, sys
from faster_whisper import WhisperModel
audio = sys.argv[1]
model_name = os.environ.get("BUILDER_BLOG_FASTER_WHISPER_MODEL", "base")
model = WhisperModel(model_name, device="auto", compute_type=os.environ.get("BUILDER_BLOG_FASTER_WHISPER_COMPUTE_TYPE", "auto"))
segments, info = model.transcribe(audio, vad_filter=True)
print(json.dumps({"text":" ".join(segment.text for segment in segments)}, ensure_ascii=False))
`;
}

function mlxWhisperPythonScript() {
  return String.raw`
import json, os, sys
import mlx_whisper
audio = sys.argv[1]
model = os.environ.get("BUILDER_BLOG_MLX_WHISPER_MODEL")
kwargs = {"path_or_hf_repo": model} if model else {}
result = mlx_whisper.transcribe(audio, **kwargs)
print(json.dumps({"text": result.get("text", "")}, ensure_ascii=False))
`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "");
}

function commandFailureReason(result) {
  if (result?.timedOut) return "timeout";
  const stderr = String(result?.stderr || "").trim();
  if (stderr === "command_not_found") return "command_not_found";
  const stdout = String(result?.stdout || "").trim();
  const text = stderr || stdout;
  return text ? text.slice(0, 500) : `exit_${result?.code ?? "unknown"}`;
}

function cleanTranscriptText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function fetchYouTubeTranscript(videoUrl, fetcher = timedSourceFetch, metadata = {}) {
  const videoId = youtubeVideoId(videoUrl);
  if (!videoId) return { text: "" };
  const response = await fetcher(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)",
    },
  });
  if (!response.ok) return { text: "" };
  const playerResponse = extractYouTubePlayerResponse(await response.text());
  const mediaDurationSeconds = firstMediaDurationSeconds(
    playerResponse?.videoDetails?.lengthSeconds,
    playerResponse?.microformat?.playerMicroformatRenderer?.lengthSeconds,
  );
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return { text: "", mediaDurationSeconds };
  const selection = preferredCaptionTrack(tracks, metadata);
  if (!selection?.track?.baseUrl) return { text: "", mediaDurationSeconds };
  const track = selection.track;
  const captionResponse = await fetcher(withYouTubeCaptionFormat(track.baseUrl, "json3"), {
    headers: {
      "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)",
    },
  });
  if (!captionResponse.ok) return { text: "", mediaDurationSeconds };
  const body = await captionResponse.text();
  const text = body.trim().startsWith("{") ? parseYouTubeJsonTranscript(body) : parseYouTubeXmlTranscript(body);
  return {
    text,
    transcriptSource: "youtube-captions",
    captionLanguageCode: track.languageCode || "",
    inferredSourceLanguage: selection.inferredSourceLanguage,
    captionSelectionReason: selection.reason,
    mediaDurationSeconds,
  };
}

function youtubeVideoId(videoUrl) {
  const urlMatch = videoUrl.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (urlMatch) return urlMatch[1];
  const shortMatch = videoUrl.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  return shortMatch ? shortMatch[1] : null;
}

function normalizeYouTubeVideoId(value) {
  const match = String(value || "").match(/([A-Za-z0-9_-]{6,})$/);
  return match ? match[1] : "";
}

function extractYouTubeJsonAssignment(html, assignmentName) {
  const assignment = html.match(new RegExp(`${escapeRegex(assignmentName)}\\s*=\\s*`));
  if (!assignment) return null;
  const start = html.indexOf("{", assignment.index);
  if (start === -1) return null;
  return parseJsonObjectAt(html, start);
}

function extractYouTubePlayerResponse(html) {
  return extractYouTubeJsonAssignment(html, "ytInitialPlayerResponse");
}

function parseJsonObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function preferredCaptionTrack(tracks, metadata = {}) {
  const typedTracks = tracks.filter((track) => track && typeof track.baseUrl === "string");
  if (typedTracks.length === 0) return null;
  const languages = new Set(typedTracks.map((track) => captionLanguageBase(track.languageCode)).filter(Boolean));
  if (languages.size === 1) {
    const language = [...languages][0];
    return {
      track: bestTrackForLanguage(typedTracks, language),
      inferredSourceLanguage: language,
      reason: "only_available_caption_language",
    };
  }

  const metadataLanguage = inferSourceLanguageFromMetadata(metadata);
  if (metadataLanguage && languages.has(metadataLanguage)) {
    return {
      track: bestTrackForLanguage(typedTracks, metadataLanguage),
      inferredSourceLanguage: metadataLanguage,
      reason: "metadata_language_matches_caption_track",
    };
  }

  return null;
}

function bestTrackForLanguage(tracks, language) {
  return (
    tracks.find((track) => captionLanguageBase(track.languageCode) === language && track.kind !== "asr") ||
    tracks.find((track) => captionLanguageBase(track.languageCode) === language) ||
    null
  );
}

function captionLanguageBase(languageCode) {
  const code = String(languageCode || "").trim().toLowerCase();
  if (!code) return "";
  if (code.startsWith("zh")) return "zh";
  if (code.startsWith("ja")) return "ja";
  if (code.startsWith("ko")) return "ko";
  if (code.startsWith("en")) return "en";
  const match = code.match(/^([a-z]{2,3})(?:[-_]|$)/);
  return match ? match[1] : code;
}

function inferSourceLanguageFromMetadata({ title = "", description = "" } = {}) {
  const text = `${title}\n${description}`;
  const han = (text.match(/[\p{Script=Han}]/gu) || []).length;
  const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const hangul = (text.match(/[\p{Script=Hangul}]/gu) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (han >= 20 && han >= latin * 0.2) return "zh";
  if (kana >= 20 && kana + han >= latin * 0.2) return "ja";
  if (hangul >= 20 && hangul >= latin * 0.2) return "ko";
  if (latin >= 80 && han + kana + hangul <= 5) return "en";
  return "";
}

function withYouTubeCaptionFormat(baseUrl, format) {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", format);
  return url.href;
}

function parseYouTubeJsonTranscript(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    return (data.events || [])
      .flatMap((event) => event.segs || [])
      .map((segment) => segment.utf8 || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function parseYouTubeXmlTranscript(xml) {
  return [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => decodeHtml(stripHtml(match[1])))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYouTubeVttTranscript(vtt) {
  return dedupeTranscriptLines(
    String(vtt || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) =>
        line &&
        !/^WEBVTT\b/i.test(line) &&
        !/^Kind:/i.test(line) &&
        !/^Language:/i.test(line) &&
        !/^NOTE\b/i.test(line) &&
        !/-->/i.test(line) &&
        !/^\d+$/.test(line),
      )
      .map((line) =>
        decodeHtml(stripHtml(line))
          .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      ),
  );
}

function parseYouTubeSrtTranscript(srt) {
  return dedupeTranscriptLines(
    String(srt || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^\d+$/.test(line) && !/-->/i.test(line))
      .map((line) => decodeHtml(stripHtml(line)).replace(/\s+/g, " ").trim()),
  );
}

function dedupeTranscriptLines(lines) {
  const output = [];
  let previous = "";
  for (const line of lines) {
    if (!line || line === previous) continue;
    output.push(line);
    previous = line;
  }
  return output.join(" ").replace(/\s+/g, " ").trim();
}

async function validateAgentSync(args) {
  const tasksFile = argValue(args, "--tasks");
  const payloadFile = argValue(args, "--file");
  if (!tasksFile) throw new Error("Missing --tasks fetch-result.json");
  if (!payloadFile) throw new Error("Missing --file personal-builders.json");

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const result = validateAgentSyncPayload(fetchResult, payload);
  console.log(JSON.stringify(result, null, 2));
}

async function expandDiscovery(args) {
  const tasksFile = argValue(args, "--tasks");
  const payloadFile = argValue(args, "--file");
  const outFile = argValue(args, "--out");
  if (!tasksFile) throw new Error("Missing --tasks fetch-result.json");
  if (!payloadFile) throw new Error("Missing --file discovery-result.json");

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const discoveryPayload = JSON.parse(await readFile(payloadFile, "utf8"));
  const expanded = expandCandidateDiscoveryFetchResult(fetchResult, discoveryPayload, {
    sources: fetchResult.sources ?? {},
    commonFetchRules: fetchResult.commonFetchRules ?? DEFAULT_FETCH_GUIDANCE,
    commonSummaryRules: fetchResult.commonSummaryRules ?? "",
  });
  const json = `${JSON.stringify(expanded, null, 2)}\n`;
  if (outFile) await writeFile(outFile, json, "utf8");
  console.log(json.trimEnd());
}

// --- Parallel shard orchestration -----------------------------------------
// shard-tasks / merge-task-results back the runner's sharded library run:
// shard-tasks splits a fetch result's fetchTasks into at most N worker shard
// files, and merge-task-results reassembles the workers' per-shard payloads
// into the single sync payload that validate-agent-sync / sync-builders
// consume. Worker grouping is by URL domain so one domain's tasks are never
// fetched by two concurrent workers (per-domain serialization is the rate-limit
// contract), while unrelated domains in the same source type can run in
// parallel. Weights bias the bin-packing so transcript-heavy sources don't pile
// onto one shard.

function shardTaskWeight(task) {
  if (task?.contentStatus === "ready") {
    const bodyChars = typeof task?.item?.body === "string" ? task.item.body.length : 0;
    return Math.max(1, Math.min(8, 1 + Math.ceil(bodyChars / 3000)));
  }
  if (task?.agentWorkType === "translate_summary_only") return 1;
  const sourceType = String(task?.sourceType || "").toLowerCase();
  if (sourceType === "youtube" || sourceType === "podcast") return 4;
  return 2;
}

function isDeterministicSyncFetchTask(task) {
  return (
    task?.deterministicSync === true &&
    task?.contentStatus === "ready" &&
    typeof task?.item?.summary === "string" &&
    task.item.summary.trim().length > 0 &&
    typeof task?.item?.headline === "string" &&
    task.item.headline.trim().length > 0
  );
}

function splitFetchTasksForWorkerQueue(fetchResult) {
  const all = extractFetchTasks(fetchResult);
  const userActionTasks = all.filter((task) => isUserActionAgentWorkType(task?.agentWorkType));
  const discoveryTasks = all.filter(
    (task) => task?.agentWorkType === "candidate_discovery_fallback",
  );
  const workTasks = all.filter(
    (task) =>
      !isUserActionAgentWorkType(task?.agentWorkType) &&
      task?.agentWorkType !== "candidate_discovery_fallback" &&
      !isDeterministicSyncFetchTask(task),
  );
  return { workTasks, userActionTasks, discoveryTasks };
}

function sourceGroupKey(task) {
  const sync = task?.builderSync ?? {};
  return String(
    sync.builderId || task?.builderId || sync.sourceUrl || sync.handle || task?.builder || "ungrouped",
  );
}

function urlDomainKey(value) {
  if (!value) return null;
  try {
    const hostname = new URL(String(value)).hostname.toLowerCase().replace(/^www\./, "");
    return hostname || null;
  } catch {
    return null;
  }
}

function shardGroupKey(task) {
  const taskId = String(task?.id || fetchTaskId(task));
  if (task?.contentStatus === "ready" || task?.agentWorkType === "translate_summary_only") {
    return `summary-task:${taskId}`;
  }
  const sync = task?.builderSync ?? {};
  const domain =
    urlDomainKey(task?.item?.url) ||
    urlDomainKey(task?.item?.sourceUrl) ||
    urlDomainKey(sync.fetchUrl) ||
    urlDomainKey(sync.sourceUrl) ||
    urlDomainKey(task?.sourceUrl) ||
    urlDomainKey(task?.fetchUrl);
  return domain ? `domain:${domain}` : sourceGroupKey(task);
}

export function shardFetchTasksForWorkers(fetchResult, maxWorkers) {
  const { assignments, userActionTasks, discoveryTasks } = planFetchQueueAssignments(fetchResult, {
    maxWorkers,
  });
  return {
    shards: assignments.map((assignment) => ({
      weight: assignment.weight,
      tasks: assignment.tasks,
    })),
    userActionTasks,
    discoveryTasks,
  };
}

export function planFetchQueueAssignments(fetchResult, {
  maxWorkers = 1,
  activeGroupKeys = new Set(),
  excludeTaskIds = new Set(),
  maxGroupsPerAssignment = Number.POSITIVE_INFINITY,
  maxTasksPerAssignment = Number.POSITIVE_INFINITY,
} = {}) {
  const { workTasks, userActionTasks, discoveryTasks } = splitFetchTasksForWorkerQueue(fetchResult);
  const activeKeys = new Set(Array.from(activeGroupKeys, (key) => String(key)));
  const excludedIds = new Set(Array.from(excludeTaskIds, (id) => String(id)));
  const groups = new Map();
  for (const task of workTasks) {
    if (excludedTaskIdsContains(excludedIds, task)) continue;
    const key = shardGroupKey(task);
    const group = groups.get(key) ?? { key, weight: 0, tasks: [] };
    group.weight += shardTaskWeight(task);
    group.tasks.push(task);
    groups.set(key, group);
  }

  const runnableGroups = [];
  const blockedGroups = [];
  for (const group of groups.values()) {
    if (activeKeys.has(group.key)) blockedGroups.push(group);
    else runnableGroups.push(group);
  }

  const workerLimit = Number.isFinite(Number(maxWorkers))
    ? Math.max(0, Math.floor(Number(maxWorkers)))
    : 1;
  const groupLimit = Number.isFinite(Number(maxGroupsPerAssignment))
    ? Math.max(1, Math.floor(Number(maxGroupsPerAssignment)))
    : Number.POSITIVE_INFINITY;
  const taskLimit = Number.isFinite(Number(maxTasksPerAssignment))
    ? Math.max(1, Math.floor(Number(maxTasksPerAssignment)))
    : Number.POSITIVE_INFINITY;
  const assignmentCount = groupLimit === Number.POSITIVE_INFINITY
    ? Math.max(0, Math.min(workerLimit, runnableGroups.length))
    : 0;
  const assignments = groupLimit === Number.POSITIVE_INFINITY
    ? Array.from(
        { length: assignmentCount },
        (_, index) => ({ id: `assignment-${index}`, weight: 0, groupKeys: [], tasks: [] }),
      )
    : [];
  const pendingGroups = [];
  const ordered = runnableGroups.sort((a, b) => b.weight - a.weight);
  for (const group of ordered) {
    let target = null;
    if (groupLimit === Number.POSITIVE_INFINITY) {
      target = assignments.reduce(
        (best, assignment) => (assignment.weight < best.weight ? assignment : best),
        assignments[0],
      );
    } else {
      target = assignments
        .filter((assignment) => assignment.groupKeys.length < groupLimit)
        .sort((a, b) => a.weight - b.weight)[0] ?? null;
      if (!target && assignments.length < workerLimit) {
        target = { id: `assignment-${assignments.length}`, weight: 0, groupKeys: [], tasks: [] };
        assignments.push(target);
      }
    }
    if (!target) {
      pendingGroups.push(group);
      continue;
    }
    const assignedTasks = taskLimit === Number.POSITIVE_INFINITY
      ? group.tasks
      : group.tasks.slice(0, taskLimit);
    const remainingTasks = taskLimit === Number.POSITIVE_INFINITY
      ? []
      : group.tasks.slice(assignedTasks.length);
    const assignedWeight = assignedTasks.reduce((sum, task) => sum + shardTaskWeight(task), 0);
    target.weight += assignedWeight;
    target.groupKeys.push(group.key);
    target.tasks.push(...assignedTasks);
    if (remainingTasks.length > 0) {
      pendingGroups.push({
        ...group,
        weight: remainingTasks.reduce((sum, task) => sum + shardTaskWeight(task), 0),
        tasks: remainingTasks,
      });
    }
  }
  return {
    assignments: assignments.filter((assignment) => assignment.tasks.length > 0),
    blockedTasks: blockedGroups.flatMap((group) => group.tasks),
    blockedGroupKeys: blockedGroups.map((group) => group.key),
    pendingTasks: pendingGroups.flatMap((group) => group.tasks),
    pendingGroupKeys: pendingGroups.map((group) => group.key),
    userActionTasks,
    discoveryTasks,
  };
}

async function shardTasks(args) {
  const tasksFile = argValue(args, "--tasks");
  const outDir = argValue(args, "--out-dir");
  const maxWorkersRaw = Number(argValue(args, "--max-workers", "3"));
  const maxWorkers = Number.isFinite(maxWorkersRaw)
    ? Math.max(1, Math.min(20, Math.floor(maxWorkersRaw)))
    : 3;
  if (!tasksFile) throw new Error("Missing --tasks fetch-result.json");
  if (!outDir) throw new Error("Missing --out-dir");

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const { shards, userActionTasks, discoveryTasks } = shardFetchTasksForWorkers(
    fetchResult,
    maxWorkers,
  );
  await mkdir(outDir, { recursive: true });
  const shardFiles = [];
  for (const [index, shard] of shards.entries()) {
    const file = join(outDir, `shard-${index}.json`);
    const workerId = `shard-${index}`;
    const shardTasks = shard.tasks.map((task) => ({
      ...task,
      workerId: task?.workerId ?? workerId,
    }));
    await writeFile(
      file,
      `${JSON.stringify(
        {
          status: "ok",
          shardIndex: index,
          shardCount: shards.length,
          fetchTasks: shardTasks,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    shardFiles.push({ file, tasks: shard.tasks.length, weight: shard.weight });
  }
  console.log(
    JSON.stringify(
      {
        status: "ok",
        shards: shardFiles,
        // Leftover discovery entries mean the pre-pass failed or was skipped;
        // they are excluded from post-task worker shards.
        discoveryTasks: discoveryTasks.map((task) => task.id || fetchTaskId(task)),
        userActions: userActionTasks.map((task) => ({
          fetchTaskId: task.id || fetchTaskId(task),
          message: task.agentMessage ?? null,
        })),
      },
      null,
      2,
    ),
  );
}

async function nextShardAssignmentIndex(outDir) {
  try {
    const names = await readdir(outDir);
    const indexes = names
      .map((name) => name.match(/^shard-(\d+)\.json$/)?.[1])
      .filter(Boolean)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return indexes.length > 0 ? Math.max(...indexes) + 1 : 0;
  } catch {
    return 0;
  }
}

async function readOrderedIdFile(file) {
  if (!file) return [];
  try {
    const text = await readFile(file, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function assignFetchTasks(args) {
  const tasksFile = argValue(args, "--tasks");
  const outDir = argValue(args, "--out-dir");
  const maxWorkersRaw = Number(argValue(args, "--max-workers", "1"));
  const maxWorkers = Number.isFinite(maxWorkersRaw)
    ? Math.max(1, Math.min(20, Math.floor(maxWorkersRaw)))
    : 1;
  const assignedTaskIdsFile = argValue(args, "--assigned-task-ids-file", null);
  const activeGroupKeysFile = argValue(args, "--active-group-keys-file", null);
  const workerIdsFile = argValue(args, "--worker-ids-file", null);
  const startIndexValue = argValue(args, "--start-index", null);
  const startIndexRaw = startIndexValue === null ? null : Number(startIndexValue);
  if (!tasksFile) throw new Error("Missing --tasks fetch-result.json");
  if (!outDir) throw new Error("Missing --out-dir");

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const excludeTaskIds = await readIdSetFile(assignedTaskIdsFile);
  const activeGroupKeys = await readIdSetFile(activeGroupKeysFile);
  const workerIds = await readOrderedIdFile(workerIdsFile);
  const assignmentWorkerIds = workerIdsFile
    ? workerIds.slice(0, maxWorkers)
    : Array.from({ length: maxWorkers }, (_, index) => `worker-${index}`);
  const plan = planFetchQueueAssignments(fetchResult, {
    maxWorkers: assignmentWorkerIds.length,
    activeGroupKeys,
    excludeTaskIds,
    maxGroupsPerAssignment: 1,
    maxTasksPerAssignment: 1,
  });

  await mkdir(outDir, { recursive: true });
  let nextIndex = startIndexRaw !== null && Number.isFinite(startIndexRaw)
    ? Math.max(0, Math.floor(startIndexRaw))
    : await nextShardAssignmentIndex(outDir);
  const shardFiles = [];
  const assignedIds = [];
  for (const [assignmentIndex, assignment] of plan.assignments.entries()) {
    const shardName = `shard-${nextIndex}`;
    const workerId = assignmentWorkerIds[assignmentIndex] ?? shardName;
    nextIndex += 1;
    const file = join(outDir, `${shardName}.json`);
    const shardTasks = assignment.tasks.map((task) => ({
      ...task,
      workerId: task?.workerId ?? workerId,
    }));
    const taskIds = shardTasks.map((task) => taskIdForSync(task));
    const assignedKeys = shardTasks.map((task) => taskKeyForSync(task));
    assignedIds.push(...taskIds);
    await writeFile(
      file,
      `${JSON.stringify(
        {
          status: "ok",
          shardIndex: nextIndex - 1,
          shardCount: null,
          dynamicAssignment: true,
          workerId,
          assignmentId: shardName,
          groupKeys: assignment.groupKeys,
          fetchTasks: shardTasks,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    shardFiles.push({
      file,
      shard: shardName,
      workerId,
      tasks: shardTasks.length,
      taskIds,
      taskKeys: assignedKeys,
      weight: assignment.weight,
      groupKeys: assignment.groupKeys,
    });
  }
  if (assignedTaskIdsFile && assignedIds.length > 0) {
    const assignedKeys = shardFiles.flatMap((shard) => shard.taskKeys ?? []);
    await appendFile(assignedTaskIdsFile, `${assignedKeys.join("\n")}\n`, "utf8");
  }

  console.log(JSON.stringify(
    {
      status: "ok",
      shards: shardFiles,
      assignedTaskIds: assignedIds,
      pendingTasks: plan.pendingTasks.length,
      pendingGroupKeys: plan.pendingGroupKeys,
      blockedTasks: plan.blockedTasks.length,
      blockedGroupKeys: plan.blockedGroupKeys,
      discoveryTasks: plan.discoveryTasks.map((task) => task.id || fetchTaskId(task)),
      userActions: plan.userActionTasks.map((task) => ({
        fetchTaskId: task.id || fetchTaskId(task),
        message: task.agentMessage ?? null,
      })),
    },
    null,
    2,
  ));
}

function normalizeShardPlan(plan) {
  if (!plan || typeof plan !== "object") return null;
  const shard = String(plan.shard || plan.name || "").trim();
  if (!shard) return null;
  const firstTask = Array.isArray(plan.tasks) ? plan.tasks.find(Boolean) : null;
  const workerId = String(plan.workerId || firstTask?.workerId || shard).trim();
  const resultFile = String(plan.resultFile || `${shard}-result.json`);
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const usage = normalizeRuntimeUsage(plan.usage, "runtime_shard");
  const progressEntries = Array.isArray(plan.progressEntries)
    ? plan.progressEntries.filter((entry) => entry && typeof entry === "object")
    : [];
  const progressTaskIds = Array.from(new Set(
    [
      ...progressEntries.map((entry) => entry.fetchTaskId ?? entry.id),
      ...(Array.isArray(plan.progressTaskIds) ? plan.progressTaskIds : []),
    ]
      .map((id) => String(id || ""))
      .filter(Boolean),
  ));
  const latestProgressEntry = progressEntries
    .slice()
    .sort((a, b) => {
      const at = Date.parse(String(a.updatedAt || "")) || Number(a.mtimeMs || 0) || 0;
      const bt = Date.parse(String(b.updatedAt || "")) || Number(b.mtimeMs || 0) || 0;
      return at - bt;
    })
    .at(-1) ?? null;
  const latestProgressTaskId = String(
    plan.latestProgressTaskId ||
      latestProgressEntry?.fetchTaskId ||
      latestProgressEntry?.id ||
      "",
  ).trim();
  return {
    shard,
    workerId,
    resultFile,
    workerLogFile: String(plan.workerLogFile || `${shard}-worker.log`),
    workerLogTail: typeof plan.workerLogTail === "string" ? plan.workerLogTail : null,
    workerLogBytes: Number.isFinite(Number(plan.workerLogBytes)) ? Number(plan.workerLogBytes) : null,
    agentOutputFile: String(plan.agentOutputFile || `${shard}-agent-output.log`),
    agentOutputTail: typeof plan.agentOutputTail === "string" ? plan.agentOutputTail : null,
    agentOutputBytes: Number.isFinite(Number(plan.agentOutputBytes)) ? Number(plan.agentOutputBytes) : null,
    usage,
    taskCount: Number.isFinite(Number(plan.taskCount)) ? Number(plan.taskCount) : tasks.length,
    taskIds: tasks.map((task) => String(task?.id || fetchTaskId(task))),
    taskTitles: tasks
      .map((task) => task?.title || task?.item?.title || task?.url || task?.item?.url || task?.id || null)
      .filter(Boolean)
      .slice(0, 5),
    progressTaskIds,
    latestProgressTaskId: latestProgressTaskId || null,
    latestProgressStatus: latestProgressEntry?.status ?? null,
    latestProgressUpdatedAt: latestProgressEntry?.updatedAt ?? null,
  };
}

function missingShardEvidence(task, shardPlan, shardSummaries, options = {}) {
  const evidence = {
    mergedBy: "merge-task-results",
    failureKind: options.failureKind || "missing_worker_result_file",
    runShardSummary: shardSummaries.map((s) => `${s.shard}:${s.status}`),
  };
  if (shardPlan) {
    evidence.missingShard = {
      shard: shardPlan.shard,
      resultFile: shardPlan.resultFile,
      workerLogFile: shardPlan.workerLogFile,
      taskCount: shardPlan.taskCount,
      taskIds: shardPlan.taskIds,
      taskTitles: shardPlan.taskTitles,
    };
    if (shardPlan.workerLogTail) evidence.missingShard.workerLogTail = shardPlan.workerLogTail;
    if (shardPlan.workerLogBytes !== null) evidence.missingShard.workerLogBytes = shardPlan.workerLogBytes;
    if (shardPlan.agentOutputFile) evidence.missingShard.agentOutputFile = shardPlan.agentOutputFile;
    if (shardPlan.agentOutputTail) evidence.missingShard.agentOutputTail = shardPlan.agentOutputTail;
    if (shardPlan.agentOutputBytes !== null) evidence.missingShard.agentOutputBytes = shardPlan.agentOutputBytes;
    if (shardPlan.latestProgressTaskId) {
      evidence.missingShard.latestProgressTaskId = shardPlan.latestProgressTaskId;
      evidence.missingShard.latestProgressStatus = shardPlan.latestProgressStatus;
      evidence.missingShard.latestProgressUpdatedAt = shardPlan.latestProgressUpdatedAt;
    }
    const workerWatchdog = workerWatchdogEventFromLog(shardPlan.workerLogTail);
    if (workerWatchdog) evidence.workerWatchdog = workerWatchdog;
  } else {
    evidence.missingTask = {
      taskId: String(task?.id || fetchTaskId(task)),
      title: task?.title || task?.url || null,
    };
  }
  if (Number.isFinite(Number(options.shardTimeoutSeconds))) {
    evidence.shardTimeoutSeconds = Number(options.shardTimeoutSeconds);
  }
  return evidence;
}

function parsedWorkerLogEvents(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((event) => event && typeof event === "object");
}

function workerEventReason(event) {
  if (!event || typeof event !== "object") return null;
  const directReason = typeof event.reason === "string" ? event.reason : null;
  const itemReason = typeof event.item?.reason === "string" ? event.item.reason : null;
  return directReason || itemReason;
}

function workerEventString(event, key) {
  if (!event || typeof event !== "object") return null;
  const direct = typeof event[key] === "string" ? event[key] : null;
  const item = typeof event.item?.[key] === "string" ? event.item[key] : null;
  return direct || item;
}

function workerTimeoutSecondsFromMessage(message) {
  const text = String(message || "");
  const match = text.match(/\bfor\s+([0-9]+)s\b/) || text.match(/\bexceeded\s+([0-9]+)s\b/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function workerWatchdogEventFromLog(text) {
  const event = parsedWorkerLogEvents(text).find((candidate) => {
    const reason = workerEventReason(candidate);
    return reason === "worker_no_progress_timeout" || reason === "worker_stalled_timeout";
  });
  if (!event) return null;
  const reason = workerEventReason(event);
  const message = workerEventString(event, "message");
  const timeoutSeconds = workerTimeoutSecondsFromMessage(message);
  const details = { reason };
  if (timeoutSeconds !== null) details.timeoutSeconds = timeoutSeconds;
  for (const key of ["worker", "shard", "at"]) {
    const value = workerEventString(event, key);
    if (value) details[key] = value;
  }
  if (message) details.message = message;
  return details;
}

function workerLogHasFailureReason(text, reason) {
  return parsedWorkerLogEvents(text).some((event) => workerEventReason(event) === reason);
}

function workerLogLooksLikeRuntimeAuthFailure(text) {
  return workerLogHasFailureReason(text, "runtime_auth_failed");
}

function workerLogLooksLikeShardTimeout(text) {
  return workerLogHasFailureReason(text, "worker_shard_timeout");
}

function workerLogLooksLikeBackgroundedTool(text) {
  return parsedWorkerLogEvents(text).some((event) => (
    workerEventReason(event) === "worker_backgrounded_tool" ||
    (
      event.type === "system" &&
      event.subtype === "task_updated" &&
      event.is_backgrounded === true
    )
  ));
}

function workerLogLooksLikeNoProgressTimeout(text) {
  return workerLogHasFailureReason(text, "worker_no_progress_timeout");
}

function workerLogLooksLikeStalledTimeout(text) {
  return workerLogHasFailureReason(text, "worker_stalled_timeout");
}

function missingShardFailure(shardPlan, shardSummary) {
  if (workerLogLooksLikeRuntimeAuthFailure(shardPlan?.workerLogTail)) {
    return {
      reason: "runtime_auth_failed",
      failureKind: "runtime_auth_failed",
    };
  }
  if (workerLogLooksLikeBackgroundedTool(shardPlan?.workerLogTail)) {
    return {
      reason: "worker_backgrounded_tool",
      failureKind: "worker_backgrounded_tool",
    };
  }
  if (workerLogLooksLikeNoProgressTimeout(shardPlan?.workerLogTail)) {
    return {
      reason: "worker_no_progress_timeout",
      failureKind: "worker_no_progress_timeout",
    };
  }
  if (workerLogLooksLikeStalledTimeout(shardPlan?.workerLogTail)) {
    return {
      reason: "worker_stalled_timeout",
      failureKind: "worker_stalled_timeout",
    };
  }
  if (workerLogLooksLikeShardTimeout(shardPlan?.workerLogTail)) {
    return {
      reason: "worker_shard_timeout",
      failureKind: "worker_shard_timeout",
    };
  }
  if (shardSummary?.status === "ok" || shardSummary?.status === "incomplete") {
    return {
      reason: "worker_incomplete_result",
      failureKind: "incomplete_worker_result",
    };
  }
  return {
    reason: "worker_missing_result",
    failureKind: "missing_worker_result_file",
  };
}

function defaultMissingFailure(options = {}) {
  const reason = String(options.defaultMissingFailureReason || "").trim();
  if (!reason) return null;
  return {
    reason,
    failureKind: String(options.defaultMissingFailureKind || reason).trim() || reason,
  };
}

function missingTaskFailure(task, shardPlan, shardSummary, options = {}) {
  const failure = shardPlan
    ? missingShardFailure(shardPlan, shardSummary)
    : defaultMissingFailure(options) ?? missingShardFailure(shardPlan, shardSummary);
  if (failure.reason !== "worker_stalled_timeout" || !shardPlan) return failure;
  const taskId = String(task?.id || fetchTaskId(task));
  const progressTaskIds = new Set(
    Array.isArray(shardPlan.progressTaskIds)
      ? shardPlan.progressTaskIds.map((id) => String(id))
      : [],
  );
  if (progressTaskIds.size === 0 || progressTaskIds.has(taskId)) return failure;
  return {
    reason: "worker_stopped_before_task_started",
    failureKind: "worker_stopped_before_task_started",
  };
}

function workerIdFromShardResultName(name) {
  const text = String(name || "");
  const checkpointMatch = text.match(/^(shard-[^/]+)-checkpoints(?:\/|$)/);
  if (checkpointMatch) return checkpointMatch[1];
  const resultMatch = text.match(/^(shard-.+?)-result\.json$/);
  if (resultMatch) return resultMatch[1];
  return null;
}

function stampItemWorkerId(item, workerId) {
  if (!workerId || !item || typeof item !== "object" || Array.isArray(item)) return item;
  const rawJson =
    item.rawJson && typeof item.rawJson === "object" && !Array.isArray(item.rawJson)
      ? item.rawJson
      : {};
  return {
    ...item,
    rawJson: {
      ...rawJson,
      workerId: rawJson.workerId ?? workerId,
    },
  };
}

function normalizeAgentExecutionMetadata(item, task, taskId, workerId) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const rawJson = objectRecord(item.rawJson);
  const agentRuntime = stringValue(rawJson.agentRuntime) || DEFAULT_AGENT_RUNTIME || "local_agent";
  const agentModel = stringValue(rawJson.agentModel) || DEFAULT_AGENT_MODEL;
  const executionMetadata = {
    ...rawJson,
    agentRuntime,
    ...(agentModel ? { agentModel } : {}),
  };
  if (task?.contentStatus !== "requires_agent") {
    return { ...item, rawJson: executionMetadata };
  }
  const fallbackProof = [
    "Local Agent worker",
    workerId || rawJson.workerId || "unknown",
    "produced this requires_agent item for fetch task",
    taskId,
    "but omitted rawJson.agentExecutionProof; merge-task-results added this provenance fallback.",
  ].join(" ");
  return {
    ...item,
    rawJson: {
      ...executionMetadata,
      agentCompletedAt: normalizedDate(rawJson.agentCompletedAt) || new Date().toISOString(),
      agentExecutionProof: stringValue(rawJson.agentExecutionProof) || fallbackProof,
    },
  };
}

function stampOutcomeWorkerId(outcome, workerId) {
  if (!workerId || !outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
    return outcome;
  }
  return {
    ...outcome,
    workerId: outcome.workerId ?? workerId,
  };
}

function preserveReadyTaskItem(item, task) {
  if (!task || task?.contentStatus !== "ready") return item;
  const original = task.item;
  if (!original || typeof original !== "object" || Array.isArray(original)) return item;
  return {
    ...item,
    kind: original.kind ?? item?.kind,
    externalId: original.externalId ?? item?.externalId,
    title: original.title ?? item?.title,
    url: original.url ?? item?.url,
    publishedAt: original.publishedAt ?? item?.publishedAt,
    sourceName: original.sourceName ?? item?.sourceName,
    description: original.description ?? item?.description,
    body: original.body ?? item?.body,
    headline: item?.headline ?? original.headline,
  };
}

function normalizeSyncItemSummary(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { item, normalized: false };
  }
  if (typeof item.summary !== "string") return { item, normalized: false };
  const summary = normalizeContentText(item.summary);
  if (summary.length <= MAX_DIGEST_HEADLINE_SUMMARY_CHARS) {
    return { item, normalized: false };
  }
  const rawJson = item.rawJson && typeof item.rawJson === "object" && !Array.isArray(item.rawJson)
    ? item.rawJson
    : {};
  return {
    item: {
      ...item,
      summary: syncExcerpt(summary, MAX_DIGEST_HEADLINE_SUMMARY_CHARS),
      rawJson: {
        ...rawJson,
        summaryNormalizedReason: rawJson.summaryNormalizedReason ?? "summary_too_long",
        summaryOriginalChars: rawJson.summaryOriginalChars ?? summary.length,
        summaryMaxChars: rawJson.summaryMaxChars ?? MAX_DIGEST_HEADLINE_SUMMARY_CHARS,
      },
    },
    normalized: true,
  };
}

function syncItemMatchesPlannedTask(builder, item, task, taskId) {
  const candidate = { builder, item };
  if (task?.agentWorkType === "fetch_builder_fallback") {
    return itemMatchesBuilderFallback(candidate, task, taskId);
  }
  return itemMatchesAgentTask(candidate, task);
}

function syncBuilderFromFetchTask(task) {
  const sync = task?.builderSync ?? {};
  return {
    builderId: sync.builderId ?? task?.builderId ?? null,
    kind: sync.kind ?? "BLOG",
    sourceType: sync.sourceType ?? task?.sourceType ?? null,
    name: sync.name ?? task?.builder ?? "Unknown source",
    handle: sync.handle ?? null,
    sourceUrl: sync.sourceUrl ?? null,
    fetchUrl: sync.fetchUrl ?? null,
    bio: sync.bio ?? null,
    subscribe: Boolean(sync.subscribe),
  };
}

function deterministicSyncItemFromFetchTask(task) {
  const item = task?.item ?? {};
  const id = String(task?.id || fetchTaskId(task));
  const rawJson = objectRecord(item.rawJson);
  return {
    kind: item.kind,
    externalId: item.externalId,
    title: item.title ?? null,
    url: item.url,
    publishedAt: item.publishedAt ?? null,
    sourceName: item.sourceName ?? task?.builder ?? null,
    body: item.body,
    headline: item.headline,
    summary: item.summary,
    rawJson: {
      ...rawJson,
      fetchTaskId: rawJson.fetchTaskId ?? id,
      readMethod: rawJson.readMethod ?? task?.readMethod ?? HUB_SHARED_REUSE_READ_METHOD,
      summaryMethod: rawJson.summaryMethod ?? task?.summaryMethod ?? HUB_SHARED_REUSE_SUMMARY_METHOD,
      deterministicSync: true,
    },
  };
}

export function mergeShardSyncPayloads(fetchResult, shardResults, options = {}) {
  const planned = extractFetchTasks(fetchResult).filter((task) => !isCandidateDiscoveryFetchTask(task));
  const plannedTaskById = new Map(
    planned.map((task) => [String(task?.id || fetchTaskId(task)), task]),
  );
  const taskTypeById = new Map(
    planned.map((task) => [String(task?.id || fetchTaskId(task)), task?.agentWorkType || ""]),
  );
  const shardPlans = (options.shardPlans ?? [])
    .map(normalizeShardPlan)
    .filter(Boolean);
  const shardPlanByTaskId = new Map();
  const shardPlanByResultFile = new Map();
  for (const plan of shardPlans) {
    for (const taskId of plan.taskIds) shardPlanByTaskId.set(taskId, plan);
    shardPlanByResultFile.set(plan.resultFile, plan);
  }

  const builders = [];
  const builderIndex = new Map();
  const taskOutcomes = [];
  // Tasks with any terminal signal (item or outcome) across all shards; the
  // backfill below covers the rest.
  const accounted = new Set();
  // Normal post tasks already synced — duplicate-item guard across shards.
  const syncedTaskIds = new Set();
  const seenFallbackItems = new Set();
  const shardSummaries = [];
  const sourceShardFromResultName = (name) => {
    const text = String(name || "");
    const match = text.match(/^(shard-[0-9]+)-result\.json$/);
    return match ? match[1] : "";
  };

  const builderKey = (builder) =>
    String(builder?.builderId || builder?.sourceUrl || builder?.handle || builder?.name || "unknown");

  const plannedTaskForSyncItem = (builder, item) => {
    const rawTaskId = item?.rawJson?.fetchTaskId ? String(item.rawJson.fetchTaskId) : null;
    const rawTask = rawTaskId ? plannedTaskById.get(rawTaskId) : null;
    if (rawTask && syncItemMatchesPlannedTask(builder, item, rawTask, rawTaskId)) {
      return { id: rawTaskId, task: rawTask };
    }
    for (const task of planned) {
      const id = String(task?.id || fetchTaskId(task));
      if (syncedTaskIds.has(id) && taskTypeById.get(id) !== "fetch_builder_fallback") continue;
      if (syncItemMatchesPlannedTask(builder, item, task, id)) return { id, task };
    }
    return rawTask ? { id: rawTaskId, task: rawTask } : null;
  };

  const syncBuilderTarget = (builder) => {
    const key = builderKey(builder);
    let target = builderIndex.get(key);
    if (!target) {
      target = { ...builder, items: [] };
      builderIndex.set(key, target);
      builders.push(target);
    }
    return target;
  };

  for (const task of planned) {
    if (!isDeterministicSyncFetchTask(task)) continue;
    const id = String(task?.id || fetchTaskId(task));
    if (accounted.has(id)) continue;
    const target = syncBuilderTarget(syncBuilderFromFetchTask(task));
    target.items.push(deterministicSyncItemFromFetchTask(task));
    accounted.add(id);
    syncedTaskIds.add(id);
  }

  for (const shard of shardResults) {
    if (
      shard.checkpoint &&
      shard.payload &&
      !(shard.payload.builders ?? []).some((builder) => (builder?.items ?? []).length > 0) &&
      !(shard.payload.taskOutcomes ?? []).some((outcome) => outcome?.fetchTaskId)
    ) {
      continue;
    }
    const workerId = shard.workerId ?? shardPlanByResultFile.get(shard.name)?.workerId ?? workerIdFromShardResultName(shard.name);
    if (!shard.payload) {
      shardSummaries.push({
        shard: shard.name,
        status: "missing",
        error: shard.error ?? "no result file",
      });
      continue;
    }
    let itemCount = 0;
    let normalizedSummaryCount = 0;
    for (const builder of shard.payload?.builders ?? []) {
      const target = syncBuilderTarget(builder);
      for (const item of builder?.items ?? []) {
        const stampedItem = stampItemWorkerId(item, workerId);
        const match = plannedTaskForSyncItem(builder, stampedItem);
        const taskId = match?.id ?? null;
        const canonicalItem = taskId
          ? {
              ...stampedItem,
              rawJson: {
                ...(stampedItem.rawJson ?? {}),
                fetchTaskId: taskId,
              },
            }
          : stampedItem;
        const mergedItem = taskId
          ? preserveReadyTaskItem(canonicalItem, match?.task)
          : canonicalItem;
        const itemWithExecutionMetadata = taskId
          ? normalizeAgentExecutionMetadata(mergedItem, match?.task, taskId, workerId)
          : mergedItem;
        const normalized = normalizeSyncItemSummary(itemWithExecutionMetadata);
        if (taskId && taskTypeById.get(taskId) === "fetch_builder_fallback") {
          // Builder-fallback tasks legitimately produce multiple items per
          // task id; dedupe those by item identity instead.
          const itemKey = `${taskId}\u0000${normalized.item?.externalId || normalized.item?.url || ""}`;
          if (seenFallbackItems.has(itemKey)) continue;
          seenFallbackItems.add(itemKey);
        } else if (taskId) {
          if (syncedTaskIds.has(taskId)) continue;
          syncedTaskIds.add(taskId);
        }
        if (taskId) accounted.add(taskId);
        target.items.push(normalized.item);
        itemCount += 1;
        if (normalized.normalized) normalizedSummaryCount += 1;
      }
    }
    let outcomeCount = 0;
    for (const outcome of shard.payload?.taskOutcomes ?? []) {
      if (!outcome?.fetchTaskId) continue;
      if (isCandidateDiscoveryOutcome(outcome)) continue;
      const id = String(outcome.fetchTaskId);
      if (accounted.has(id)) continue;
      accounted.add(id);
      taskOutcomes.push(stampOutcomeWorkerId(outcome, workerId));
      outcomeCount += 1;
    }
    if (shard.checkpoint && itemCount === 0 && outcomeCount === 0) continue;
    const sourceShard = sourceShardFromResultName(shard.name);
    const plan = shardPlanByResultFile.get(shard.name);
    shardSummaries.push({
      shard: shard.name,
      status: "ok",
      items: itemCount,
      taskOutcomes: outcomeCount,
      ...(sourceShard ? { sourceShard } : {}),
      ...(plan ? { taskCount: plan.taskCount } : {}),
      ...(normalizedSummaryCount > 0 ? { normalizedSummaries: normalizedSummaryCount } : {}),
    });
  }
  for (const summary of shardSummaries) {
    if (summary.status === "missing") {
      const plan = shardPlanByResultFile.get(summary.shard);
      if (plan && plan.taskIds.every((id) => accounted.has(id))) {
        delete summary.error;
        Object.assign(summary, {
          status: "ok",
          items: 0,
          taskOutcomes: 0,
          sourceShard: plan.shard,
          taskCount: plan.taskCount,
          completedBy: "checkpoints",
        });
      }
    }
    if (summary.status !== "ok") continue;
    const plan = shardPlanByResultFile.get(summary.shard);
    if (!plan) continue;
    const missingTaskIds = plan.taskIds.filter((id) => !accounted.has(id));
    if (missingTaskIds.length === 0) continue;
    summary.status = "incomplete";
    summary.error = "result file did not account for every shard task";
    summary.missingTasks = missingTaskIds.length;
    summary.missingTaskIds = missingTaskIds;
  }
  const knownShardResults = new Set(shardSummaries.map((summary) => summary.shard));
  const shardSummaryByResultFile = new Map(
    shardSummaries.map((summary) => [summary.shard, summary]),
  );
  if (options.backfillMissing !== false) {
    for (const plan of shardPlans) {
      if (knownShardResults.has(plan.resultFile)) continue;
      shardSummaries.push({
        shard: plan.resultFile,
        status: "missing",
        error: "no result file",
        sourceShard: plan.shard,
        taskCount: plan.taskCount,
      });
    }
  }

  // Terminal-state backstop: every planned post task a worker never reported
  // (worker crash, timeout, missing result file)
  // becomes a failed outcome so validate-agent-sync still passes coverage and
  // the fetch log records the loss instead of silently dropping the task.
  let backfilled = 0;
  if (options.backfillMissing !== false) {
    for (const task of planned) {
      if (isUserActionAgentWorkType(task?.agentWorkType)) continue;
      const id = String(task?.id || fetchTaskId(task));
      if (accounted.has(id)) continue;
      const shardPlan = shardPlanByTaskId.get(id);
      if (options.backfillUnassigned === false && !shardPlan) continue;
      accounted.add(id);
      const shardSummary = shardPlan ? shardSummaryByResultFile.get(shardPlan.resultFile) : null;
      const failure = missingTaskFailure(task, shardPlan, shardSummary, options);
      taskOutcomes.push({
        fetchTaskId: id,
        status: "failed",
        reason: failure.reason,
        evidence: missingShardEvidence(
          task,
          shardPlan,
          shardSummaries,
          { ...options, failureKind: failure.failureKind },
        ),
        ...(shardPlan?.workerId ? { workerId: shardPlan.workerId } : {}),
      });
      backfilled += 1;
    }
  }

  return {
    payload: { summaryLanguage: fetchResult?.summaryLanguage ?? null, builders, taskOutcomes },
    shards: shardSummaries,
    backfilledOutcomes: backfilled,
    accountedTaskIds: [...accounted],
  };
}

function tailLines(text, maxLines = 20, maxChars = 3000) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.length > 0);
  const tail = lines.slice(-maxLines).join("\n");
  if (tail.length <= maxChars) return tail;
  return tail.slice(tail.length - maxChars);
}

async function readOptionalText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function readShardPlanProgressEntries(progressDir) {
  let files;
  try {
    files = await readdir(progressDir);
  } catch {
    return [];
  }
  const entries = [];
  for (const fileName of files.filter((name) => name.endsWith(".json")).sort()) {
    const file = join(progressDir, fileName);
    try {
      const payload = JSON.parse(await readFile(file, "utf8"));
      const stat = await fsStat(file);
      entries.push({ ...payload, file: fileName, mtimeMs: stat.mtimeMs });
    } catch {
      // Ignore malformed progress telemetry here; checkpoint-progress reports
      // those separately and merge-task-results should not fail because a UI
      // progress file is broken.
    }
  }
  return entries;
}

async function readShardPlans(resultsDir) {
  const shardDir = dirname(resultsDir);
  let names;
  try {
    names = await readdir(shardDir);
  } catch {
    return [];
  }
  const shardNames = names.filter((name) => /^shard-.*\.json$/.test(name)).sort();
  const plans = [];
  for (const name of shardNames) {
    const file = join(shardDir, name);
    const shard = name.replace(/\.json$/, "");
    let payload;
    try {
      payload = JSON.parse(await readFile(file, "utf8"));
    } catch {
      payload = {};
    }
    const workerLogFile = `${shard}-worker.log`;
    const agentOutputFile = `${shard}-agent-output.log`;
    const usageFile = `${shard}-usage.jsonl`;
    const workerLogText = await readOptionalText(join(resultsDir, workerLogFile));
    const agentOutputText = await readOptionalText(join(resultsDir, agentOutputFile));
    const progressEntries = await readShardPlanProgressEntries(
      join(resultsDir, `${shard}-checkpoints`, "progress"),
    );
    const usage = runtimeUsageFromFile(join(resultsDir, usageFile), "runtime_sidecar") ??
      (workerLogText ? runtimeUsageFromText(workerLogText) : null) ??
      (agentOutputText ? runtimeUsageFromText(agentOutputText) : null);
    const firstTask = Array.isArray(payload.fetchTasks) ? payload.fetchTasks.find(Boolean) : null;
    plans.push({
      shard,
      workerId: payload.workerId ?? firstTask?.workerId ?? shard,
      resultFile: `${shard}-result.json`,
      workerLogFile,
      agentOutputFile,
      usageFile,
      workerLogTail: workerLogText ? tailLines(workerLogText) : null,
      workerLogBytes: workerLogText ? Buffer.byteLength(workerLogText, "utf8") : null,
      agentOutputTail: agentOutputText ? tailLines(agentOutputText) : null,
      agentOutputBytes: agentOutputText ? Buffer.byteLength(agentOutputText, "utf8") : null,
      usage,
      progressEntries,
      tasks: Array.isArray(payload.fetchTasks) ? payload.fetchTasks : [],
    });
  }
  return plans;
}

async function readShardWorkerUsages(resultsDir, plannedTasks = []) {
  if (!resultsDir) return [];
  const plannedTaskIds = new Set(
    (Array.isArray(plannedTasks) ? plannedTasks : [])
      .map((task) => String(task?.id || fetchTaskId(task)))
      .filter(Boolean),
  );
  const workerUsages = [];
  for (const plan of (await readShardPlans(resultsDir)).map(normalizeShardPlan).filter(Boolean)) {
    if (!plan.usage) continue;
    if (plannedTaskIds.size > 0 && !plan.taskIds.some((taskId) => plannedTaskIds.has(taskId))) {
      continue;
    }
    workerUsages.push({
      workerId: plan.workerId ?? plan.shard,
      usage: plan.usage,
      taskCount: plan.taskCount,
      taskIds: plan.taskIds,
    });
  }
  return workerUsages;
}

async function readShardCheckpointResults(resultsDir) {
  let entries;
  try {
    entries = await readdir(resultsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const checkpointDirs = entries
    .filter((entry) => entry.isDirectory() && /^shard-.*-checkpoints$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const results = [];
  for (const dirName of checkpointDirs) {
    const dir = join(resultsDir, dirName);
    let files;
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const fileName of files.filter((name) => name.endsWith(".json")).sort()) {
      const name = `${dirName}/${fileName}`;
      try {
        const payload = JSON.parse(await readFile(join(dir, fileName), "utf8"));
        results.push({ name, payload, checkpoint: true });
      } catch (error) {
        results.push({
          name,
          error: error instanceof Error ? error.message : String(error),
          checkpoint: true,
        });
      }
    }
  }
  return results;
}

async function readShardProgressFiles(resultsDir) {
  let entries;
  try {
    entries = await readdir(resultsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const checkpointDirs = entries
    .filter((entry) => entry.isDirectory() && /^shard-.*-checkpoints$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const results = [];
  for (const dirName of checkpointDirs) {
    const progressDir = join(resultsDir, dirName, "progress");
    let files;
    try {
      files = await readdir(progressDir);
    } catch {
      continue;
    }
    for (const fileName of files.filter((name) => name.endsWith(".json")).sort()) {
      const name = `${dirName}/progress/${fileName}`;
      try {
        const payload = JSON.parse(await readFile(join(progressDir, fileName), "utf8"));
        results.push({ name, payload, workerId: dirName.replace(/-checkpoints$/, "") });
      } catch (error) {
        results.push({
          name,
          error: error instanceof Error ? error.message : String(error),
          workerId: dirName.replace(/-checkpoints$/, ""),
        });
      }
    }
  }
  return results;
}

function progressFromWorkerProgressEntry(entry, plannedById) {
  const payload = entry?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = String(payload.fetchTaskId ?? payload.id ?? "");
  if (!id) return null;
  if (isCandidateDiscoveryTaskId(id)) return null;
  const planned = plannedById.get(id) ?? {};
  return {
    ...planned,
    id,
    status: payload.status ?? "running",
    phase: payload.phase ?? payload.status ?? "running",
    message: payload.message ?? null,
    builder: payload.builder ?? planned.builder ?? null,
    builderId: payload.builderId ?? planned.builderId ?? null,
    sourceType: payload.sourceType ?? planned.sourceType ?? null,
    title: payload.title ?? planned.title ?? null,
    url: payload.url ?? planned.url ?? null,
    workerId: payload.workerId ?? planned.workerId ?? entry.workerId ?? null,
    bodyChars: payload.bodyChars ?? null,
    bodyWords: payload.bodyWords ?? null,
    headlineChars: payload.headlineChars ?? null,
    headlineWords: payload.headlineWords ?? null,
    summaryChars: payload.summaryChars ?? null,
    summaryWords: payload.summaryWords ?? null,
    updatedAt: payload.updatedAt ?? null,
  };
}

function progressFromCheckpointItem(item, builder, entry, plannedById) {
  const id = item?.rawJson?.fetchTaskId ? String(item.rawJson.fetchTaskId) : "";
  if (!id) return null;
  if (isCandidateDiscoveryTaskId(id)) return null;
  const planned = plannedById.get(id) ?? {};
  const bodyStats = textStats(item?.body);
  const headlineStats = textStats(item?.headline);
  const summaryStats = textStats(item?.summary);
  return {
    ...planned,
    id,
    status: "summarized",
    phase: "summarize",
    message: "Summary ready; waiting for server sync.",
    workerId: planned.workerId ?? entry.name?.split("/")?.[0]?.replace(/-checkpoints$/, "") ?? null,
    builder: planned.builder ?? builder?.name ?? null,
    builderId: planned.builderId ?? builder?.builderId ?? null,
    sourceType: planned.sourceType ?? item?.sourceType ?? null,
    title: planned.title ?? item?.title ?? null,
    url: planned.url ?? item?.url ?? null,
    bodyChars: bodyStats.chars,
    bodyWords: bodyStats.words,
    headlineChars: headlineStats.chars,
    headlineWords: headlineStats.words,
    summaryChars: summaryStats.chars,
    summaryWords: summaryStats.words,
  };
}

function progressFromCheckpointOutcome(outcome, entry, plannedById) {
  const id = String(outcome?.fetchTaskId ?? "");
  if (!id) return null;
  if (isCandidateDiscoveryOutcome(outcome)) return null;
  const planned = plannedById.get(id) ?? {};
  const status = outcome.status ?? "done";
  const reason = outcome.failureReason ?? outcome.reason;
  return {
    ...planned,
    id,
    status,
    phase: "completed",
    message: reason
      ? `${String(status).replace(/_/g, " ")}: ${reason}`
      : `${String(status).replace(/_/g, " ")}.`,
    reason,
    workerId: planned.workerId ?? entry.name?.split("/")?.[0]?.replace(/-checkpoints$/, "") ?? null,
  };
}

export function coalesceCheckpointProgressUpdates(updates, completedTaskIds = []) {
  const completed = new Set(
    (Array.isArray(completedTaskIds) ? completedTaskIds : [])
      .map((id) => String(id))
      .filter(Boolean),
  );
  const byTaskId = new Map();
  for (const update of updates) {
    if (update?.id && !completed.has(String(update.id))) byTaskId.set(update.id, update);
  }
  return [...byTaskId.values()];
}

function latestProgressTask(tasks) {
  return tasks
    .filter((task) => task?.id)
    .sort((a, b) => String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")))
    .at(-1) ?? null;
}

async function emitCheckpointProgress(args) {
  const tasksFile = argValue(args, "--tasks");
  const resultsDir = argValue(args, "--results-dir");
  if (!tasksFile) throw new Error("Missing --tasks fetch-result.json");
  if (!resultsDir) throw new Error("Missing --results-dir");

  const config = await readConfig();
  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const shardPlans = await readShardPlans(resultsDir);
  const planned = fetchRunPlannedTaskPatches(fetchResult, { shardPlans });
  const workerUsages = await readShardWorkerUsages(resultsDir, planned);
  if (workerUsages.length > 0) {
    await patchFetchRunOutcomes(
      config,
      {},
      {},
      [],
      [],
      [],
      null,
      { partialOutcomes: true, workerUsages },
    );
  }
  const progress = await readFetchProgressState();
  if (!progress) return;
  const plannedById = new Map(planned.map((task) => [task.id, task]));
  const updates = [];

  for (const entry of await readShardProgressFiles(resultsDir)) {
    const update = progressFromWorkerProgressEntry(entry, plannedById);
    if (update) updates.push(update);
  }

  const checkpointCompletedIds = new Set();
  for (const entry of await readShardCheckpointResults(resultsDir)) {
    if (!entry.payload) continue;
    for (const builder of entry.payload?.builders ?? []) {
      for (const item of builder?.items ?? []) {
        const update = progressFromCheckpointItem(item, builder, entry, plannedById);
        if (!update) continue;
        checkpointCompletedIds.add(update.id);
        updates.push(update);
      }
    }
    for (const outcome of entry.payload?.taskOutcomes ?? []) {
      const update = progressFromCheckpointOutcome(outcome, entry, plannedById);
      if (!update) continue;
      checkpointCompletedIds.add(update.id);
      updates.push(update);
    }
  }

  // A successful server sync is authoritative. Worker progress/checkpoint files
  // remain on disk and can still say "summarized" on later polling cycles; do
  // not let that stale telemetry regress a terminal task back to waiting.
  const coalescedUpdates = coalesceCheckpointProgressUpdates(
    updates,
    progress.completedTaskIds,
  );
  let changed = false;
  for (const update of coalescedUpdates) {
    changed = upsertFetchProgressTask(progress, update) || changed;
  }
  const counters = progress.counters ?? {};
  const tasksPlanned = Math.max(counters.tasksPlanned ?? 0, planned.length);
  const tasksDone = Math.min(tasksPlanned, Math.max(counters.tasksDone ?? 0, checkpointCompletedIds.size));
  if (tasksPlanned !== counters.tasksPlanned || tasksDone !== counters.tasksDone) {
    progress.counters = { ...counters, tasksPlanned, tasksDone };
    changed = true;
  }
  const latest = latestProgressTask(coalescedUpdates);
  if (latest) {
    progress.current = {
      ...(progress.current ?? {}),
      task: latest.title ?? latest.url ?? latest.id,
      workerId: latest.workerId ?? null,
    };
  }
  if (!changed) return;
  if (latest) {
    appendFetchProgressEvent(progress, {
      type: "task_progress",
      taskId: latest.id,
      status: latest.status,
      message: `${latest.title ?? latest.id}: ${latest.message ?? latest.phase ?? latest.status ?? "updated"}`,
    });
  }
  await emitFetchJobProgress(config, progress, {
    stage: argValue(args, "--stage", "workers_running"),
    summary: progressSummary(fetchProgressSnapshot(progress)),
  });
}

async function mergeTaskResults(args) {
  const tasksFile = argValue(args, "--tasks");
  const resultsDir = argValue(args, "--results-dir");
  const outFile = argValue(args, "--out");
  const tasksOutFile = argValue(args, "--tasks-out", null);
  const idsOutFile = argValue(args, "--ids-out", null);
  const completedOnly = args.includes("--completed-only");
  const assignedOnly = args.includes("--assigned-only");
  const completeSourcesOnly = args.includes("--complete-sources-only");
  const excludeTaskIdsFile = argValue(args, "--exclude-task-ids-file", null);
  const shardTimeoutSeconds = Number(argValue(args, "--shard-timeout-seconds", ""));
  const defaultMissingFailureReason = argValue(args, "--default-missing-reason", null);
  if (!tasksFile) throw new Error("Missing --tasks fetch-result.json");
  if (!resultsDir) throw new Error("Missing --results-dir");
  if (!outFile) throw new Error("Missing --out library-agent-sync.json");

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const entries = (await readdir(resultsDir)).filter((name) =>
    /^shard-.*-result\.json$/.test(name),
  );
  const shardResults = [];
  for (const name of entries.sort()) {
    try {
      const payload = JSON.parse(await readFile(join(resultsDir, name), "utf8"));
      shardResults.push({ name, payload });
    } catch (error) {
      shardResults.push({
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Full shard results are preferred. Task-level checkpoints are merged after
  // them so they can rescue completed tasks when a worker later crashes or
  // fails to write its final shard result, without overriding a valid final
  // shard payload.
  shardResults.push(...(await readShardCheckpointResults(resultsDir)));

  const merged = mergeShardSyncPayloads(fetchResult, shardResults, {
    shardPlans: await readShardPlans(resultsDir),
    shardTimeoutSeconds: Number.isFinite(shardTimeoutSeconds) ? shardTimeoutSeconds : null,
    defaultMissingFailureReason,
    defaultMissingFailureKind: defaultMissingFailureReason,
    backfillMissing: !completedOnly,
    backfillUnassigned: !(assignedOnly || completeSourcesOnly),
  });
  const excluded = await readIdSetFile(excludeTaskIdsFile);
  const availableIds = syncPayloadTaskIds(merged.payload);
  const completedSourceIds = completedOnly || completeSourcesOnly
    ? completeSourceIdsForAvailableTasks(fetchResult, availableIds)
    : null;
  const selectedTasks = extractFetchTasks(fetchResult).filter((task) => {
    const id = taskIdForSync(task);
    const sourceTaskId = taskSourceTaskIdForSync(task);
    if (completedSourceIds && sourceTaskId && !completedSourceIds.has(sourceTaskId)) return false;
    return availableIds.has(id) && !excludedTaskIdsContains(excluded, task);
  });
  const selectedIds = new Set(
    selectedTasks.map((task) => taskIdForSync(task)),
  );
  const shouldFilterOutput = completedOnly || assignedOnly || completeSourcesOnly || excluded.size > 0;
  const payloadOut = shouldFilterOutput
    ? filterSyncPayloadToTaskIds(merged.payload, selectedIds)
    : merged.payload;
  const tasksOut = shouldFilterOutput
    ? filterFetchResultToTasks(fetchResult, selectedTasks, { includeZeroPostCloudSourceTasks: !completedOnly })
    : null;
  await writeFile(outFile, `${JSON.stringify(payloadOut, null, 2)}\n`, "utf8");
  if (tasksOutFile) {
    await writeFile(
      tasksOutFile,
      `${JSON.stringify(tasksOut ?? fetchResult, null, 2)}\n`,
      "utf8",
    );
  }
  if (idsOutFile) {
    const selectedKeys = selectedTasks.map((task) => taskKeyForSync(task));
    await writeFile(idsOutFile, `${selectedKeys.sort().join("\n")}${selectedKeys.length ? "\n" : ""}`, "utf8");
  }
  console.log(
    JSON.stringify(
      {
        status: "ok",
        out: outFile,
        ...(tasksOutFile ? { tasksOut: tasksOutFile } : {}),
        ...(idsOutFile ? { idsOut: idsOutFile } : {}),
        completedOnly,
        assignedOnly,
        completeSourcesOnly,
        taskIds: [...selectedIds].sort(),
        builders: payloadOut.builders.length,
        items: payloadOut.builders.reduce(
          (count, builder) => count + (builder.items?.length ?? 0),
          0,
        ),
        taskOutcomes: payloadOut.taskOutcomes.length,
        backfilledOutcomes: merged.backfilledOutcomes,
        shards: merged.shards,
      },
      null,
      2,
    ),
  );
}

function taskIdForSync(task) {
  return String(task?.id || fetchTaskId(task));
}

function taskSourceTaskIdForSync(task) {
  return String(task?.cloudSourceTaskId || task?.builderSync?.cloudSourceTaskId || "").trim();
}

function completeSourceIdsForAvailableTasks(fetchResult, availableIds) {
  const tasksBySourceId = new Map();
  for (const task of extractFetchTasks(fetchResult)) {
    if (isCandidateDiscoveryFetchTask(task) || isUserActionAgentWorkType(task?.agentWorkType)) continue;
    const sourceTaskId = taskSourceTaskIdForSync(task);
    if (!sourceTaskId) continue;
    const tasks = tasksBySourceId.get(sourceTaskId) ?? [];
    tasks.push(taskIdForSync(task));
    tasksBySourceId.set(sourceTaskId, tasks);
  }
  const complete = new Set();
  for (const [sourceTaskId, taskIds] of tasksBySourceId) {
    if (taskIds.length > 0 && taskIds.every((taskId) => availableIds.has(taskId))) {
      complete.add(sourceTaskId);
    }
  }
  return complete;
}

function taskCloudRunIdForSync(task) {
  return String(task?.cloudRunId || task?.builderSync?.cloudRunId || "").trim();
}

function taskKeyForSync(task) {
  const id = taskIdForSync(task);
  const cloudRunId = taskCloudRunIdForSync(task);
  return cloudRunId ? `${cloudRunId}\t${id}` : id;
}

function excludedTaskIdsContains(excludedIds, task) {
  const cloudRunId = taskCloudRunIdForSync(task);
  if (cloudRunId) return excludedIds.has(taskKeyForSync(task));
  return excludedIds.has(taskIdForSync(task));
}

const TERMINAL_FETCH_RUN_TASK_STATUSES = new Set(["synced", "skipped", "failed", "action_needed"]);

/**
 * @param {unknown} detailsValue
 * @param {unknown} fetchResultOrTasks
 * @returns {string[]}
 */
export function terminalFetchRunTaskKeysFromDetails(detailsValue, fetchResultOrTasks = []) {
  const plannedTasks = Array.isArray(fetchResultOrTasks?.fetchTasks)
    ? extractFetchTasks(fetchResultOrTasks)
    : Array.isArray(fetchResultOrTasks)
      ? fetchResultOrTasks
      : [];
  const plannedById = new Map(plannedTasks.map((task) => [taskIdForSync(task), task]));
  const details = objectRecord(detailsValue);
  const tasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  const keys = new Set();
  for (const value of tasks) {
    const task = objectRecord(value);
    const id = String(task.id || task.fetchTaskId || "").trim();
    if (!id) continue;
    const status = String(task.status || "").trim();
    if (!TERMINAL_FETCH_RUN_TASK_STATUSES.has(status)) continue;
    const planned = plannedById.get(id);
    if (planned) keys.add(taskKeyForSync(planned));
    else keys.add(taskKeyForSync(task));
    keys.add(id);
  }
  return [...keys].sort();
}

async function appendFetchRunTerminalTaskIds(args) {
  const outFile = argValue(args, "--out");
  if (!outFile) throw new Error("Missing --out completed-task-ids.txt");
  if (webSyncDisabled()) {
    console.log(JSON.stringify({ status: "skipped", webSyncDisabled: true }, null, 2));
    return;
  }
  const config = await readConfig();
  requireLoggedIn(config);

  const tasksFile = argValue(args, "--tasks", null);
  const fetchResult = tasksFile ? JSON.parse(await readFile(tasksFile, "utf8")) : null;
  let runId = String(argValue(args, "--run-id", "") || "").trim();
  if (!runId) {
    try {
      runId = (await readFile(libraryFetchRunIdFile(), "utf8")).trim();
    } catch {
      runId = "";
    }
  }
  if (!runId) {
    console.log(JSON.stringify({ status: "skipped", reason: "fetch_run_id_missing" }, null, 2));
    return;
  }

  const data = await getJson(`${config.appUrl}/api/skill/fetch-runs`, config.token, {
    label: "fetch run terminal task lookup",
    timeoutMs: HTTP_SYNC_TIMEOUT_MS,
  });
  const candidates = [
    ...(Array.isArray(data?.runs) ? data.runs : []),
    ...(Array.isArray(data?.cronRuns) ? data.cronRuns : []),
  ];
  const run = candidates.find((candidate) => candidate?.id === runId) ?? null;
  if (!run) {
    console.log(JSON.stringify({ status: "skipped", reason: "fetch_run_not_in_recent_page", runId }, null, 2));
    return;
  }

  const ids = terminalFetchRunTaskKeysFromDetails(run.details, fetchResult ?? []);
  if (ids.length > 0) {
    await appendFile(outFile, `${ids.join("\n")}\n`, "utf8");
  }
  console.log(JSON.stringify({ status: "ok", runId, appended: ids.length }, null, 2));
}

async function readIdSetFile(file) {
  if (!file) return new Set();
  try {
    return new Set(
      (await readFile(file, "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function syncPayloadTaskIds(payload) {
  const ids = new Set();
  for (const { item } of extractSyncItems(payload)) {
    const id = item?.rawJson?.fetchTaskId;
    if (id) ids.add(String(id));
  }
  for (const outcome of payload?.taskOutcomes ?? []) {
    if (outcome?.fetchTaskId) ids.add(String(outcome.fetchTaskId));
  }
  return ids;
}

function cloudSourceTaskIdForSync(task) {
  return String(task?.cloudSourceTaskId || task?.builderSync?.cloudSourceTaskId || "").trim();
}

function zeroPostCloudSourceTasksForSync(fetchResult) {
  const sourceTaskIdsWithPosts = new Set();
  for (const task of extractFetchTasks(fetchResult)) {
    if (isCandidateDiscoveryFetchTask(task) || isUserActionAgentWorkType(task?.agentWorkType)) continue;
    const sourceTaskId = cloudSourceTaskIdForSync(task);
    if (sourceTaskId) sourceTaskIdsWithPosts.add(sourceTaskId);
  }
  return extractCloudSourceTasks(fetchResult).filter((task) => {
    const sourceTaskId = String(task?.cloudSourceTaskId || "").trim();
    return sourceTaskId && !sourceTaskIdsWithPosts.has(sourceTaskId);
  });
}

function filterFetchResultToTasks(fetchResult, tasks, options = {}) {
  const wanted = new Set(tasks.map(taskIdForSync));
  const cloudSourceTasks = options.includeZeroPostCloudSourceTasks
    ? zeroPostCloudSourceTasksForSync(fetchResult)
    : [];
  return {
    ...copyPayloadMetadata(fetchResult),
    status: fetchResult?.status ?? "ok",
    fetchTasks: tasks,
    ...(cloudSourceTasks.length > 0 ? { cloudSourceTasks } : {}),
    taskOutcomes: Array.isArray(fetchResult?.taskOutcomes)
      ? fetchResult.taskOutcomes.filter((outcome) =>
          outcome?.fetchTaskId && wanted.has(String(outcome.fetchTaskId)),
        )
      : [],
    discoveryExpansions: Array.isArray(fetchResult?.discoveryExpansions)
      ? fetchResult.discoveryExpansions.filter((expansion) =>
          expansion?.fetchTaskId && wanted.has(String(expansion.fetchTaskId)),
        )
      : [],
  };
}

function filterSyncPayloadToTaskIds(payload, taskIds) {
  const wanted = new Set([...taskIds].map(String));
  const builders = [];
  for (const builder of payload?.builders ?? []) {
    const items = (builder?.items ?? []).filter((item) => {
      const id = item?.rawJson?.fetchTaskId;
      return id && wanted.has(String(id));
    });
    if (items.length > 0) builders.push({ ...builder, items });
  }
  const taskOutcomes = (payload?.taskOutcomes ?? []).filter((outcome) =>
    outcome?.fetchTaskId && wanted.has(String(outcome.fetchTaskId)),
  );
  return { builders, taskOutcomes };
}

function copyPayloadMetadata(payload) {
  const out = {};
  if (payload?.fetchTool !== undefined) out.fetchTool = payload.fetchTool;
  if (payload?.force !== undefined) out.force = payload.force;
  return out;
}

function ensureSyncSlice(slices, key) {
  const normalizedKey = String(key || "ungrouped");
  let slice = slices.get(normalizedKey);
  if (!slice) {
    slice = {
      key: normalizedKey,
      fetchTasks: [],
      cloudSourceTasks: [],
      plannedTaskOutcomes: [],
      discoveryExpansions: [],
      builders: [],
      builderIndex: new Map(),
      taskOutcomes: [],
    };
    slices.set(normalizedKey, slice);
  }
  return slice;
}

function builderKeyForSync(builder) {
  return String(builder?.builderId || builder?.sourceUrl || builder?.handle || builder?.name || "unknown");
}

function builderLikeTask(builder, item = {}) {
  return {
    builderId: builder?.builderId,
    builder: builder?.name,
    builderSync: builder,
    item,
  };
}

function addBuilderItemToSlice(slice, builder, item) {
  const key = builderKeyForSync(builder);
  let target = slice.builderIndex.get(key);
  if (!target) {
    target = { ...builder, items: [] };
    slice.builderIndex.set(key, target);
    slice.builders.push(target);
  }
  target.items.push(item);
}

function splitKeyForTaskGranularity(task) {
  return `task:${taskIdForSync(task)}`;
}

function splitKeyForSourceGranularity(task) {
  return sourceGroupKey(task);
}

function extractCloudSourceTasks(fetchResult) {
  return Array.isArray(fetchResult?.cloudSourceTasks) ? fetchResult.cloudSourceTasks : [];
}

function splitKeyForCloudSourceGranularity(task) {
  const sourceTaskId = String(task?.cloudSourceTaskId || "").trim();
  return sourceTaskId ? `cloudSource:${sourceTaskId}` : sourceGroupKey(task);
}

function splitSyncPayload(fetchResult, payload = {}, options = {}) {
  const granularity = options.granularity === "task" ? "task" : "source";
  const keyForTask = typeof options.keyForTask === "function"
    ? options.keyForTask
    : granularity === "task" ? splitKeyForTaskGranularity : splitKeyForSourceGranularity;
  const keyForCloudSource = typeof options.keyForCloudSource === "function"
    ? options.keyForCloudSource
    : splitKeyForCloudSourceGranularity;
  const slices = new Map();
  const taskKeyById = new Map();
  const taskById = new Map();
  const emittedItemTaskIds = new Set();
  const fetchTasks = extractFetchTasks(fetchResult);
  const cloudSourceTasks = extractCloudSourceTasks(fetchResult);

  for (const task of fetchTasks) {
    const key = keyForTask(task);
    const id = taskIdForSync(task);
    taskKeyById.set(id, key);
    taskById.set(id, task);
    ensureSyncSlice(slices, key).fetchTasks.push(task);
  }

  for (const task of cloudSourceTasks) {
    ensureSyncSlice(slices, keyForCloudSource(task)).cloudSourceTasks.push(task);
  }

  for (const outcome of fetchResult?.taskOutcomes ?? []) {
    if (!outcome?.fetchTaskId) continue;
    const key = taskKeyById.get(String(outcome.fetchTaskId)) || `outcome:${outcome.fetchTaskId}`;
    ensureSyncSlice(slices, key).plannedTaskOutcomes.push(outcome);
  }

  for (const expansion of fetchResult?.discoveryExpansions ?? []) {
    if (!expansion?.fetchTaskId) continue;
    const key = taskKeyById.get(String(expansion.fetchTaskId)) || `discovery:${expansion.fetchTaskId}`;
    ensureSyncSlice(slices, key).discoveryExpansions.push(expansion);
  }

  for (const builder of payload?.builders ?? []) {
    for (const item of builder?.items ?? []) {
      const rawTaskId = item?.rawJson?.fetchTaskId ? String(item.rawJson.fetchTaskId) : null;
      const rawTask = rawTaskId ? taskById.get(rawTaskId) : null;
      const matchedTask = rawTask && syncItemMatchesPlannedTask(builder, item, rawTask, rawTaskId)
        ? { id: rawTaskId, task: rawTask }
        : fetchTasks
          .map((task) => ({ id: taskIdForSync(task), task }))
          .find((candidate) => syncItemMatchesPlannedTask(builder, item, candidate.task, candidate.id));
      const taskId = matchedTask?.id ?? rawTaskId;
      const key = (taskId && taskKeyById.get(taskId)) || keyForTask(builderLikeTask(builder, item));
      const taskForDedupe = matchedTask?.task ?? rawTask;
      if (taskId && matchedTask && taskForDedupe?.agentWorkType !== "fetch_builder_fallback") {
        const emittedKey = `${key}\u0000${taskId}`;
        if (emittedItemTaskIds.has(emittedKey)) continue;
        emittedItemTaskIds.add(emittedKey);
      }
      const itemForSlice = taskId
        ? {
            ...item,
            rawJson: {
              ...(item.rawJson ?? {}),
              fetchTaskId: taskId,
            },
          }
        : item;
      const slice = ensureSyncSlice(slices, key);
      addBuilderItemToSlice(slice, builder, itemForSlice);
    }
  }

  for (const outcome of payload?.taskOutcomes ?? []) {
    if (!outcome?.fetchTaskId) continue;
    const key = taskKeyById.get(String(outcome.fetchTaskId)) || `outcome:${outcome.fetchTaskId}`;
    ensureSyncSlice(slices, key).taskOutcomes.push(outcome);
  }

  const metadata = copyPayloadMetadata(payload);
  return [...slices.values()].map((slice) => ({
    key: slice.key,
    tasks: {
      status: "ok",
      localErrors: [],
      fetchTasks: slice.fetchTasks,
      cloudSourceTasks: slice.cloudSourceTasks,
      taskOutcomes: slice.plannedTaskOutcomes,
      discoveryExpansions: slice.discoveryExpansions,
    },
    payload: {
      ...metadata,
      builders: slice.builders,
      taskOutcomes: slice.taskOutcomes,
    },
  }));
}

export function splitSyncPayloadBySource(fetchResult, payload = {}) {
  return splitSyncPayload(fetchResult, payload, { granularity: "source" });
}

export function splitSyncPayloadByTask(fetchResult, payload = {}) {
  return splitSyncPayload(fetchResult, payload, { granularity: "task" });
}

function splitKeyForCloudRun(task) {
  const runId = String(task?.cloudRunId || task?.builderSync?.cloudRunId || "").trim();
  return runId ? `cloudRun:${runId}` : "cloudRun:missing";
}

function splitKeyForCloudSourceRun(task) {
  const runId = String(task?.cloudRunId || "").trim();
  return runId ? `cloudRun:${runId}` : "cloudRun:missing";
}

export function splitCloudSyncPayloadByRunId(fetchResult, payload = {}) {
  return splitSyncPayload(fetchResult, payload, {
    keyForTask: splitKeyForCloudRun,
    keyForCloudSource: splitKeyForCloudSourceRun,
  })
    .map((slice) => ({
      ...slice,
      payload: {
        ...slice.payload,
        cloudRunId: slice.key.replace(/^cloudRun:/, ""),
      },
      cloudRunId: slice.key.replace(/^cloudRun:/, ""),
    }));
}

function uniqueNonEmptyStrings(values) {
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function cloudSourceTaskMergeKey(task) {
  const cloudRunId = String(task?.cloudRunId || "").trim();
  const cloudSourceTaskId = String(task?.cloudSourceTaskId || "").trim();
  if (cloudRunId || cloudSourceTaskId) return `${cloudRunId}\u0000${cloudSourceTaskId}`;
  return JSON.stringify(task ?? {});
}

function mergeCloudSourceTasks(...taskLists) {
  const merged = [];
  const seen = new Set();
  for (const list of taskLists) {
    for (const task of Array.isArray(list) ? list : []) {
      const key = cloudSourceTaskMergeKey(task);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(task);
    }
  }
  return merged;
}

export function mergeFetchResultsForQueue(baseResult = {}, nextResult = {}) {
  const baseCloudRunIds = Array.isArray(baseResult?.cloudRunIds) ? baseResult.cloudRunIds : [];
  const nextCloudRunIds = Array.isArray(nextResult?.cloudRunIds) ? nextResult.cloudRunIds : [];
  const cloudRunIds = uniqueNonEmptyStrings([
    ...baseCloudRunIds,
    baseResult?.cloudRunId,
    ...nextCloudRunIds,
    nextResult?.cloudRunId,
  ]);
  const fetchTasks = [
    ...(Array.isArray(baseResult?.fetchTasks) ? baseResult.fetchTasks : []),
    ...(Array.isArray(nextResult?.fetchTasks) ? nextResult.fetchTasks : []),
  ];
  const localErrors = [
    ...(Array.isArray(baseResult?.localErrors) ? baseResult.localErrors : []),
    ...(Array.isArray(nextResult?.localErrors) ? nextResult.localErrors : []),
  ];
  const taskOutcomes = [
    ...(Array.isArray(baseResult?.taskOutcomes) ? baseResult.taskOutcomes : []),
    ...(Array.isArray(nextResult?.taskOutcomes) ? nextResult.taskOutcomes : []),
  ];
  const discoveryExpansions = [
    ...(Array.isArray(baseResult?.discoveryExpansions) ? baseResult.discoveryExpansions : []),
    ...(Array.isArray(nextResult?.discoveryExpansions) ? nextResult.discoveryExpansions : []),
  ];
  const cloudSourceTasks = mergeCloudSourceTasks(baseResult?.cloudSourceTasks, nextResult?.cloudSourceTasks);
  return {
    ...baseResult,
    status: baseResult?.status === "error" && nextResult?.status === "error" ? "error" : "ok",
    cloudRunId: cloudRunIds[0] ?? baseResult?.cloudRunId ?? nextResult?.cloudRunId ?? null,
    cloudRunIds,
    leasedTasks: Number(baseResult?.leasedTasks || 0) + Number(nextResult?.leasedTasks || 0),
    localErrors,
    summaryLanguage: baseResult?.summaryLanguage ?? nextResult?.summaryLanguage ?? null,
    fetchTasks,
    ...(cloudSourceTasks.length > 0 ? { cloudSourceTasks } : {}),
    ...(taskOutcomes.length > 0 ? { taskOutcomes } : {}),
    ...(discoveryExpansions.length > 0 ? { discoveryExpansions } : {}),
  };
}

async function mergeFetchResultsCommand(args) {
  const baseFile = argValue(args, "--base");
  const nextFile = argValue(args, "--next");
  const outFile = argValue(args, "--out");
  if (!baseFile) throw new Error("Missing --base fetch-result.json");
  if (!nextFile) throw new Error("Missing --next next-fetch-result.json");
  if (!outFile) throw new Error("Missing --out fetch-result.json");
  const baseResult = JSON.parse(await readFile(baseFile, "utf8"));
  const nextResult = JSON.parse(await readFile(nextFile, "utf8"));
  const merged = mergeFetchResultsForQueue(baseResult, nextResult);
  await writeFile(outFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(
    {
      status: "ok",
      out: outFile,
      cloudRunIds: merged.cloudRunIds,
      fetchTasks: merged.fetchTasks.length,
      leasedTasks: merged.leasedTasks,
    },
    null,
    2,
  ));
}

function validationErrorsByTaskFromText(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return new Map();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return new Map();
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (!Array.isArray(parsed)) return new Map();
    const byTask = new Map();
    for (const entry of parsed) {
      const fetchTaskId = String(entry?.fetchTaskId || "").trim();
      if (!fetchTaskId) continue;
      const errors = Array.isArray(entry?.errors)
        ? entry.errors.map((error) => String(error)).filter(Boolean)
        : [];
      byTask.set(fetchTaskId, {
        ...(entry?.builder ? { builder: String(entry.builder) } : {}),
        ...(entry?.item ? { item: String(entry.item) } : {}),
        ...(errors.length > 0 ? { errors } : {}),
      });
    }
    return byTask;
  } catch {
    return new Map();
  }
}

const MAX_SYNC_ERROR_CHARS = 1_000;

function boundedSyncError(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SYNC_ERROR_CHARS);
}

function syncFailureFactsByTask(payload) {
  const byTaskId = new Map();
  for (const { item } of extractSyncItems(payload)) {
    const taskId = String(item?.rawJson?.fetchTaskId || "").trim();
    if (!taskId || byTaskId.has(taskId)) continue;
    const body = textStats(item?.body);
    const headline = textStats(item?.headline);
    const summary = textStats(item?.summary);
    byTaskId.set(taskId, {
      title: String(item?.title || "").trim() || null,
      url: String(item?.url || "").trim() || null,
      bodyChars: body.chars,
      bodyWords: body.words,
      headlineChars: headline.chars,
      headlineWords: headline.words,
      summaryChars: summary.chars,
      summaryWords: summary.words,
      ...(summary.chars > 0 && headline.chars > 0
        ? { completedStage: "summarize" }
        : body.chars > 0
          ? { completedStage: "read" }
          : {}),
      agentRuntime: item?.rawJson?.agentRuntime ?? null,
      agentModel: item?.rawJson?.agentModel ?? null,
      workerId: item?.rawJson?.workerId ?? null,
      readMethod: item?.rawJson?.readMethod ?? null,
      summaryMethod: item?.rawJson?.summaryMethod ?? null,
      hubSharedReuse: nonEmptyObjectRecord(item?.rawJson?.hubSharedReuse),
    });
  }
  return byTaskId;
}

function failedSyncPayloadForTasks(
  fetchResult,
  {
    reason,
    message,
    validationErrorsByTask = new Map(),
    attemptedPayload = null,
    syncError = "",
  } = {},
) {
  const taskOutcomes = [];
  const failureReason = reason || "slice_sync_failed";
  const factsByTaskId = syncFailureFactsByTask(attemptedPayload);
  const diagnostic = boundedSyncError(syncError || message);
  for (const task of extractFetchTasks(fetchResult)) {
    if (isUserActionAgentWorkType(task?.agentWorkType)) continue;
    const id = taskIdForSync(task);
    const validation = validationErrorsByTask.get(id);
    const facts = factsByTaskId.get(id);
    taskOutcomes.push({
      fetchTaskId: id,
      status: "failed",
      reason: failureReason,
      ...(facts ?? {}),
      ...(diagnostic ? { syncError: diagnostic } : {}),
      evidence: {
        failureKind: failureReason,
        failedBy: "sync-builders-slice",
        ...(message ? { message } : {}),
        ...(validation ? { validation } : {}),
      },
    });
  }
  return { builders: [], taskOutcomes };
}

async function splitSyncSlices(args) {
  const tasksFile = argValue(args, "--tasks");
  const payloadFile = argValue(args, "--file");
  const outDir = argValue(args, "--out-dir");
  const granularity = argValue(args, "--granularity", "source");
  if (!tasksFile) throw new Error("Missing --tasks fetch-result.json");
  if (!payloadFile) throw new Error("Missing --file library-agent-sync.json");
  if (!outDir) throw new Error("Missing --out-dir sync-slices/");
  if (granularity !== "source" && granularity !== "task" && granularity !== "cloud-run") {
    throw new Error("--granularity must be source, task, or cloud-run");
  }

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const slices = granularity === "cloud-run"
    ? splitCloudSyncPayloadByRunId(fetchResult, payload)
    : splitSyncPayload(fetchResult, payload, { granularity });
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const written = [];
  for (const [index, slice] of slices.entries()) {
    const prefix = `slice-${String(index).padStart(3, "0")}`;
    const tasksOut = join(outDir, `${prefix}-tasks.json`);
    const payloadOut = join(outDir, `${prefix}-payload.json`);
    await writeFile(tasksOut, `${JSON.stringify(slice.tasks, null, 2)}\n`, "utf8");
    await writeFile(payloadOut, `${JSON.stringify(slice.payload, null, 2)}\n`, "utf8");
    written.push({
      key: slice.key,
      tasks: slice.tasks.fetchTasks.length,
      builders: slice.payload.builders.length,
      items: slice.payload.builders.reduce(
        (count, builder) => count + (builder.items?.length ?? 0),
        0,
      ),
      taskOutcomes: slice.payload.taskOutcomes.length,
      tasksFile: tasksOut,
      payloadFile: payloadOut,
    });
  }

  console.log(JSON.stringify({ status: "ok", granularity, slices: written }, null, 2));
}

async function failSyncSlice(args) {
  const tasksFile = argValue(args, "--tasks");
  const payloadFile = argValue(args, "--payload", null);
  const diagnosticFile = argValue(args, "--diagnostic-file", null);
  const outFile = argValue(args, "--out");
  const tasksOutFile = argValue(args, "--tasks-out", null);
  const excludeTaskIdsFile = argValue(args, "--exclude-task-ids-file", null);
  const reason = argValue(args, "--reason", "slice_sync_failed");
  const message = argValue(args, "--message", "");
  const validationFile = argValue(args, "--validation-file", null);
  if (!tasksFile) throw new Error("Missing --tasks slice-tasks.json");
  if (!outFile) throw new Error("Missing --out failed-payload.json");

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const excluded = await readIdSetFile(excludeTaskIdsFile);
  const selectedTasks = extractFetchTasks(fetchResult).filter((task) =>
    !excludedTaskIdsContains(excluded, task),
  );
  const tasksOut = filterFetchResultToTasks(fetchResult, selectedTasks);
  const validationErrorsByTask = validationFile
    ? validationErrorsByTaskFromText(await readFile(validationFile, "utf8").catch(() => ""))
    : new Map();
  const attemptedPayload = payloadFile
    ? JSON.parse(await readFile(payloadFile, "utf8"))
    : null;
  const syncError = diagnosticFile
    ? await readFile(diagnosticFile, "utf8").catch(() => "")
    : "";
  const payload = failedSyncPayloadForTasks(tasksOut, {
    reason,
    message,
    validationErrorsByTask,
    attemptedPayload,
    syncError,
  });
  await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  if (tasksOutFile) {
    await writeFile(tasksOutFile, `${JSON.stringify(tasksOut, null, 2)}\n`, "utf8");
  }
  console.log(
    JSON.stringify(
      {
        status: "ok",
        out: outFile,
        ...(tasksOutFile ? { tasksOut: tasksOutFile } : {}),
        taskOutcomes: payload.taskOutcomes.length,
      },
      null,
      2,
    ),
  );
}

// Validate a single non-synced terminal outcome. A task that wasn't synced as
// an item must be one of skipped / failed / blocked, each with a reason; a
// `skipped` (no-content) decision additionally requires that task's OWN
// evidence — this is the gate that stops an agent skipping many tasks on one
// assumption (e.g. bulk-skipping 11 videos after listening to only the first).
function validateTaskOutcome(outcome) {
  const errors = [];
  const status = outcome?.status;
  if (status !== "skipped" && status !== "failed" && status !== "blocked") {
    errors.push("outcome.status_must_be_skipped_failed_or_blocked");
    return errors;
  }
  if (!String(outcome?.reason || "").trim()) errors.push("outcome.reason_required");
  if (status === "skipped") {
    const ev = outcome?.evidence;
    const hasEvidence =
      ev && typeof ev === "object" && !Array.isArray(ev) && Object.keys(ev).length > 0;
    if (!hasEvidence) errors.push("outcome.skipped_requires_per_task_evidence");
  }
  return errors;
}

export function validateAgentSyncPayload(fetchResult, payload) {
  const fetchTasks = extractFetchTasks(fetchResult);
  const syncReadyPayload = prepareSyncReadyPayload(payload, fetchTasks);
  const syncItems = extractSyncItems(syncReadyPayload);
  const outcomeById = new Map(
    (Array.isArray(syncReadyPayload?.taskOutcomes) ? syncReadyPayload.taskOutcomes : [])
      .filter((o) => o && o.fetchTaskId)
      .map((o) => [String(o.fetchTaskId), o]),
  );
  const validatedFetchTasks = [];
  const accountedOutcomes = [];
  const errors = [];

  const userActionTasks = [];
  for (const task of fetchTasks) {
    const id = task.id || fetchTaskId(task);
    // User-action tasks (e.g., x_token_missing) are informational: the
    // agent prints them and does not include them in the sync payload,
    // so the validator must not flag them as missing.
    if (isUserActionAgentWorkType(task.agentWorkType)) {
      userActionTasks.push({
        fetchTaskId: id,
        agentWorkType: task.agentWorkType,
        builder: task.builder,
        message: task.agentMessage ?? null,
        helpUrl: task.agentHelpUrl ?? null,
      });
      continue;
    }
    if (isCandidateDiscoveryFetchTask(task)) {
      continue;
    }
    const matches =
      task.agentWorkType === "fetch_builder_fallback"
        ? syncItems.filter((candidate) => itemMatchesBuilderFallback(candidate, task, id))
        : (() => {
            const found = syncItems.find((candidate) => itemMatchesAgentTask(candidate, task));
            return found ? [found] : [];
          })();
    if (matches.length === 0) {
      // Not synced as an item → it MUST be accounted for by a structured
      // outcome (skipped/failed/blocked). A bare omission is unaccounted.
      const outcome = outcomeById.get(id);
      if (outcome) {
        const outcomeErrors = validateTaskOutcome(outcome);
        if (outcomeErrors.length > 0) {
          errors.push({ fetchTaskId: id, builder: task.builder, errors: outcomeErrors });
        } else {
          accountedOutcomes.push({ fetchTaskId: id, status: outcome.status });
        }
        continue;
      }
      errors.push({
        fetchTaskId: id,
        builder: task.builder,
        item: task.item?.externalId || task.item?.url || task.item?.title,
        error: "missing_synced_item_for_fetch_task",
      });
      continue;
    }

    let anyValid = false;
    for (const match of matches) {
      const taskErrors = validateFetchTaskItem(task, match);
      if (taskErrors.length > 0) {
        errors.push({
          fetchTaskId: id,
          builder: task.builder,
          item: match.item.externalId || match.item.url || match.item.title,
          errors: taskErrors,
        });
        continue;
      }
      anyValid = true;
      validatedFetchTasks.push({
        fetchTaskId: id,
        builder: task.builder,
        externalId: match.item.externalId,
        contentStatus: task.contentStatus,
      });
    }
    if (!anyValid && matches.length > 0) {
      // Errors already recorded per item; do not add a separate
      // "missing_synced_item" since at least one candidate was attempted.
    }
  }

  if (errors.length > 0) {
    const error = new Error(`Agent sync validation failed for ${errors.length} task(s).`);
    error.details = errors;
    throw error;
  }

  return {
    status: "ok",
    fetchTasks: fetchTasks.length,
    validatedFetchTasks: validatedFetchTasks.length,
    accountedOutcomes: accountedOutcomes.length,
    userActions: userActionTasks,
  };
}

function extractFetchTasks(fetchResult) {
  if (
    Array.isArray(fetchResult) ||
    Array.isArray(fetchResult?.agentTasks) ||
    Array.isArray(fetchResult?.summaryTasks)
  ) {
    throw new Error("fetchTasks are required; legacy agentTasks/summaryTasks are unsupported.");
  }
  if (Array.isArray(fetchResult?.fetchTasks)) return fetchResult.fetchTasks;
  return [];
}

function extractSyncItems(payload) {
  return (payload?.builders ?? []).flatMap((builder) =>
    (builder?.items ?? []).map((item) => ({
      builder,
      item,
    })),
  );
}

function syncReadyItemError(path, message, fetchTaskId = "") {
  return {
    ...(fetchTaskId ? { fetchTaskId } : {}),
    field: path,
    error: message,
    errors: [`${path}: ${message}`],
  };
}

export function prepareSyncReadyPayload(payload, plannedTasks = []) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const plannedById = new Map(
    plannedTasks.map((task) => [String(task?.id || fetchTaskId(task)), task]),
  );
  const errors = [];
  const builders = (payload.builders ?? []).map((builder, builderIndex) => ({
    ...builder,
    items: (builder?.items ?? []).map((item, itemIndex) => {
      const path = `builders.${builderIndex}.items.${itemIndex}`;
      const fetchTaskIdValue = String(item?.rawJson?.fetchTaskId || "").trim();
      const task = plannedById.get(fetchTaskIdValue);
      const next = { ...item };

      if (item?.publishedAt !== null && item?.publishedAt !== undefined) {
        const publishedAt = normalizedDate(item.publishedAt);
        if (!publishedAt) {
          errors.push(syncReadyItemError(
            `${path}.publishedAt`,
            "publishedAt must be a valid datetime",
            fetchTaskIdValue,
          ));
        } else {
          next.publishedAt = publishedAt;
        }
      }

      const isFallbackResult =
        task?.agentWorkType === "fetch_builder_fallback" ||
        String(item?.externalId || "").startsWith("agent-fallback:");
      if (isFallbackResult) {
        if (String(item?.externalId || "").startsWith("agent-fallback:")) {
          errors.push(syncReadyItemError(
            `${path}.externalId`,
            "builder fallback externalId must replace the placeholder identity",
            fetchTaskIdValue,
          ));
        }
        if (!String(item?.title || "").trim()) {
          errors.push(syncReadyItemError(
            `${path}.title`,
            "builder fallback title is required for the actual post identity",
            fetchTaskIdValue,
          ));
        }
      }
      return next;
    }),
  }));

  if (errors.length > 0) {
    const summary = errors.map((entry) => `${entry.field}: ${entry.error}`).join("; ");
    const error = new Error(`Sync-ready item validation failed: ${summary}`);
    error.details = errors;
    throw error;
  }
  return { ...payload, builders };
}

function itemMatchesBuilderFallback(candidate, task, taskId) {
  const rawJson = candidate.item.rawJson;
  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) return false;
  if (rawJson.fetchTaskId !== taskId) return false;
  const builder = candidate.builder;
  const sync = task.builderSync || {};
  if (builder.builderId && task.builderId && builder.builderId === task.builderId) return true;
  if (sync.handle && builder.handle && builder.handle === sync.handle) return true;
  if (sync.sourceUrl && builder.sourceUrl && builder.sourceUrl === sync.sourceUrl) return true;
  if (task.builder && builder.name === task.builder) return true;
  return false;
}

function itemMatchesAgentTask(candidate, task) {
  const item = candidate.item;
  const builder = candidate.builder;
  const taskItem = task.item ?? {};
  const itemExternalId = typeof item.externalId === "string" && item.externalId ? item.externalId : null;
  const itemUrl = typeof item.url === "string" && item.url ? item.url : null;
  const taskExternalId = typeof taskItem.externalId === "string" && taskItem.externalId ? taskItem.externalId : null;
  const taskUrl = typeof taskItem.url === "string" && taskItem.url ? taskItem.url : null;
  const externalMatches =
    (itemExternalId && taskExternalId && itemExternalId === taskExternalId) ||
    (itemUrl && taskUrl && itemUrl === taskUrl) ||
    (taskUrl && itemExternalId && itemExternalId === taskUrl);
  if (!externalMatches) return false;

  if (task.builderId) {
    const candidateBuilderIds = [
      builder.builderId,
      item.rawJson?.builderId,
    ].filter(Boolean).map(String);
    if (candidateBuilderIds.length > 0) {
      return candidateBuilderIds.includes(String(task.builderId));
    }
  }

  const builderMatches =
    builder.name === task.builder ||
    builder.builderId === task.builderId ||
    builder.handle === task.builder ||
    builder.sourceUrl === taskItem.sourceUrl ||
    builder.fetchUrl === taskItem.sourceUrl ||
    builder.sourceUrl === taskItem.url ||
    builder.fetchUrl === taskItem.url ||
    item.rawJson?.builderId === task.builderId ||
    item.rawJson?.builderName === task.builder;
  return builderMatches || !task.builder;
}

function validateFetchTaskItem(task, candidate) {
  const errors = [];
  const rawJson = candidate.item.rawJson;
  const taskId = task.id || fetchTaskId(task);
  const canSyncWithoutBody = itemCanSyncWithoutBodyForValidation(task, candidate);
  if (!String(candidate.item.body || "").trim() && !canSyncWithoutBody) {
    errors.push("item.body_required");
  }
  if (task.item?.body && normalizeContentText(candidate.item.body) !== normalizeContentText(task.item.body)) {
    errors.push("item.body_must_match_ready_fetch_task_body");
  }
  const summaryErrors = validateItemSummary(candidate.item.summary, {
    title: task.item?.title || "",
    body: candidate.item.body || task.item?.body || "",
  });
  errors.push(...summaryErrors.map((error) => `summary:${error}`));
  const headlineErrors = validateItemHeadline(candidate.item.headline, {
    title: task.item?.title || "",
    summary: candidate.item.summary || "",
  });
  errors.push(...headlineErrors.map((error) => `headline:${error}`));

  if (task.contentStatus !== "requires_agent") {
    if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
      errors.push("rawJson.fetchTaskId_required");
      return errors;
    }
    if (rawJson.fetchTaskId !== taskId) errors.push("rawJson.fetchTaskId_must_match_task_id");
    return errors;
  }

  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
    errors.push("rawJson_agent_execution_proof_required");
    return errors;
  }
  if (rawJson.fetchTaskId !== taskId) errors.push("rawJson.fetchTaskId_must_match_task_id");
  if (!String(rawJson.agentRuntime || "").trim()) errors.push("rawJson.agentRuntime_required");
  if (!String(rawJson.agentExecutionProof || "").trim()) {
    errors.push("rawJson.agentExecutionProof_required");
  }
  if (!normalizedDate(rawJson.agentCompletedAt)) {
    errors.push("rawJson.agentCompletedAt_required_iso_datetime");
  }

  if (canSyncWithoutBody && !String(candidate.item.body || "").trim()) {
    return errors;
  }

  if (task.agentWorkType === "youtube_transcription" || task.sourceType === "youtube") {
    const source = rawJson.transcriptSource || rawJson.contentSource || rawJson.source;
    const quality = youtubeContentQuality(candidate.item.body, {
      source,
      title: task.item?.title || "",
      description: task.item?.description || "",
      standards: task.minimumContentQuality,
    });
    if (!quality.ok) errors.push(`youtube_content_quality:${quality.reason}`);
    return errors;
  }

  const quality = genericContentQuality(candidate.item.body, {
    title: task.item?.title || "",
    description: task.item?.description || "",
    standards: task.minimumContentQuality,
    primaryContentAcquisitionVerified: hasSameOriginPrimaryDocumentAcquisition(task, candidate),
  });
  if (!quality.ok) errors.push(`content_quality:${quality.reason}`);
  return errors;
}

function itemCanSyncWithoutBodyForValidation(task, candidate) {
  if (task?.agentWorkType === "translate_summary_only") return true;
  const rawJson = objectRecord(candidate?.item?.rawJson);
  if (rawJson.agentWorkType === "translate_summary_only") return true;
  const hubSharedReuse = objectRecord(rawJson.hubSharedReuse);
  if (
    hubSharedReuse.bodyReused === false &&
    (hubSharedReuse.summaryReused === true || hubSharedReuse.summaryTranslated === true)
  ) {
    return true;
  }
  const sourceType = candidate?.builder?.sourceType ?? task?.sourceType ?? task?.builderSync?.sourceType ?? null;
  const rawContentKind = inferSyncRawContentKind(sourceType, rawJson);
  const policy = syncContentPolicyFor(sourceType, rawContentKind);
  return policy.durableRawMode === "none";
}

export function filterStaleSyncItemsByFetchCutoff(payload, plannedTasks = []) {
  const taskById = new Map(
    (Array.isArray(plannedTasks) ? plannedTasks : [])
      .map((task) => [String(task?.id || fetchTaskId(task)), task]),
  );
  const existingOutcomes = Array.isArray(payload?.taskOutcomes) ? payload.taskOutcomes : [];
  const outcomeIds = new Set(
    existingOutcomes
      .filter((outcome) => outcome?.fetchTaskId)
      .map((outcome) => String(outcome.fetchTaskId)),
  );
  const staleOutcomes = [];
  const builders = [];

  for (const builder of payload?.builders ?? []) {
    const items = [];
    for (const item of builder?.items ?? []) {
      const fetchTaskId = item?.rawJson?.fetchTaskId ? String(item.rawJson.fetchTaskId) : "";
      const task = fetchTaskId ? taskById.get(fetchTaskId) : null;
      const cutoff = normalizedDate(task?.fetchCutoff);
      const publishedAt = normalizedDate(item?.publishedAt);
      if (fetchTaskId && cutoff && publishedAt && !isAfterCutoff(publishedAt, cutoff)) {
        if (!outcomeIds.has(fetchTaskId)) {
          staleOutcomes.push({
            fetchTaskId,
            status: "skipped",
            reason: "published_before_fetch_cutoff",
            evidence: {
              publishedAt,
              fetchCutoff: cutoff,
              title: item?.title ?? task?.item?.title ?? null,
              url: item?.url ?? task?.item?.url ?? null,
            },
          });
          outcomeIds.add(fetchTaskId);
        }
        continue;
      }
      items.push(item);
    }
    if (items.length > 0) builders.push({ ...builder, items });
  }

  return {
    ...payload,
    builders,
    taskOutcomes: [...existingOutcomes, ...staleOutcomes],
  };
}

function validateSummaryShape(summary, { title = "", body = "", checkBodyPrefix = false } = {}) {
  const errors = [];
  const normalized = normalizeContentText(summary || "");
  if (normalized.length < 40) errors.push("summary_too_short");
  if (normalized.length > 1200) errors.push("summary_too_long");
  if (isNearDuplicate(normalized, title)) errors.push("summary_duplicates_title");
  if (checkBodyPrefix && body && normalized === normalizeContentText(body).slice(0, normalized.length)) {
    errors.push("summary_copies_body_prefix");
  }
  return errors;
}

function validateReusableSourceSummary(summary, { title = "" } = {}) {
  return validateSummaryShape(summary, { title });
}

function validateFinalSummary(summary, { title = "", body = "" } = {}) {
  return validateSummaryShape(summary, { title, body, checkBodyPrefix: true });
}

function validateItemSummary(summary, { title = "", body = "" } = {}) {
  return validateFinalSummary(summary, { title, body });
}

function validateHeadlineShape(headline, { title = "", summary = "" } = {}) {
  const errors = [];
  const normalized = normalizeContentText(headline || "");
  if (!normalized) {
    errors.push("headline_missing");
    return errors;
  }
  if (normalized.length > MAX_POST_HEADLINE_CHARS) errors.push("headline_too_long");
  if (textStats(normalized).words > MAX_POST_HEADLINE_WORDS) errors.push("headline_too_long");
  if (isNearDuplicate(normalized, title)) errors.push("headline_duplicates_title");
  if (normalizeContentText(summary) && normalized === normalizeContentText(summary)) {
    errors.push("headline_duplicates_summary");
  }
  return errors;
}

function validateItemHeadline(headline, { title = "", summary = "" } = {}) {
  return validateHeadlineShape(headline, { title, summary });
}

function genericContentQuality(
  text,
  {
    title = "",
    description = "",
    standards,
    primaryContentAcquisitionVerified = false,
  } = {},
) {
  const normalized = normalizeContentText(text);
  const units = contentUnits(normalized);
  const qualityStandards = standards ?? genericMinimumContentQuality();
  const metrics = {
    chars: normalized.length,
    contentUnits: units.length,
  };
  const minChars = readQualityNumber(qualityStandards, "minChars", "minChars", 1);
  const minContentUnits = readQualityNumber(qualityStandards, "minContentUnits", "minWords", 1);
  if (metrics.chars < minChars || metrics.contentUnits < minContentUnits) {
    return { ok: false, reason: "content_too_short", metrics, standards: qualityStandards };
  }
  const duplicatesTitle = isNearDuplicate(normalized, title);
  const duplicatesUnverifiedDescription =
    !primaryContentAcquisitionVerified && isNearDuplicate(normalized, description);
  if (duplicatesTitle || duplicatesUnverifiedDescription) {
    return { ok: false, reason: "content_duplicates_metadata", metrics, standards: qualityStandards };
  }
  return { ok: true, reason: "ok", metrics, standards: qualityStandards };
}

const DEFAULT_DIGEST_SOURCE_ORDER = [
  "podcast",
  "youtube",
  "blog",
  "x",
  "github_trending",
  "product_hunt_top_products",
  "website",
];

function digestSectionLabel(sourceType, context = {}) {
  const sourceLabel = stringOrNull(context?.sources?.[sourceType]?.label);
  if (sourceLabel) return sourceLabel;
  const language = context?.language || "zh";
  const lang = String(language || "").toLowerCase();
  const zh = lang.startsWith("zh") || lang.includes("chinese") || lang.includes("中文");
  const labels = zh
    ? {
        x: "X/Twitter",
        blog: "Blog",
        github_trending: "GitHub Trending",
        product_hunt_top_products: "Product Hunt Top Products",
        youtube: "YouTube",
        podcast: "Podcast RSS",
        website: "Website",
      }
    : {
        x: "X/Twitter",
        blog: "Blog",
        github_trending: "GitHub Trending",
        product_hunt_top_products: "Product Hunt Top Products",
        youtube: "YouTube",
        podcast: "Podcast RSS",
        website: "Website",
      };
  return labels[sourceType] ?? sourceType;
}

function digestSourceOrder(context) {
  const configured = Array.isArray(context?.digest?.order) ? context.digest.order : [];
  const order = configured.length > 0 ? configured : DEFAULT_DIGEST_SOURCE_ORDER;
  return new Map(order.map((sourceId, index) => [sourceId, index]));
}

function digestTextLine(value, fallback = "") {
  return String(value || fallback)
    .replace(/\r?\n/g, " ")
    .replace(/^\s*#+\s*/, "")
    .trim();
}

function sourceTypeForDigestItem(item) {
  return normalizeSourceType(item?.builder?.sourceType || item?.sourceType || "") || "website";
}

function sourceIdentityForDigestItem(item, context) {
  const sourceType = sourceTypeForDigestItem(item);
  const host = hostLabel(item?.builder?.sourceUrl || item?.builder?.fetchUrl || item?.url || "");
  return (
    item?.sourceName ||
    item?.builder?.name ||
    context?.subscriptionEntities?.find((entity) => entity?.id === item?.entityId)?.name ||
    host ||
    sourceType
  );
}

function hostLabel(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Per-post summaries are copied verbatim from the existing summary on each
// context item — the digest agent no longer produces (or rewrites/translates)
// them. Building the map here keeps the copy deterministic and CLI-owned.
function postSummaryFromContextItems(context) {
  const map = new Map();
  const items = Array.isArray(context?.items) ? context.items : [];
  for (const item of items) {
    const id = stringOrNull(item?.id);
    const summary = stringOrNull(item?.summary);
    if (id && summary) map.set(id, summary);
  }
  return map;
}

function validateDigestAgentOutput(context, agentOutput, postSummaries) {
  const errors = [];
  if (!agentOutput || typeof agentOutput !== "object" || Array.isArray(agentOutput)) {
    throw new Error("Digest agent output must be one JSON object.");
  }
  const headlineSummary = stringOrNull(agentOutput.headlineSummary);
  if (!headlineSummary) {
    errors.push("headlineSummary is required and must be a non-empty string");
  } else if (headlineSummary.length > MAX_DIGEST_HEADLINE_SUMMARY_CHARS) {
    errors.push(
      `headlineSummary must be ${MAX_DIGEST_HEADLINE_SUMMARY_CHARS} characters or fewer ` +
        `(got ${headlineSummary.length})`,
    );
  }

  const items = Array.isArray(context?.items) ? context.items : [];
  if (items.length > MAX_DIGEST_ITEMS) {
    errors.push(`context.items must contain ${MAX_DIGEST_ITEMS} items or fewer for digest sync (got ${items.length})`);
  }
  const seenItemIds = new Set();
  for (const item of items) {
    const id = stringOrNull(item?.id);
    if (!id) {
      errors.push(`context item is missing id: ${item?.title || item?.url || "unknown item"}`);
      continue;
    }
    if (seenItemIds.has(id)) errors.push(`duplicate context item id: ${id}`);
    seenItemIds.add(id);
    // Post summaries are copied verbatim from each context item's existing
    // summary; a missing one means there is nothing to copy for that item.
    if (!postSummaries.has(id)) errors.push(`context item ${id} has no existing summary to copy`);
  }

  const sourceSummaries = Array.isArray(agentOutput.sourceSummaries)
    ? agentOutput.sourceSummaries
    : [];
  const validEntityIds = new Set(items.map((item) => item?.entityId).filter(Boolean).map(String));
  for (const row of sourceSummaries) {
    const summary = stringOrNull(row?.summary);
    if (!summary) continue;
    const entityId = stringOrNull(row?.entityId);
    if (!entityId) errors.push("non-empty source summary is missing entityId");
    else if (!validEntityIds.has(entityId)) errors.push(`source summary has unknown entityId: ${entityId}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid digest agent output: ${errors.join("; ")}`);
  }
}

function sourceSummaryFromAgentOutput(agentOutput) {
  const map = new Map();
  const rows = Array.isArray(agentOutput?.sourceSummaries) ? agentOutput.sourceSummaries : [];
  for (const row of rows) {
    const entityId = stringOrNull(row?.entityId);
    const summary = stringOrNull(row?.summary);
    if (entityId && summary) map.set(entityId, summary);
  }
  return map;
}

function postSummaryForItem(item, postSummaries) {
  return postSummaries.get(String(item?.id || "")) || "";
}

function headlineLineSeparatorIndex(line) {
  const zhIndex = line.indexOf("：");
  const asciiIndex = line.indexOf(":");
  if (zhIndex === -1) return asciiIndex;
  if (asciiIndex === -1) return zhIndex;
  return Math.min(zhIndex, asciiIndex);
}

function headlineSourceKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCombinedHeadlineSourceLabel(value) {
  const normalized = String(value || "").normalize("NFKC").trim();
  if (!normalized) return [];
  return normalized
    .split(/\s+(?:and|&|\+)\s+|[、，,]\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function headlineSourceKeysForGroup(group) {
  const keys = [
    group.source,
    digestTextLine(group.source),
    group.entityId,
  ].filter(Boolean);
  return [...keys, ...keys.map((key) => String(key).replace(/^@/, ""))]
    .map(headlineSourceKey)
    .filter(Boolean);
}

function orderedDigestGroups(items, context) {
  const order = digestSourceOrder(context);
  const sections = new Map();
  for (const item of items) {
    const sourceType = sourceTypeForDigestItem(item);
    const source = sourceIdentityForDigestItem(item, context);
    const entityId = item?.entityId || item?.builder?.entityId || source;
    if (!sections.has(sourceType)) sections.set(sourceType, new Map());
    const groups = sections.get(sourceType);
    if (!groups.has(entityId)) groups.set(entityId, { source, entityId, items: [] });
    groups.get(entityId).items.push(item);
  }

  const sectionEntries = [...sections.entries()].sort((a, b) => {
    const ai = order.has(a[0]) ? order.get(a[0]) : 999;
    const bi = order.has(b[0]) ? order.get(b[0]) : 999;
    if (ai !== bi) return ai - bi;
    return a[0].localeCompare(b[0]);
  });

  return sectionEntries.flatMap(([, groups]) =>
    [...groups.values()].sort((a, b) => a.source.localeCompare(b.source)),
  );
}

function orderHeadlineSummaryByDigestSources(headlineSummary, items, context) {
  const trimmed = stringOrNull(headlineSummary);
  if (!trimmed || !Array.isArray(items) || items.length === 0) return trimmed || "";

  const sourceOrder = new Map();
  orderedDigestGroups(items, context).forEach((group, index) => {
    for (const key of headlineSourceKeysForGroup(group)) {
      if (!sourceOrder.has(key)) sourceOrder.set(key, index);
    }
  });
  if (sourceOrder.size === 0) return trimmed;

  const rows = trimmed.split(/\r?\n/).map((rawLine, index) => {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    const separatorIndex = headlineLineSeparatorIndex(line);
    const sourceName = separatorIndex > 0 ? line.slice(0, separatorIndex).trim().replace(/^["“]|["”]$/g, "") : "";
    const orderIndexes = [
      sourceOrder.get(headlineSourceKey(sourceName)),
      ...splitCombinedHeadlineSourceLabel(sourceName).map((part) => sourceOrder.get(headlineSourceKey(part))),
    ].filter((value) => value !== undefined);
    const orderIndex = orderIndexes.length > 0 ? Math.min(...orderIndexes) : undefined;
    return { rawLine, index, orderIndex };
  });

  return rows
    .sort((a, b) => {
      const ai = a.orderIndex ?? Number.POSITIVE_INFINITY;
      const bi = b.orderIndex ?? Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      return a.index - b.index;
    })
    .map((row) => row.rawLine)
    .join("\n")
    .trim();
}

export function renderStructuredDigest(context, agentOutput = {}) {
  const items = Array.isArray(context?.items) ? context.items : [];
  const headlineSummary = orderHeadlineSummaryByDigestSources(
    agentOutput?.headlineSummary,
    items,
    context,
  );
  if (items.length === 0) {
    throw new Error("No digest items: structured digest sync requires at least one context item.");
  }

  const postSummaries = postSummaryFromContextItems(context);
  validateDigestAgentOutput(context, agentOutput, postSummaries);
  const sourceSummaries = sourceSummaryFromAgentOutput(agentOutput);
  const structuredItems = [];
  let order = 0;
  for (const group of orderedDigestGroups(items, context)) {
    const sourceType = sourceTypeForDigestItem(group.items[0]);
    const groupSummary =
      sourceSummaries.get(String(group.entityId)) ||
      sourceSummaries.get(String(group.source)) ||
      sourceSummaries.get(digestTextLine(group.source)) ||
      null;
    const sortedItems = [...group.items].sort((a, b) => {
      const at = new Date(a.publishedAt || a.createdAt || 0).getTime();
      const bt = new Date(b.publishedAt || b.createdAt || 0).getTime();
      return bt - at;
    });
    for (const item of sortedItems) {
      const itemSourceType = sourceTypeForDigestItem(item);
      const sourceName = digestTextLine(
        sourceIdentityForDigestItem(item, context),
        "Unknown source",
      );
      const builder = item?.builder ?? {};
      structuredItems.push({
        order,
        section: {
          key: sourceType,
          label: digestSectionLabel(sourceType, context),
          sourceType,
        },
        source: {
          entityId: String(item?.entityId || builder?.entityId || group.entityId || ""),
          name: sourceName,
          sourceType: itemSourceType,
          sourceUrl: stringOrNull(builder?.sourceUrl),
          fetchUrl: stringOrNull(builder?.fetchUrl),
          avatarUrl: stringOrNull(builder?.avatarUrl),
          avatarDataUrl: stringOrNull(builder?.avatarDataUrl),
        },
        sourceSummary: groupSummary,
        post: {
          feedItemId: String(item?.id || ""),
          entityId: String(item?.entityId || builder?.entityId || group.entityId || ""),
          kind: String(item?.kind || ""),
          externalId: String(item?.externalId || ""),
          title: stringOrNull(item?.title || item?.sourceName || builder?.name),
          url: String(item?.url || ""),
          sourceName: stringOrNull(item?.sourceName),
          sourceType: itemSourceType,
          publishedAt: stringOrNull(item?.publishedAt),
          createdAt: stringOrNull(item?.createdAt) || new Date(context?.generatedAt || Date.now()).toISOString(),
        },
        summary: postSummaryForItem(item, postSummaries),
      });
      order += 1;
    }
  }

  validateRenderedDigestSyncLimits({ items: structuredItems });

  return {
    headlineSummary,
    items: structuredItems,
  };
}

function validateRenderedDigestSyncLimits({ items }) {
  const serialized = JSON.stringify({ items });
  if (serialized.length > MAX_DIGEST_CONTENT_CHARS) {
    throw new Error(
      `Rendered digest exceeds sync limit: structured items must be ${MAX_DIGEST_CONTENT_CHARS} ` +
        `characters or fewer (got ${serialized.length})`,
    );
  }
}

async function renderDigest(args) {
  const contextPath = argValue(args, "--context");
  const agentOutputPath = argValue(args, "--agent-output");
  const outPath = argValue(args, "--out");
  const summaryOutPath = argValue(args, "--summary-out");
  if (!contextPath) throw new Error("Missing --context builder-blog-context.json");
  if (!agentOutputPath) throw new Error("Missing --agent-output digest-agent-output.json");
  if (!outPath) throw new Error("Missing --out builder-blog-digest.json");
  if (!summaryOutPath) throw new Error("Missing --summary-out digest-headlines.txt");

  const context = JSON.parse(await readFile(contextPath, "utf8"));
  const agentOutput = JSON.parse(await readFile(agentOutputPath, "utf8"));
  const rendered = renderStructuredDigest(context, agentOutput);
  const digestJson = `${JSON.stringify(rendered, null, 2)}\n`;
  await writeFile(outPath, digestJson, "utf8");
  await writeFile(summaryOutPath, rendered.headlineSummary || "", "utf8");
  console.log(JSON.stringify({
    status: "ok",
    itemCount: rendered.items.length,
    digestBytes: digestJson.length,
    headlineChars: rendered.headlineSummary.length,
  }, null, 2));
}

async function sync(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const file = argValue(args, "--file");
  const title = argValue(args, "--title", `AI Builder Digest — ${new Date().toLocaleDateString()}`);
  let rawDigest = "";
  if (file) {
    rawDigest = await readFile(file, "utf8");
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    rawDigest = Buffer.concat(chunks).toString("utf8");
  }
  if (!rawDigest.trim()) throw new Error("Digest JSON is empty");
  let structuredDigest;
  try {
    structuredDigest = JSON.parse(rawDigest);
  } catch (error) {
    throw new Error(`Digest JSON is invalid: ${error.message}`);
  }
  const items = Array.isArray(structuredDigest?.items) ? structuredDigest.items : [];
  if (items.length === 0) throw new Error("Digest JSON has no structured items");
  const summaryFile = argValue(args, "--summary-file", null);
  const headlineSummary = summaryFile
    ? stringOrNull(await readFile(summaryFile, "utf8"))
    : stringOrNull(argValue(args, "--summary", structuredDigest?.headlineSummary ?? null));

  // --regenerate ("re-generate today's digest"): digests are always additive —
  // the create route never replaces or deletes an existing same-day digest.
  // The flag's real effect happened at `prepare`, which re-included
  // already-digested posts as candidates; here it is forwarded for provenance.
  const regenerate = args.includes("--regenerate");

  // The candidate posts presented to this digest. Read them from the prepared
  // context file (the same JSON `prepare` wrote and the agent read) so the
  // server can mark exactly that set as digested for this user. Degrade
  // gracefully — a missing/unreadable context just skips the marking.
  // Default matches where the digest prompts write the context. Scheduled
  // runner jobs set BUILDER_BLOG_JOB_TMP_DIR so multiple accounts on the same
  // machine do not read each other's prepared context.
  const contextPath = argValue(
    args,
    "--context",
    defaultDigestContextFile(),
  );
  const digestedItems = items
    .map((item) => item?.post)
    .filter((post) => post && post.entityId && post.kind && post.externalId && post.feedItemId)
    .map((post) => ({
      entityId: post.entityId,
      kind: post.kind,
      externalId: post.externalId,
      feedItemId: post.feedItemId,
    }));
  // The DigestRun id the server issued at `prepare`; links this sync back to the
  // recorded candidate funnel so the digest log shows included-vs-dropped.
  let runId = null;
  let jobRunId = envJobRunId() || null;
  try {
    const ctx = JSON.parse(await readFile(contextPath, "utf8"));
    if (typeof ctx.runId === "string" && ctx.runId) runId = ctx.runId;
    if (typeof ctx.jobRunId === "string" && ctx.jobRunId) jobRunId = ctx.jobRunId;
  } catch {
    console.error(
      `Could not read digest candidates from ${contextPath}; skipping the ` +
        `digested-marking step (posts may reappear in the next digest).`,
    );
  }

  if (webSyncDisabled()) {
    console.log(JSON.stringify(
      {
        status: "skipped",
        webSyncDisabled: true,
        digestItems: items.length,
        digestedItems: digestedItems.length,
        runId,
        jobRunId,
        message: "Web sync disabled for smoke check; no digest, digested items, or digest log were uploaded.",
      },
      null,
      2,
    ));
    return;
  }

  const now = new Date();
  const result = await postJson(
    `${config.appUrl}/api/skill/digests`,
    {
      title,
      items,
      ...(headlineSummary ? { headlineSummary } : {}),
      // Recorded language is set server-side from the account-wide summary
      // language preference; this is only the fallback when none is set.
      language: argValue(args, "--language", "zh"),
      periodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: now.toISOString(),
      itemCount: Number(argValue(args, "--item-count", String(items.length))),
      regenerate,
      digestedItems,
      ...(runId ? { runId } : {}),
      ...(jobRunId ? { jobRunId } : {}),
    },
    config.token,
    {
      label: "digest sync",
      timeoutMs: HTTP_SYNC_LARGE_TIMEOUT_MS,
      retries: 0,
    },
  );
  console.log(JSON.stringify(result, null, 2));
}

async function patchFetchRunPlan(args) {
  const config = await readConfig();
  if (webSyncDisabled()) {
    console.log(JSON.stringify({ status: "skipped", webSyncDisabled: true }, null, 2));
    return;
  }
  requireLoggedIn(config);

  const tasksFile = argValue(args, "--tasks", defaultLibraryFetchResultFile());
  const resultsDir = argValue(args, "--results-dir");
  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const shardPlans = resultsDir ? await readShardPlans(resultsDir) : [];
  const plannedTasks = fetchRunPlannedTaskPatches(fetchResult, { shardPlans });
  let runId = "";
  try {
    runId = (await readFile(libraryFetchRunIdFile(), "utf8")).trim();
  } catch {
    console.log(JSON.stringify({ status: "skipped", reason: "fetch_run_id_missing", plannedTasks: plannedTasks.length }, null, 2));
    return;
  }
  if (!runId) {
    console.log(JSON.stringify({ status: "skipped", reason: "fetch_run_id_missing", plannedTasks: plannedTasks.length }, null, 2));
    return;
  }

  const patchPayload = fetchRunPlanPatchPayload(plannedTasks);
  let patchStatus = patchPayload ? "ok" : "skipped";
  let errorMessage = null;
  if (patchPayload) {
    try {
      await patchJson(
        `${config.appUrl}/api/skill/fetch-runs/${encodeURIComponent(runId)}`,
        patchPayload,
        config.token,
        { label: "fetch log plan patch" },
      );
    } catch (error) {
      patchStatus = "failed";
      errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to patch fetch log plan: ${errorMessage}`);
    }
  }

  const fetchProgress = await readFetchProgressState();
  if (fetchProgress) {
    seedFetchProgressPlannedTasks(fetchProgress, plannedTasks);
    const discoveryExpansions = Array.isArray(fetchResult?.discoveryExpansions)
      ? fetchResult.discoveryExpansions
      : [];
    for (const expansion of discoveryExpansions) {
      if (!expansion?.fetchTaskId) continue;
      appendFetchProgressEvent(fetchProgress, {
        type: "discovery_expanded",
        taskId: String(expansion.fetchTaskId),
        status: "synced",
        message: `Candidate discovery expanded into ${formatProgressCount(expansion.fetchTasks ?? 0)} post task${Number(expansion.fetchTasks ?? 0) === 1 ? "" : "s"}.`,
      });
    }
    await emitFetchJobProgress(config, fetchProgress, {
      stage: "tasks_planned",
      counters: {
        tasksPlanned: Math.max(fetchProgress.counters?.tasksPlanned ?? 0, plannedTasks.length),
      },
      current: { source: null, task: null },
      event: {
        type: "tasks_planned",
        message: `Planned ${plannedTasks.length} post task${plannedTasks.length === 1 ? "" : "s"}.`,
      },
    });
  }

  console.log(JSON.stringify(
    {
      status: patchStatus,
      runId,
      plannedTasks: plannedTasks.length,
      ...(errorMessage ? { error: errorMessage } : {}),
    },
    null,
    2,
  ));
}

export function fetchRunPlanPatchPayload(plannedTasks) {
  return Array.isArray(plannedTasks) && plannedTasks.length > 0 ? { plannedTasks } : null;
}

async function syncBuilders(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const file = argValue(args, "--file");
  if (!file) throw new Error("Missing --file personal-builders.json");
  const partialOutcomes = args.includes("--partial-outcomes");
  let payload = JSON.parse(await readFile(file, "utf8"));
  payload.fetchTool ??= skillFetchTool(
    "manual JSON sync",
    argValue(args, "--agent-model", DEFAULT_AGENT_MODEL),
  );
  const tasksFile = argValue(args, "--tasks", defaultLibraryFetchResultFile());
  const { plannedTasks, plannedTaskOutcomes, discoveryExpansions, summaryLanguage } = await readPlannedFetchResult(tasksFile);
  const workerUsages = await readShardWorkerUsages(argValue(args, "--results-dir", null), plannedTasks);
  payload.summaryLanguage ??= summaryLanguage ?? null;
  payload = prepareSyncReadyPayload(payload, plannedTasks);
  payload = filterStaleSyncItemsByFetchCutoff(payload, plannedTasks);
  validateAgentSyncPayload({ fetchTasks: plannedTasks }, payload);
  const plannedPostTasks = plannedTasks.filter((task) => !isCandidateDiscoveryFetchTask(task));
  const fetchProgress =
    (await readFetchProgressState()) ??
    createFetchProgressState({
      stage: partialOutcomes ? "checkpoint_syncing" : "syncing",
      counters: {
        tasksPlanned: plannedPostTasks.length,
        tasksDone: 0,
      },
    });
  if (webSyncDisabled()) {
    console.log(JSON.stringify(
      {
        status: "skipped",
        webSyncDisabled: true,
        builders: Array.isArray(payload.builders) ? payload.builders.length : 0,
        taskOutcomes: Array.isArray(payload.taskOutcomes) ? payload.taskOutcomes.length : 0,
        message: "Web sync disabled for smoke check; no builders, feed items, or fetch log were uploaded.",
      },
      null,
      2,
    ));
    return;
  }
  await emitFetchJobProgress(config, fetchProgress, {
    stage: partialOutcomes ? "checkpoint_syncing" : "syncing",
    counters: {
      tasksPlanned: Math.max(fetchProgress.counters.tasksPlanned ?? 0, plannedPostTasks.length),
    },
    current: { task: null },
    event: {
      type: partialOutcomes ? "checkpoint_syncing" : "syncing",
      message: partialOutcomes
        ? "Syncing completed checkpoint posts to FollowBrief."
        : "Syncing fetched posts to FollowBrief.",
    },
  });
  if (Array.isArray(payload.builders) && payload.builders.length === 0) {
    await patchFetchRunOutcomes(
      config,
      payload,
      { itemResults: [] },
      plannedTasks,
      plannedTaskOutcomes,
      discoveryExpansions,
      fetchProgress,
      { partialOutcomes, workerUsages },
    );
    console.log(JSON.stringify(
      {
        status: "ok",
        builders: 0,
        feedItems: 0,
        taskOutcomes: Array.isArray(payload.taskOutcomes) ? payload.taskOutcomes.length : 0,
        message: "No builders to sync; fetch log updated only.",
      },
      null,
      2,
    ));
    return;
  }
  let currentFetchRunId = "";
  try {
    currentFetchRunId = (await readFile(libraryFetchRunIdFile(), "utf8")).trim();
  } catch {
    currentFetchRunId = "";
  }
  if (!currentFetchRunId) {
    // The builders route hard-requires an existing fetch run (reset fence) and
    // responds 409 without persisting anything, so uploading without a run id
    // would ship megabytes of posts only to have them discarded. Fail fast
    // with an actionable error instead.
    throw new Error(
      "No fetch run id found for this sync (the fetch log upload failed or fetch-personal did not run). " +
      "Re-run fetch-personal, then sync-builders again.",
    );
  }
  const uploadPayload = prepareSyncPayloadForUpload({
    ...payload,
    fetchRun: buildFetchRunSyncPatch(currentFetchRunId, plannedTasks),
  });
  const result = await postJson(`${config.appUrl}/api/skill/builders`, uploadPayload, config.token, {
    label: "builder sync",
    timeoutMs: HTTP_SYNC_LARGE_TIMEOUT_MS,
    retries: 1,
  });
  console.log(JSON.stringify(result, null, 2));

  // Reconcile the fetch log against the FULL planned task list so a task the
  // agent dropped (fetched but never summarized) is recorded as a failure, not
  // left pending. Read the planned tasks the CLI emitted in fetch-personal.
  await patchFetchRunOutcomes(
    config,
    payload,
    result,
    plannedTasks,
    plannedTaskOutcomes,
    discoveryExpansions,
    fetchProgress,
    { partialOutcomes, workerUsages },
  );
}

export function prepareSyncPayloadForUpload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    ...payload,
    builders: (payload.builders ?? []).map((builder) => ({
      ...builder,
      items: (builder.items ?? []).map((item) =>
        prepareSyncItemForUpload(builder.sourceType, item),
      ),
    })),
  };
}

// Trim one planned/fetched cloud task into the per-post outcome the cloud fetch
// log renders (mirrors CloudFetchPostOutcome / the personal log's fetchTasks).
function cloudSyncPostOutcome(task, status, outcome, syncItem = null) {
  const text = (value) => (typeof value === "string" && value.trim() ? value : null);
  const count = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const item = task?.item && typeof task.item === "object" ? task.item : {};
  const rawJson = objectRecord(item.rawJson);
  const syncedRawJson = objectRecord(syncItem?.rawJson);
  const readyBody = task?.contentStatus === "ready"
    ? textStats(item.body)
    : { chars: count(task?.bodyChars), words: count(task?.bodyWords) };
  const readyHeadline = task?.contentStatus === "ready"
    ? textStats(item.headline)
    : { chars: count(task?.headlineChars), words: count(task?.headlineWords) };
  const readySummary = task?.contentStatus === "ready"
    ? textStats(item.summary)
    : { chars: count(task?.summaryChars), words: count(task?.summaryWords) };
  return {
    id: text(task?.id || fetchTaskId(task)),
    title: text(task?.title ?? item.title ?? syncItem?.title),
    url: text(task?.url ?? task?.canonicalUrl ?? item.url ?? syncItem?.url),
    contentStatus: text(task?.contentStatus),
    agentWorkType: text(task?.agentWorkType),
    status,
    failureReason: text(task?.failureReason ?? outcome?.reason),
    fetchTool: text(task?.fetchTool ?? task?.readMethod ?? task?.agentWorkType),
    agentRuntime: text(task?.agentRuntime ?? rawJson.agentRuntime ?? syncedRawJson.agentRuntime),
    agentModel: text(task?.agentModel ?? syncedRawJson.agentModel),
    bodyChars: count(task?.bodyChars) ?? readyBody.chars,
    bodyWords: count(task?.bodyWords) ?? readyBody.words,
    headlineChars: count(task?.headlineChars) ?? readyHeadline.chars,
    headlineWords: count(task?.headlineWords) ?? readyHeadline.words,
    summaryChars: count(task?.summaryChars) ?? readySummary.chars,
    summaryWords: count(task?.summaryWords) ?? readySummary.words,
    readMethod: text(task?.readMethod ?? rawJson.readMethod ?? syncedRawJson.readMethod),
    summaryMethod: text(task?.summaryMethod ?? rawJson.summaryMethod ?? syncedRawJson.summaryMethod),
    hubSharedReuse: nonEmptyObjectRecord(rawJson.hubSharedReuse) ?? nonEmptyObjectRecord(syncedRawJson.hubSharedReuse),
    workerId: text(task?.workerId ?? outcome?.workerId ?? syncedRawJson.workerId),
  };
}

function buildCloudSyncTaskResults(plannedTasks = [], payload = {}, cloudSourceTasks = []) {
  const syncItems = extractSyncItems(payload);
  const syncItemByTaskId = new Map(
    syncItems
      .map(({ item }) => {
        const id = item?.rawJson?.fetchTaskId ? String(item.rawJson.fetchTaskId) : "";
        return id ? [id, item] : null;
      })
      .filter(Boolean),
  );
  const syncItemTaskIds = new Set(
    syncItems
      .map(({ item }) => item?.rawJson?.fetchTaskId)
      .filter(Boolean)
      .map(String),
  );
  const outcomeByTaskId = new Map(
    (Array.isArray(payload?.taskOutcomes) ? payload.taskOutcomes : [])
      .filter((outcome) => outcome?.fetchTaskId)
      .map((outcome) => [String(outcome.fetchTaskId), outcome]),
  );
  const workerUsages = Array.isArray(payload?.workerUsages) ? payload.workerUsages : [];
  const grouped = new Map();
  for (const sourceTask of Array.isArray(cloudSourceTasks) ? cloudSourceTasks : []) {
    const cloudSourceTaskId = String(sourceTask?.cloudSourceTaskId || "").trim();
    if (!cloudSourceTaskId || grouped.has(cloudSourceTaskId)) continue;
    grouped.set(cloudSourceTaskId, {
      cloudSourceTaskId,
      status: "succeeded",
      plannedPosts: 0,
      syncedPosts: 0,
      failedPosts: 0,
      failureReason: null,
      details: {
        fetchTaskIds: [],
        posts: [],
        noGeneratedFetchTasks: true,
        ...(sourceTask?.builderId ? { builderId: sourceTask.builderId } : {}),
        ...(sourceTask?.name ? { name: sourceTask.name } : {}),
        ...(sourceTask?.sourceType ? { sourceType: sourceTask.sourceType } : {}),
      },
    });
  }
  for (const task of plannedTasks) {
    if (isCandidateDiscoveryFetchTask(task) || isUserActionAgentWorkType(task?.agentWorkType)) continue;
    const cloudSourceTaskId = String(task?.cloudSourceTaskId || task?.builderSync?.cloudSourceTaskId || "").trim();
    if (!cloudSourceTaskId) continue;
    const plannedFetchTaskId = String(task?.id || fetchTaskId(task));
    const group = grouped.get(cloudSourceTaskId) ?? {
      cloudSourceTaskId,
      status: "succeeded",
      plannedPosts: 0,
      syncedPosts: 0,
      failedPosts: 0,
      failureReason: null,
      details: { fetchTaskIds: [], posts: [] },
    };
    if (group.details?.noGeneratedFetchTasks) delete group.details.noGeneratedFetchTasks;
    group.plannedPosts += 1;
    group.details.fetchTaskIds.push(plannedFetchTaskId);
    const outcome = outcomeByTaskId.get(plannedFetchTaskId);
    let postStatus;
    if (syncItemTaskIds.has(plannedFetchTaskId)) {
      group.syncedPosts += 1;
      postStatus = "synced";
    } else if (outcome?.status === "failed" || outcome?.status === "blocked") {
      group.failedPosts += 1;
      group.failureReason ??= String(outcome.reason || outcome.status || "cloud_task_failed").slice(0, 400);
      postStatus = outcome.status;
    } else {
      postStatus = String(outcome?.status || task?.status || "pending");
    }
    // Persist each post's outcome so the cloud fetch log can render the same
    // per-post staged (read → summarize → sync) + debug rows the personal log
    // uses. Without this only fetchTaskIds were stored, so posts never rendered.
    group.details.posts.push(cloudSyncPostOutcome(task, postStatus, outcome, syncItemByTaskId.get(plannedFetchTaskId)));
    grouped.set(cloudSourceTaskId, group);
  }
  const groups = [...grouped.values()];
  const workerUsageGroupCounts = countWorkerUsageGroupMatches(groups, workerUsages);
  return groups.map((group) => {
    const outcomeSummary = summarizeCloudSyncSourceGroup(group);
    const fetchTaskIds = new Set(group.details.fetchTaskIds);
    const groupWorkerUsages = workerUsages.filter((usage) => {
      return workerUsageMatchesFetchTaskIds(usage, fetchTaskIds);
    });
    const sourceScopedUsages = groupWorkerUsages.filter((usage) => (
      workerUsageGroupCounts.get(workerUsageKey(usage)) === 1
    ));
    const groupUsage = aggregateWorkerUsageSummaries(sourceScopedUsages);
    if (groupWorkerUsages.length > 0) {
      group.details.workerUsages = groupWorkerUsages;
    }
    return {
      cloudSourceTaskId: group.cloudSourceTaskId,
      status: outcomeSummary.status,
      plannedPosts: outcomeSummary.plannedPosts,
      syncedPosts: outcomeSummary.syncedPosts,
      failedPosts: outcomeSummary.failedPosts,
      ...(groupUsage?.totalTokens != null ? { usageTokens: groupUsage.totalTokens } : {}),
      ...(groupUsage?.costUsd != null ? { usageCostUsd: groupUsage.costUsd } : {}),
      ...(outcomeSummary.failureReason ? { failureReason: outcomeSummary.failureReason } : {}),
      details: group.details,
    };
  });
}

function summarizeCloudSyncSourceGroup(group) {
  const posts = Array.isArray(group?.details?.posts) ? group.details.posts : [];
  const plannedPosts = nonNegativeInteger(group?.plannedPosts);
  const syncedPosts = Math.min(
    plannedPosts,
    Math.max(nonNegativeInteger(group?.syncedPosts), posts.filter((post) => postStatus(post) === "synced").length),
  );
  const skippedPosts = posts.filter((post) => postStatus(post) === "skipped").length;
  const failedPostReasons = posts
    .filter((post) => {
      const status = postStatus(post);
      return status === "failed" || status === "blocked" || status === "action_needed";
    })
    .map((post) => String(post?.failureReason || post?.reason || "").trim())
    .filter(Boolean);
  const failedFromPosts = failedPostReasons.length;
  const rawFailedPosts = nonNegativeInteger(group?.failedPosts);
  const failedPosts = Math.min(
    plannedPosts,
    failedFromPosts + Math.max(0, rawFailedPosts - failedFromPosts - skippedPosts),
  );
  const pendingPosts = Math.max(0, plannedPosts - syncedPosts - skippedPosts - failedPosts);
  const status = failedPosts > 0
    ? syncedPosts === 0 && skippedPosts === 0 && failedPosts >= plannedPosts
      ? "failed"
      : "partial"
    : pendingPosts > 0
      ? "partial"
      : "succeeded";
  return {
    status,
    plannedPosts,
    syncedPosts,
    failedPosts,
    pendingPosts,
    failureReason: failedPosts > 0
      ? failedPostReasons[0] || String(group?.failureReason || "cloud_task_failed").trim()
      : null,
  };
}

function postStatus(post) {
  const status = String(post?.status ?? "").trim().toLowerCase();
  return status || null;
}

function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function aggregateWorkerUsageSummaries(workerUsages = []) {
  let total = null;
  for (const value of workerUsages) {
    const usage = normalizeRuntimeUsage(value?.usage ?? value, "runtime_shard");
    if (!usage) continue;
    total = addUsageSummaries(total, usage);
  }
  return total;
}

function countWorkerUsageGroupMatches(groups = [], workerUsages = []) {
  const counts = new Map();
  for (const usage of workerUsages) {
    const key = workerUsageKey(usage);
    for (const group of groups) {
      if (!workerUsageMatchesFetchTaskIds(usage, new Set(group.details.fetchTaskIds))) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function workerUsageMatchesFetchTaskIds(usage, fetchTaskIds) {
  const ids = Array.isArray(usage?.taskIds) ? usage.taskIds.map((id) => String(id)) : [];
  return ids.some((id) => fetchTaskIds.has(id));
}

function workerUsageKey(usage) {
  const workerId = String(usage?.workerId ?? "");
  const ids = Array.isArray(usage?.taskIds) ? usage.taskIds.map((id) => String(id)).sort() : [];
  return `${workerId}\u0000${ids.join("\u0000")}`;
}

export function buildCloudSyncTaskResultsForTest(plannedTasks, payload) {
  return buildCloudSyncTaskResults(plannedTasks, payload);
}

export function prepareCloudSyncPayloadForUpload(payload, cloudRunId, plannedTasks = [], cloudSourceTasks = []) {
  const prepared = prepareSyncPayloadForUpload(payload);
  if (!prepared || typeof prepared !== "object") return prepared;
  const normalizedCloudRunId = String(cloudRunId || prepared.cloudRunId || "").trim();
  const scopedCloudSourceTasks = (Array.isArray(cloudSourceTasks) ? cloudSourceTasks : [])
    .filter((task) => {
      const taskRunId = String(task?.cloudRunId || "").trim();
      return !normalizedCloudRunId || !taskRunId || taskRunId === normalizedCloudRunId;
    });
  const taskResults = Array.isArray(prepared.taskResults) && prepared.taskResults.length > 0
    ? prepared.taskResults
    : buildCloudSyncTaskResults(plannedTasks, prepared, scopedCloudSourceTasks);
  return {
    ...prepared,
    cloudRunId: normalizedCloudRunId,
    taskResults,
  };
}

async function syncCloudBuilders(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const file = argValue(args, "--file");
  if (!file) throw new Error("Missing --file personal-builders.json");
  let rawPayload = JSON.parse(await readFile(file, "utf8"));
  rawPayload.fetchTool ??= skillFetchTool(
    "cloud JSON sync",
    argValue(args, "--agent-model", DEFAULT_AGENT_MODEL),
  );
  const tasksFile = argValue(args, "--tasks", defaultLibraryFetchResultFile());
  const {
    plannedTasks: rawPlannedTasks,
    cloudSourceTasks: rawCloudSourceTasks,
    summaryLanguage,
  } = await readPlannedFetchResult(tasksFile);
  const resultsDir = argValue(args, "--results-dir", null);
  const shardWorkerIds = resultsDir
    ? shardWorkerIdByTaskId(await readShardPlans(resultsDir))
    : new Map();
  const plannedTasks = rawPlannedTasks.map((task) => taskWithShardWorkerId(task, shardWorkerIds));
  const workerUsages = await readShardWorkerUsages(resultsDir, plannedTasks);
  if (workerUsages.length > 0) rawPayload.workerUsages = workerUsages;
  rawPayload.summaryLanguage ??= summaryLanguage ?? null;
  rawPayload = prepareSyncReadyPayload(rawPayload, plannedTasks);
  rawPayload = filterStaleSyncItemsByFetchCutoff(rawPayload, plannedTasks);
  validateAgentSyncPayload({ fetchTasks: plannedTasks }, rawPayload);
  const cloudRunId =
    argValue(args, "--cloud-run-id") ||
    rawPayload.cloudRunId ||
    process.env.BUILDER_BLOG_CLOUD_RUN_ID ||
    "";
  if (!String(cloudRunId).trim()) {
    throw new Error("Missing --cloud-run-id <id> for sync-cloud-builders.");
  }
  const uploadPayload = prepareCloudSyncPayloadForUpload(rawPayload, cloudRunId, plannedTasks, rawCloudSourceTasks);
  if (webSyncDisabled()) {
    console.log(JSON.stringify(
      {
        status: "skipped",
        webSyncDisabled: true,
        cloudRunId: uploadPayload.cloudRunId,
        builders: Array.isArray(uploadPayload.builders) ? uploadPayload.builders.length : 0,
        taskResults: Array.isArray(uploadPayload.taskResults) ? uploadPayload.taskResults.length : 0,
        message: "Web sync disabled for smoke check; no cloud builders or cloud fetch status were uploaded.",
      },
      null,
      2,
    ));
    return;
  }
  const result = await postJson(
    `${config.appUrl}/api/admin/cloud-fetch/sync`,
    uploadPayload,
    config.token,
    {
      label: "cloud builder sync",
      timeoutMs: HTTP_SYNC_LARGE_TIMEOUT_MS,
      retries: 1,
    },
  );
  console.log(JSON.stringify(result, null, 2));
}

function leasedCloudTaskBuilder(task) {
  const source = task?.source ?? {};
  return {
    id: task?.builderId ?? source.id,
    kind: source.kind ?? "BLOG",
    sourceType: source.sourceType ?? null,
    name: source.name ?? "Cloud source",
    handle: source.handle ?? null,
    sourceUrl: source.sourceUrl ?? null,
    fetchUrl: source.fetchUrl ?? source.sourceUrl ?? null,
    bio: source.bio ?? null,
    canonicalKey: source.canonicalKey ?? null,
  };
}

function leasedCloudTaskFetchedItems(task, builderId) {
  return Array.isArray(task?.fetchedItems)
    ? task.fetchedItems
      .filter((item) => item?.kind && item?.externalId)
      .map((item) => ({
        builderId: item.builderId ?? task?.builderId ?? builderId,
        kind: item.kind,
        externalId: item.externalId,
        publishedAt: item.publishedAt ?? null,
        createdAt: item.createdAt ?? null,
      }))
    : [];
}

async function fetchCloudLibrary(args) {
  const startedAt = new Date();
  const rawDays = Number(argValue(args, "--days", String(DEFAULT_PERSONAL_FETCH_DAYS)));
  const days = Number.isFinite(rawDays)
    ? Math.min(90, Math.max(1, Math.floor(rawDays)))
    : DEFAULT_PERSONAL_FETCH_DAYS;
  const rawPostLimit = Number(argValue(args, "--post-limit", argValue(args, "--fetch-limit", "5")));
  const postLimit = Number.isFinite(rawPostLimit) ? Math.max(1, Math.min(20, Math.floor(rawPostLimit))) : 5;
  const rawCloudLimit = Number(argValue(args, "--limit", process.env.BUILDER_BLOG_CLOUD_FETCH_LIMIT || "10"));
  const cloudLimit = Number.isFinite(rawCloudLimit)
    ? Math.max(1, Math.min(100, Math.floor(rawCloudLimit)))
    : 10;
  const force = args.includes("--force");
  const agentModel = argValue(args, "--agent-model", DEFAULT_AGENT_MODEL);
  const leaseOwner =
    argValue(args, "--lease-owner") ||
    process.env.BUILDER_BLOG_CLOUD_LEASE_OWNER ||
    `local-cloud-runner:${RUN_HOSTNAME || "unknown"}`;
  const config = await readConfig();
  requireLoggedIn(config);

  if (webSyncDisabled()) {
    console.log(JSON.stringify(
      {
        status: "skipped",
        webSyncDisabled: true,
        cloudRunId: null,
        leasedTasks: 0,
        localErrors: [],
        cloudSourceTasks: [],
        fetchTasks: [],
        taskOutcomes: [],
        message: "Web sync disabled for smoke check; no cloud fetch tasks were leased.",
      },
      null,
      2,
    ));
    return;
  }

  const lease = await postJson(
    `${config.appUrl}/api/admin/cloud-fetch/lease`,
    { limit: cloudLimit, leaseOwner, jobRunId: envJobRunId() },
    config.token,
    { label: "cloud fetch lease", retries: 1 },
  );
  if (lease.status !== "ok" || !lease.runId || !Array.isArray(lease.tasks) || lease.tasks.length === 0) {
    console.log(JSON.stringify(
      {
        status: "ok",
        cloudRunId: lease.runId ?? null,
        leasedTasks: 0,
        localErrors: [],
        summaryLanguage: null,
        cloudSourceTasks: [],
        fetchTasks: [],
        taskOutcomes: [],
      },
      null,
      2,
    ));
    return;
  }

  const context = await getJson(
    `${config.appUrl}/api/skill/context?intent=library&days=${encodeURIComponent(String(days))}`,
    config.token,
    { label: "cloud library context" },
  );
  const cloudTaskMetadataByBuilderId = new Map();
  const cloudFetchedItems = [];
  const builders = lease.tasks.map((task) => {
    const builder = leasedCloudTaskBuilder(task);
    cloudFetchedItems.push(...leasedCloudTaskFetchedItems(task, builder.id));
    cloudTaskMetadataByBuilderId.set(builder.id, {
      cloudRunId: lease.runId,
      cloudSourceTaskId: task.cloudSourceTaskId,
      builderId: builder.id,
      summaryLanguage: task.summaryLanguage,
      mustSucceedBy: task.mustSucceedBy,
      estimatedDurationSeconds: task.estimatedDurationSeconds,
      estimatedWorkSeconds: task.estimatedWorkSeconds,
      provisionalExecutionBudgetSeconds: task.provisionalExecutionBudgetSeconds,
      executionBudgetSeconds: task.executionBudgetSeconds,
      workloadClass: task.workloadClass,
      budgetReason: task.budgetReason,
      deadlineState: task.deadlineState,
      estimateEvidence: task.estimateEvidence,
    });
    return builder;
  });
  const planned = await buildFetchTasksForBuilders({
    builders,
    context: {
      ...context,
      subscriptions: [],
      personalFetchedItems: force ? [] : cloudFetchedItems,
      latestPersonalFetchedItems: [],
    },
    force,
    days,
    limit: postLimit,
    runStartedAt: startedAt,
    agentModel,
    config,
    defaultSummaryLanguage: null,
    cloudTaskMetadataByBuilderId,
  });
  console.log(JSON.stringify(
    {
      status: "ok",
      cloudRunId: lease.runId,
      leasedTasks: builders.length,
      localErrors: [],
      summaryLanguage: null,
      cloudSourceTasks: builders.map((builder) => ({
        ...cloudTaskMetadataByBuilderId.get(builder.id),
        builderId: builder.id,
        name: builder.name,
        sourceType: builder.sourceType,
        sourceUrl: builder.sourceUrl,
        fetchUrl: builder.fetchUrl,
      })),
      fetchTasks: planned.fetchTasks,
      taskOutcomes: planned.taskOutcomes,
    },
    null,
    2,
  ));
}

async function heartbeatCloudFetch(args) {
  const config = await readConfig();
  requireLoggedIn(config);
  const cloudRunId =
    argValue(args, "--cloud-run-id") ||
    process.env.BUILDER_BLOG_CLOUD_RUN_ID ||
    "";
  if (!String(cloudRunId).trim()) {
    throw new Error("Missing --cloud-run-id <id> for heartbeat-cloud-fetch.");
  }
  const leaseOwner =
    argValue(args, "--lease-owner") ||
    process.env.BUILDER_BLOG_CLOUD_LEASE_OWNER ||
    "";
  if (webSyncDisabled()) {
    console.log(JSON.stringify(
      {
        status: "skipped",
        webSyncDisabled: true,
        cloudRunId,
        message: "Web sync disabled for smoke check; no cloud fetch heartbeat was uploaded.",
      },
      null,
      2,
    ));
    return;
  }
  const result = await postJson(
    `${config.appUrl}/api/admin/cloud-fetch/heartbeat`,
    {
      runId: cloudRunId,
      ...(leaseOwner ? { leaseOwner } : {}),
    },
    config.token,
    { label: "cloud fetch heartbeat", retries: 0 },
  );
  console.log(JSON.stringify(result, null, 2));
}

async function leaseCloudBuilders(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const requestedLimit = Number(argValue(args, "--limit", "10"));
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
    : 10;
  const leaseOwner =
    argValue(args, "--lease-owner") ||
    process.env.BUILDER_BLOG_CLOUD_LEASE_OWNER ||
    `local-cloud-runner:${RUN_HOSTNAME || "unknown"}`;
  if (webSyncDisabled()) {
    console.log(JSON.stringify(
      {
        status: "skipped",
        webSyncDisabled: true,
        limit,
        leaseOwner,
        message: "Web sync disabled for smoke check; no cloud fetch tasks were leased.",
      },
      null,
      2,
    ));
    return;
  }
  const result = await postJson(
    `${config.appUrl}/api/admin/cloud-fetch/lease`,
    { limit, leaseOwner, jobRunId: envJobRunId() },
    config.token,
    {
      label: "cloud fetch lease",
      retries: 1,
    },
  );
  console.log(JSON.stringify(result, null, 2));
}

function prepareSyncItemForUpload(sourceType, item) {
  const rawJson = objectRecord(item?.rawJson);
  const body = String(item?.body ?? "");
  const rawContentKind = inferSyncRawContentKind(sourceType, rawJson);
  const policy = syncContentPolicyFor(sourceType, rawContentKind);
  const durableBody = durableSyncBody({ body, policy });
  const bodyStored = normalizeContentText(durableBody).length > 0;
  const rawRetained = bodyStored && syncBodyCanBeStoredForPolicy(policy);
  const rawTruncated =
    rawRetained &&
    policy.durableRawMaxChars > 0 &&
    normalizeContentText(body).length > normalizeContentText(durableBody).length;
  const acquisition = normalizeSyncAcquisition(sourceType, rawContentKind, rawJson);
  return {
    ...item,
    body: durableBody,
    rawJson: {
      ...sanitizeSyncRawJson(rawJson, 0),
      acquisition,
      rawContentPolicy: {
        sourceType: normalizeSourceType(sourceType) || "unknown",
        rawContentKind,
        processingRaw: "allowed",
        durableRawMode: policy.durableRawMode,
        durableRawMaxChars: policy.durableRawMaxChars,
        bodyStored,
        rawRetained,
        rawTruncated,
        hubRawSharing: false,
        temporaryRawCleanup: "required",
      },
    },
  };
}

const SYNC_RAW_STRING_LIMIT = 1000;
const SYNC_RAW_ARRAY_LIMIT = 20;
const SYNC_RAW_OBJECT_DEPTH_LIMIT = 5;
const SYNC_DANGEROUS_RAW_JSON_KEYS = new Set([
  "audio",
  "audioFile",
  "body",
  "captionText",
  "comments",
  "content",
  "html",
  "pageHtml",
  "raw",
  "rawBody",
  "rawContent",
  "rawHtml",
  "rawJson",
  "rawText",
  "rawTranscript",
  "text",
  "transcript",
  "transcriptText",
  "tweet",
]);

function syncContentPolicyFor(sourceType, rawContentKind) {
  const source = normalizeSourceType(sourceType);
  if (source === "x") return { durableRawMode: "full", durableRawMaxChars: 4000 };
  if (source === "blog") return { durableRawMode: "full", durableRawMaxChars: 50_000 };
  if (source === "website") return { durableRawMode: "excerpt", durableRawMaxChars: 12_000 };
  if (source === "github_trending") return { durableRawMode: "facts_only", durableRawMaxChars: 8000 };
  if (source === "product_hunt_top_products") return { durableRawMode: "facts_only", durableRawMaxChars: 8000 };
  if (source === "youtube") return { durableRawMode: "none", durableRawMaxChars: 0 };
  if (source === "podcast" && rawContentKind === "transcript") {
    return { durableRawMode: "none", durableRawMaxChars: 0 };
  }
  if (source === "podcast") return { durableRawMode: "excerpt", durableRawMaxChars: 30_000 };
  return { durableRawMode: "excerpt", durableRawMaxChars: 12_000 };
}

function syncBodyCanBeStoredForPolicy(policy) {
  return (
    policy?.durableRawMode === "full" ||
    policy?.durableRawMode === "excerpt" ||
    policy?.durableRawMode === "facts_only"
  );
}

function durableSyncBody({ body, policy }) {
  const normalizedBody = normalizeContentText(body);
  if (policy.durableRawMode === "none") {
    return "";
  }
  return syncExcerpt(normalizedBody, policy.durableRawMaxChars);
}

function inferSyncRawContentKind(sourceType, rawJson) {
  const source = normalizeSourceType(sourceType);
  const transcriptSource = stringValue(rawJson.transcriptSource || rawJson.contentSource);
  if (source === "youtube") return "transcript";
  if (source === "podcast") {
    if (
      transcriptSource ||
      /transcript|asr|speech|whisper/i.test(stringValue(rawJson.source)) ||
      /transcription/i.test(stringValue(rawJson.agentWorkType))
    ) {
      return "transcript";
    }
    return "show_notes";
  }
  if (source === "x") return "tweet_text";
  if (source === "blog") return "article";
  if (source === "website") return "page";
  if (source === "github_trending") return "repo_facts";
  if (source === "product_hunt_top_products") return "product_facts";
  return "raw_content";
}

function normalizeSyncAcquisition(sourceType, rawContentKind, rawJson) {
  const existing = objectRecord(rawJson.acquisition);
  return {
    provider: stringValue(existing.provider) || providerForSyncSourceType(sourceType),
    method:
      stringValue(existing.method) ||
      stringValue(rawJson.transcriptSource) ||
      stringValue(rawJson.contentSource) ||
      methodForSyncSourceType(sourceType, rawContentKind, rawJson),
    processedLocally: existing.processedLocally ?? true,
    rawPersistedRequested: existing.rawPersistedRequested ?? true,
    rightsBasis:
      stringValue(existing.rightsBasis) ||
      stringValue(rawJson.rightsBasis) ||
      rightsBasisForSyncSourceType(sourceType, rawContentKind),
  };
}

function methodForSyncSourceType(sourceType, rawContentKind, rawJson) {
  const source = normalizeSourceType(sourceType);
  if (source === "x") return "x-api-v2";
  if (source === "youtube") return stringValue(rawJson.transcriptSource) || "youtube-local-transcript";
  if (source === "podcast") {
    return rawContentKind === "transcript" ? "podcast-local-transcription" : "podcast-rss-show-notes";
  }
  if (source === "blog") return "rss-or-html-article";
  if (source === "website") return "website-html-extract";
  if (source === "github_trending") return "github-trending-investigation";
  if (source === "product_hunt_top_products") return "product-hunt-structured-facts";
  return "local-agent-fetch";
}

function providerForSyncSourceType(sourceType) {
  const source = normalizeSourceType(sourceType);
  if (source === "product_hunt_top_products") return "product-hunt";
  if (source === "github_trending") return "github";
  if (source === "podcast") return "podcast-rss";
  return source || "unknown";
}

function rightsBasisForSyncSourceType(sourceType, rawContentKind) {
  const source = normalizeSourceType(sourceType);
  if (source === "x") return "platform-api-user-token";
  if (source === "youtube") return "user-directed-local-processing";
  if (source === "podcast" && rawContentKind === "transcript") {
    return "user-directed-local-processing";
  }
  if (source === "product_hunt_top_products") return "structured-facts-only";
  return "public-source-user-directed";
}

function sanitizeSyncRawJson(rawJson, depth) {
  const output = {};
  for (const [key, value] of Object.entries(rawJson)) {
    if (SYNC_DANGEROUS_RAW_JSON_KEYS.has(key)) {
      output[key] = "[removed raw content]";
      continue;
    }
    output[key] = sanitizeSyncRawJsonValue(value, depth + 1);
  }
  return output;
}

function sanitizeSyncRawJsonValue(value, depth) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > SYNC_RAW_STRING_LIMIT
      ? `[removed long string:${value.length} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    if (depth >= SYNC_RAW_OBJECT_DEPTH_LIMIT) return `[removed deep array:${value.length} items]`;
    return value.slice(0, SYNC_RAW_ARRAY_LIMIT).map((item) => sanitizeSyncRawJsonValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth >= SYNC_RAW_OBJECT_DEPTH_LIMIT) return "[removed deep object]";
    return sanitizeSyncRawJson(value, depth);
  }
  return undefined;
}

function syncExcerpt(value, maxChars) {
  if (!value || maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 18)).trimEnd()} [truncated]`;
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonEmptyObjectRecord(value) {
  const record = objectRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function readPlannedFetchResult(tasksFile) {
  try {
    const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
    return {
      plannedTasks: Array.isArray(fetchResult?.fetchTasks) ? fetchResult.fetchTasks : [],
      cloudSourceTasks: extractCloudSourceTasks(fetchResult),
      plannedTaskOutcomes: Array.isArray(fetchResult?.taskOutcomes) ? fetchResult.taskOutcomes : [],
      discoveryExpansions: Array.isArray(fetchResult?.discoveryExpansions)
        ? fetchResult.discoveryExpansions
        : [],
      summaryLanguage: typeof fetchResult?.summaryLanguage === "string" ? fetchResult.summaryLanguage : null,
    };
  } catch {
    // No planned-tasks file (e.g. ad-hoc sync) → reconcile against payload only.
    return {
      plannedTasks: [],
      cloudSourceTasks: [],
      plannedTaskOutcomes: [],
      discoveryExpansions: [],
      summaryLanguage: null,
    };
  }
}

// After a sync, attach per-post fetch/summary outcomes to the fetch-log record
// emitted earlier by fetch-personal. Keyed by rawJson.fetchTaskId. The server
// response is authoritative for success/failure (a task succeeds only when its
// item persisted with a non-empty summary); the payload supplies sizes/model.
// Every PLANNED task is classified so dropped ones surface as failures.
// Best-effort and non-fatal: a missing run id or unreachable server just skips.
async function patchFetchRunOutcomes(
  config,
  payload,
  serverResult = {},
  plannedTasks = [],
  plannedTaskOutcomes = [],
  discoveryExpansions = [],
  fetchProgress = null,
  options = {},
) {
  if (!config?.appUrl || !config?.token) return;
  const partialOutcomes = options.partialOutcomes === true;
  const workerUsages = Array.isArray(options.workerUsages) ? options.workerUsages : [];
  let runId = "";
  try {
    runId = (await readFile(libraryFetchRunIdFile(), "utf8")).trim();
  } catch {
    return;
  }
  if (!runId) return;

  // Sizes / agent facts from the agent's sync payload, by fetchTaskId.
  const sizesByTaskId = new Map();
  for (const { item } of extractSyncItems(payload)) {
    const id = item?.rawJson?.fetchTaskId;
    if (!id) continue;
    const body = textStats(item?.body);
    const headline = textStats(item?.headline);
    const summary = textStats(item?.summary);
    sizesByTaskId.set(String(id), {
      bodyChars: body.chars,
      bodyWords: body.words,
      headlineChars: headline.chars,
      headlineWords: headline.words,
      summaryChars: summary.chars,
      summaryWords: summary.words,
      agentRuntime: item?.rawJson?.agentRuntime ?? null,
      agentModel: item?.rawJson?.agentModel ?? null,
      workerId: item?.rawJson?.workerId ?? null,
      readMethod: item?.rawJson?.readMethod ?? null,
      summaryMethod: item?.rawJson?.summaryMethod ?? null,
      hubSharedReuse: nonEmptyObjectRecord(item?.rawJson?.hubSharedReuse),
    });
  }

  // Authoritative success/failure from the server (what actually persisted).
  const serverByTaskId = new Map();
  const serverItemResults = Array.isArray(serverResult?.itemResults)
    ? serverResult.itemResults
    : [];
  for (const r of serverItemResults) {
    if (r?.fetchTaskId) serverByTaskId.set(String(r.fetchTaskId), r);
  }

  // Agent-reported terminal outcomes for tasks not synced as items
  // (skipped / failed / blocked, with reason + per-task evidence).
  const agentOutcomeById = new Map(
    [
      ...(Array.isArray(plannedTaskOutcomes) ? plannedTaskOutcomes : []),
      ...(Array.isArray(payload?.taskOutcomes) ? payload.taskOutcomes : []),
    ]
      .filter((o) => o && o.fetchTaskId)
      .map((o) => [String(o.fetchTaskId), o]),
  );
  const discoveryExpansionById = new Map(
    (Array.isArray(discoveryExpansions) ? discoveryExpansions : [])
      .filter((expansion) => expansion?.fetchTaskId)
      .map((expansion) => [String(expansion.fetchTaskId), expansion]),
  );

  // Classify every planned task; fall back to payload+server ids when no
  // planned list is available.
  const plannedById = new Map(
    plannedTasks.map((t) => [String(t?.id || fetchTaskId(t)), t]),
  );
  const taskIds = partialOutcomes
    ? [
        ...new Set([
          ...serverByTaskId.keys(),
          ...sizesByTaskId.keys(),
          ...agentOutcomeById.keys(),
        ]),
      ]
    : plannedById.size > 0 || agentOutcomeById.size > 0
      ? [
          ...new Set([
            ...plannedById.keys(),
            ...serverByTaskId.keys(),
            ...sizesByTaskId.keys(),
            ...agentOutcomeById.keys(),
            ...discoveryExpansionById.keys(),
          ]),
        ]
      : [...new Set([...serverByTaskId.keys(), ...sizesByTaskId.keys(), ...discoveryExpansionById.keys()])];

  const taskOutcomes = [];
  const discoveryProgressEvents = [];
  for (const id of taskIds) {
    const planned = plannedById.get(id);
    const agentOutcome = agentOutcomeById.get(id);
    const discoveryExpansion = discoveryExpansionById.get(id);
    if (!partialOutcomes && discoveryExpansion) {
      discoveryProgressEvents.push({
        type: "discovery_expanded",
        taskId: id,
        status: "synced",
        message: `Candidate discovery expanded into ${formatProgressCount(discoveryExpansion.fetchTasks ?? 0)} post task${Number(discoveryExpansion.fetchTasks ?? 0) === 1 ? "" : "s"}.`,
      });
      continue;
    }
    if (isCandidateDiscoveryFetchTask(planned) || isCandidateDiscoveryOutcome(agentOutcome)) continue;
    const plannedTaskPatch = planned
      ? fetchTaskLogPatch(planned, id)
      : agentOutcome?.plannedTask && typeof agentOutcome.plannedTask === "object"
        ? agentOutcome.plannedTask
        : null;
    const work = String(planned?.agentWorkType || "");
    // Informational user-action tasks (e.g. invalid X access) aren't failures.
    if (isUserActionAgentWorkType(work)) {
      taskOutcomes.push({
        fetchTaskId: id,
        status: "action_needed",
        ...(plannedTaskPatch ? { plannedTask: plannedTaskPatch } : {}),
      });
      continue;
    }
    const agentFacts = agentOutcome
      ? sanitizeAgentOutcomeFacts(
          Object.fromEntries(
            [
              "title",
              "url",
              "bodyChars",
              "bodyWords",
              "headlineChars",
              "headlineWords",
              "summaryChars",
              "summaryWords",
              "completedStage",
              "syncError",
              "agentRuntime",
              "agentModel",
              "workerId",
              "readMethod",
              "summaryMethod",
              "hubSharedReuse",
            ]
              .filter((key) => agentOutcome[key] !== undefined)
              .map((key) => [key, agentOutcome[key]]),
          ),
        )
      : {};
    const sizes = { ...agentFacts, ...(sizesByTaskId.get(id) ?? {}) };
    const server = serverByTaskId.get(id);
    let status;
    let failureReason;
    let evidence;
    const workerId = sizes.workerId ?? agentOutcome?.workerId ?? null;
    if (server) {
      status = server.status === "synced" ? "synced" : "failed";
      if (status === "failed") failureReason = server.reason || "not_synced";
    } else if (sizesByTaskId.has(id)) {
      // In the payload but unclassified by the server (older server) → trust the
      // presence of a non-empty summary.
      status = sizes.summaryChars > 0 && sizes.headlineChars > 0 ? "synced" : "failed";
      if (status === "failed") failureReason = sizes.summaryChars > 0 ? "headline_missing" : "summary_missing";
    } else if (agentOutcome) {
      // Agent reported a non-synced terminal outcome: skipped (no content, with
      // evidence) / failed / blocked. Maps onto the fetch-log status vocabulary.
      status =
        agentOutcome.status === "skipped"
          ? "skipped"
          : agentOutcome.status === "blocked"
            ? "action_needed"
            : "failed";
      failureReason = agentOutcome.reason || agentOutcome.status;
      if (agentOutcome.evidence && typeof agentOutcome.evidence === "object") {
        evidence = agentOutcome.evidence;
      }
    } else if (!partialOutcomes) {
      // Planned but neither synced nor reported by the agent → unaccounted.
      status = "failed";
      failureReason = "not_summarized";
    } else {
      continue;
    }
    taskOutcomes.push({
      fetchTaskId: id,
      ...(plannedTaskPatch ? { plannedTask: plannedTaskPatch } : {}),
      ...sizes,
      status,
      ...(workerId ? { workerId } : {}),
      ...(failureReason ? { failureReason } : {}),
      ...(evidence ? { evidence } : {}),
    });
  }
  if (fetchProgress) {
    for (const event of discoveryProgressEvents) appendFetchProgressEvent(fetchProgress, event);
    applyFetchProgressTaskOutcomes(fetchProgress, taskOutcomes, taskIds);
  }
  if (taskOutcomes.length === 0 && workerUsages.length === 0) {
    if (!partialOutcomes && fetchProgress) {
      await emitFetchJobProgress(config, fetchProgress, {
        stage: "reconciled",
        event: {
          type: "reconciled",
          message: "No post tasks needed reconciliation.",
        },
      });
    }
    return;
  }

  const fetchRunUrl = `${config.appUrl}/api/skill/fetch-runs/${encodeURIComponent(runId)}`;
  try {
    try {
      await patchJson(
        fetchRunUrl,
        {
          ...(taskOutcomes.length > 0 ? { taskOutcomes } : {}),
          ...(workerUsages.length > 0 ? { workerUsages } : {}),
        },
        config.token,
        { label: "fetch log task patch" },
      );
    } catch (patchError) {
      // The fetch log is best-effort. When the server-side merged details would
      // blow the size cap, retry once with a slimmed per-post payload: identity,
      // status and sizes only, dropping the redundant plannedTask echo (the
      // server already has it from the planned-tasks POST) and any free-form
      // evidence. Keeps each outcome recorded without re-inflating stored details.
      if (taskOutcomes.length === 0 || !isDetailsTooLargeError(patchError)) throw patchError;
      const slimOutcomes = taskOutcomes.map(slimFetchRunOutcome);
      await patchJson(
        fetchRunUrl,
        {
          taskOutcomes: slimOutcomes,
          ...(workerUsages.length > 0 ? { workerUsages } : {}),
        },
        config.token,
        { label: "fetch log task patch (slim)" },
      );
      console.error(
        `Fetch log details near the size cap; attached ${slimOutcomes.length} per-post outcome(s) in slim form (no plannedTask/evidence).`,
      );
    }
    if (fetchProgress) {
      if (partialOutcomes) {
        const nextStage =
          fetchProgress.stage === "checkpoint_syncing" || fetchProgress.stage === "syncing"
            ? "workers_running"
            : fetchProgress.stage;
        await emitFetchJobProgress(config, fetchProgress, {
          stage: nextStage,
          current: { task: null },
          event: {
            type: "checkpoint_synced",
            message: `Synced ${taskOutcomes.length} completed post task${taskOutcomes.length === 1 ? "" : "s"}; waiting for remaining workers.`,
          },
        });
      } else {
        await emitFetchJobProgress(config, fetchProgress, {
          stage: "reconciled",
          current: {},
          event: {
            type: "reconciled",
            message: `Reconciled ${taskOutcomes.length} post task${taskOutcomes.length === 1 ? "" : "s"}.`,
          },
        });
      }
    }
  } catch (patchError) {
    const message = patchError instanceof Error ? patchError.message : String(patchError);
    console.error(`Failed to attach per-post info to the fetch log: ${message}`);
  }
}

// True when a fetch-log PATCH was rejected for exceeding the server-side
// details size cap, so the caller can retry once with a slimmer payload.
function isDetailsTooLargeError(error) {
  return /too large/i.test(String(error?.message ?? ""));
}

// Slim a per-post outcome to what the fetch log needs when details are near
// the cap: drop the redundant plannedTask echo and free-form evidence, keep
// the identity, status, sizes, and failure reason.
// The fetch-log PATCH route validates every element of `taskOutcomes` with one
// Zod schema and rejects the WHOLE array when a single field is invalid. Agent
// workers author `url` and `completedStage` free-form, so drop values the
// server schema would refuse (e.g. url: "unavailable", completedStage: "sync")
// instead of letting one bad field 400 the entire patch and leave every task
// stuck "pending" in the fetch log.
export function sanitizeAgentOutcomeFacts(facts) {
  return Object.fromEntries(
    Object.entries(facts).filter(([key, value]) => {
      if (value === null || value === undefined) return true;
      if (key === "url") return isValidOutcomeUrl(value);
      if (key === "completedStage") return value === "read" || value === "summarize";
      return true;
    }),
  );
}

// Mirrors the PATCH route's `url: z.string().url().max(2048)` constraint.
function isValidOutcomeUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function slimFetchRunOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return outcome;
  const slim = {};
  for (const [key, value] of Object.entries(outcome)) {
    if (key === "plannedTask" || key === "evidence") continue;
    slim[key] = value;
  }
  return slim;
}

function fetchTaskLogPatch(task, id) {
  const readyBody = task?.contentStatus === "ready"
    ? textStats(task?.item?.body)
    : { chars: null, words: null };
  const readyHeadline = task?.contentStatus === "ready"
    ? textStats(task?.item?.headline)
    : { chars: null, words: null };
  const readySummary = task?.contentStatus === "ready"
    ? textStats(task?.item?.summary)
    : { chars: null, words: null };
  const rawJson = objectRecord(task?.item?.rawJson);
  return {
    id,
    builder: task?.builder ?? null,
    builderId: task?.builderId ?? null,
    sourceType: task?.sourceType ?? null,
    contentStatus: task?.contentStatus ?? null,
    agentWorkType: task?.agentWorkType ?? null,
    title: task?.item?.title ?? null,
    url: task?.item?.url ?? null,
    fetchTool: task?.fetchTool ?? null,
    bodyChars: readyBody.chars,
    bodyWords: readyBody.words,
    headlineChars: readyHeadline.chars || null,
    headlineWords: readyHeadline.words || null,
    summaryChars: readySummary.chars || null,
    summaryWords: readySummary.words || null,
    agentRuntime: null,
    agentModel: null,
    workerId: task?.workerId ?? null,
    readMethod: task?.readMethod ?? rawJson.readMethod ?? null,
    summaryMethod: task?.summaryMethod ?? rawJson.summaryMethod ?? null,
    hubSharedReuse: nonEmptyObjectRecord(rawJson.hubSharedReuse),
  };
}

function plannedFetchTaskStatus(task) {
  const work = String(task?.agentWorkType ?? "");
  if (isUserActionAgentWorkType(work)) return "action_needed";
  if (task?.contentStatus === "ready") return "fetched";
  return "pending";
}

function shardWorkerIdByTaskId(shardPlans = []) {
  const byTaskId = new Map();
  for (const plan of shardPlans.map(normalizeShardPlan).filter(Boolean)) {
    for (const taskId of plan.taskIds) byTaskId.set(taskId, plan.workerId ?? plan.shard);
  }
  return byTaskId;
}

function taskWithShardWorkerId(task, workerIds) {
  if (task?.workerId) return task;
  const id = String(task?.id || fetchTaskId(task));
  const workerId = workerIds.get(id);
  return workerId ? { ...task, workerId } : task;
}

export function fetchRunPlannedTaskPatches(fetchResult, options = {}) {
  const workerIds = shardWorkerIdByTaskId(options.shardPlans ?? []);
  return extractFetchTasks(fetchResult)
    .filter((task) => !isCandidateDiscoveryFetchTask(task))
    .map((task) => {
      const id = String(task?.id || fetchTaskId(task));
      const plannedTask = taskWithShardWorkerId(task, workerIds);
      return {
        ...fetchTaskLogPatch(plannedTask, id),
        status: plannedFetchTaskStatus(plannedTask),
      };
    });
}

export function buildFetchRunSyncPatch(runId, fetchTasks = []) {
  const id = String(runId || "").trim();
  if (!id) return null;
  return {
    id,
    plannedTasks: fetchRunPlannedTaskPatches({ fetchTasks }),
  };
}

async function status() {
  const config = await readConfig();
  const account = process.env.BUILDER_BLOG_ACCOUNT?.trim() ?? null;
  console.log(
    JSON.stringify(
      {
        loggedIn: Boolean(config.token),
        appUrl: config.appUrl ?? null,
        account,
        accountsDir: accountsDir(),
      },
      null,
      2,
    ),
  );
}

function normalizeCronJob(job) {
  return job === "digest-cron" ? "digest-cron" : "library-cron";
}

function cronAuditLabel(job) {
  const kind = normalizeCronJob(job) === "digest-cron" ? "digest" : "library";
  return `com.followbrief.${kind}.${accountSlug()}`;
}

function cronAuditLogPath(job) {
  return join(agentDir(), "tmp", "accounts", accountSlug(), normalizeCronJob(job), "cron-events.jsonl");
}

function parseAuditBoolean(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return null;
}

function parseAuditStatus(value) {
  return value === "active" || value === "stopped" ? value : null;
}

function parseAuditDetails(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return { value };
  }
}

async function appendCronAuditLocal(event) {
  const path = cronAuditLogPath(event.job);
  await mkdir(dirname(path), { recursive: true });
  const record = {
    at: new Date().toISOString().replace(".000Z", "Z"),
    account: process.env.BUILDER_BLOG_ACCOUNT ?? null,
    accountSlug: accountSlug(),
    pid: process.pid,
    hostname: RUN_HOSTNAME,
    platform: RUN_PLATFORM,
    ...event,
  };
  await writeFile(path, `${JSON.stringify(record)}\n`, { flag: "a", mode: 0o600 });
  return path;
}

async function postCronAuditEvent(config, event) {
  if (webSyncDisabled() || !config?.token || !config?.appUrl) return null;
  return postJson(
    `${config.appUrl}/api/skill/cron-events`,
    event,
    config.token,
    {
      label: "cron audit event",
      retries: HTTP_SYNC_RETRY_DELAYS_MS.length,
      timeoutMs: HTTP_SYNC_TIMEOUT_MS,
    },
  );
}

async function recordCronAuditEvent(config, event) {
  const normalized = {
    ...event,
    job: normalizeCronJob(event.job),
    localLabel: event.localLabel || cronAuditLabel(event.job),
    details: event.details && typeof event.details === "object" && !Array.isArray(event.details)
      ? event.details
      : {},
  };
  const localLogPath = await appendCronAuditLocal(normalized);
  try {
    const server = await postCronAuditEvent(config, normalized);
    return { localLogPath, serverLogged: Boolean(server?.id), serverEventId: server?.id ?? null };
  } catch (error) {
    return {
      localLogPath,
      serverLogged: false,
      error: httpSyncErrorSummary(error),
    };
  }
}

async function cronAudit(args) {
  const config = await readConfig();
  const job = normalizeCronJob(argValue(args, "--job", "library-cron"));
  const localLabel = argValue(args, "--label", cronAuditLabel(job));
  const plistExistsArg = parseAuditBoolean(argValue(args, "--plist-exists"));
  const launchctlLoaded = parseAuditBoolean(argValue(args, "--launchctl-loaded"));
  const plistPath = join(homedir(), "Library", "LaunchAgents", `${localLabel}.plist`);
  const result = await recordCronAuditEvent(config, {
    job,
    eventType: argValue(args, "--event", "manual_audit"),
    status: parseAuditStatus(argValue(args, "--status")),
    reason: argValue(args, "--reason", null),
    runtime: argValue(args, "--runtime") || process.env.BUILDER_BLOG_RUNTIME || null,
    localLabel,
    localPlistExists: plistExistsArg ?? existsSync(plistPath),
    launchctlLoaded,
    details: {
      cliVersion: CLI_VERSION,
      ...parseAuditDetails(argValue(args, "--details")),
    },
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cronStatus(args) {
  const config = await readConfig();
  requireLoggedIn(config);
  const job = normalizeCronJob(argValue(args, "--job", "library-cron"));
  const statusValue = argValue(args, "--status", "active");
  const freq = argValue(args, "--freq");
  const schedule = argValue(args, "--schedule");
  const label = argValue(args, "--label");
  const runtime = argValue(args, "--runtime") || process.env.BUILDER_BLOG_RUNTIME || null;
  const forceValue = argValue(args, "--force", "0");
  const regenerateValue = argValue(args, "--regenerate", "0");
  const startedAt = argValue(args, "--started-at") || new Date().toISOString();
  const ownerId = argValue(args, "--owner-id", null);

  const payload = {
    job,
    status: statusValue,
    frequencyKey: freq,
    frequencyLabel: label,
    schedule,
    runtime,
    overrideFetched: forceValue === "1",
    regenerateDigest: regenerateValue === "1",
    startedAt,
    ownerId,
  };

  await recordCronAuditEvent(config, {
    job,
    eventType: "cron_status_sync_start",
    status: parseAuditStatus(statusValue),
    reason: "cron_status_command",
    runtime,
    details: { frequencyKey: freq ?? null, schedule: schedule ?? null, ownerId },
  });

  let result;
  try {
    result = await postJson(
      `${config.appUrl}/api/skill/cron-jobs`,
      payload,
      config.token,
      {
        label: "cron status sync",
        retries: HTTP_SYNC_RETRY_DELAYS_MS.length,
      },
    );
  } catch (error) {
    await recordCronAuditEvent(config, {
      job,
      eventType: "cron_status_sync_failed",
      status: parseAuditStatus(statusValue),
      reason: httpSyncErrorSummary(error),
      runtime,
      details: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
  await recordCronAuditEvent(config, {
    job,
    eventType: "cron_status_sync_succeeded",
    status: parseAuditStatus(statusValue),
    reason: "cron_status_command",
    runtime,
    details: { result },
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cronState(args) {
  const config = await readConfig();
  requireLoggedIn(config);
  const job = normalizeCronJob(argValue(args, "--job", "library-cron"));
  const result = await getJson(
    `${config.appUrl}/api/skill/cron-jobs?job=${encodeURIComponent(job)}`,
    config.token,
    { label: "cron state" },
  );
  console.log(JSON.stringify(result, null, 2));
}

async function cronGuard(args) {
  const config = await readConfig();
  requireLoggedIn(config);
  const job = normalizeCronJob(argValue(args, "--job", "library-cron"));
  const ownerId = argValue(args, "--owner-id", null);
  const params = new URLSearchParams({
    job,
    mode: "guard",
    ...(ownerId ? { ownerId } : {}),
  });
  const result = await getJson(
    `${config.appUrl}/api/skill/cron-jobs?${params.toString()}`,
    config.token,
    { label: "cron guard", retries: HTTP_SYNC_RETRY_DELAYS_MS.length },
  );
  console.log(JSON.stringify(result, null, 2));
  if (result?.decision !== "run") process.exitCode = 75;
}

function normalizeScheduleFrequency(value) {
  const key = String(value || "").trim();
  if (["1h", "daily", "weekly"].includes(key)) return key;
  return "daily";
}

function cronExpressionForAnchor(freq, anchorDate) {
  const minute = anchorDate.getMinutes();
  const hour = anchorDate.getHours();
  const weekday = anchorDate.getDay();
  switch (freq) {
    case "1h":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${weekday}`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

function launchdInteger(key, value) {
  return `<key>${key}</key><integer>${value}</integer>`;
}

function launchdScheduleDict(fields, indent = "") {
  const lines = [`${indent}<dict>`];
  for (const [key, value] of fields) {
    lines.push(`${indent}  ${launchdInteger(key, value)}`);
  }
  lines.push(`${indent}</dict>`);
  return lines.join("\n");
}

function launchdScheduleForAnchor(freq, anchorDate) {
  const minute = anchorDate.getMinutes();
  const hour = anchorDate.getHours();
  const weekday = anchorDate.getDay();
  const start = "  <key>StartCalendarInterval</key>";
  const dict = (fields) => launchdScheduleDict(fields, "  ");

  switch (freq) {
    case "1h":
      return `${start}\n${dict([["Minute", minute]])}`;
    case "daily":
      return `${start}\n${dict([["Hour", hour], ["Minute", minute]])}`;
    case "weekly":
      return `${start}\n${dict([["Weekday", weekday], ["Hour", hour], ["Minute", minute]])}`;
    default:
      return `${start}\n${dict([["Hour", hour], ["Minute", minute]])}`;
  }
}

async function writeOptionalText(path, value) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${value}\n`, "utf8");
}

async function scheduleSpec(args) {
  const freq = normalizeScheduleFrequency(argValue(args, "--freq", "daily"));
  const anchorFile = argValue(args, "--anchor-file");
  const anchorText = anchorFile ? readFileSync(anchorFile, "utf8").trim() : argValue(args, "--anchor-at");
  const anchorMs = Date.parse(anchorText || "");
  if (!Number.isFinite(anchorMs)) {
    throw new Error("schedule-spec requires --anchor-file or --anchor-at with an ISO timestamp");
  }

  const anchorDate = new Date(anchorMs);
  const anchorAt = anchorDate.toISOString().replace(".000Z", "Z");
  const cron = cronExpressionForAnchor(freq, anchorDate);
  const launchdXml = launchdScheduleForAnchor(freq, anchorDate);
  const statusSchedule = `anchor:${cron}`;

  await writeOptionalText(argValue(args, "--cron-out"), cron);
  await writeOptionalText(argValue(args, "--launchd-out"), launchdXml);
  await writeOptionalText(argValue(args, "--status-out"), statusSchedule);

  console.log(JSON.stringify({ status: "ok", freq, anchorAt, cron, statusSchedule, launchdXml }, null, 2));
}

function readLocalText(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
  } catch {
    return null;
  }
}

function parseLocalJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

function normalizeIso(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(".000Z", "Z") : null;
}

function pidIsAlive(pid) {
  const numeric = Number(pid || 0);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch {
    return false;
  }
}

function relativeWindow(cronJob, now = new Date()) {
  const startedMs = Date.parse(cronJob?.startedAt || "");
  const intervalMs = Number(cronJob?.intervalMinutes || 0) * 60 * 1000;
  if (!Number.isFinite(startedMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { latestExpectedAt: null, nextExpectedAt: null };
  }
  const elapsed = now.getTime() - startedMs;
  if (elapsed < intervalMs) {
    return {
      latestExpectedAt: null,
      nextExpectedAt: new Date(startedMs + intervalMs).toISOString().replace(".000Z", "Z"),
    };
  }
  const slot = Math.floor(elapsed / intervalMs);
  return {
    latestExpectedAt: new Date(startedMs + slot * intervalMs).toISOString().replace(".000Z", "Z"),
    nextExpectedAt: new Date(startedMs + (slot + 1) * intervalMs).toISOString().replace(".000Z", "Z"),
  };
}

async function fetchStatusAudit() {
  const config = await readConfig();
  requireLoggedIn(config);
  const data = await getJson(`${config.appUrl}/api/skill/fetch-runs`, config.token, {
    label: "fetch status audit",
    timeoutMs: HTTP_SYNC_TIMEOUT_MS,
  });
  const cronJob = data.cronJob ?? null;
  const scheduledJobRuns = Array.isArray(data.scheduledJobRuns) ? data.scheduledJobRuns : [];
  const latestScheduled = scheduledJobRuns[0] ?? null;
  const localAnchorPath = join(agentDir(), `schedule-anchor-library-cron-${accountSlug()}`);
  const localTmpDir = join(agentDir(), "tmp", "accounts", accountSlug(), "library-cron");
  const localLastFiredPath = join(localTmpDir, "last-fired-expected-at");
  const localCurrentPath = join(localTmpDir, "current.json");
  const localAnchor = normalizeIso(readLocalText(localAnchorPath));
  const localLastFired = normalizeIso(readLocalText(localLastFiredPath));
  const localCurrent = parseLocalJson(localCurrentPath);
  const currentPidAlive = localCurrent ? pidIsAlive(localCurrent.workerPid) : false;
  const window = relativeWindow(cronJob);
  const latestExpected = normalizeIso(latestScheduled?.expectedAt);
  const terminalStatuses = new Set(["succeeded", "failed", "timed_out", "killed", "replaced", "stale"]);
  const checks = [
    {
      name: "production_cron_active",
      ok: cronJob?.status === "active",
      detail: cronJob?.status ?? "missing",
    },
    {
      name: "local_anchor_matches_production",
      ok: !cronJob || !localAnchor || localAnchor === normalizeIso(cronJob.startedAt),
      detail: { localAnchor, productionStartedAt: normalizeIso(cronJob?.startedAt) },
    },
    {
      name: "latest_scheduled_run_terminal",
      ok: !latestScheduled || terminalStatuses.has(String(latestScheduled.status)),
      detail: latestScheduled
        ? { status: latestScheduled.status, expectedAt: latestExpected, stage: latestScheduled.stage }
        : "none",
    },
    {
      name: "last_fired_matches_latest_scheduled_run",
      ok: !localLastFired || !latestExpected || localLastFired === latestExpected,
      detail: { localLastFired, latestExpected },
    },
    {
      name: "current_file_not_dead",
      ok: !localCurrent || currentPidAlive,
      detail: localCurrent
        ? { instanceId: localCurrent.instanceId, workerPid: localCurrent.workerPid, currentPidAlive }
        : "missing",
    },
  ];
  const ok = checks.every((check) => check.ok);
  if (cronJob?.status === "active" && !localAnchor && !localLastFired && !localCurrent) {
    await recordCronAuditEvent(config, {
      job: "library-cron",
      eventType: "local_scheduler_missing",
      status: "active",
      reason: "fetch_status_audit",
      runtime: cronJob.runtime ?? null,
      details: { checks },
    });
  }
  console.log(JSON.stringify({
    status: ok ? "ok" : "needs_attention",
    appUrl: config.appUrl,
    account: process.env.BUILDER_BLOG_ACCOUNT ?? null,
    now: new Date().toISOString().replace(".000Z", "Z"),
    production: {
      cronJob,
      latestScheduled,
      latestFetchRun: Array.isArray(data.runs) ? data.runs[0] ?? null : null,
      scheduledWindow: window,
    },
    local: {
      anchorPath: localAnchorPath,
      anchor: localAnchor,
      lastFiredPath: localLastFiredPath,
      lastFired: localLastFired,
      currentPath: localCurrentPath,
      current: localCurrent,
      currentPidAlive,
    },
    checks,
  }, null, 2));
}

async function digestStatusAudit() {
  const config = await readConfig();
  requireLoggedIn(config);
  const data = await getJson(`${config.appUrl}/api/digest-runs`, config.token, {
    label: "digest status audit",
    timeoutMs: HTTP_SYNC_TIMEOUT_MS,
  });
  const cronJob = data.cronJob ?? null;
  const scheduledJobRuns = Array.isArray(data.scheduledJobRuns) ? data.scheduledJobRuns : [];
  const latestScheduled = scheduledJobRuns[0] ?? null;
  const cronRuns = Array.isArray(data.cronRuns) ? data.cronRuns : [];
  const latestCronRun = cronRuns[0] ?? null;
  const localAnchorPath = join(agentDir(), `schedule-anchor-digest-cron-${accountSlug()}`);
  const localTmpDir = join(agentDir(), "tmp", "accounts", accountSlug(), "digest-cron");
  const localLastFiredPath = join(localTmpDir, "last-fired-expected-at");
  const localCurrentPath = join(localTmpDir, "current.json");
  const localAnchor = normalizeIso(readLocalText(localAnchorPath));
  const localLastFired = normalizeIso(readLocalText(localLastFiredPath));
  const localCurrent = parseLocalJson(localCurrentPath);
  const currentPidAlive = localCurrent ? pidIsAlive(localCurrent.workerPid) : false;
  const window = relativeWindow(cronJob);
  const latestExpected = normalizeIso(latestScheduled?.expectedAt);
  const terminalStatuses = new Set(["succeeded", "failed", "timed_out", "killed", "replaced", "stale"]);
  const latestDigestMatchesScheduled =
    !latestScheduled ||
    latestScheduled.status !== "succeeded" ||
    (
      latestCronRun?.status === "synced" &&
      (!latestCronRun?.jobRunId || latestCronRun.jobRunId === latestScheduled.instanceId)
    );
  const checks = [
    {
      name: "production_cron_active",
      ok: cronJob?.status === "active",
      detail: cronJob?.status ?? "missing",
    },
    {
      name: "local_anchor_matches_production",
      ok: !cronJob || !localAnchor || localAnchor === normalizeIso(cronJob.startedAt),
      detail: { localAnchor, productionStartedAt: normalizeIso(cronJob?.startedAt) },
    },
    {
      name: "latest_scheduled_run_terminal",
      ok: !latestScheduled || terminalStatuses.has(String(latestScheduled.status)),
      detail: latestScheduled
        ? { status: latestScheduled.status, expectedAt: latestExpected, stage: latestScheduled.stage }
        : "none",
    },
    {
      name: "last_fired_matches_latest_scheduled_run",
      ok: !localLastFired || !latestExpected || localLastFired === latestExpected,
      detail: { localLastFired, latestExpected },
    },
    {
      name: "current_file_not_dead",
      ok: !localCurrent || currentPidAlive,
      detail: localCurrent
        ? { instanceId: localCurrent.instanceId, workerPid: localCurrent.workerPid, currentPidAlive }
        : "missing",
    },
    {
      name: "latest_digest_run_synced_for_scheduled_job",
      ok: latestDigestMatchesScheduled,
      detail: latestScheduled
        ? {
            scheduledStatus: latestScheduled.status,
            scheduledInstanceId: latestScheduled.instanceId,
            digestRunStatus: latestCronRun?.status ?? null,
            digestRunJobRunId: latestCronRun?.jobRunId ?? null,
          }
        : "none",
    },
  ];
  const ok = checks.every((check) => check.ok);
  if (cronJob?.status === "active" && !localAnchor && !localLastFired && !localCurrent) {
    await recordCronAuditEvent(config, {
      job: "digest-cron",
      eventType: "local_scheduler_missing",
      status: "active",
      reason: "digest_status_audit",
      runtime: cronJob.runtime ?? null,
      details: { checks },
    });
  }
  console.log(JSON.stringify({
    status: ok ? "ok" : "needs_attention",
    appUrl: config.appUrl,
    account: process.env.BUILDER_BLOG_ACCOUNT ?? null,
    now: new Date().toISOString().replace(".000Z", "Z"),
    production: {
      cronJob,
      latestScheduled,
      latestDigestRun: latestCronRun,
      scheduledWindow: window,
    },
    local: {
      anchorPath: localAnchorPath,
      anchor: localAnchor,
      lastFiredPath: localLastFiredPath,
      lastFired: localLastFired,
      currentPath: localCurrentPath,
      current: localCurrent,
      currentPidAlive,
    },
    checks,
  }, null, 2));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "exchange") await exchange(args);
  else if (command === "login") {
    console.warn(
      "The `login` command has been removed. Use the Copy-prompt button in the FollowBrief web app. " +
      "The first command in the prompt exchanges a one-time code for an agent token " +
      `saved under ${accountsDir()}.`,
    );
    process.exit(1);
  }
  else if (command === "fetch-personal") await fetchPersonal(args);
  else if (command === "expand-discovery") await expandDiscovery(args);
  else if (command === "patch-fetch-run-plan") await patchFetchRunPlan(args);
  else if (command === "shard-tasks") await shardTasks(args);
  else if (command === "assign-fetch-tasks") await assignFetchTasks(args);
  else if (command === "merge-fetch-results") await mergeFetchResultsCommand(args);
  else if (command === "checkpoint-progress") await emitCheckpointProgress(args);
  else if (command === "merge-task-results") await mergeTaskResults(args);
  else if (command === "append-fetch-run-terminal-task-ids") await appendFetchRunTerminalTaskIds(args);
  else if (command === "split-sync-slices") await splitSyncSlices(args);
  else if (command === "fail-sync-slice") await failSyncSlice(args);
  else if (command === "prepare") await prepare(args);
  else if (command === "validate-agent-sync") await validateAgentSync(args);
  else if (command === "lease-cloud-builders") await leaseCloudBuilders(args);
  else if (command === "fetch-cloud-library") await fetchCloudLibrary(args);
  else if (command === "heartbeat-cloud-fetch") await heartbeatCloudFetch(args);
  else if (command === "sync-builders") await syncBuilders(args);
  else if (command === "sync-cloud-builders") await syncCloudBuilders(args);
  else if (command === "render-digest") await renderDigest(args);
  else if (command === "sync") await sync(args);
  else if (command === "cron-audit") await cronAudit(args);
  else if (command === "schedule-spec") await scheduleSpec(args);
  else if (command === "cron-status") await cronStatus(args);
  else if (command === "cron-state") await cronState(args);
  else if (command === "cron-guard") await cronGuard(args);
  else if (command === "fetch-status-audit") await fetchStatusAudit();
  else if (command === "digest-status-audit") await digestStatusAudit();
  else if (command === "parse-runtime-usage") await parseRuntimeUsageCommand(args);
  else if (command === "aggregate-runtime-usage") await aggregateRuntimeUsageCommand(args);
  else if (command === "job-run-start") await jobRunCommand(args, "starting");
  else if (command === "job-run-update") await jobRunCommand(args, "running");
  else if (command === "status") await status();
  else usage();
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (error?.details) console.error(JSON.stringify(error.details, null, 2));
    process.exit(1);
  });
}
