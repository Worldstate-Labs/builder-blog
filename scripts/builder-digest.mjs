#!/usr/bin/env node
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, hostname, platform, release, tmpdir, userInfo } from "node:os";
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
const ACCOUNTS_DIR = join(CONFIG_DIR, "accounts");
function agentDir() {
  return process.env.BUILDER_BLOG_AGENT_DIR?.trim() || CONFIG_DIR;
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
const SOURCES_CONFIG_PATH = join(CONFIG_DIR, "sources.json");
const GITHUB_TRENDING_URL = "https://github.com/trending?since=daily";
const PRODUCT_HUNT_TOP_PRODUCTS_URL = "https://www.producthunt.com/";
const MAX_DIGEST_CONTENT_CHARS = 200_000;
const MAX_DIGEST_HEADLINE_SUMMARY_CHARS = 1200;
const MAX_DIGEST_ITEMS = 5_000;
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
  try {
    _sourcesConfig = JSON.parse(readFileSync(SOURCES_CONFIG_PATH, "utf8"));
  } catch (error) {
    // No embedded fallback: config/sources.json (served verbatim) is the single
    // source of truth, and both entry points now guarantee it locally — the
    // runner refreshes it every run, and bootstrap downloads it on install. If
    // it's still missing the install is incomplete, so fail loud and actionable
    // rather than silently running on stale/guessed values.
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not read ${SOURCES_CONFIG_PATH} (${reason}). Re-run the FollowBrief ` +
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
const DEFAULT_APP_URL = "https://builder-blog.worldstatelabs.com";
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
  merge-task-results --tasks fetch-result.json --results-dir shards/results/ --out library-agent-sync.json
  split-sync-slices --tasks fetch-result.json --file library-agent-sync.json --out-dir sync-slices/ [--granularity source|task]
  fail-sync-slice --tasks slice-tasks.json --out failed-payload.json [--tasks-out failed-tasks.json] [--exclude-task-ids-file synced-ids.txt] [--reason slice_sync_failed] [--message "..."]
  prepare [--regenerate]
  validate-agent-sync --tasks fetch-result.json --file personal-builders.json
  sync-builders --file personal-builders.json [--tasks fetch-result.json] [--agent-model gpt-5.5] [--partial-outcomes]
  render-digest --context builder-blog-context.json --agent-output digest-agent-output.json --out builder-blog-digest.json --summary-out digest-headlines.txt
  sync --file builder-blog-digest.json [--summary-file digest-headlines.txt] [--title "AI Builder Digest"] [--regenerate] [--context builder-blog-context.json]
  schedule-spec --freq 12h --anchor-file schedule-anchor-library-cron-user [--cron-out cron.txt] [--launchd-out launchd.xml] [--status-out status.txt]
  cron-status --job library-cron|digest-cron --status active|stopped [--freq 6h] [--schedule "0 */6 * * *"]
  fetch-status-audit
  digest-status-audit
  parse-runtime-usage --file runtime-output.log [--runtime codex|claude|openclaw|hermes] [--out runtime-usage.jsonl]
  aggregate-runtime-usage --out runtime-usage.json runtime-output-1.log runtime-output-2.log
  job-run-start --job-type library-fetch|digest-build --trigger scheduled|one_time|manual_cli --instance-id <id>
  job-run-update --job-type library-fetch|digest-build --trigger scheduled|one_time|manual_cli --instance-id <id> --status running|succeeded|failed|timed_out|killed|replaced|stale
  status

To set up an account, use the Copy-prompt button in the FollowBrief web app.
The first command in the prompt exchanges a one-time code for an agent token
saved to ~/.builder-blog/accounts/<email>.json`);
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
 * Load an account file from ~/.builder-blog/accounts/<email>.json.
 * Returns { email, token, appUrl } or throws with a clear error.
 */
async function loadAccountFile(email) {
  const safeName = email.replace(/[^a-zA-Z0-9._@+-]/g, "_");
  const accountPath = join(ACCOUNTS_DIR, `${safeName}.json`);
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
    details: record.details ?? {},
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
    exitCode: Number(argValue(args, "--exit-code", "")) || null,
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
      ...(usage ? { usage } : {}),
    },
  });
  console.log(JSON.stringify(result ?? { status: "skipped" }, null, 2));
}

async function parseRuntimeUsageCommand(args) {
  const out = argValue(args, "--out", null);
  const usage = runtimeUsageFromFile(argValue(args, "--file", null), argValue(args, "--runtime", null));
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
  const snapshot = {
    version: FETCH_PROGRESS_VERSION,
    stage: progress.stage,
    updatedAt: new Date().toISOString(),
    counters: { ...(progress.counters ?? {}) },
    current: { ...(progress.current ?? {}) },
    sources: Array.isArray(progress.sources)
      ? progress.sources.slice(options.includeInternal ? undefined : -FETCH_PROGRESS_SOURCE_LIMIT)
      : [],
    tasks: Array.isArray(progress.tasks)
      ? progress.tasks.slice(options.includeInternal ? undefined : -FETCH_PROGRESS_TASK_LIMIT)
      : [],
    recentEvents: Array.isArray(progress.recentEvents)
      ? progress.recentEvents.slice(-FETCH_PROGRESS_RECENT_EVENT_LIMIT)
      : [],
  };
  if (options.includeInternal && Array.isArray(progress.completedTaskIds)) {
    snapshot.completedTaskIds = progress.completedTaskIds;
  }
  return snapshot;
}

function appendFetchProgressEvent(progress, event) {
  progress.recentEvents = [
    ...(Array.isArray(progress.recentEvents) ? progress.recentEvents : []),
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
    builder: compactProgressText(task.builder, 160),
    builderId: compactProgressText(task.builderId, 120),
    sourceType: compactProgressText(task.sourceType, 80),
    title: compactProgressText(task.title, 220),
    url: compactProgressText(task.url, 500),
    workerId,
    bodyChars: Number.isFinite(Number(task.bodyChars)) ? Number(task.bodyChars) : previous.bodyChars ?? null,
    bodyWords: Number.isFinite(Number(task.bodyWords)) ? Number(task.bodyWords) : previous.bodyWords ?? null,
    summaryChars: Number.isFinite(Number(task.summaryChars)) ? Number(task.summaryChars) : previous.summaryChars ?? null,
    summaryWords: Number.isFinite(Number(task.summaryWords)) ? Number(task.summaryWords) : previous.summaryWords ?? null,
    updatedAt: compactProgressText(task.updatedAt, 80) ?? new Date().toISOString(),
  };
  const changed =
    !previous ||
    previous.status !== value.status ||
    previous.phase !== value.phase ||
    previous.message !== value.message ||
    previous.workerId !== value.workerId ||
    previous.bodyChars !== value.bodyChars ||
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
    const fetchProgressSnapshotValue = fetchProgressSnapshot(progress);
    await emitAgentJobRunRecord(config, {
      jobType: "library-fetch",
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

function progressSummary(progress) {
  const counters = progress.counters ?? {};
  const stage = String(progress.stage ?? "running").replace(/_/g, " ");
  const sourcePart = counters.sourcesTotal
    ? `${formatProgressCount(counters.sourcesChecked ?? 0)}/${formatProgressCount(counters.sourcesTotal)} sources`
    : null;
  const taskPart = counters.tasksPlanned
    ? `${formatProgressCount(counters.tasksDone ?? 0)}/${formatProgressCount(counters.tasksPlanned)} tasks`
    : null;
  return [stage, sourcePart, taskPart].filter(Boolean).join(" · ").slice(0, 500);
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
      workerId: outcome.workerId,
      bodyChars: outcome.bodyChars,
      bodyWords: outcome.bodyWords,
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
      `or set BUILDER_BLOG_ACCOUNT to an email that has a ~/.builder-blog/accounts/<email>.json file. ` +
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
  const accountPath = join(ACCOUNTS_DIR, `${safeName}.json`);
  await mkdir(ACCOUNTS_DIR, { recursive: true });
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
  const context = await getJson(contextUrl, config.token, {
    label: "digest context",
  });
  console.log(JSON.stringify(context, null, 2));
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
    const sources = context.sources ?? {};
    const commonFetchRules = context.commonFetchRules ?? context.digest?.commonFetchRules ?? DEFAULT_FETCH_GUIDANCE;
    const commonSummaryRules = context.commonSummaryRules ?? context.digest?.commonSummaryRules ?? "";
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

    const fallbackCutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const builders = [];
    const fetchTasks = [];
    const builderStats = new Map();

    for (const builder of personalBuilders) {
      const builderStat = {
        builderId: builder.id,
        name: builder.name,
        sourceType: sourceTypeIdForBuilder(builder),
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
        subscribe: subscribedBuilderIds.has(builder.id),
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
              now: startedAt,
              sources,
              commonFetchRules,
              commonSummaryRules,
            });
            fetchTasks.push(task);
            if (isCandidateDiscoveryFetchTask(task)) builderStat.discoveryTasksGenerated += 1;
            else builderStat.tasksGenerated += 1;
            continue;
          }
          const filtered = filterFetchedItems(externalItems, {
            builderId: builder.id,
            cutoff: builderCutoff,
            limit,
            fetchedItemKeys: force ? new Set() : fetchedItemKeysForBuilder(context, builder.id),
          });
          builders.push({ ...fallbackBuilderSync, fetchCutoff: builderCutoff?.toISOString() ?? null, items: filtered });
          builderStat.itemsFetched += filtered.length;
          continue;
        }
        const builderCutoff = force ? null : cutoffForBuilder(context, builder.id, fallbackCutoff);
        const fetched = await source.fetch(builder, {
          cutoff: builderCutoff,
          limit,
          agentModel,
          fetchedItemKeys: force ? new Set() : fetchedItemKeysForBuilder(context, builder.id),
          sources,
        });
        const { items, agentTasks: sourceAgentTasks } = normalizePersonalFetchResult(fetched);
        const filteredItems = filterFinalFetchedItemsByCutoff(items, builderCutoff);
        const filteredAgentTasks = filterFinalAgentTasksByCutoff(sourceAgentTasks, builderCutoff);
        const builderSync = {
          ...fallbackBuilderSync,
          kind: source.syncKind,
          sourceType: source.id,
        };
        const fetchTasksFromAgentTasks = filteredAgentTasks.map((task) => ({
          ...fetchTaskFromAgentTask(task, builderSync, sources, commonFetchRules, commonSummaryRules),
          fetchCutoff: builderCutoff?.toISOString() ?? null,
        }));
        fetchTasks.push(...fetchTasksFromAgentTasks);
        builderStat.tasksGenerated += fetchTasksFromAgentTasks.filter((task) => !isCandidateDiscoveryFetchTask(task)).length;
        builderStat.discoveryTasksGenerated += fetchTasksFromAgentTasks.filter(isCandidateDiscoveryFetchTask).length;
        builders.push({ ...builderSync, fetchCutoff: builderCutoff?.toISOString() ?? null, items: filteredItems });
        builderStat.itemsFetched += filteredItems.length;
        builderStat.sourceType = source.id;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const task = buildPersonalFetchErrorTask(builder, {
          builderSync: fallbackBuilderSync,
          error,
          limit,
          now: startedAt,
          sources,
          commonFetchRules,
          commonSummaryRules,
        });
        if (isRecoverableFetchFallback(task)) {
          builderStat.fallback = sourceFallbackNotice(task, message);
        } else {
          builderStat.error = message;
          errorCount += 1;
        }
        fetchTasks.push(task);
        if (isCandidateDiscoveryFetchTask(task)) builderStat.discoveryTasksGenerated += 1;
        else builderStat.tasksGenerated += 1;
      } finally {
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
      }
    }

    if (builders.length > 0) {
      fetchTasks.push(...fetchTasksForReadyBuilders(builders, sources, commonSummaryRules));
    }

    // Recount items/tasks: fetchTasksForReadyBuilders rewrote a task
    // per item, so totals belong to the final tasks array, not the
    // partial counters above. We keep builderStat per-builder counts
    // separately for the UI's per-builder breakdown.
    const postFetchTasks = fetchTasks.filter((task) => !isCandidateDiscoveryFetchTask(task));
    const agentTasks = postFetchTasks.filter((task) => task?.contentStatus !== "ready");
    itemsFetched = builders.reduce((sum, builder) => sum + (builder.items?.length ?? 0), 0);
    tasksGenerated = postFetchTasks.length;
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

    perBuilder = [...builderStats.values()];
    ({ slimFetchTasks } = summarizeFetchTasksForLog(fetchTasks));

    const payload = { status: "ok", localErrors, fetchTasks };
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
      summaryChars: null,
      summaryWords: null,
      agentRuntime: null,
      agentModel: null,
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
    const result = await postJson(`${config.appUrl}/api/skill/fetch-runs`, body, config.token, {
      label: "fetch log upload",
      retries: 0,
    });
    if (result?.id) {
      // Hand the run id to the later sync-builders step so it can attach
      // per-post outcomes. Best-effort: if persisting fails, the run is still
      // recorded — sync-builders just skips the per-post patch.
      try {
        const runIdFile = libraryFetchRunIdFile();
        await mkdir(dirname(runIdFile), { recursive: true });
        await writeFile(runIdFile, String(result.id), "utf8");
      } catch {
        // ignore — non-fatal
      }
    }
  } catch (uploadError) {
    const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
    // Upload failure is non-fatal: the CLI's primary contract (JSON
    // output + downstream agent steps) must keep working even when
    // the server is unreachable.
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
      },
      summaryInstructions: singlePostSummaryInstructions(builder.sourceType, sources, commonSummaryRules),
      id: fetchTaskId({ builderId: builder.builderId, builder: builder.name, item }),
    })),
  );
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
  return String(value || "").trim().toLowerCase() === ORIGINAL_CONTENT_LANGUAGE_VALUE;
}

function singlePostSummaryPrompt(source) {
  const languageInstruction = isOriginalContentLanguage(source.language)
    ? "Write one concise FollowBrief single-post summary in the same language as the task's final raw body. For ready tasks, use task.item.body's language. For requires_agent tasks, first fetch the primary content, then use the final body language."
    : `Write one concise FollowBrief single-post summary in ${source.language}.`;
  return [
    languageInstruction,
    "",
    source.commonSummaryRules,
    "",
    "Hard validation rules for the output `summary` string:",
    "- Keep `summary` between 40 and 1200 characters. If it is over 1200 characters, shorten it before writing JSON; otherwise validation fails with `summary_too_long`.",
    "- Do not duplicate the title; otherwise validation fails with `summary_duplicates_title`.",
    "- Do not copy the beginning of the source body as the whole summary; otherwise validation fails with `summary_copies_body_prefix`.",
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
  };
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
  const candidates = parseBlogCandidates(indexBody, indexUrl)
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
    const body = extracted.body || article.description;
    const title = extracted.title || article.title || "Untitled";
    const publishedAt = extracted.publishedAt || article.publishedAt;
    if (!isAfterCutoff(publishedAt, cutoff)) continue;
    const quality = genericContentQuality(body, {
      title,
      description: article.description,
      standards: qualityStandards,
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
        rawJson: {
          source: "personal-podcast",
          builderId: builder.id,
          builderName: builder.name,
          feedUrl,
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
  };
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
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
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

function runTool(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? envToolTimeoutMs("BUILDER_BLOG_YOUTUBE_TOOL_TIMEOUT_MS", DEFAULT_YOUTUBE_TOOL_TIMEOUT_MS);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
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
  if (/<rss[\s>]|<feed[\s>]/i.test(body)) {
    return parseFeedCandidates(body, indexUrl);
  }
  if (indexUrl.includes("anthropic.com")) return parseAnthropicEngineeringIndex(body);
  if (indexUrl.includes("claude.com")) return parseClaudeBlogIndex(body);
  return parseHtmlCandidates(body, indexUrl);
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
      return {
        title: tagText(block, "title"),
        url: absoluteUrl(hrefMatch?.[1] || linkText, indexUrl),
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
    if (!looksLikeArticlePath(parsed.pathname)) continue;
    candidates.push({
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
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
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
  const ytdlp = await fetchYouTubeTranscriptWithYtDlp(video.url, {
    fetcher,
    commandRunner,
    metadata,
    attempts,
  });
  if (ytdlp.text) return ytdlp;

  const watch = await fetchYouTubeTranscript(video.url, fetcher, metadata)
    .catch((error) => ({ text: "", error: errorMessage(error) }));
  attempts.push({
    method: "youtube-watch-captions",
    status: watch.text ? "ok" : "unavailable",
    reason: watch.text ? watch.captionSelectionReason || "caption_selected" : watch.error || "no_usable_caption_track",
    captionLanguageCode: watch.captionLanguageCode || null,
  });
  if (watch.text) return { ...watch, attempts };

  const transcriptApi = await fetchYouTubeTranscriptApi(video.url, {
    commandRunner,
    metadata,
    attempts,
  });
  if (transcriptApi.text) return transcriptApi;

  const localAsr = await fetchYouTubeLocalAsr(video.url, {
    commandRunner,
    attempts,
  });
  if (localAsr.text) return localAsr;

  return { text: "", attempts };
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
  const tracks = ytDlpCaptionTracks(data);
  if (tracks.length === 0) {
    attempts.push({ method: "yt-dlp-captions", status: "unavailable", reason: "no_caption_tracks" });
    return { text: "" };
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
    return { text: "" };
  }
  const text = await fetchYouTubeCaptionTrackText(selection.track, fetcher).catch(() => "");
  attempts.push({
    method: "yt-dlp-captions",
    status: text ? "ok" : "failed",
    reason: text ? selection.reason : "selected_caption_download_failed",
    captionLanguageCode: selection.track.languageCode || null,
    captionKind: selection.track.kind === "asr" ? "automatic" : "manual",
  });
  if (!text) return { text: "" };
  return {
    text,
    transcriptSource: "youtube-captions",
    captionLanguageCode: selection.track.languageCode || "",
    inferredSourceLanguage: selection.inferredSourceLanguage,
    captionSelectionReason: selection.reason,
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

  const workDir = await mkdtemp(join(tmpdir(), "followbrief-youtube-asr-"));
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
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return { text: "" };
  const selection = preferredCaptionTrack(tracks, metadata);
  if (!selection?.track?.baseUrl) return { text: "" };
  const track = selection.track;
  const captionResponse = await fetcher(withYouTubeCaptionFormat(track.baseUrl, "json3"), {
    headers: {
      "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)",
    },
  });
  if (!captionResponse.ok) return { text: "" };
  const body = await captionResponse.text();
  const text = body.trim().startsWith("{") ? parseYouTubeJsonTranscript(body) : parseYouTubeXmlTranscript(body);
  return {
    text,
    transcriptSource: "youtube-captions",
    captionLanguageCode: track.languageCode || "",
    inferredSourceLanguage: selection.inferredSourceLanguage,
    captionSelectionReason: selection.reason,
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
// consume. Grouping is by builder so one source's tasks are never fetched by
// two concurrent workers (per-source serialization is the rate-limit
// contract), and weights bias the bin-packing so transcript-heavy sources
// don't pile onto one shard.

function shardTaskWeight(task) {
  if (task?.contentStatus === "ready") return 1;
  const sourceType = String(task?.sourceType || "").toLowerCase();
  if (sourceType === "youtube" || sourceType === "podcast") return 4;
  return 2;
}

function shardGroupKey(task) {
  const sync = task?.builderSync ?? {};
  return String(
    sync.builderId || task?.builderId || sync.sourceUrl || sync.handle || task?.builder || "ungrouped",
  );
}

export function shardFetchTasksForWorkers(fetchResult, maxWorkers) {
  const all = extractFetchTasks(fetchResult);
  const userActionTasks = all.filter((task) => isUserActionAgentWorkType(task?.agentWorkType));
  const discoveryTasks = all.filter(
    (task) => task?.agentWorkType === "candidate_discovery_fallback",
  );
  const workTasks = all.filter(
    (task) =>
      !isUserActionAgentWorkType(task?.agentWorkType) &&
      task?.agentWorkType !== "candidate_discovery_fallback",
  );

  const groups = new Map();
  for (const task of workTasks) {
    const key = shardGroupKey(task);
    const group = groups.get(key) ?? { key, weight: 0, tasks: [] };
    group.weight += shardTaskWeight(task);
    group.tasks.push(task);
    groups.set(key, group);
  }

  const shardCount = Math.max(1, Math.min(maxWorkers, groups.size));
  const shards = Array.from({ length: shardCount }, () => ({ weight: 0, tasks: [] }));
  const ordered = [...groups.values()].sort((a, b) => b.weight - a.weight);
  for (const group of ordered) {
    const target = shards.reduce(
      (best, shard) => (shard.weight < best.weight ? shard : best),
      shards[0],
    );
    target.weight += group.weight;
    target.tasks.push(...group.tasks);
  }
  return {
    shards: shards.filter((shard) => shard.tasks.length > 0),
    userActionTasks,
    discoveryTasks,
  };
}

async function shardTasks(args) {
  const tasksFile = argValue(args, "--tasks");
  const outDir = argValue(args, "--out-dir");
  const maxWorkersRaw = Number(argValue(args, "--max-workers", "3"));
  const maxWorkers = Number.isFinite(maxWorkersRaw)
    ? Math.max(1, Math.min(8, Math.floor(maxWorkersRaw)))
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

function normalizeShardPlan(plan) {
  if (!plan || typeof plan !== "object") return null;
  const shard = String(plan.shard || plan.name || "").trim();
  if (!shard) return null;
  const resultFile = String(plan.resultFile || `${shard}-result.json`);
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const usage = normalizeRuntimeUsage(plan.usage, "runtime_shard");
  return {
    shard,
    resultFile,
    workerLogFile: String(plan.workerLogFile || `${shard}-worker.log`),
    workerLogTail: typeof plan.workerLogTail === "string" ? plan.workerLogTail : null,
    workerLogBytes: Number.isFinite(Number(plan.workerLogBytes)) ? Number(plan.workerLogBytes) : null,
    usage,
    taskCount: Number.isFinite(Number(plan.taskCount)) ? Number(plan.taskCount) : tasks.length,
    taskIds: tasks.map((task) => String(task?.id || fetchTaskId(task))),
    taskTitles: tasks
      .map((task) => task?.title || task?.item?.title || task?.url || task?.item?.url || task?.id || null)
      .filter(Boolean)
      .slice(0, 5),
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

function workerLogLooksLikeRuntimeAuthFailure(text) {
  return /OAuth token refresh failed|OpenAI Codex.*token.*refresh|Please try again or re-authenticate|unsupported_country_region_territory|embedded run failover decision:.*reason=auth/i.test(
    String(text || ""),
  );
}

function missingShardFailure(shardPlan) {
  if (workerLogLooksLikeRuntimeAuthFailure(shardPlan?.workerLogTail)) {
    return {
      reason: "runtime_auth_failed",
      failureKind: "runtime_auth_failed",
    };
  }
  return {
    reason: "worker_missing_result",
    failureKind: "missing_worker_result_file",
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

function stampOutcomeWorkerId(outcome, workerId) {
  if (!workerId || !outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
    return outcome;
  }
  return {
    ...outcome,
    workerId: outcome.workerId ?? workerId,
  };
}

export function mergeShardSyncPayloads(fetchResult, shardResults, options = {}) {
  const planned = extractFetchTasks(fetchResult).filter((task) => !isCandidateDiscoveryFetchTask(task));
  const taskTypeById = new Map(
    planned.map((task) => [String(task?.id || fetchTaskId(task)), task?.agentWorkType || ""]),
  );
  const shardPlans = (options.shardPlans ?? [])
    .map(normalizeShardPlan)
    .filter(Boolean);
  const shardPlanByTaskId = new Map();
  for (const plan of shardPlans) {
    for (const taskId of plan.taskIds) shardPlanByTaskId.set(taskId, plan);
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

  const builderKey = (builder) =>
    String(builder?.builderId || builder?.sourceUrl || builder?.handle || builder?.name || "unknown");

  for (const shard of shardResults) {
    const workerId = shard.workerId ?? workerIdFromShardResultName(shard.name);
    if (!shard.payload) {
      shardSummaries.push({
        shard: shard.name,
        status: "missing",
        error: shard.error ?? "no result file",
      });
      continue;
    }
    let itemCount = 0;
    for (const builder of shard.payload?.builders ?? []) {
      const key = builderKey(builder);
      let target = builderIndex.get(key);
      if (!target) {
        target = { ...builder, items: [] };
        builderIndex.set(key, target);
        builders.push(target);
      }
      for (const item of builder?.items ?? []) {
        const stampedItem = stampItemWorkerId(item, workerId);
        const taskId = stampedItem?.rawJson?.fetchTaskId ? String(stampedItem.rawJson.fetchTaskId) : null;
        if (taskId && taskTypeById.get(taskId) === "fetch_builder_fallback") {
          // Builder-fallback tasks legitimately produce multiple items per
          // task id; dedupe those by item identity instead.
          const itemKey = `${taskId}\u0000${stampedItem?.externalId || stampedItem?.url || ""}`;
          if (seenFallbackItems.has(itemKey)) continue;
          seenFallbackItems.add(itemKey);
        } else if (taskId) {
          if (syncedTaskIds.has(taskId)) continue;
          syncedTaskIds.add(taskId);
        }
        if (taskId) accounted.add(taskId);
        target.items.push(stampedItem);
        itemCount += 1;
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
    shardSummaries.push({
      shard: shard.name,
      status: "ok",
      items: itemCount,
      taskOutcomes: outcomeCount,
    });
  }
  const knownShardResults = new Set(shardSummaries.map((summary) => summary.shard));
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
      accounted.add(id);
      const shardPlan = shardPlanByTaskId.get(id);
      const failure = missingShardFailure(shardPlan);
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
        ...(shardPlan?.shard ? { workerId: shardPlan.shard } : {}),
      });
      backfilled += 1;
    }
  }

  return {
    payload: { builders, taskOutcomes },
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
    const usageFile = `${shard}-usage.jsonl`;
    const workerLogText = await readOptionalText(join(resultsDir, workerLogFile));
    const usage = runtimeUsageFromFile(join(resultsDir, usageFile), "runtime_sidecar") ??
      (workerLogText ? runtimeUsageFromText(workerLogText) : null);
    plans.push({
      shard,
      resultFile: `${shard}-result.json`,
      workerLogFile,
      usageFile,
      workerLogTail: workerLogText ? tailLines(workerLogText) : null,
      workerLogBytes: workerLogText ? Buffer.byteLength(workerLogText, "utf8") : null,
      usage,
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
      workerId: plan.shard,
      usage: plan.usage,
      taskCount: plan.taskCount,
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
    workerId: payload.workerId ?? entry.workerId ?? planned.workerId ?? null,
    bodyChars: payload.bodyChars ?? null,
    bodyWords: payload.bodyWords ?? null,
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
  const summaryStats = textStats(item?.summary);
  return {
    ...planned,
    id,
    status: "summarized",
    phase: "summarize",
    message: "Summary ready; waiting for server sync.",
    workerId: entry.name?.split("/")?.[0]?.replace(/-checkpoints$/, "") ?? planned.workerId ?? null,
    builder: planned.builder ?? builder?.name ?? null,
    builderId: planned.builderId ?? builder?.builderId ?? null,
    sourceType: planned.sourceType ?? item?.sourceType ?? null,
    title: planned.title ?? item?.title ?? null,
    url: planned.url ?? item?.url ?? null,
    bodyChars: bodyStats.chars,
    bodyWords: bodyStats.words,
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
  return {
    ...planned,
    id,
    status,
    phase: "completed",
    message: outcome.failureReason
      ? `${String(status).replace(/_/g, " ")}: ${outcome.failureReason}`
      : `${String(status).replace(/_/g, " ")}.`,
    workerId: entry.name?.split("/")?.[0]?.replace(/-checkpoints$/, "") ?? planned.workerId ?? null,
  };
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

  const progress = await readFetchProgressState();
  if (!progress) return;
  const config = await loadConfig();
  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const shardPlans = await readShardPlans(resultsDir);
  const planned = fetchRunPlannedTaskPatches(fetchResult, { shardPlans });
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

  let changed = false;
  for (const update of updates) {
    changed = upsertFetchProgressTask(progress, update) || changed;
  }
  const counters = progress.counters ?? {};
  const tasksPlanned = Math.max(counters.tasksPlanned ?? 0, planned.length);
  const tasksDone = Math.min(tasksPlanned, Math.max(counters.tasksDone ?? 0, checkpointCompletedIds.size));
  if (tasksPlanned !== counters.tasksPlanned || tasksDone !== counters.tasksDone) {
    progress.counters = { ...counters, tasksPlanned, tasksDone };
    changed = true;
  }
  const latest = latestProgressTask(updates);
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
  const excludeTaskIdsFile = argValue(args, "--exclude-task-ids-file", null);
  const shardTimeoutSeconds = Number(argValue(args, "--shard-timeout-seconds", ""));
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
    backfillMissing: !completedOnly,
  });
  const excluded = await readIdSetFile(excludeTaskIdsFile);
  const availableIds = syncPayloadTaskIds(merged.payload);
  const selectedIds = new Set(
    [...availableIds].filter((id) => !excluded.has(id)),
  );
  const shouldFilterOutput = completedOnly || excluded.size > 0;
  const payloadOut = shouldFilterOutput
    ? filterSyncPayloadToTaskIds(merged.payload, selectedIds)
    : merged.payload;
  const tasksOut = shouldFilterOutput
    ? filterFetchResultToTaskIds(fetchResult, selectedIds)
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
    await writeFile(idsOutFile, `${[...selectedIds].sort().join("\n")}${selectedIds.size ? "\n" : ""}`, "utf8");
  }
  console.log(
    JSON.stringify(
      {
        status: "ok",
        out: outFile,
        ...(tasksOutFile ? { tasksOut: tasksOutFile } : {}),
        ...(idsOutFile ? { idsOut: idsOutFile } : {}),
        completedOnly,
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

function filterFetchResultToTaskIds(fetchResult, taskIds) {
  const wanted = new Set([...taskIds].map(String));
  return {
    ...copyPayloadMetadata(fetchResult),
    status: fetchResult?.status ?? "ok",
    fetchTasks: extractFetchTasks(fetchResult).filter((task) =>
      wanted.has(taskIdForSync(task)),
    ),
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
  return shardGroupKey(task);
}

function splitSyncPayload(fetchResult, payload = {}, options = {}) {
  const granularity = options.granularity === "task" ? "task" : "source";
  const keyForTask =
    granularity === "task" ? splitKeyForTaskGranularity : splitKeyForSourceGranularity;
  const slices = new Map();
  const taskKeyById = new Map();
  const fetchTasks = extractFetchTasks(fetchResult);

  for (const task of fetchTasks) {
    const key = keyForTask(task);
    const id = taskIdForSync(task);
    taskKeyById.set(id, key);
    ensureSyncSlice(slices, key).fetchTasks.push(task);
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
      const taskId = item?.rawJson?.fetchTaskId ? String(item.rawJson.fetchTaskId) : null;
      const key =
        (taskId && taskKeyById.get(taskId)) ||
        keyForTask(builderLikeTask(builder, item));
      const slice = ensureSyncSlice(slices, key);
      addBuilderItemToSlice(slice, builder, item);
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

function failedSyncPayloadForTasks(fetchResult, { reason, message } = {}) {
  const taskOutcomes = [];
  const failureReason = reason || "slice_sync_failed";
  for (const task of extractFetchTasks(fetchResult)) {
    if (isUserActionAgentWorkType(task?.agentWorkType)) continue;
    const id = taskIdForSync(task);
    taskOutcomes.push({
      fetchTaskId: id,
      status: "failed",
      reason: failureReason,
      evidence: {
        failureKind: failureReason,
        failedBy: "sync-builders-slice",
        ...(message ? { message } : {}),
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
  if (granularity !== "source" && granularity !== "task") {
    throw new Error("--granularity must be source or task");
  }

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const slices = splitSyncPayload(fetchResult, payload, { granularity });
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
  const outFile = argValue(args, "--out");
  const tasksOutFile = argValue(args, "--tasks-out", null);
  const excludeTaskIdsFile = argValue(args, "--exclude-task-ids-file", null);
  const reason = argValue(args, "--reason", "slice_sync_failed");
  const message = argValue(args, "--message", "");
  if (!tasksFile) throw new Error("Missing --tasks slice-tasks.json");
  if (!outFile) throw new Error("Missing --out failed-payload.json");

  const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
  const excluded = await readIdSetFile(excludeTaskIdsFile);
  const selectedIds = new Set(
    extractFetchTasks(fetchResult)
      .map(taskIdForSync)
      .filter((id) => !excluded.has(id)),
  );
  const tasksOut = filterFetchResultToTaskIds(fetchResult, selectedIds);
  const payload = failedSyncPayloadForTasks(tasksOut, { reason, message });
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
  const syncItems = extractSyncItems(payload);
  const outcomeById = new Map(
    (Array.isArray(payload?.taskOutcomes) ? payload.taskOutcomes : [])
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
  const externalMatches =
    item.externalId === taskItem.externalId ||
    item.url === taskItem.url ||
    (taskItem.url && item.externalId === taskItem.url);
  if (!externalMatches) return false;

  const builderMatches =
    builder.name === task.builder ||
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
  if (!String(candidate.item.body || "").trim()) errors.push("item.body_required");
  if (task.item?.body && normalizeContentText(candidate.item.body) !== normalizeContentText(task.item.body)) {
    errors.push("item.body_must_match_ready_fetch_task_body");
  }
  const summaryErrors = validateItemSummary(candidate.item.summary, {
    title: task.item?.title || "",
    body: candidate.item.body || task.item?.body || "",
  });
  errors.push(...summaryErrors.map((error) => `summary:${error}`));

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
  });
  if (!quality.ok) errors.push(`content_quality:${quality.reason}`);
  return errors;
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

function validateItemSummary(summary, { title = "", body = "" } = {}) {
  const errors = [];
  const normalized = normalizeContentText(summary || "");
  if (normalized.length < 40) errors.push("summary_too_short");
  if (normalized.length > 1200) errors.push("summary_too_long");
  if (isNearDuplicate(normalized, title)) errors.push("summary_duplicates_title");
  if (body && normalized === normalizeContentText(body).slice(0, normalized.length)) {
    errors.push("summary_copies_body_prefix");
  }
  return errors;
}

function genericContentQuality(text, { title = "", description = "", standards } = {}) {
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
  if (isNearDuplicate(normalized, title) || isNearDuplicate(normalized, description)) {
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

function postSummaryFromAgentOutput(agentOutput) {
  const map = new Map();
  const rows = Array.isArray(agentOutput?.postSummaries) ? agentOutput.postSummaries : [];
  for (const row of rows) {
    const summary = stringOrNull(row?.summary);
    if (!summary) continue;
    if (row?.feedItemId) map.set(String(row.feedItemId), summary);
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
    if (!postSummaries.has(id)) errors.push(`postSummaries missing feedItemId: ${id}`);
  }

  if (!Array.isArray(agentOutput.postSummaries)) {
    errors.push("postSummaries must be an array");
  } else {
    const outputItemIds = new Set();
    for (const row of agentOutput.postSummaries) {
      const feedItemId = stringOrNull(row?.feedItemId);
      if (!feedItemId) {
        errors.push("post summary is missing feedItemId");
      } else {
        if (outputItemIds.has(feedItemId)) errors.push(`duplicate post summary feedItemId: ${feedItemId}`);
        outputItemIds.add(feedItemId);
        if (!seenItemIds.has(feedItemId)) errors.push(`post summary has unknown feedItemId: ${feedItemId}`);
      }
      if (!stringOrNull(row?.summary)) {
        errors.push(`post summary is empty for feedItemId: ${row?.feedItemId || "unknown"}`);
      }
    }
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

  const postSummaries = postSummaryFromAgentOutput(agentOutput);
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

  // --regenerate ("re-generate today's digest"): the create route replaces
  // this user's existing same-day digest instead of stacking a duplicate.
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

  let patchStatus = "ok";
  let errorMessage = null;
  try {
    await patchJson(
      `${config.appUrl}/api/skill/fetch-runs/${encodeURIComponent(runId)}`,
      { plannedTasks },
      config.token,
      { label: "fetch log plan patch" },
    );
  } catch (error) {
    patchStatus = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to patch fetch log plan: ${errorMessage}`);
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
  const { plannedTasks, plannedTaskOutcomes, discoveryExpansions } = await readPlannedFetchResult(tasksFile);
  const workerUsages = await readShardWorkerUsages(argValue(args, "--results-dir", null), plannedTasks);
  payload = filterStaleSyncItemsByFetchCutoff(payload, plannedTasks);
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
    if (!partialOutcomes) validateAgentSyncPayload({ fetchTasks: plannedTasks }, payload);
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
  const uploadPayload = prepareSyncPayloadForUpload(
    currentFetchRunId
      ? { ...payload, fetchRun: buildFetchRunSyncPatch(currentFetchRunId, plannedTasks) }
      : payload,
  );
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

function prepareSyncItemForUpload(sourceType, item) {
  const rawJson = objectRecord(item?.rawJson);
  const summary = String(item?.summary ?? "").trim();
  const body = String(item?.body ?? "");
  const rawContentKind = inferSyncRawContentKind(sourceType, rawJson);
  const policy = syncContentPolicyFor(sourceType, rawContentKind);
  const durableBody = durableSyncBody({ body, summary, policy });
  const rawRetained =
    policy.durableRawMode === "full" ||
    policy.durableRawMode === "excerpt" ||
    policy.durableRawMode === "facts_only";
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

function durableSyncBody({ body, summary, policy }) {
  const normalizedBody = normalizeContentText(body);
  const normalizedSummary = normalizeContentText(summary);
  if (policy.durableRawMode === "none") {
    return normalizedSummary || syncExcerpt(normalizedBody, 500) || "Summary unavailable.";
  }
  if (policy.durableRawMode === "facts_only") {
    return normalizedSummary || syncExcerpt(normalizedBody, policy.durableRawMaxChars) || "Facts unavailable.";
  }
  return syncExcerpt(normalizedBody, policy.durableRawMaxChars) || normalizedSummary || "Content unavailable.";
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

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function readPlannedFetchResult(tasksFile) {
  try {
    const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
    return {
      plannedTasks: Array.isArray(fetchResult?.fetchTasks) ? fetchResult.fetchTasks : [],
      plannedTaskOutcomes: Array.isArray(fetchResult?.taskOutcomes) ? fetchResult.taskOutcomes : [],
      discoveryExpansions: Array.isArray(fetchResult?.discoveryExpansions)
        ? fetchResult.discoveryExpansions
        : [],
    };
  } catch {
    // No planned-tasks file (e.g. ad-hoc sync) → reconcile against payload only.
    return { plannedTasks: [], plannedTaskOutcomes: [], discoveryExpansions: [] };
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
    const summary = textStats(item?.summary);
    sizesByTaskId.set(String(id), {
      bodyChars: body.chars,
      bodyWords: body.words,
      summaryChars: summary.chars,
      summaryWords: summary.words,
      agentRuntime: item?.rawJson?.agentRuntime ?? null,
      agentModel: item?.rawJson?.agentModel ?? null,
      workerId: item?.rawJson?.workerId ?? null,
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
    // Informational user-action tasks (e.g. x_token_missing) aren't failures.
    if (work === "x_token_missing" || work.startsWith("user_action_")) {
      taskOutcomes.push({
        fetchTaskId: id,
        status: "action_needed",
        ...(plannedTaskPatch ? { plannedTask: plannedTaskPatch } : {}),
      });
      continue;
    }
    const sizes = sizesByTaskId.get(id) ?? {};
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
      status = sizes.summaryChars > 0 ? "synced" : "failed";
      if (status === "failed") failureReason = "summary_missing";
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
    summaryChars: null,
    summaryWords: null,
    agentRuntime: null,
    agentModel: null,
    workerId: task?.workerId ?? null,
  };
}

function plannedFetchTaskStatus(task) {
  const work = String(task?.agentWorkType ?? "");
  if (work === "x_token_missing" || work.startsWith("user_action_")) return "action_needed";
  if (task?.contentStatus === "ready") return "fetched";
  return "pending";
}

function shardWorkerIdByTaskId(shardPlans = []) {
  const byTaskId = new Map();
  for (const plan of shardPlans.map(normalizeShardPlan).filter(Boolean)) {
    for (const taskId of plan.taskIds) byTaskId.set(taskId, plan.shard);
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
        accountsDir: ACCOUNTS_DIR,
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
  };

  await recordCronAuditEvent(config, {
    job,
    eventType: "cron_status_sync_start",
    status: parseAuditStatus(statusValue),
    reason: "cron_status_command",
    runtime,
    details: { frequencyKey: freq ?? null, schedule: schedule ?? null },
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

function normalizeScheduleFrequency(value) {
  const key = String(value || "").trim();
  if (["30m", "1h", "3h", "6h", "12h", "daily", "weekly"].includes(key)) return key;
  return "6h";
}

function sortedHourList(anchorHour, stepHours) {
  const values = [];
  for (let hour = anchorHour; !values.includes(hour); hour = (hour + stepHours) % 24) {
    values.push(hour);
  }
  return values.sort((a, b) => a - b);
}

function cronExpressionForAnchor(freq, anchorDate) {
  const minute = anchorDate.getMinutes();
  const hour = anchorDate.getHours();
  const weekday = anchorDate.getDay();
  switch (freq) {
    case "30m": {
      const minutes = [minute, (minute + 30) % 60].sort((a, b) => a - b);
      return `${minutes.join(",")} * * * *`;
    }
    case "1h":
      return `${minute} * * * *`;
    case "3h":
      return `${minute} ${sortedHourList(hour, 3).join(",")} * * *`;
    case "6h":
      return `${minute} ${sortedHourList(hour, 6).join(",")} * * *`;
    case "12h":
      return `${minute} ${sortedHourList(hour, 12).join(",")} * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${weekday}`;
    default:
      return `${minute} ${sortedHourList(hour, 6).join(",")} * * *`;
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
  const array = (items) => [
    start,
    "  <array>",
    ...items.map((fields) => launchdScheduleDict(fields, "    ")),
    "  </array>",
  ].join("\n");

  switch (freq) {
    case "30m":
      return array(
        [minute, (minute + 30) % 60]
          .sort((a, b) => a - b)
          .map((value) => [["Minute", value]]),
      );
    case "1h":
      return `${start}\n${dict([["Minute", minute]])}`;
    case "3h":
      return array(sortedHourList(hour, 3).map((value) => [["Hour", value], ["Minute", minute]]));
    case "6h":
      return array(sortedHourList(hour, 6).map((value) => [["Hour", value], ["Minute", minute]]));
    case "12h":
      return array(sortedHourList(hour, 12).map((value) => [["Hour", value], ["Minute", minute]]));
    case "daily":
      return `${start}\n${dict([["Hour", hour], ["Minute", minute]])}`;
    case "weekly":
      return `${start}\n${dict([["Weekday", weekday], ["Hour", hour], ["Minute", minute]])}`;
    default:
      return array(sortedHourList(hour, 6).map((value) => [["Hour", value], ["Minute", minute]]));
  }
}

async function writeOptionalText(path, value) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${value}\n`, "utf8");
}

async function scheduleSpec(args) {
  const freq = normalizeScheduleFrequency(argValue(args, "--freq", "6h"));
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
      "saved to ~/.builder-blog/accounts/<email>.json",
    );
    process.exit(1);
  }
  else if (command === "fetch-personal") await fetchPersonal(args);
  else if (command === "expand-discovery") await expandDiscovery(args);
  else if (command === "patch-fetch-run-plan") await patchFetchRunPlan(args);
  else if (command === "shard-tasks") await shardTasks(args);
  else if (command === "checkpoint-progress") await emitCheckpointProgress(args);
  else if (command === "merge-task-results") await mergeTaskResults(args);
  else if (command === "split-sync-slices") await splitSyncSlices(args);
  else if (command === "fail-sync-slice") await failSyncSlice(args);
  else if (command === "prepare") await prepare(args);
  else if (command === "validate-agent-sync") await validateAgentSync(args);
  else if (command === "sync-builders") await syncBuilders(args);
  else if (command === "render-digest") await renderDigest(args);
  else if (command === "sync") await sync(args);
  else if (command === "cron-audit") await cronAudit(args);
  else if (command === "schedule-spec") await scheduleSpec(args);
  else if (command === "cron-status") await cronStatus(args);
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
