#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, hostname, platform, release, userInfo } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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

const CONFIG_DIR = join(homedir(), ".builder-blog");
const ACCOUNTS_DIR = join(CONFIG_DIR, "accounts");
const TMP_DIR = join(CONFIG_DIR, "tmp");
// fetch-personal writes the emitted run's id here so the later, separate
// sync-builders step can PATCH per-post fetch/summary outcomes onto the same
// fetch-log record (the two run in the same job on the same machine).
const FETCH_RUN_ID_FILE = join(TMP_DIR, "library-fetch-run-id");
const SOURCES_CONFIG_PATH = join(CONFIG_DIR, "sources.json");

let _sourcesConfig = null;

function loadSourcesConfig() {
  if (_sourcesConfig) return _sourcesConfig;
  try {
    _sourcesConfig = JSON.parse(readFileSync(SOURCES_CONFIG_PATH, "utf8"));
  } catch {
    // Fall back to embedded defaults when the file hasn't been downloaded yet.
    _sourcesConfig = {
      sources: [
        {
          id: "x",
          builderKind: "X",
          urlPatterns: ["(^|//)((www\\.)?(x|twitter)\\.com)/"],
          contentQuality: { primaryContentOnly: true, minChars: 1, minWords: 1, disallowedPrimarySources: ["title", "description", "page metadata"] },
        },
        {
          id: "blog",
          builderKind: "BLOG",
          urlPatterns: [],
          contentQuality: { primaryContentOnly: true, minChars: 200, minWords: 35, disallowedPrimarySources: ["title", "description", "page metadata", "file name"] },
        },
        {
          id: "youtube",
          builderKind: "PODCAST",
          urlPatterns: ["youtube\\.com", "youtu\\.be"],
          contentQuality: { primaryContentOnly: true, minChars: 80, minWords: 12, minUniqueWordRatio: 0.25, maxTimestampWordRatio: 0.2, disallowedPrimarySources: ["title", "description", "feed description", "page metadata"] },
        },
        {
          id: "podcast",
          builderKind: "PODCAST",
          urlPatterns: [],
          contentQuality: { primaryContentOnly: true, minChars: 200, minWords: 35, disallowedPrimarySources: ["title", "description", "page metadata"] },
        },
        {
          id: "pdf",
          builderKind: "WEBSITE",
          urlPatterns: ["\\.pdf(?:\\s|$|[?#])"],
          contentQuality: { primaryContentOnly: true, minChars: 200, minWords: 35, disallowedPrimarySources: ["title", "description", "page metadata", "file name"] },
        },
        {
          id: "website",
          builderKind: "WEBSITE",
          urlPatterns: [],
          contentQuality: { primaryContentOnly: true, minChars: 200, minWords: 35, disallowedPrimarySources: ["title", "description", "page metadata"] },
        },
      ],
    };
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
  youtube: fetchPersonalYouTubeBuilder,
  podcast: fetchPersonalPodcastBuilder,
  pdf: fetchPersonalPdfBuilder,
  website: fetchPersonalWebsiteBuilder,
};

function usage() {
  console.log(`builder-digest commands:
  exchange --ec <code> [--app-url ${DEFAULT_APP_URL}]
  fetch-personal [--days ${DEFAULT_PERSONAL_FETCH_DAYS}] [--limit 3] [--force] [--agent-model gpt-5.5]
  prepare [--regenerate]
  validate-agent-sync --tasks fetch-result.json --file personal-builders.json
  sync-builders --file personal-builders.json [--agent-model gpt-5.5]
  sync --file digest.md [--title "AI Builder Digest"] [--regenerate] [--context builder-blog-context.json]
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
  // jobs. It's authoritative and covers gemini/openclaw, which the env sniff
  // below can't detect. Fall back to per-agent env signals for interactive
  // (un-pinned) runs.
  const pinned = process.env.BUILDER_BLOG_RUNTIME?.trim().toLowerCase();
  const pinnedLabels = {
    claude: "Claude Code",
    codex: "Codex",
    gemini: "Gemini CLI",
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

  // Model detection must match the runtime — otherwise a gemini run would report
  // a model sniffed from Codex's config (e.g. "Gemini CLI (model gpt-5.5)").
  // Each runtime reads only its own sources; an unknown source yields "" so the
  // label degrades to just the runtime name.
  switch (runtime) {
    case "Codex":
      return detectedCodexModel();
    case "Claude Code":
      return process.env.ANTHROPIC_MODEL?.trim() || process.env.CLAUDE_MODEL?.trim() || "";
    case "Gemini CLI":
      return detectedGeminiModel();
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

function detectedGeminiModel() {
  const envModel = process.env.GEMINI_MODEL?.trim();
  if (envModel) return envModel;

  // Gemini CLI does not persist its model in settings.json today; read it
  // defensively in case a future version does, otherwise report no model.
  const geminiConfigPath = join(homedir(), ".gemini", "settings.json");
  if (!existsSync(geminiConfigPath)) return "";
  try {
    const settings = JSON.parse(readFileSync(geminiConfigPath, "utf8"));
    const model = settings?.model?.name ?? settings?.model;
    return typeof model === "string" ? model.trim() : "";
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
 *   1. BUILDER_BLOG_TOKEN env — direct token override
 *   2. BUILDER_BLOG_ACCOUNT env — read accounts/<email>.json
 *   3. Error
 */
async function readConfig() {
  const envToken = process.env.BUILDER_BLOG_TOKEN?.trim();
  const envUrl = process.env.BUILDER_BLOG_URL?.trim().replace(/\/$/, "");
  const envAccount = process.env.BUILDER_BLOG_ACCOUNT?.trim();

  if (envToken) {
    return {
      token: envToken,
      appUrl: envUrl ?? DEFAULT_APP_URL,
    };
  }

  if (envAccount) {
    const account = await loadAccountFile(envAccount);
    return {
      token: account.token,
      appUrl: envUrl ?? account.appUrl,
    };
  }

  return { token: null, appUrl: envUrl ?? DEFAULT_APP_URL };
}

function argValue(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

async function postJson(url, body, token) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}`, ...MACHINE_HEADERS } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function patchJson(url, body, token) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}`, ...MACHINE_HEADERS } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: token
      ? { authorization: `Bearer ${token}`, ...MACHINE_HEADERS }
      : {},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && data.status !== "pending") {
    throw new Error(data.error || data.status || `HTTP ${response.status}`);
  }
  return data;
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
  const data = await postJson(`${appUrl}/api/skill/exchange`, { code: ec });
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
  // --regenerate ("re-generate today's digest"): ask the context route to
  // ignore the last-digest cutoff so the full window is re-covered. Without it
  // a same-day re-run would return an empty window.
  const regenerate = args.includes("--regenerate");
  const contextUrl =
    `${config.appUrl}/api/skill/context?includePrompts=1` +
    (regenerate ? "&regenerate=1" : "");
  const context = await getJson(contextUrl, config.token);
  console.log(JSON.stringify(context, null, 2));
}

async function fetchPersonal(args) {
  const startedAt = new Date();
  // Cron-driven invocations export BUILDER_BLOG_RUN_SOURCE=cron from
  // builder-agent-runner.sh; anything else (manual terminal usage,
  // ad-hoc agent runs) is recorded as "manual".
  const runSource = process.env.BUILDER_BLOG_RUN_SOURCE?.trim() === "cron" ? "cron" : "manual";
  const days = Math.max(1, Number(argValue(args, "--days", String(DEFAULT_PERSONAL_FETCH_DAYS))));
  const limit = Math.max(1, Number(argValue(args, "--limit", "3")));
  const force = args.includes("--force");
  const agentModel = argValue(args, "--agent-model", DEFAULT_AGENT_MODEL);
  const cliFlags = { days, limit, force, agentModel };

  const config = await readConfig();
  // No token → no upload possible; let the original error bubble so
  // the user sees the actionable login message.
  requireLoggedIn(config);

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
  let promptsBySourceType = {};

  try {
    const context = await getJson(
      `${config.appUrl}/api/skill/context?days=${encodeURIComponent(String(days))}`,
      config.token,
    );
    const sources = context.sources ?? {};
    const commonSummaryRules = context.commonSummaryRules ?? context.digest?.commonSummaryRules ?? "";
    const subscribedBuilderIds = new Set(
      (context.subscriptions ?? []).map((builder) => builder.id),
    );
    const personalBuilders = personalBuildersForFetch(context);
    buildersAttempted = personalBuilders.length;

    if (personalBuilders.length === 0) {
      const payload = { status: "ok", localErrors: [], fetchTasks: [] };
      console.log(JSON.stringify(payload, null, 2));
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
          const externalItems = await fetchPersonalWithExternalCommand(builder, {
            fallbackCutoff,
            force,
            limit,
            context,
            agentModel,
          });
          if (!externalItems) {
            const task = buildBuilderFallbackTask(builder, fallbackBuilderSync, {
              error: new Error("No local fetcher configured for this personal source."),
              sources,
              commonSummaryRules,
            });
            fetchTasks.push(task);
            builderStat.tasksGenerated += 1;
            continue;
          }
          const filtered = filterFetchedItems(externalItems, {
            builderId: builder.id,
            cutoff: force ? null : cutoffForBuilder(context, builder.id, fallbackCutoff),
            limit,
            fetchedItemKeys: force ? new Set() : fetchedItemKeysForBuilder(context, builder.id),
          });
          builders.push({ ...fallbackBuilderSync, items: filtered });
          builderStat.itemsFetched += filtered.length;
          continue;
        }
        const fetched = await source.fetch(builder, {
          cutoff: force ? null : cutoffForBuilder(context, builder.id, fallbackCutoff),
          limit,
          agentModel,
          fetchedItemKeys: force ? new Set() : fetchedItemKeysForBuilder(context, builder.id),
        });
        const { items, agentTasks: sourceAgentTasks } = normalizePersonalFetchResult(fetched);
        const builderSync = {
          ...fallbackBuilderSync,
          kind: source.syncKind,
          sourceType: source.id,
        };
        const fetchTasksFromAgentTasks = sourceAgentTasks.map((task) =>
          fetchTaskFromAgentTask(task, builderSync, sources, commonSummaryRules),
        );
        fetchTasks.push(...fetchTasksFromAgentTasks);
        builderStat.tasksGenerated += fetchTasksFromAgentTasks.length;
        builders.push({ ...builderSync, items });
        builderStat.itemsFetched += items.length;
        builderStat.sourceType = source.id;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        builderStat.error = message;
        errorCount += 1;
        const task = buildBuilderFallbackTask(builder, fallbackBuilderSync, {
          error,
          sources,
          commonSummaryRules,
        });
        fetchTasks.push(task);
        builderStat.tasksGenerated += 1;
      }
    }

    if (builders.length > 0) {
      fetchTasks.push(...fetchTasksForReadyBuilders(builders, sources, commonSummaryRules));
    }

    // Recount items/tasks: fetchTasksForReadyBuilders rewrote a task
    // per item, so totals belong to the final tasks array, not the
    // partial counters above. We keep builderStat per-builder counts
    // separately for the UI's per-builder breakdown.
    const agentTasks = fetchTasks.filter((task) => task?.contentStatus !== "ready");
    itemsFetched = builders.reduce((sum, builder) => sum + (builder.items?.length ?? 0), 0);
    tasksGenerated = fetchTasks.length;

    // Extract user-action items (e.g. x_token_missing) into a
    // first-class collection so the UI can surface them prominently.
    for (const task of agentTasks) {
      const kind = task?.agentWorkType ?? "";
      if (typeof kind === "string" && kind.startsWith("user_action_")) {
        userActions.push({
          kind,
          builder: task.builder ?? task.builderId ?? "unknown",
          message: task.agentMessage ?? task.fallbackReason ?? "",
          ...(task.agentHelpUrl ? { helpUrl: task.agentHelpUrl } : {}),
        });
      }
    }

    perBuilder = [...builderStats.values()];
    ({ slimFetchTasks, promptsBySourceType } = summarizeFetchTasksForLog(
      fetchTasks,
      sources,
      commonSummaryRules,
    ));

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
        prompts: promptsBySourceType,
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
        prompts: promptsBySourceType,
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
// summary (no body, no full prompt) plus the per-source-type prompts
// deduplicated by sourceType. This is what the user sees in the
// Fetch log details panel — small enough for the 50 KB cap, but
// faithful enough that the prompt history survives admin edits.
export function textStats(value) {
  const s = typeof value === "string" ? value : "";
  const trimmed = s.trim();
  return { chars: s.length, words: trimmed ? trimmed.split(/\s+/).length : 0 };
}

export function summarizeFetchTasksForLog(fetchTasks, sources = {}, commonSummaryRules = "") {
  const slimFetchTasks = fetchTasks.map((task) => {
    const ready = task?.contentStatus === "ready";
    const isUserAction =
      typeof task?.agentWorkType === "string" && task.agentWorkType.startsWith("user_action_");
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
  const sourceTypesUsed = new Set();
  for (const task of fetchTasks) {
    if (task?.sourceType) sourceTypesUsed.add(task.sourceType);
  }
  // Emit the *composed* prompt strings — exactly what the agent reads
  // as `task.summaryInstructions.prompt` (always) and
  // `task.fetchInstructions.prompt` (when admin set a custom
  // fetchPromptBody for the source). When fetchInstructions is null,
  // we mirror that here as null so the UI can label it "default
  // extraction" rather than fabricating a fetch prompt.
  const promptsBySourceType = {};
  for (const sourceType of sourceTypesUsed) {
    const source = sources?.[sourceType];
    if (!source) continue;
    const summaryInstructions = (() => {
      try {
        return singlePostSummaryInstructions(sourceType, sources, commonSummaryRules);
      } catch {
        return null;
      }
    })();
    const fetchInstructions = singlePostFetchInstructions(sourceType, sources);
    promptsBySourceType[sourceType] = {
      summary: summaryInstructions?.prompt ?? null,
      fetch: fetchInstructions.prompt,
      fetchIsDefault: fetchInstructions.isDefault,
    };
  }
  return { slimFetchTasks, promptsBySourceType };
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
      `Synced ${itemsFetched} post${itemsFetched === 1 ? "" : "s"} from ${buildersAttempted} source${buildersAttempted === 1 ? "" : "s"}`,
    );
  } else {
    parts.push(`Fetched 0 new posts from ${buildersAttempted} source${buildersAttempted === 1 ? "" : "s"}`);
  }
  if (agentTaskCount > 0) {
    parts.push(`${agentTaskCount} source${agentTaskCount === 1 ? "" : "s"} require agent extraction`);
  }
  if (userActions.length > 0) {
    parts.push(`${userActions.length} action${userActions.length === 1 ? "" : "s"} need attention`);
  }
  return parts.join(" · ").slice(0, 280);
}

async function emitFetchRunRecord(config, record) {
  if (!config?.appUrl || !config?.token) return;
  const finishedAt = new Date();
  const body = {
    startedAt: record.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status: record.status,
    source: record.source,
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
      agentRuntime: DEFAULT_AGENT_RUNTIME || null,
      agentModel: DEFAULT_AGENT_MODEL || null,
    },
  };
  try {
    const result = await postJson(`${config.appUrl}/api/skill/fetch-runs`, body, config.token);
    if (result?.id) {
      // Hand the run id to the later sync-builders step so it can attach
      // per-post outcomes. Best-effort: if persisting fails, the run is still
      // recorded — sync-builders just skips the per-post patch.
      try {
        await mkdir(TMP_DIR, { recursive: true });
        await writeFile(FETCH_RUN_ID_FILE, String(result.id), "utf8");
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

export function fetchTasksForReadyBuilders(builders, sources = {}, commonSummaryRules = "") {
  return builders.flatMap((builder) =>
    (builder.items ?? []).map((item) => ({
      type: "fetch_post",
      contentStatus: "ready",
      builder: builder.name,
      builderId: builder.builderId,
      sourceType: builder.sourceType,
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

function buildBuilderFallbackTask(builder, builderSync, { error, sources = {}, commonSummaryRules = "" } = {}) {
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
  const fetchInstructions = singlePostFetchInstructions(sourceType, sources);
  const task = {
    type: "fetch_post",
    agentWorkType: "fetch_builder_fallback",
    contentStatus: "requires_agent",
    builder: builder.name,
    builderId: builder.id,
    sourceType,
    builderSync,
    item,
    minimumContentQuality: genericMinimumContentQuality(),
    summaryInstructions: singlePostSummaryInstructions(sourceType, sources, commonSummaryRules),
    fetchInstructions,
    fallbackReason: error?.message || String(error || "Personal fetcher failed"),
  };
  task.id = fetchTaskId({ builderId: builder.id, builder: builder.name, item });
  return task;
}

function fetchTaskFromAgentTask(task, builderSync, sources = {}, commonSummaryRules = "") {
  const item = task.item ?? {};
  const sourceType = task.sourceType ?? builderSync.sourceType;
  const fetchInstructions = task.fetchInstructions ?? singlePostFetchInstructions(sourceType, sources);
  const out = {
    type: "fetch_post",
    agentWorkType: task.type,
    contentStatus: "requires_agent",
    builder: task.builder ?? builderSync.name,
    builderId: task.builderId ?? builderSync.builderId,
    sourceType,
    builderSync,
    item,
    minimumContentQuality: task.minimumContentQuality ?? genericMinimumContentQuality(),
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

// Default extraction guidance the agent follows when admin hasn't
// configured a custom fetchPromptBody for the source. Kept here so
// the CLI is the single source of truth for "what prompt the agent
// actually received" — both the skill markdown and the fetch log
// point at task.fetchInstructions.prompt now, and that string is
// always non-empty (custom-or-default).
export const DEFAULT_FETCH_GUIDANCE = [
  "Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to pick any",
  "extraction method available: web fetch, local CLI tools (yt-dlp, curl,",
  "ffmpeg, headless browser, etc.), transcription APIs — anything you have.",
  "Keep trying available methods until real primary content that meets",
  "`task.minimumContentQuality` is obtained, or no method remains.",
].join("\n");

// Build the per-source extraction instructions the agent literally
// follows when a fetchTask is `requires_agent`. Always returns a
// non-null record:
//   - admin-configured fetchPromptBody → wraps it with a thin header
//     and marks isDefault=false. The agent must follow this prompt
//     verbatim and may not substitute its own heuristics.
//   - empty config → returns the shared default extraction guidance
//     with isDefault=true. Same string the fetch log surfaces, so the
//     "this is what the agent received" promise stays true even when
//     no custom prompt is configured.
export function singlePostFetchInstructions(sourceId, sources = {}) {
  const source = sources?.[sourceId];
  const label = source?.label || sourceId;
  const body = source?.fetchPrompt?.body;
  const hasCustom = typeof body === "string" && body.trim().length > 0;
  if (hasCustom) {
    return {
      scope: "single_post",
      isDefault: false,
      prompt: [
        `Follow these extraction rules for one ${label} post.`,
        "",
        body,
      ].join("\n"),
    };
  }
  return {
    scope: "single_post",
    isDefault: true,
    prompt: [
      `Default FollowBrief extraction for one ${label} post (admin has not configured a custom fetch prompt for this source).`,
      "",
      DEFAULT_FETCH_GUIDANCE,
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

function singlePostSummaryPrompt(source) {
  return [
    `Write one concise FollowBrief single-post summary in ${source.language}.`,
    "",
    source.commonSummaryRules,
    "",
    `Source-specific rules (${source.label}):`,
    source.body,
  ].join("\n");
}

export function personalBuildersForFetch(context) {
  return (context.libraryBuilders ?? []).filter(
    (builder) => builder.scope === "PERSONAL",
  );
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

  // First: URL-pattern matches scoped to the builder kind (catches youtube/pdf).
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

function isPdfSource(builder) {
  return sourceTypeIdForBuilder(builder) === "pdf";
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
  return normalized === "auto" ? "" : normalized;
}

async function fetchPersonalYouTubeBuilder(
  builder,
  { cutoff, limit, agentModel, fetchedItemKeys = new Set(), fetcher = fetch },
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
    const transcript = await fetchYouTubeTranscript(video.url, fetcher).catch(() => "");
    const quality = youtubeContentQuality(transcript, {
      source: transcript ? "youtube-captions" : "missing",
      title: video.title,
      description: video.description,
    });
    if (!quality.ok) {
      agentTasks.push(youtubeAgentTaskForVideo(builder, video));
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
        transcriptSource: "youtube-captions",
        contentQuality: quality,
      },
    });
  }

  return { items, agentTasks };
}

export function fetchPersonalYouTubeBuilderForTest(builder, options) {
  return fetchPersonalYouTubeBuilder(builder, options);
}

// Average the unique-word ratio over fixed-size windows. Unlike the global
// type-token ratio \u2014 which decays ~1/sqrt(N) (Heaps' law) and so makes any long
// transcript look "repetitive" \u2014 this stays high for real speech (each window
// has fresh vocabulary) and only collapses for genuinely repetitive text such
// as stuck captions or "music music music". Length-invariant by construction.
function localUniqueRatio(words, windowSize = 100) {
  const lower = words.map((word) => word.toLowerCase());
  if (lower.length === 0) return 0;
  if (lower.length <= windowSize) return new Set(lower).size / lower.length;
  let sum = 0;
  let windows = 0;
  for (let i = 0; i + windowSize <= lower.length; i += windowSize) {
    const win = lower.slice(i, i + windowSize);
    sum += new Set(win).size / windowSize;
    windows += 1;
  }
  // Fold in a trailing remainder window when it's big enough to be meaningful.
  const rem = lower.length % windowSize;
  if (rem >= 20) {
    const win = lower.slice(lower.length - rem);
    sum += new Set(win).size / rem;
    windows += 1;
  }
  return windows ? sum / windows : 0;
}

/**
 * @param {string} text
 * @param {{ source?: string; title?: string; description?: string }} [options]
 */
export function youtubeContentQuality(text, { source = "", title = "", description = "" } = {}) {
  const normalized = normalizeContentText(text);
  const words = normalized.match(/[A-Za-z0-9\u4e00-\u9fff]+/g) ?? [];
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  const timestampLike = words.filter((word) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(word)).length;
  const metrics = {
    chars: normalized.length,
    words: words.length,
    uniqueWords: uniqueWords.size,
    uniqueWordRatio: words.length ? uniqueWords.size / words.length : 0,
    localUniqueWordRatio: localUniqueRatio(words),
    timestampLike,
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
      standards: youtubeMinimumContentQuality(),
    };
  }
  if (metrics.chars < 80 || metrics.words < 12) {
    return {
      ok: false,
      reason: "transcript_too_short",
      metrics,
      standards: youtubeMinimumContentQuality(),
    };
  }
  const minUniqueRatio = youtubeMinimumContentQuality()?.minUniqueWordRatio ?? 0.25;
  if (metrics.words >= 40 && metrics.localUniqueWordRatio < minUniqueRatio) {
    return {
      ok: false,
      reason: "transcript_too_repetitive",
      metrics,
      standards: youtubeMinimumContentQuality(),
    };
  }
  if (metrics.timestampLike > 0 && metrics.timestampLike / metrics.words > 0.2) {
    return {
      ok: false,
      reason: "transcript_is_timestamp_heavy",
      metrics,
      standards: youtubeMinimumContentQuality(),
    };
  }
  if (isNearDuplicate(normalized, title) || isNearDuplicate(normalized, description)) {
    return {
      ok: false,
      reason: "transcript_duplicates_title_or_description",
      metrics,
      standards: youtubeMinimumContentQuality(),
    };
  }
  return { ok: true, reason: "ok", metrics, standards: youtubeMinimumContentQuality() };
}

function youtubeMinimumContentQuality() {
  return sourceConfigFor("youtube").contentQuality;
}

function genericMinimumContentQuality() {
  return sourceConfigFor("website").contentQuality;
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

function youtubeAgentTaskForVideo(builder, video) {
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
    minimumContentQuality: youtubeMinimumContentQuality(),
  };
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

async function fetchPersonalBlogBuilder(builder, { cutoff, limit, agentModel, fetchedItemKeys = new Set() }) {
  const indexUrl = builder.fetchUrl || builder.sourceUrl;
  if (!indexUrl) return [];

  const indexResponse = await fetch(indexUrl, {
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

  for (const article of candidates) {
    const articleResponse = await fetch(article.url, {
      headers: { "User-Agent": "FollowBriefSkill/1.0 (personal agent fetcher)" },
    });
    if (!articleResponse.ok) continue;

    const html = await articleResponse.text();
    const extracted = extractBlogArticle(html, article.url);
    const body = extracted.body || article.description;
    if (!body.trim()) continue;

    items.push({
      kind: "BLOG_POST",
      externalId: article.url,
      title: extracted.title || article.title || "Untitled",
      body,
      url: article.url,
      publishedAt: extracted.publishedAt || article.publishedAt,
      sourceName: builder.name,
      fetchTool: skillFetchTool("RSS/HTML article extractor", agentModel),
      rawJson: {
        source: "personal-blog",
        builderId: builder.id,
        builderName: builder.name,
        title: extracted.title || article.title || "Untitled",
        url: article.url,
        publishedAt: extracted.publishedAt || article.publishedAt,
      },
    });
  }

  return items;
}

async function fetchPersonalPodcastBuilder(
  builder,
  { cutoff, limit, agentModel, fetchedItemKeys = new Set(), fetcher = fetch },
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
      agentTasks.push(podcastAgentTaskForEpisode(builder, item, feedUrl));
    }
  }

  return { items, agentTasks };
}

const APPLE_PODCAST_URL_RE = /podcasts\.apple\.com\/[^?\s]*\/id(\d+)/i;

async function resolveApplePodcastFeedUrl(url, fetcher = fetch) {
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
  const words = text.match(/[A-Za-z0-9一-鿿]+/g) ?? [];
  // Mirrors the podcast contentQuality bar in config/sources.json
  // (minChars: 200, minWords: 35). The agent's fetch prompt may apply a
  // stricter "substantial" threshold for the audio-fallback decision.
  return text.length >= 200 && words.length >= 35;
}

function podcastAgentTaskForEpisode(builder, item, feedUrl) {
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
    minimumContentQuality: genericMinimumContentQuality(),
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

async function fetchPersonalPdfBuilder(builder) {
  const sourceUrl = builder.fetchUrl || builder.sourceUrl;
  if (!sourceUrl) return { items: [], agentTasks: [] };
  return {
    items: [],
    agentTasks: [
      (() => {
        const item = {
          kind: "BLOG_POST",
          externalId: sourceUrl,
          title: builder.name,
          url: sourceUrl,
          publishedAt: null,
          sourceName: builder.name,
        };
        const task = {
          type: "pdf_extraction",
          builder: builder.name,
          builderId: builder.id,
          sourceType: "pdf",
          item,
          minimumContentQuality: genericMinimumContentQuality(),
        };
        return { ...task, id: agentTaskId(task) };
      })(),
    ],
  };
}

async function fetchPersonalWebsiteBuilder(builder, { cutoff, limit, agentModel, fetchedItemKeys = new Set() }) {
  if (isPdfSource(builder)) {
    return fetchPersonalPdfBuilder(builder);
  }
  const sourceUrl = builder.fetchUrl || builder.sourceUrl;
  if (!sourceUrl) return [];

  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": "FollowBriefSkill/1.0 (personal website fetcher)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: HTTP ${response.status}`);
  }

  const html = await response.text();
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

async function fetchPersonalXBuilder(builder, { cutoff, limit, agentModel, fetchedItemKeys = new Set() }) {
  const bearerToken = process.env.X_BEARER_TOKEN?.trim();
  if (!bearerToken) {
    // No throw: unauthenticated x.com scraping doesn't yield usable post
    // content (login wall + JS challenge), so retry-with-agent is futile.
    // Surface a structured task the agent prints to the user instead.
    const handleString = normalizeXHandle(builder.handle || builder.sourceUrl) ?? "";
    const profileUrl = handleString
      ? `https://x.com/${handleString}`
      : (builder.sourceUrl ?? "");
    const task = {
      type: "x_token_missing",
      builder: builder.name,
      builderId: builder.id,
      sourceType: "x",
      agentMessage:
        `Action needed for X source "${builder.name}": personal X (Twitter) ` +
        `fetching requires an X API bearer token. The CLI cannot fetch posts ` +
        `without it, and unauthenticated x.com scraping does not return usable ` +
        `content. Get a free bearer token at ` +
        `https://developer.x.com/en/portal/dashboard (the Free tier covers ` +
        `read-only access), then export X_BEARER_TOKEN=... in the shell that ` +
        `runs this skill before re-running.`,
      agentHelpUrl: "https://developer.x.com/en/portal/dashboard",
      item: {
        kind: "TWEET",
        externalId: `x-token-missing:${builder.id}`,
        title: builder.name,
        url: profileUrl,
        publishedAt: null,
        sourceName: builder.name,
      },
      minimumContentQuality: genericMinimumContentQuality(),
    };
    return {
      items: [],
      agentTasks: [{ ...task, id: agentTaskId(task) }],
    };
  }
  const handle = normalizeXHandle(builder.handle || builder.sourceUrl);
  if (!handle) return [];

  const userResponse = await fetch(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=description`,
    { headers: { authorization: `Bearer ${bearerToken}` } },
  );
  if (!userResponse.ok) {
    throw new Error(`Failed to resolve X user ${handle}: HTTP ${userResponse.status}`);
  }
  const user = (await userResponse.json())?.data;
  if (!user?.id) return [];

  const tweetResponse = await fetch(
    `https://api.x.com/2/users/${encodeURIComponent(user.id)}/tweets?max_results=${Math.min(100, Math.max(5, limit * 3))}&tweet.fields=created_at,note_tweet&exclude=retweets,replies`,
    { headers: { authorization: `Bearer ${bearerToken}` } },
  );
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
  return !Number.isNaN(date.getTime()) && date > cutoff;
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
  return linksByPattern(html, /href=["']\/engineering\/([a-z0-9-]+)["']/gi, "https://www.anthropic.com/engineering/");
}

function parseClaudeBlogIndex(html) {
  return linksByPattern(html, /href=["']\/blog\/([a-z0-9-]+)["']/gi, "https://claude.com/blog/");
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
  const paragraphs = [...source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length > 40);

  return {
    title: stripHtml(title),
    publishedAt,
    body: paragraphs.slice(0, 30).join("\n\n"),
  };
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

export async function youtubeFeedUrl(sourceUrl, fetcher = fetch) {
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
export async function fetchYouTubeVideos(sourceUrl, fetcher = fetch, options = {}) {
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

async function fetchYouTubeTranscript(videoUrl, fetcher = fetch) {
  const videoId = youtubeVideoId(videoUrl);
  if (!videoId) return "";
  const response = await fetcher(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) return "";
  const playerResponse = extractYouTubePlayerResponse(await response.text());
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return "";
  const track = preferredCaptionTrack(tracks);
  if (!track?.baseUrl) return "";
  const captionResponse = await fetcher(withYouTubeCaptionFormat(track.baseUrl, "json3"), {
    headers: {
      "User-Agent": "FollowBriefSkill/1.0 (personal YouTube fetcher)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!captionResponse.ok) return "";
  const body = await captionResponse.text();
  return body.trim().startsWith("{") ? parseYouTubeJsonTranscript(body) : parseYouTubeXmlTranscript(body);
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

function preferredCaptionTrack(tracks) {
  const typedTracks = tracks.filter((track) => track && typeof track.baseUrl === "string");
  return (
    typedTracks.find((track) => track.languageCode?.startsWith("en") && track.kind !== "asr") ||
    typedTracks.find((track) => track.languageCode?.startsWith("en")) ||
    typedTracks.find((track) => track.kind !== "asr") ||
    typedTracks[0]
  );
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
    if (task.agentWorkType === "x_token_missing") {
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
    });
    if (!quality.ok) errors.push(`youtube_content_quality:${quality.reason}`);
    return errors;
  }

  const quality = genericContentQuality(candidate.item.body, {
    title: task.item?.title || "",
    description: task.item?.description || "",
  });
  if (!quality.ok) errors.push(`content_quality:${quality.reason}`);
  return errors;
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

function genericContentQuality(text, { title = "", description = "" } = {}) {
  const normalized = normalizeContentText(text);
  const words = normalized.match(/[A-Za-z0-9\u4e00-\u9fff]+/g) ?? [];
  const standards = genericMinimumContentQuality();
  const metrics = {
    chars: normalized.length,
    words: words.length,
  };
  if (metrics.chars < standards.minChars || metrics.words < standards.minWords) {
    return { ok: false, reason: "content_too_short", metrics, standards };
  }
  if (isNearDuplicate(normalized, title) || isNearDuplicate(normalized, description)) {
    return { ok: false, reason: "content_duplicates_metadata", metrics, standards };
  }
  return { ok: true, reason: "ok", metrics, standards };
}

async function sync(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const file = argValue(args, "--file");
  const title = argValue(args, "--title", `AI Builder Digest — ${new Date().toLocaleDateString()}`);
  let content = "";
  if (file) {
    content = await readFile(file, "utf8");
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    content = Buffer.concat(chunks).toString("utf8");
  }
  if (!content.trim()) throw new Error("Digest content is empty");

  // --regenerate ("re-generate today's digest"): the create route replaces
  // this user's existing same-day digest instead of stacking a duplicate.
  const regenerate = args.includes("--regenerate");

  // The candidate posts presented to this digest. Read them from the prepared
  // context file (the same JSON `prepare` wrote and the agent read) so the
  // server can mark exactly that set as digested for this user. Degrade
  // gracefully — a missing/unreadable context just skips the marking.
  // Default matches where the digest prompts write the context:
  // ${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/tmp/builder-blog-context.json
  const agentDir = process.env.BUILDER_BLOG_AGENT_DIR?.trim() || CONFIG_DIR;
  const contextPath = argValue(
    args,
    "--context",
    join(agentDir, "tmp", "builder-blog-context.json"),
  );
  let digestedItems = [];
  try {
    const ctx = JSON.parse(await readFile(contextPath, "utf8"));
    digestedItems = (Array.isArray(ctx.items) ? ctx.items : [])
      .filter((it) => it && it.entityId && it.kind && it.externalId)
      .map((it) => ({
        entityId: it.entityId,
        kind: it.kind,
        externalId: it.externalId,
        feedItemId: it.id ?? null,
      }));
  } catch {
    console.error(
      `Could not read digest candidates from ${contextPath}; skipping the ` +
        `digested-marking step (posts may reappear in the next digest).`,
    );
  }

  const now = new Date();
  const result = await postJson(
    `${config.appUrl}/api/skill/digests`,
    {
      title,
      content,
      // Recorded language is set server-side from the account-wide summary
      // language preference; this is only the fallback when none is set.
      language: argValue(args, "--language", "zh"),
      periodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: now.toISOString(),
      itemCount: Number(argValue(args, "--item-count", String(digestedItems.length))),
      regenerate,
      digestedItems,
    },
    config.token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function syncBuilders(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const file = argValue(args, "--file");
  if (!file) throw new Error("Missing --file personal-builders.json");
  const payload = JSON.parse(await readFile(file, "utf8"));
  payload.fetchTool ??= skillFetchTool(
    "manual JSON sync",
    argValue(args, "--agent-model", DEFAULT_AGENT_MODEL),
  );
  const result = await postJson(`${config.appUrl}/api/skill/builders`, payload, config.token);
  console.log(JSON.stringify(result, null, 2));

  // Reconcile the fetch log against the FULL planned task list so a task the
  // agent dropped (fetched but never summarized) is recorded as a failure, not
  // left pending. Read the planned tasks the CLI emitted in fetch-personal.
  const agentDir = process.env.BUILDER_BLOG_AGENT_DIR?.trim() || CONFIG_DIR;
  const tasksFile = argValue(args, "--tasks", join(agentDir, "tmp", "library-fetch-result.json"));
  let plannedTasks = [];
  try {
    const fetchResult = JSON.parse(await readFile(tasksFile, "utf8"));
    plannedTasks = Array.isArray(fetchResult?.fetchTasks) ? fetchResult.fetchTasks : [];
  } catch {
    // No planned-tasks file (e.g. ad-hoc sync) → reconcile against payload only.
  }
  await patchFetchRunOutcomes(config, payload, result, plannedTasks);
}

// After a sync, attach per-post fetch/summary outcomes to the fetch-log record
// emitted earlier by fetch-personal. Keyed by rawJson.fetchTaskId. The server
// response is authoritative for success/failure (a task succeeds only when its
// item persisted with a non-empty summary); the payload supplies sizes/model.
// Every PLANNED task is classified so dropped ones surface as failures.
// Best-effort and non-fatal: a missing run id or unreachable server just skips.
async function patchFetchRunOutcomes(config, payload, serverResult = {}, plannedTasks = []) {
  if (!config?.appUrl || !config?.token) return;
  let runId = "";
  try {
    runId = (await readFile(FETCH_RUN_ID_FILE, "utf8")).trim();
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
    (Array.isArray(payload?.taskOutcomes) ? payload.taskOutcomes : [])
      .filter((o) => o && o.fetchTaskId)
      .map((o) => [String(o.fetchTaskId), o]),
  );

  // Classify every planned task; fall back to payload+server ids when no
  // planned list is available.
  const plannedById = new Map(
    plannedTasks.map((t) => [String(t?.id || fetchTaskId(t)), t]),
  );
  const taskIds =
    plannedById.size > 0
      ? [...plannedById.keys()]
      : [...new Set([...serverByTaskId.keys(), ...sizesByTaskId.keys()])];

  const taskOutcomes = [];
  for (const id of taskIds) {
    const planned = plannedById.get(id);
    const work = String(planned?.agentWorkType || "");
    // Informational user-action tasks (e.g. x_token_missing) aren't failures.
    if (work === "x_token_missing" || work.startsWith("user_action_")) {
      taskOutcomes.push({ fetchTaskId: id, status: "action_needed" });
      continue;
    }
    const sizes = sizesByTaskId.get(id) ?? {};
    const server = serverByTaskId.get(id);
    const agentOutcome = agentOutcomeById.get(id);
    let status;
    let failureReason;
    let evidence;
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
    } else {
      // Planned but neither synced nor reported by the agent → unaccounted.
      status = "failed";
      failureReason = "not_summarized";
    }
    taskOutcomes.push({
      fetchTaskId: id,
      ...sizes,
      status,
      ...(failureReason ? { failureReason } : {}),
      ...(evidence ? { evidence } : {}),
    });
  }
  if (taskOutcomes.length === 0) return;

  try {
    await patchJson(
      `${config.appUrl}/api/skill/fetch-runs/${encodeURIComponent(runId)}`,
      { taskOutcomes },
      config.token,
    );
  } catch (patchError) {
    const message = patchError instanceof Error ? patchError.message : String(patchError);
    console.error(`Failed to attach per-post info to the fetch log: ${message}`);
  }
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
  else if (command === "prepare") await prepare(args);
  else if (command === "validate-agent-sync") await validateAgentSync(args);
  else if (command === "sync-builders") await syncBuilders(args);
  else if (command === "sync") await sync(args);
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
