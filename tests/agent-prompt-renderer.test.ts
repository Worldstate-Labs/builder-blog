import assert from "node:assert/strict";
import test from "node:test";
import type { SkillJobName } from "../src/lib/skill-job-files";
import {
  buildOpenClawChildSetupUrl,
  renderAgentPrompt,
  type ExistingCronRecord,
  type NormalizedAgentPromptRenderOptions,
} from "../src/lib/agent-prompt-renderer";

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
    options: { runtime: "hermes", force: true, fetchDays: 14, parallelWorkers: 7 },
    exchange: {
      code: "bb_ec_renderer_library_once",
      accountEmail: "builder@example.com",
      accountUserId: "user_library_once",
    },
  });

  assert.match(content, /builder@example\.com/);
  assert.match(content, /BUILDER_BLOG_AGENT_RUNTIME="\$\{BUILDER_BLOG_AGENT_RUNTIME-hermes\}"/);
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
  assert.match(content, /run {{AGENT_RUNTIME}}|PATH="\$SCHEDULER_PATH" command -v codex/);
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

test("buildOpenClawChildSetupUrl creates a canonical child job URL from origin, job, normalized options, and account only", () => {
  const url = buildOpenClawChildSetupUrl({
    origin: "https://followbrief.example",
    job: "library-cron-setup",
    accountEmail: "queue@example.com",
    options: normalizedOptions({
      runtime: "openclaw",
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
  assert.match(parent, /FOLLOWBRIEF_OPENCLAW_QUEUED=1/);
  assert.doesNotMatch(parent, /Run this queued FollowBrief setup continuation/);

  assert.match(child, /^Run this queued FollowBrief setup continuation\./);
  assert.match(child, /This job is unattended\./);
  assert.match(child, /6\. Run one real initial fetch job now\./);
  assert.doesNotMatch(child, /1\. Install or refresh the skill:/);
  assert.doesNotMatch(child, /1a\. Exchange the one-time setup code/);
  assert.doesNotMatch(child, /bb_ec_renderer_openclaw_parent/);
});
