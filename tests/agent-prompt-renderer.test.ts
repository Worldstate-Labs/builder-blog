import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import type { SkillJobName } from "../src/lib/skill-job-files";
import {
  buildOpenClawChildSetupUrl,
  renderAgentPrompt,
  type ExistingCronRecord,
  type NormalizedAgentPromptRenderOptions,
} from "../src/lib/agent-prompt-renderer";

const markdownShellBlocks = (text: string) =>
  [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);

const markdownProse = (text: string) => text.replace(/```bash\n[\s\S]*?```/g, "");

function normalizedOptions(
  overrides: Partial<NormalizedAgentPromptRenderOptions> = {},
): NormalizedAgentPromptRenderOptions {
  return {
    runtime: "codex",
    frequency: "daily",
    force: false,
    fetchDays: 30,
    parallelWorkers: 10,
    fetchLimit: 3,
    ...overrides,
  };
}

type OpenClawChildSetupUrlOptions = Parameters<typeof buildOpenClawChildSetupUrl>[0]["options"];

function normalizedOpenClawChildSetupOptions(
  overrides: Partial<OpenClawChildSetupUrlOptions> = {},
): OpenClawChildSetupUrlOptions {
  return {
    ...normalizedOptions({ runtime: "openclaw" }),
    runtime: "openclaw",
    ...overrides,
  };
}

function extractBashBlock(content: string, marker: string): string {
  const block = markdownShellBlocks(content).find((candidate) => candidate.includes(marker));
  assert.ok(block, `missing bash block with marker: ${marker}`);
  return block!;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function dataTextUrl(text: string): string {
  return `data:text/plain;base64,${Buffer.from(text, "utf8").toString("base64")}`;
}

const failSessionsCommandSentinel = "__FAIL_OPENCLAW_SESSIONS_COMMAND__";

function runOpenClawQueueBlock({
  block,
  channelContext,
  sessions,
  helpText,
  agent = "main",
}: {
  block: string;
  channelContext: string;
  sessions: string;
  helpText: string;
  agent?: string;
}) {
  const root = mkdtempSync(join(tmpdir(), "openclaw-queue-block-"));
  const agentDir = join(root, "agent");
  const binDir = join(root, "bin");
  const cronAddArgsPath = join(root, "cron-add-args.txt");
  const helpPath = join(root, "cron-add-help.txt");
  const sessionsPath = join(root, "sessions.json");
  const openclawPath = join(binDir, "openclaw");

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(helpPath, helpText, "utf8");
  if (sessions !== failSessionsCommandSentinel) {
    writeFileSync(sessionsPath, sessions, "utf8");
  }
  writeFileSync(
    openclawPath,
    `#!/bin/sh
set -eu
cmd="\${1:-}"
shift || true
case "$cmd" in
  config)
    sub="\${1:-}"
    shift || true
    case "$sub" in
      get)
        printf '0\\n'
        ;;
      set)
        exit 0
        ;;
      *)
        echo "unexpected config subcommand: $sub" >&2
        exit 97
        ;;
    esac
    ;;
  sessions)
    [ "\${1:-}" = "--json" ] || exit 96
    if [ "$OPENCLAW_TEST_SESSIONS_PATH" = "${failSessionsCommandSentinel}" ]; then
      echo "stubbed openclaw sessions failure" >&2
      exit 93
    fi
    cat "$OPENCLAW_TEST_SESSIONS_PATH"
    ;;
  cron)
    sub="\${1:-}"
    shift || true
    case "$sub" in
      add)
        if [ "\${1:-}" = "--help" ]; then
          cat "$OPENCLAW_TEST_HELP_PATH"
          exit 0
        fi
        printf '%s\\n' "$@" > "$OPENCLAW_TEST_CRON_ADD_ARGS_PATH"
        printf '{"ok":true}\\n'
        ;;
      *)
        echo "unexpected cron subcommand: $sub" >&2
        exit 95
        ;;
    esac
    ;;
  *)
    echo "unexpected command: $cmd" >&2
    exit 94
    ;;
esac
`,
    "utf8",
  );
  chmodSync(openclawPath, 0o755);

  const promptUrl = dataTextUrl("Run this queued FollowBrief setup continuation.\n");
  const blockForExecution = block.replace(
    /^OPENCLAW_CHILD_SETUP_PROMPT_URL='[^']*'$/m,
    `OPENCLAW_CHILD_SETUP_PROMPT_URL=${shellSingleQuote(promptUrl)}`,
  );
  const env = {
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    BUILDER_BLOG_AGENT_DIR: agentDir,
    OPENCLAW_AGENT: agent,
    OPENCLAW_CHANNEL_CONTEXT: channelContext,
    OPENCLAW_TEST_CRON_ADD_ARGS_PATH: cronAddArgsPath,
    OPENCLAW_TEST_HELP_PATH: helpPath,
    OPENCLAW_TEST_SESSIONS_PATH:
      sessions === failSessionsCommandSentinel ? failSessionsCommandSentinel : sessionsPath,
  };
  const result = spawnSync("bash", ["-eu", "-c", blockForExecution], {
    encoding: "utf8",
    env,
  });

  return {
    ...result,
    cronAddArgs: existsSync(cronAddArgsPath)
      ? readFileSync(cronAddArgsPath, "utf8").trim().split("\n").filter(Boolean)
      : [],
  };
}

async function getSkillJobPromptRoute(
  request: Request,
  job: SkillJobName,
): Promise<Response> {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgres://followbrief:followbrief@127.0.0.1:5432/followbrief";
  try {
    const { GET } = await import("../src/app/api/skill/jobs/[job]/skill.md/route");
    return GET(request, {
      params: Promise.resolve({ job }),
    });
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

async function renderWithDefaults({
  job,
  options,
  exchange,
  openClawChild,
  credentialPrep = "",
  existingCronRecord = null,
}: {
  job: SkillJobName;
  options?: Partial<NormalizedAgentPromptRenderOptions>;
  exchange?: {
    code: string;
    accountEmail: string;
    accountUserId?: string | null;
  };
  openClawChild?: {
    accountEmail: string;
  };
  credentialPrep?: string;
  existingCronRecord?: ExistingCronRecord | null;
}) {
  return renderAgentPrompt(
    {
      origin: "https://followbrief.example",
      job,
      options: normalizedOptions(options),
      exchange,
      openClawChild,
    },
    {
      buildSourceCredentialPrep: async () => credentialPrep,
      getExistingCronRecord: async () => existingCronRecord,
    },
  );
}

test("renderAgentPrompt renders a one-time library prompt with normalized runtime, lookback, parallel workers, and exchange/account substitution", async () => {
  const content = await renderWithDefaults({
    job: "library-once",
    options: { runtime: "openclaw", force: true, fetchDays: 14, parallelWorkers: 7 },
    exchange: {
      code: "bb_ec_renderer_library_once",
      accountEmail: "builder@example.com",
      accountUserId: "user_library_once",
    },
  });

  assert.match(content, /builder@example\.com/);
  assert.match(content, /BUILDER_BLOG_AGENT_RUNTIME="\$\{BUILDER_BLOG_AGENT_RUNTIME-openclaw\}"/);
  assert.match(content, /BUILDER_BLOG_FETCH_DAYS="\$\{BUILDER_BLOG_FETCH_DAYS-14\}"/);
  assert.match(content, /BUILDER_BLOG_PARALLEL_WORKERS="\$\{BUILDER_BLOG_PARALLEL_WORKERS-7\}"/);
  assert.match(content, /BUILDER_BLOG_FETCH_FORCE="\$\{BUILDER_BLOG_FETCH_FORCE---force\}"/);
  assert.match(content, /node "\$\{BUILDER_BLOG_AGENT_DIR:-\$HOME\/\.builder-blog\}\/builder-digest\.mjs" exchange --ec "bb_ec_renderer_library_once"/);
  assert.doesNotMatch(content, /\{\{AGENT_RUNTIME\}\}|\{\{FETCH_DAYS\}\}|\{\{PARALLEL_WORKERS\}\}|\{\{FETCH_FLAG\}\}/);
});

test("renderAgentPrompt renders recurring library setup with credential prep, active schedule warning, and ordered exchange insertion", async () => {
  const content = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "codex", frequency: "weekly", fetchDays: 21, parallelWorkers: 12 },
    exchange: {
      code: "bb_ec_renderer_library_cron",
      accountEmail: "cron@example.com",
      accountUserId: "user_library_cron",
    },
    credentialPrep: "**Prepare source API credentials**\n\n- X_BEARER_TOKEN",
    existingCronRecord: {
      status: "active",
      startedAt: new Date("2026-07-18T12:30:00.000Z"),
      frequencyLabel: "Daily",
      runtime: "codex",
      hostname: "cloudbox",
      updatedAt: new Date("2026-07-18T13:00:00.000Z"),
    },
  });

  assert.match(content, /\*\*Existing active schedule recorded by FollowBrief\.\*\*/);
  assert.match(content, /Frequency: Daily/);
  assert.match(content, /Runner: codex · cloudbox/);
  assert.match(content, /\*\*Prepare source API credentials/);
  assert.match(content, /1a\. Exchange the one-time setup code/);
  assert.match(content, /cron@example\.com/);
  assert.match(content, /Scheduled runtime: \*\*Codex\*\* \(codex\)/);
  assert.match(content, /PATH="\$SCHEDULER_PATH" command -v codex/);
  assert.doesNotMatch(content, /\{\{AGENT_RUNTIME\}\}/);
  assert.doesNotMatch(content, /\{\{SOURCE_CREDENTIAL_PREP\}\}|\{\{CRON_FREQUENCY_KEY\}\}|\{\{CRON_FREQUENCY_LABEL\}\}/);

  const installIndex = content.indexOf("1. Install or refresh the skill:");
  const exchangeIndex = content.indexOf("1a. Exchange the one-time setup code");
  const credentialIndex = content.indexOf("**Prepare source API credentials");
  const stepThreeIndex = content.indexOf("3. Before changing anything");
  assert.ok(installIndex >= 0 && exchangeIndex > installIndex);
  assert.ok(credentialIndex > exchangeIndex);
  assert.ok(stepThreeIndex > credentialIndex);
});

test("renderAgentPrompt renders digest setup using digest regenerate placeholders and runtime labels", async () => {
  const content = await renderWithDefaults({
    job: "digest-cron-setup",
    options: { runtime: "claude", frequency: "1h", force: true, parallelWorkers: 5 },
    exchange: {
      code: "bb_ec_renderer_digest_cron",
      accountEmail: "digest@example.com",
      accountUserId: "user_digest_cron",
    },
  });

  assert.match(content, /Scheduled runtime: \*\*Claude Code\*\* \(claude\)/);
  assert.match(content, /BUILDER_BLOG_DIGEST_REGENERATE="--regenerate"/);
  assert.match(content, /--regenerate "1"/);
  assert.match(content, /digest@example\.com/);
  assert.doesNotMatch(content, /\{\{DIGEST_REGENERATE\}\}|\{\{DIGEST_REGENERATE_FLAG\}\}/);
});

test("renderAgentPrompt renders cloud worker host and cloud stop prompts without relying on route-owned substitutions", async () => {
  const hostPrompt = await renderWithDefaults({
    job: "cloud-library-host",
    options: { runtime: "openclaw", fetchDays: 9, parallelWorkers: 4 },
  });
  const stopPrompt = await renderWithDefaults({
    job: "cloud-library-cron-stop",
    exchange: {
      code: "bb_ec_renderer_cloud_stop",
      accountEmail: "cloud-admin@example.com",
      accountUserId: "user_cloud_stop",
    },
  });

  assert.match(hostPrompt, /BUILDER_BLOG_AGENT_RUNTIME="\$\{BUILDER_BLOG_AGENT_RUNTIME-openclaw\}"/);
  assert.match(hostPrompt, /BUILDER_BLOG_FETCH_DAYS="\$\{BUILDER_BLOG_FETCH_DAYS-9\}"/);
  assert.match(hostPrompt, /BUILDER_BLOG_PARALLEL_WORKERS="\$\{BUILDER_BLOG_PARALLEL_WORKERS-4\}"/);
  assert.match(stopPrompt, /cloud-admin@example\.com/);
  assert.match(stopPrompt, /BUILDER_BLOG_ACCOUNT="cloud-admin@example\.com"/);
});

test("all copied prompts install with bounded Node fetch before consuming the exchange code", async () => {
  const jobs: SkillJobName[] = [
    "library-once",
    "digest-once",
    "library-cron-setup",
    "digest-cron-setup",
    "library-cron-stop",
    "digest-cron-stop",
    "cloud-library-cron-setup",
    "cloud-library-cron-stop",
  ];

  for (const job of jobs) {
    const content = await renderWithDefaults({
      job,
      exchange: {
        code: `bb_ec_${job.replaceAll("-", "_")}`,
        accountEmail: "prompt-order@example.com",
        accountUserId: "user_prompt_order",
      },
    });
    const installIndex = content.indexOf("1. Install or refresh the skill");
    const exchangeIndex = content.indexOf("1a. Exchange the one-time setup code");
    const stepTwoIndex = content.indexOf("\n2.");

    assert.ok(installIndex >= 0, `${job} must include the install step`);
    assert.ok(exchangeIndex > installIndex, `${job} must install before exchange`);
    assert.ok(stepTwoIndex > exchangeIndex, `${job} must exchange before step 2`);
    assert.match(content, /AbortController/);
    assert.match(content, /maxAttempts\s*=\s*4/);
    assert.match(content, /error\?\.cause/);
    assert.doesNotMatch(content, /curl -fsSL/);
    assert.doesNotMatch(content, /\{\{EXCHANGE_BLOCK\}\}/);
  }
});

test("buildOpenClawChildSetupUrl creates a canonical child job URL from origin, job, normalized options, and account only", () => {
  const url = buildOpenClawChildSetupUrl({
    origin: "https://followbrief.example",
    job: "library-cron-setup",
    accountEmail: "queue@example.com",
    options: normalizedOpenClawChildSetupOptions({
      frequency: "weekly",
      force: true,
      fetchDays: 45,
      parallelWorkers: 6,
      fetchLimit: 8,
    }),
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://followbrief.example");
  assert.equal(parsed.pathname, "/api/skill/jobs/library-cron-setup/skill.md");
  assert.equal(parsed.searchParams.get("openclaw_setup_child"), "1");
  assert.equal(parsed.searchParams.get("setup_account"), "queue@example.com");
  assert.equal(parsed.searchParams.get("runtime"), "openclaw");
  assert.equal(parsed.searchParams.get("freq"), "weekly");
  assert.equal(parsed.searchParams.get("force"), "1");
  assert.equal(parsed.searchParams.get("days"), "45");
  assert.equal(parsed.searchParams.get("parallel"), "6");
  assert.equal(parsed.searchParams.get("postLimit"), "8");
  assert.equal(parsed.searchParams.get("ec"), null);
  assert.ok(!parsed.pathname.startsWith("/p/"));
});

test("buildOpenClawChildSetupUrl rejects invalid jobs or runtimes from untyped callers", () => {
  assert.throws(
    () =>
      buildOpenClawChildSetupUrl({
        origin: "https://followbrief.example",
        job: "cloud-library-host" as never,
        accountEmail: "queue@example.com",
        options: normalizedOpenClawChildSetupOptions(),
      }),
    /only support cron setup jobs/i,
  );
  assert.throws(
    () =>
      buildOpenClawChildSetupUrl({
        origin: "https://followbrief.example",
        job: "library-cron-setup",
        accountEmail: "queue@example.com",
        options: normalizedOptions({ runtime: "codex" }) as never,
      }),
    /require runtime openclaw/i,
  );
});

test("buildOpenClawChildSetupUrl narrows to OpenClaw cron setup inputs at compile time", () => {
  if (false) {
    const invalidJobArgs: Parameters<typeof buildOpenClawChildSetupUrl>[0] = {
      origin: "https://followbrief.example",
      // @ts-expect-error job must be a supported cron setup job
      job: "library-once",
      accountEmail: "queue@example.com",
      options: normalizedOpenClawChildSetupOptions(),
    };
    const invalidRuntimeArgs: Parameters<typeof buildOpenClawChildSetupUrl>[0] = {
      origin: "https://followbrief.example",
      job: "library-cron-setup",
      accountEmail: "queue@example.com",
      // @ts-expect-error runtime must be openclaw
      options: normalizedOptions({ runtime: "codex" }),
    };
    void invalidJobArgs;
    void invalidRuntimeArgs;
  }
});

test("renderAgentPrompt slices OpenClaw parent and child setup prompts independently of the parent entry URL", async () => {
  const parent = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "openclaw", frequency: "daily", fetchDays: 11, parallelWorkers: 3 },
    exchange: {
      code: "bb_ec_renderer_openclaw_parent",
      accountEmail: "openclaw@example.com",
      accountUserId: "user_openclaw_parent",
    },
  });
  const child = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "openclaw", frequency: "daily", fetchDays: 11, parallelWorkers: 3 },
    openClawChild: {
      accountEmail: "openclaw@example.com",
    },
  });

  assert.match(parent, /Next: Queue the OpenClaw initial run and schedule install\./);
  assert.match(parent, /OPENCLAW_CHILD_SETUP_PROMPT_URL='https:\/\/followbrief\.example\/api\/skill\/jobs\/library-cron-setup\/skill\.md\?openclaw_setup_child=1&setup_account=openclaw%40example\.com&runtime=openclaw/);
  assert.match(parent, /AbortController/);
  assert.match(parent, /maxAttempts\s*=\s*4/);
  assert.match(parent, /error\?\.cause/);
  assert.doesNotMatch(parent, /curl -fsSL/);
  assert.match(parent, /OPENCLAW_CRON_ADD_HELP="\$\(openclaw cron add --help 2>&1\)"/);
  assert.match(parent, /--session current/);
  assert.match(parent, /--message "\$\(cat "\$PROMPT_COPY"\)"/);
  assert.match(parent, /OPENCLAW_CHANNEL_CONTEXT/);
  assert.match(parent, /openclaw sessions --json/);
  assert.match(parent, /chat\.id/);
  assert.match(parent, /sender\.id/);
  assert.match(parent, /OPENCLAW_PARENT_SESSION_KEY/);
  assert.match(parent, /--session main/);
  assert.match(parent, /--session-key "\$OPENCLAW_PARENT_SESSION_KEY"/);
  assert.match(parent, /--system-event "\$\(cat "\$PROMPT_COPY"\)"/);
  assert.match(parent, /--wake now/);
  assert.match(
    parent,
    /OpenClaw does not expose a persistent cron session mode required for confirmation/,
  );
  assert.doesNotMatch(parent, /--session isolated/);
  assert.doesNotMatch(parent, /--light-context/);
  assert.match(parent, /FOLLOWBRIEF_OPENCLAW_QUEUED=1/);
  assert.doesNotMatch(parent, /Run this queued FollowBrief setup continuation/);

  assert.match(child, /^Run this queued FollowBrief setup continuation\./);
  assert.match(child, /persistent OpenClaw session/);
  assert.match(child, /If the verified verdict was `"needs_confirmation"`/);
  assert.match(child, /Ask whether to install the scheduled run\s+anyway\./);
  assert.match(child, /Only[\s\S]*continue to step 8 if the user explicitly agrees/);
  assert.match(child, /followbriefScheduleInstall/);
  assert.match(child, /FollowBrief schedule is not confirmed active\./);
  assert.doesNotMatch(child, /unattended and must not wait for confirmation/);
  assert.doesNotMatch(child, /--session isolated/);
  assert.doesNotMatch(child, /openclaw cron (add|list|inspect|run)/);
  assert.match(child, /6\. Run one real initial fetch job now\./);
  assert.match(child, /7\. Interpret the output from step 6/);
  assert.match(child, /8\. When the user explicitly confirms a `needs_confirmation` result later/);
  assert.doesNotMatch(child, /1\. Install or refresh the skill:/);
  assert.doesNotMatch(child, /1a\. Exchange the one-time setup code/);
  assert.doesNotMatch(child, /bb_ec_renderer_openclaw_parent/);

  const childBlocks = markdownShellBlocks(child);
  const setupBlockIndex = childBlocks.findIndex((candidate) =>
    candidate.includes("verify-library-setup-verdict"),
  );
  assert.ok(setupBlockIndex >= 0, "child prompt must keep the setup flow in one bash block");
  const setupBlock = childBlocks[setupBlockIndex]!;
  assert.match(
    setupBlock,
    /RESUME_CONTRACT_PATH="\$AGENT_DIR\/tmp\/accounts\/\$ACCOUNT_SLUG\/library-cron-direct\/resume-contract-\$EXPECTED_INSTANCE_ID\.json"/,
  );
  assert.match(setupBlock, /FAILED_POST_DETAILS="\$\(/);
  assert.match(setupBlock, /rm -f -- "\$RESUME_CONTRACT_PATH"/);
  assert.match(setupBlock, /mv -f "\$RESUME_CONTRACT_TMP" "\$RESUME_CONTRACT_PATH"/);
  assert.match(setupBlock, /printf 'Exact confirmation command: FOLLOWBRIEF_CONFIRM_PARTIAL=1 BUILDER_BLOG_AGENT_DIR="%s" "%s" --contract "%s"\\n'/);
  assert.match(setupBlock, /BUILDER_BLOG_AGENT_DIR="\$AGENT_DIR" "\$HELPER_PATH" --contract "\$RESUME_CONTRACT_PATH"/);
  assert.match(setupBlock, /followbriefScheduleInstall/);
  for (const laterBlock of childBlocks.slice(setupBlockIndex + 1)) {
    assert.doesNotMatch(laterBlock, /SETUP_VERDICT_JSON|EXPECTED_INSTANCE_ID|SETUP_TMP_DIR/);
  }
  const childProse = markdownProse(child);
  assert.doesNotMatch(
    childProse,
    /FOLLOWBRIEF_CONFIRM_PARTIAL=1 "\$AGENT_DIR\/builder-library-cron-install\.sh" --contract "\$RESUME_CONTRACT_PATH"/,
  );
  assert.match(childProse, /only the exact `Exact confirmation command:` line printed by step 6,\s+byte-for-byte\./);

  const probeFunction = parent.match(
    /openclaw_persistent_session_mode\(\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(probeFunction, "rendered parent must include the session capability probe");
  const probe = (help: string) => spawnSync(
    "bash",
    ["-c", `${probeFunction}\nopenclaw_persistent_session_mode "$1"`, "probe", help],
    { encoding: "utf8" },
  );
  const currentPiped = probe([
    "--session <target>  Session target (main|isolated|current)",
    "--system-event <text>  System event payload",
  ].join("\n"));
  const currentSpaced = probe("--session current | main | isolated");
  const legacyMain = probe([
    "--session <target>  Session target (isolated | main)",
    "--system-event <text>  System event payload (main session)",
  ].join("\n"));
  const legacyMainWithSessionKey = probe([
    "--session <target>  Session target (isolated | main)",
    "--session-key <key>  Target one exact session for replies",
    "--system-event <text>  System event payload (main session)",
  ].join("\n"));
  const unsupported = probe("--session <target>  Session target (isolated)");

  assert.equal(currentPiped.status, 0, currentPiped.stderr);
  assert.equal(currentPiped.stdout.trim(), "current");
  assert.equal(currentSpaced.status, 0, currentSpaced.stderr);
  assert.equal(currentSpaced.stdout.trim(), "current");
  assert.notEqual(legacyMain.status, 0);
  assert.equal(legacyMainWithSessionKey.status, 0, legacyMainWithSessionKey.stderr);
  assert.equal(legacyMainWithSessionKey.stdout.trim(), "main-event");
  assert.notEqual(unsupported.status, 0);
});

test("rendered OpenClaw queue block binds the legacy main-event continuation to one exact origin session", async () => {
  const parent = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "openclaw", frequency: "daily", fetchDays: 11, parallelWorkers: 3 },
    exchange: {
      code: "bb_ec_renderer_openclaw_exact_session",
      accountEmail: "openclaw@example.com",
      accountUserId: "user_openclaw_exact_session",
    },
  });
  const queueBlock = extractBashBlock(parent, "OPENCLAW_CHILD_SETUP_PROMPT_URL");
  const result = runOpenClawQueueBlock({
    block: queueBlock,
    channelContext: JSON.stringify({ sender: { id: 12345 } }),
    sessions: JSON.stringify({
      sessions: [
        { agentId: "main", kind: "cron", key: "agent:main:telegram:direct:12345" },
        { agentId: "main", kind: "direct", key: "agent:main:run:cron-owner-12345" },
        { agentId: "main", kind: "direct", key: "agent:main:telegram:direct:12345" },
        { agentId: "main", kind: "direct", key: "agent:main:telegram:direct:012345" },
        { agentId: "main", kind: "direct", key: "agent:main:telegram:direct" },
        { agentId: "main", kind: "direct", key: "agent:main:telegram:direct:12345:topic:9" },
        { agentId: "main", kind: "direct", key: "agent:main:cron:direct:12345" },
        { agentId: "work", kind: "direct", key: "agent:work:telegram:direct:12345" },
      ],
    }),
    helpText: [
      "--session <target>  Session target (isolated | main)",
      "--session-key <key>  Target one exact session for replies",
      "--system-event <text>  System event payload (main session)",
    ].join("\n"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FOLLOWBRIEF_OPENCLAW_QUEUED=1/);
  assert.deepEqual(result.cronAddArgs, [
    "--name",
    result.cronAddArgs[1]!,
    "--at",
    result.cronAddArgs[3]!,
    "--delete-after-run",
    "--session",
    "main",
    "--session-key",
    "agent:main:telegram:direct:12345",
    "--system-event",
    "Run this queued FollowBrief setup continuation.",
    "--wake",
    "now",
    "--json",
  ]);
});

test("rendered OpenClaw queue block prefers chat.id over sender.id so a group route beats the sender's DM", async () => {
  const parent = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "openclaw", frequency: "daily", fetchDays: 11, parallelWorkers: 3 },
    exchange: {
      code: "bb_ec_renderer_openclaw_group_preferred",
      accountEmail: "openclaw@example.com",
      accountUserId: "user_openclaw_group_preferred",
    },
  });
  const queueBlock = extractBashBlock(parent, "OPENCLAW_CHILD_SETUP_PROMPT_URL");
  const result = runOpenClawQueueBlock({
    block: queueBlock,
    channelContext: JSON.stringify({ sender: { id: 12345 }, chat: { id: -100 } }),
    sessions: JSON.stringify({
      sessions: [
        { agentId: "main", kind: "direct", key: "agent:main:telegram:direct:12345" },
        { agentId: "main", kind: "group", key: "agent:main:telegram:group:-100" },
      ],
    }),
    helpText: [
      "--session <target>  Session target (isolated | main)",
      "--session-key <key>  Target one exact session for replies",
      "--system-event <text>  System event payload (main session)",
    ].join("\n"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FOLLOWBRIEF_OPENCLAW_QUEUED=1/);
  assert.deepEqual(result.cronAddArgs.slice(5, 10), [
    "--session",
    "main",
    "--session-key",
    "agent:main:telegram:group:-100",
    "--system-event",
  ]);
});

test("rendered OpenClaw queue block keeps the native current-session branch unchanged", async () => {
  const parent = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "openclaw", frequency: "daily", fetchDays: 11, parallelWorkers: 3 },
    exchange: {
      code: "bb_ec_renderer_openclaw_current_branch",
      accountEmail: "openclaw@example.com",
      accountUserId: "user_openclaw_current_branch",
    },
  });
  const queueBlock = extractBashBlock(parent, "OPENCLAW_CHILD_SETUP_PROMPT_URL");
  const result = runOpenClawQueueBlock({
    block: queueBlock,
    channelContext: JSON.stringify({ sender: { id: 12345 } }),
    sessions: failSessionsCommandSentinel,
    helpText: [
      "--session <target>  Session target (main|isolated|current)",
      "--timeout-seconds <seconds>  Override the agent timeout",
      "--announce  Deliver output to the active route when possible",
      "--best-effort-deliver  Try to deliver even if the active route is stale",
      "--message <text>  Prompt body",
      "--system-event <text>  System event payload",
    ].join("\n"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FOLLOWBRIEF_OPENCLAW_QUEUED=1/);
  assert.deepEqual(result.cronAddArgs, [
    "--name",
    result.cronAddArgs[1]!,
    "--at",
    result.cronAddArgs[3]!,
    "--delete-after-run",
    "--agent",
    "main",
    "--session",
    "current",
    "--timeout-seconds",
    result.cronAddArgs[10]!,
    "--announce",
    "--best-effort-deliver",
    "--message",
    "Run this queued FollowBrief setup continuation.",
    "--json",
  ]);
  assert.doesNotMatch(result.cronAddArgs.join("\n"), /--session-key|--system-event|--wake/);
});

test("rendered OpenClaw queue block fails closed before cron add when origin-session routing is malformed or ambiguous", async () => {
  const parent = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "openclaw", frequency: "daily", fetchDays: 11, parallelWorkers: 3 },
    exchange: {
      code: "bb_ec_renderer_openclaw_fail_closed",
      accountEmail: "openclaw@example.com",
      accountUserId: "user_openclaw_fail_closed",
    },
  });
  const queueBlock = extractBashBlock(parent, "OPENCLAW_CHILD_SETUP_PROMPT_URL");
  const helpText = [
    "--session <target>  Session target (isolated | main)",
    "--session-key <key>  Target one exact session for replies",
    "--system-event <text>  System event payload (main session)",
  ].join("\n");
  const scenarios = [
    {
      label: "malformed context",
      channelContext: '["not-an-object"]',
      sessions: JSON.stringify({
        sessions: [{ agentId: "main", kind: "direct", key: "agent:main:telegram:direct:12345" }],
      }),
    },
    {
      label: "zero matches",
      channelContext: JSON.stringify({ sender: { id: "12345" } }),
      sessions: JSON.stringify({
        sessions: [{ agentId: "main", kind: "direct", key: "agent:main:telegram:direct:no-match" }],
      }),
    },
    {
      label: "ambiguous matches",
      channelContext: JSON.stringify({ sender: { id: "12345" } }),
      sessions: JSON.stringify({
        sessions: [
          { agentId: "main", kind: "direct", key: "agent:main:telegram:direct:12345" },
          { agentId: "main", kind: "direct", key: "agent:main:discord:direct:12345" },
        ],
      }),
    },
    {
      label: "deceptive partial suffix",
      channelContext: JSON.stringify({ sender: { id: "12345" } }),
      sessions: JSON.stringify({
        sessions: [{ agentId: "main", kind: "direct", key: "agent:main:telegram:direct:012345" }],
      }),
    },
    {
      label: "group thread collision",
      channelContext: JSON.stringify({ sender: { id: "12345" }, chat: { id: "-100" } }),
      sessions: JSON.stringify({
        sessions: [
          { agentId: "main", kind: "group", key: "agent:main:telegram:group:-100" },
          { agentId: "main", kind: "group", key: "agent:main:telegram:group:-100:topic:77" },
        ],
      }),
    },
    {
      label: "alternate cron and internal routes",
      channelContext: JSON.stringify({ sender: { id: "12345" } }),
      sessions: JSON.stringify({
        sessions: [
          { agentId: "main", kind: "cron", key: "agent:main:telegram:direct:12345" },
          { agentId: "main", kind: "direct", key: "agent:main:cron:direct:12345" },
          { agentId: "main", kind: "direct", key: "agent:main:run:direct:12345" },
          { agentId: "main", kind: "direct", key: "agent:main:telegram:direct" },
        ],
      }),
    },
  ] as const;

  for (const scenario of scenarios) {
    const result = runOpenClawQueueBlock({
      block: queueBlock,
      channelContext: scenario.channelContext,
      sessions: scenario.sessions,
      helpText,
    });

    assert.notEqual(result.status, 0, `${scenario.label} should fail closed`);
    assert.equal(result.cronAddArgs.length, 0, `${scenario.label} must fail before cron add`);
    assert.match(result.stderr, /OpenClaw durable setup job could not be queued|OpenClaw origin session/i);
  }
});

test("rendered OpenClaw queue block fails closed before cron add when openclaw sessions --json fails", async () => {
  const parent = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "openclaw", frequency: "daily", fetchDays: 11, parallelWorkers: 3 },
    exchange: {
      code: "bb_ec_renderer_openclaw_sessions_failure",
      accountEmail: "openclaw@example.com",
      accountUserId: "user_openclaw_sessions_failure",
    },
  });
  const queueBlock = extractBashBlock(parent, "OPENCLAW_CHILD_SETUP_PROMPT_URL");
  const result = runOpenClawQueueBlock({
    block: queueBlock,
    channelContext: JSON.stringify({ sender: { id: 12345 } }),
    sessions: failSessionsCommandSentinel,
    helpText: [
      "--session <target>  Session target (isolated | main)",
      "--session-key <key>  Target one exact session for replies",
      "--system-event <text>  System event payload (main session)",
    ].join("\n"),
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.cronAddArgs.length, 0);
  assert.match(result.stderr, /OpenClaw origin session routing could not list sessions\./);
});

test("printed confirmation command stays self-contained across a fresh shell", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-confirm-command-"));
  const agentDir = join(root, "agent root");
  const helperPath = join(agentDir, "builder-library-cron-install.sh");
  const contractPath = join(
    agentDir,
    "tmp",
    "accounts",
    "openclaw_example_com_deadbeef",
    "library-cron-direct",
    "resume-contract-11111111-1111-4111-8111-111111111111.json",
  );
  const resultPath = join(root, "helper-result.json");

  mkdirSync(dirname(contractPath), { recursive: true });
  writeFileSync(contractPath, '{"version":1}\n', "utf8");
  writeFileSync(
    helperPath,
    `#!/bin/sh
set -eu
[ "\${FOLLOWBRIEF_CONFIRM_PARTIAL:-}" = "1" ]
[ "\${BUILDER_BLOG_AGENT_DIR:-}" = "${agentDir}" ]
[ "$0" = "${helperPath}" ]
[ "$1" = "--contract" ]
[ "$2" = "${contractPath}" ]
printf '{"agentDir":"%s","helper":"%s","flag":"%s","arg1":"%s","arg2":"%s"}\\n' "$BUILDER_BLOG_AGENT_DIR" "$0" "$FOLLOWBRIEF_CONFIRM_PARTIAL" "$1" "$2" > "${resultPath}"
`,
    "utf8",
  );
  chmodSync(helperPath, 0o755);

  const command = `FOLLOWBRIEF_CONFIRM_PARTIAL=1 BUILDER_BLOG_AGENT_DIR="${agentDir}" "${helperPath}" --contract "${contractPath}"`;
  const env = { ...process.env };
  delete env.BUILDER_BLOG_AGENT_DIR;

  const result = spawnSync("sh", ["-c", command], { encoding: "utf8", env });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(resultPath, "utf8")), {
    agentDir,
    helper: helperPath,
    flag: "1",
    arg1: "--contract",
    arg2: contractPath,
  });
});

test("route GET delegates cloud-library-host rendering and preserves markdown headers", async () => {
  const request = new Request(
    "https://followbrief.example/api/skill/jobs/cloud-library-host/skill.md?runtime=openclaw&days=9&parallel=4&postLimit=7",
  );
  const response = await getSkillJobPromptRoute(request, "cloud-library-host");

  const content = await response.text();
  const rendered = await renderWithDefaults({
    job: "cloud-library-host",
    options: {
      runtime: "openclaw",
      fetchDays: 9,
      parallelWorkers: 4,
      fetchLimit: 7,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(content, rendered);
});

test("route GET delegates OpenClaw child setup rendering for DB-free cron setup requests", async () => {
  const request = new Request(
    "https://followbrief.example/api/skill/jobs/library-cron-setup/skill.md?openclaw_setup_child=1&setup_account=openclaw%40example.com&runtime=openclaw&freq=weekly&force=1&days=11&parallel=3&postLimit=4",
  );
  const response = await getSkillJobPromptRoute(request, "library-cron-setup");

  const content = await response.text();
  const rendered = await renderWithDefaults({
    job: "library-cron-setup",
    options: {
      runtime: "openclaw",
      frequency: "weekly",
      force: true,
      fetchDays: 11,
      parallelWorkers: 3,
      fetchLimit: 4,
    },
    openClawChild: {
      accountEmail: "openclaw@example.com",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(content, rendered);
});

test("route GET rejects a removed Hermes runtime instead of rendering an unpinned prompt", async () => {
  const request = new Request(
    "https://followbrief.example/api/skill/jobs/library-once/skill.md?runtime=hermes",
  );
  const response = await getSkillJobPromptRoute(request, "library-once");

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Runtime invalid" });
});
