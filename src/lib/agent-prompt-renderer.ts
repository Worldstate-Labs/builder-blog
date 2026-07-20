import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { localAgentTimeoutSeconds } from "./local-agent-timeouts";
import { expandSkillIncludes } from "./skill-includes";
import { jobSkillFiles, type SkillJobName } from "./skill-job-files";

export type AgentPromptRuntime = "claude" | "codex" | "hermes" | "openclaw";
export type AgentPromptFrequency = "1h" | "daily" | "weekly";

export type ExistingCronRecord = {
  status: string;
  startedAt: Date;
  frequencyLabel: string;
  runtime: string | null;
  hostname: string | null;
  updatedAt: Date;
};

export type NormalizedAgentPromptRenderOptions = {
  runtime: AgentPromptRuntime | null;
  frequency: AgentPromptFrequency;
  force: boolean;
  fetchDays: number;
  parallelWorkers: number;
  fetchLimit: number;
};

type ExchangeRenderContext = {
  code: string;
  accountEmail: string;
  accountUserId?: string | null;
};

type OpenClawChildRenderContext = {
  accountEmail: string;
};

type RenderAgentPromptArgs = {
  origin: string;
  job: SkillJobName;
  options: NormalizedAgentPromptRenderOptions;
  exchange?: ExchangeRenderContext;
  openClawChild?: OpenClawChildRenderContext;
};

type RenderAgentPromptDeps = {
  buildSourceCredentialPrep: (accountUserId: string) => Promise<string>;
  getExistingCronRecord: (input: {
    job: SkillJobName;
    accountUserId: string;
  }) => Promise<ExistingCronRecord | null>;
};

const runtimeLabels: Record<AgentPromptRuntime, string> = {
  claude: "Claude Code",
  codex: "Codex",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

const cronFrequencies: Record<AgentPromptFrequency, { label: string }> = {
  "1h": { label: "Hourly" },
  daily: { label: "Daily" },
  weekly: { label: "Weekly" },
};

const cronIntervalMinutes: Record<AgentPromptFrequency, string> = {
  "1h": "60",
  daily: "1440",
  weekly: "10080",
};

function safePromptText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[`|\r\n]/g, " ")
    .trim();
}

function buildExistingCronWarning(
  job: SkillJobName,
  serverActiveCron: ExistingCronRecord | null,
): string {
  if (!serverActiveCron || serverActiveCron.status !== "active") return "";
  const label = job.startsWith("digest") ? "AI Brief" : "Fetch sources";
  const runner = [serverActiveCron.runtime, serverActiveCron.hostname]
    .map(safePromptText)
    .filter(Boolean)
    .join(" · ");
  return [
    "**Existing active schedule recorded by FollowBrief.**",
    `FollowBrief web currently records an active ${label} schedule for this account.`,
    `- Frequency: ${safePromptText(serverActiveCron.frequencyLabel) || "unknown"}`,
    `- Started: ${serverActiveCron.startedAt.toISOString()}`,
    `- Runner: ${runner || "unknown"}`,
    "",
    "Treat this as an existing schedule even if this machine's local launchd/crontab",
    "check prints `(none found)`. STOP: report this server-side active schedule and",
    "ask the user whether to override. Only continue after the user explicitly",
    "confirms. If they decline, stop and change nothing.",
  ].join("\n");
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildOpenClawInitialRunBootstrap({
  email,
  job,
  childSetupPromptUrl,
  setupTimeoutSeconds,
}: {
  email: string;
  job: SkillJobName;
  childSetupPromptUrl: string;
  setupTimeoutSeconds: string;
}): string {
  return [
    "Next: Queue the OpenClaw initial run and schedule install.",
    "Run this block after the setup checks pass and before any manual schedule install. If it prints",
    "`FOLLOWBRIEF_OPENCLAW_QUEUED=1`, report the printed setup job name and stop.",
    "",
    "```bash",
    `OPENCLAW_CHILD_SETUP_PROMPT_URL=${shellSingleQuote(childSetupPromptUrl)}`,
    `OPENCLAW_SETUP_TIMEOUT_SECONDS=${shellSingleQuote(setupTimeoutSeconds)}`,
    `FOLLOWBRIEF_SETUP_JOB=${shellSingleQuote(job)}`,
    `ACCT=${shellSingleQuote(email)}`,
    "AGENT_DIR=\"${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}\"",
    "account_slug() {",
    "  node - \"${1:-default}\" <<'NODE'",
    "const { createHash } = require(\"node:crypto\");",
    "const account = String(process.argv[2] || \"default\");",
    "const base = account.replace(/[^a-zA-Z0-9]/g, \"_\").replace(/^_+|_+$/g, \"\").replace(/_+/g, \"_\") || \"default\";",
    "const hash = createHash(\"sha256\").update(account).digest(\"hex\").slice(0, 8);",
    "console.log(`${base}_${hash}`);",
    "NODE",
    "}",
    "ACCOUNT_SLUG=\"$(account_slug \"$ACCT\")\"",
    "SETUP_TMP_DIR=\"$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/$FOLLOWBRIEF_SETUP_JOB-openclaw\"",
    "mkdir -p \"$SETUP_TMP_DIR\" \"$AGENT_DIR/logs\"",
    "PROMPT_COPY=\"$SETUP_TMP_DIR/prompt.md\"",
    "CRON_ADD_OUTPUT=\"$SETUP_TMP_DIR/openclaw-cron-add-output.txt\"",
    "SETUP_ID=\"$(printf 'followbrief-%s-%s-%s' \"$ACCOUNT_SLUG\" \"$FOLLOWBRIEF_SETUP_JOB\" \"$(date -u +%Y%m%dT%H%M%SZ)\" | tr -c 'a-zA-Z0-9_.@+-' '_')\"",
    "RUN_AT=\"$(node -e 'console.log(new Date(Date.now()+30000).toISOString())')\"",
    "curl -fsSL \"$OPENCLAW_CHILD_SETUP_PROMPT_URL\" -o \"$PROMPT_COPY\"",
    "OPENCLAW_TIMEOUT_CURRENT=\"$(openclaw config get agents.defaults.timeoutSeconds 2>/dev/null || printf '0\\n')\"",
    "case \"$OPENCLAW_TIMEOUT_CURRENT\" in ''|*[!0-9]*) OPENCLAW_TIMEOUT_CURRENT=0 ;; esac",
    "if [ \"$OPENCLAW_TIMEOUT_CURRENT\" -lt \"$OPENCLAW_SETUP_TIMEOUT_SECONDS\" ]; then",
    "  openclaw config set agents.defaults.timeoutSeconds \"$OPENCLAW_SETUP_TIMEOUT_SECONDS\" --strict-json >/dev/null 2>&1 || true",
    "fi",
    "if ! openclaw cron add \\",
    "  --name \"$SETUP_ID\" \\",
    "  --at \"$RUN_AT\" \\",
    "  --delete-after-run \\",
    "  --agent \"${OPENCLAW_AGENT:-main}\" \\",
    "  --session isolated \\",
    "  --light-context \\",
    "  --timeout-seconds \"$OPENCLAW_SETUP_TIMEOUT_SECONDS\" \\",
    "  --announce \\",
    "  --best-effort-deliver \\",
    "  --message \"$(cat \"$PROMPT_COPY\")\" \\",
    "  --json > \"$CRON_ADD_OUTPUT\" 2>&1; then",
    "  echo \"OpenClaw durable setup job could not be queued.\" >&2",
    "  cat \"$CRON_ADD_OUTPUT\" >&2",
    "  exit 1",
    "fi",
    "cat \"$CRON_ADD_OUTPUT\"",
    "echo \"FOLLOWBRIEF_OPENCLAW_QUEUED=1 name=$SETUP_ID run_at=$RUN_AT prompt=$PROMPT_COPY\"",
    "exit 0",
    "```",
    "",
  ].join("\n");
}

function setupInitialRunMarker(job: SkillJobName): string {
  if (job === "library-cron-setup") return "6. Run one real initial fetch job now.";
  if (job === "digest-cron-setup") return "6. Run one real initial brief job now.";
  return "";
}

function adaptSetupContinuationForUnattendedChild(
  job: SkillJobName,
  childBody: string,
): string {
  if (job !== "library-cron-setup") return childBody;
  return childBody.replace(
    /If the gate prints `"status": "needs_confirmation"`[\s\S]*?install or report an active schedule\./,
    [
      "If the gate prints `\"status\": \"needs_confirmation\"`, list every failed post",
      "task with its title, source, failed stage (`read`, `summarize`, or `sync`),",
      "and reason. Then stop without installing the scheduled run. This child job is",
      "unattended and must not wait for confirmation.",
    ].join("\n"),
  );
}

function sliceSetupPromptForOpenClawChild(job: SkillJobName, content: string): string {
  const marker = setupInitialRunMarker(job);
  const markerIndex = marker ? content.indexOf(marker) : -1;
  const rawChildBody = markerIndex >= 0 ? content.slice(markerIndex).trimStart() : content.trimStart();
  const childBody = adaptSetupContinuationForUnattendedChild(job, rawChildBody);
  return [
    "Run this queued FollowBrief setup continuation.",
    "Start at the initial-run step below; numbering continues from the",
    "user-facing setup prompt.",
    "",
    "This job is unattended. If the initial run command fails, times out, or the",
    "validation gate reports failed post tasks, report the details and stop",
    "without installing the schedule.",
    "",
    childBody,
  ].join("\n");
}

function sliceSetupPromptForOpenClawParent(
  job: SkillJobName,
  content: string,
  initialRunBootstrap: string,
): string {
  const marker = setupInitialRunMarker(job);
  const markerIndex = marker ? content.indexOf(marker) : -1;
  const parentBody = markerIndex >= 0 ? content.slice(0, markerIndex).trimEnd() : content.trimEnd();
  return `${parentBody}\n\n${initialRunBootstrap}`;
}

function insertExchangeAfterInstallStep(content: string, exchangeBlock: string): string {
  const installStep =
    /(1\. Install or refresh the skill:[\s\S]*?^```[^\n]*\n[\s\S]*?^```\n)/m;
  if (!installStep.test(content)) {
    return `${exchangeBlock}\n${content}`;
  }
  return content.replace(installStep, "$1\n" + exchangeBlock + "\n");
}

export function buildOpenClawChildSetupUrl({
  origin,
  job,
  accountEmail,
  options,
}: {
  origin: string;
  job: SkillJobName;
  accountEmail: string;
  options: NormalizedAgentPromptRenderOptions;
}): string {
  const nextUrl = new URL(`/api/skill/jobs/${job}/skill.md`, origin);
  nextUrl.searchParams.set("openclaw_setup_child", "1");
  nextUrl.searchParams.set("setup_account", accountEmail);
  if (options.runtime) nextUrl.searchParams.set("runtime", options.runtime);
  nextUrl.searchParams.set("freq", options.frequency);
  nextUrl.searchParams.set("force", options.force ? "1" : "0");
  nextUrl.searchParams.set("days", String(options.fetchDays));
  nextUrl.searchParams.set("parallel", String(options.parallelWorkers));
  nextUrl.searchParams.set("postLimit", String(options.fetchLimit));
  return nextUrl.toString();
}

export async function renderAgentPrompt(
  { origin, job, options, exchange, openClawChild }: RenderAgentPromptArgs,
  { buildSourceCredentialPrep, getExistingCronRecord }: RenderAgentPromptDeps,
): Promise<string> {
  const cronInterval = cronIntervalMinutes[options.frequency] ?? "1440";
  const cronIntervalSeconds = String(Number(cronInterval) * 60);
  const cronTimeoutJob =
    job === "library-cron-setup"
      ? "library-cron"
      : job === "digest-cron-setup"
        ? "digest-cron"
        : job === "cloud-library-cron-setup"
          ? "cloud-library-cron"
          : job;
  const cronTimeoutSeconds = localAgentTimeoutSeconds(cronInterval, cronTimeoutJob);
  const cronTimeoutNumber = Number(cronTimeoutSeconds);
  const openClawSetupTimeoutSeconds = Number.isFinite(cronTimeoutNumber)
    ? String(cronTimeoutNumber + 600)
    : cronTimeoutSeconds;
  const isCronSetupJob = job === "library-cron-setup" || job === "digest-cron-setup";
  const accountEmail = exchange?.accountEmail ?? openClawChild?.accountEmail ?? "";
  const accountUserId = exchange?.accountUserId ?? null;

  let content = await readFile(join(process.cwd(), jobSkillFiles[job]), "utf8");
  content = await expandSkillIncludes(content);
  content = content
    .replaceAll("{{AGENT_RUNTIME}}", options.runtime ?? "")
    .replaceAll(
      "{{AGENT_RUNTIME_LABEL}}",
      options.runtime ? runtimeLabels[options.runtime] : "your Local Agent",
    )
    .replaceAll("{{CRON_FREQUENCY_KEY}}", options.frequency)
    .replaceAll("{{CRON_FREQUENCY_LABEL}}", cronFrequencies[options.frequency].label)
    .replaceAll("{{CRON_INTERVAL_MINUTES}}", cronInterval)
    .replaceAll("{{CRON_INTERVAL_SECONDS}}", cronIntervalSeconds)
    .replaceAll("{{CRON_TIMEOUT_SECONDS}}", cronTimeoutSeconds)
    .replaceAll("{{FETCH_FORCE}}", options.force ? "1" : "0")
    .replaceAll("{{FETCH_FLAG}}", options.force ? "--force" : "")
    .replaceAll("{{FETCH_DAYS}}", String(options.fetchDays))
    .replaceAll("{{PARALLEL_WORKERS}}", String(options.parallelWorkers))
    .replaceAll("{{FETCH_LIMIT}}", String(options.fetchLimit))
    .replaceAll("{{DIGEST_REGENERATE}}", options.force ? "1" : "0")
    .replaceAll("{{DIGEST_REGENERATE_FLAG}}", options.force ? "--regenerate" : "");

  let credentialPrep = "";
  if (accountEmail) {
    if (accountUserId && content.includes("{{SOURCE_CREDENTIAL_PREP}}")) {
      credentialPrep = await buildSourceCredentialPrep(accountUserId);
    }

    if (accountUserId && isCronSetupJob) {
      const serverActiveCron = await getExistingCronRecord({ job, accountUserId });
      const existingCronWarning = buildExistingCronWarning(job, serverActiveCron);
      if (existingCronWarning) {
        content = content.replace(
          "3. Before changing anything,",
          `${existingCronWarning}\n\n3. Before changing anything,`,
        );
      }
    }

    content = content.replaceAll("${BUILDER_BLOG_ACCOUNT}", accountEmail);

    const openClawSetupBootstrap =
      options.runtime === "openclaw" && !openClawChild && isCronSetupJob
        ? buildOpenClawInitialRunBootstrap({
            email: accountEmail,
            job,
            childSetupPromptUrl: buildOpenClawChildSetupUrl({
              origin,
              job,
              accountEmail,
              options,
            }),
            setupTimeoutSeconds: openClawSetupTimeoutSeconds,
          })
        : "";

    const exchangeBlock = exchange
      ? [
          "1a. Exchange the one-time setup code for an agent token after installing the skill.",
          "This writes to",
          `\`~/.builder-blog/accounts/${accountEmail}.json\`. The code is used once and expires.`,
          "If this command fails, stop and report the command, exit code, and stderr.\n",
          "```bash",
          'mkdir -p "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/accounts"',
          `node "\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" exchange --ec "${exchange.code}"`,
          "```\n",
        ].join("\n")
      : "";

    const contentWithExchange = exchangeBlock
      ? insertExchangeAfterInstallStep(content, exchangeBlock)
      : content;

    if (openClawChild && isCronSetupJob) {
      content = sliceSetupPromptForOpenClawChild(job, contentWithExchange);
    } else {
      content = openClawSetupBootstrap
        ? sliceSetupPromptForOpenClawParent(job, contentWithExchange, openClawSetupBootstrap)
        : contentWithExchange;
    }

    const accountEnv = `BUILDER_BLOG_ACCOUNT="${accountEmail}"`;
    content = content.replace(/^```bash\n([\s\S]*?)^```/gm, (_match, blockBody) => {
      const rewritten = blockBody.replace(
        /(^|\n)([ \t]*)(?:BUILDER_BLOG_ACCOUNT="[^"]*"\s*\\\n[ \t]*)?(node\s+[^\n]*builder-digest\.mjs[^\n]*)/gm,
        (_m: string, lineStart: string, indent: string, nodeCmd: string) =>
          `${lineStart}${indent}${accountEnv} \\\n${indent}${nodeCmd}`,
      );
      return "```bash\n" + rewritten + "```";
    });
  }

  return content.replaceAll("{{SOURCE_CREDENTIAL_PREP}}", credentialPrep);
}
