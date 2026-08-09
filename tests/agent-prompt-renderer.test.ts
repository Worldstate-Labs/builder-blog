import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

const forceDeleteCommand = /(?:^|[;&|()\s])rm[ \t]+(?:--force|-[A-Za-z]*f[A-Za-z]*)(?=[ \t]|$)/m;

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

function runOpenClawQueuePreparationBlock(block: string) {
  const root = mkdtempSync(join(tmpdir(), "openclaw-queue-block-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });

  const promptUrl = dataTextUrl("Run this queued FollowBrief setup continuation.\n");
  const blockForExecution = block.replace(
    /^OPENCLAW_CHILD_SETUP_PROMPT_URL='[^']*'$/m,
    `OPENCLAW_CHILD_SETUP_PROMPT_URL=${shellSingleQuote(promptUrl)}`,
  );
  const env = {
    ...process.env,
    BUILDER_BLOG_AGENT_DIR: agentDir,
  };
  const result = spawnSync("bash", ["-eu", "-c", blockForExecution], {
    encoding: "utf8",
    env,
  });

  return {
    ...result,
    root,
    agentDir,
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
    for (const [blockIndex, block] of markdownShellBlocks(content).entries()) {
      assert.doesNotMatch(
        block,
        forceDeleteCommand,
        `${job} bash block ${blockIndex + 1} must not use force-delete syntax`,
      );
    }
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

  assert.match(parent, /Next: Queue the OpenClaw initial run and schedule install with OpenClaw/);
  assert.match(parent, /OPENCLAW_CHILD_SETUP_PROMPT_URL='https:\/\/followbrief\.example\/api\/skill\/jobs\/library-cron-setup\/skill\.md\?openclaw_setup_child=1&setup_account=openclaw%40example\.com&runtime=openclaw/);
  assert.match(parent, /AbortController/);
  assert.match(parent, /maxAttempts\s*=\s*4/);
  assert.match(parent, /error\?\.cause/);
  assert.doesNotMatch(parent, /curl -fsSL/);
  assert.match(parent, /built-in `cron` tool/);
  assert.match(parent, /"action": "add"/);
  assert.match(parent, /sessionTarget: "current"/);
  assert.match(parent, /kind: "agentTurn"/);
  assert.match(parent, /deleteAfterRun: true/);
  assert.match(parent, /bestEffort: true/);
  assert.match(parent, /OPENCLAW_CRON_JOB_JSON/);
  assert.match(parent, /FOLLOWBRIEF_OPENCLAW_CRON_JOB_READY=1/);
  assert.doesNotMatch(parent, /openclaw cron/);
  assert.doesNotMatch(parent, /OPENCLAW_CHANNEL_CONTEXT/);
  assert.doesNotMatch(parent, /openclaw sessions/);
  assert.doesNotMatch(parent, /OPENCLAW_PARENT_SESSION_KEY/);
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
  assert.match(
    setupBlock,
    /if ! rm -- "\$RESUME_CONTRACT_PATH" 2>\/dev\/null &&[\s\S]*\{ \[ -e "\$RESUME_CONTRACT_PATH" \] \|\| \[ -L "\$RESUME_CONTRACT_PATH" \]; \}; then[\s\S]*echo "Failed to remove file: \$RESUME_CONTRACT_PATH" >&2[\s\S]*exit 1[\s\S]*fi/,
  );
  assert.doesNotMatch(setupBlock, forceDeleteCommand);
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

});

test("rendered OpenClaw queue preparation emits an official current-session cron job", async () => {
  const parent = await renderWithDefaults({
    job: "library-cron-setup",
    options: { runtime: "openclaw", frequency: "daily", fetchDays: 11, parallelWorkers: 3 },
    exchange: {
      code: "bb_ec_renderer_openclaw_official_tool",
      accountEmail: "openclaw@example.com",
      accountUserId: "user_openclaw_official_tool",
    },
  });
  const queueBlock = extractBashBlock(parent, "OPENCLAW_CHILD_SETUP_PROMPT_URL");
  assert.doesNotMatch(queueBlock, /\bopenclaw\s+(?:cron|sessions|config)\b/i);
  const before = Date.now();
  const result = runOpenClawQueuePreparationBlock(queueBlock);
  const after = Date.now();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FOLLOWBRIEF_OPENCLAW_CRON_JOB_READY=1/);

  const jsonLine = result.stdout
    .trim()
    .split("\n")
    .find((line) => line.startsWith("OPENCLAW_CRON_JOB_JSON="));
  assert.ok(jsonLine, "preparation must print the exact cron job object");
  const job = JSON.parse(jsonLine.slice("OPENCLAW_CRON_JOB_JSON=".length));

  assert.match(job.name, /^followbrief-openclaw_example_com_[a-f0-9]{8}-library-cron-setup-/);
  assert.deepEqual(job.schedule, {
    kind: "at",
    at: job.schedule.at,
  });
  const scheduledAt = Date.parse(job.schedule.at);
  assert.ok(scheduledAt >= before + 29_000);
  assert.ok(scheduledAt <= after + 31_000);
  assert.equal(job.deleteAfterRun, true);
  assert.equal(job.sessionTarget, "current");
  assert.equal(job.payload.kind, "agentTurn");
  assert.equal(job.payload.timeoutSeconds, 7800);
  assert.match(job.payload.message, /Read and follow the instructions in /);
  assert.match(job.payload.message, /\/prompt\.md/);
  assert.deepEqual(job.delivery, {
    mode: "announce",
    bestEffort: true,
  });

  const promptPath = job.payload.message.match(/instructions in (.+?) exactly\./)?.[1];
  assert.ok(promptPath, "job payload must identify the downloaded child prompt");
  assert.equal(
    readFileSync(promptPath, "utf8"),
    "Run this queued FollowBrief setup continuation.\n",
  );
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
