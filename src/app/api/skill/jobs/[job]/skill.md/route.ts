import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { jobSkillFiles } from "@/lib/skill-job-files";
import { expandSkillIncludes } from "@/lib/skill-includes";
import { localAgentTimeoutSeconds } from "@/lib/local-agent-timeouts";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ job: string }> };

type ExistingCronRecord = {
  status: string;
  startedAt: Date;
  frequencyLabel: string;
  runtime: string | null;
  hostname: string | null;
  updatedAt: Date;
};

function safePromptText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[`|\r\n]/g, " ")
    .trim();
}

function buildExistingCronWarning(job: string, serverActiveCron: ExistingCronRecord | null): string {
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

function boundedIntegerParam(
  searchParams: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): string {
  const raw = Number(searchParams.get(name) ?? String(fallback));
  if (!Number.isFinite(raw)) return String(fallback);
  return String(Math.min(max, Math.max(min, Math.floor(raw))));
}

function withOpenClawSetupChildParams(rawUrl: string, email: string): string {
  const nextUrl = new URL(rawUrl);
  nextUrl.searchParams.delete("ec");
  nextUrl.searchParams.set("openclaw_setup_child", "1");
  nextUrl.searchParams.set("setup_account", email);
  return nextUrl.toString();
}

function buildOpenClawInitialRunBootstrap({
  email,
  job,
  childSetupPromptUrl,
  setupTimeoutSeconds,
}: {
  email: string;
  job: string;
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

function setupInitialRunMarker(job: string): string {
  if (job === "library-cron-setup") return "6. Run one real initial fetch job now.";
  if (job === "digest-cron-setup") return "6. Run one real initial brief job now.";
  return "";
}

function adaptSetupContinuationForUnattendedChild(job: string, childBody: string): string {
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

function sliceSetupPromptForOpenClawChild(job: string, content: string): string {
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
  job: string,
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
  return content.replace(installStep, `$1\n${exchangeBlock}\n`);
}

// Source-type-aware credential prep for the library cron setup prompt. The web
// copy-prompt flow resolves the account from the exchange code, so we can tell
// the agent up front which sources need a local API token in secrets.json —
// instead of only finding out when the initial setup run surfaces an
// *_token_missing notice. Read-only; returns "" when no credentialed sources.
const SOURCE_CREDENTIAL_SPECS: {
  kinds: string[];
  envKey: string;
  label: string;
  help: string;
}[] = [
  {
    kinds: ["X"],
    envKey: "X_BEARER_TOKEN",
    label: "X (Twitter)",
    help: "free read-only tier at https://developer.x.com/en/portal/dashboard",
  },
];

async function buildSourceCredentialPrep(userId: string): Promise<string> {
  const entries = await prisma.builderPoolEntry.findMany({
    where: { userId, removedAt: null },
    select: { builder: { select: { kind: true } } },
  });
  const kinds = new Set<string>();
  for (const entry of entries) {
    if (entry.builder?.kind) kinds.add(entry.builder.kind);
  }
  const needed = SOURCE_CREDENTIAL_SPECS.filter((spec) =>
    spec.kinds.some((kind) => kinds.has(kind)),
  );
  if (needed.length === 0) return "";

  // This runs on the user's machine (the server can't see their secrets.json):
  // checkJs reports present/missing with the same lookup as the runner — env,
  // then the single top-level token (one app-scoped X token serves the whole
  // host) — so we never re-ask for an already-configured token.
  const checkJs =
    'const fs=require("fs");const k=process.env.KEY,p=process.env.SECRETS;' +
    'let ok=Boolean((process.env[k]||"").trim());' +
    'if(!ok){let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}' +
    'ok=Boolean(d[k]&&String(d[k]).trim())}' +
    'console.log(k+": "+(ok?"present, already configured. Skip.":"missing, ask the user"))';
  const writeJs =
    'const fs=require("fs");const[p,k,v]=process.argv.slice(1);let d={};' +
    'try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d[k]=v;fs.writeFileSync(p,JSON.stringify(d,null,2))';

  const blocks = needed
    .map((spec) =>
      [
        `- **${spec.label}** source(s) present → needs \`${spec.envKey}\` (${spec.help}).`,
        "  Check whether it is already on this machine; only ask the user if missing:",
        "",
        "  ```bash",
        `  SECRETS="\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/secrets.json"`,
        `  KEY=${spec.envKey} SECRETS="$SECRETS" node -e '${checkJs}'`,
        "  ```",
        "",
        "  If `present`, skip. If `missing`, ask the user for the token and store",
        "  it (preserves other keys):",
        "",
        "  ```bash",
        `  node -e '${writeJs}' "$SECRETS" ${spec.envKey} "PASTE_${spec.envKey}"`,
        '  chmod 600 "$SECRETS"',
        "  ```",
        "",
        "  Asking is optional. If the user declines or has no token yet, do NOT",
        `  block. Continue the setup. The ${spec.label} source(s) will simply be`,
        '  skipped (they surface as "Action needed") until a token is added later.',
      ].join("\n"),
    )
    .join("\n\n");

  return [
    "**Prepare source API credentials (before the initial run).** This account",
    "has sources that fetch through an authenticated API, so the bare cron",
    "environment needs their tokens in the local secrets file. For each one below,",
    "check first and only ask the user when the token is actually missing. Never",
    "re-ask for an already-configured token. Providing a token is optional and",
    "never blocks setup: a source with no token is just skipped, not an error.",
    "",
    blocks,
  ].join("\n");
}

export async function GET(request: Request, { params }: Params) {
  const { job } = await params;
  const path = jobSkillFiles[job as keyof typeof jobSkillFiles];
  if (!path) {
    return NextResponse.json({ error: "Skill job not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const ecParam = url.searchParams.get("ec");
  const openClawSetupChild = url.searchParams.get("openclaw_setup_child") === "1";
  const setupAccountParam = url.searchParams.get("setup_account");

  // Reject any ec value that doesn't match the exchange-code format so it
  // can never carry shell metacharacters into the generated bash block.
  if (ecParam && !/^bb_ec_[A-Za-z0-9_-]{8,256}$/.test(ecParam)) {
    return NextResponse.json(
      { error: "Exchange code invalid" },
      { status: 400 },
    );
  }

  // Runtime hint for cron-setup prompts: which agent will execute the
  // scheduled job. We pin it server-side instead of letting the
  // discovery chain pick whatever's first on PATH, so the unattended
  // permission flags can be exact for that runtime. Whitelisted to a
  // closed set so no shell metacharacters slip into the rendered md.
  const runtimeRaw = url.searchParams.get("runtime");
  const runtimeAllowed = new Set(["claude", "codex", "hermes", "openclaw"]);
  const runtime = runtimeRaw && runtimeAllowed.has(runtimeRaw) ? runtimeRaw : null;
  const runtimeLabels: Record<string, string> = {
    claude: "Claude Code",
    codex: "Codex",
    hermes: "Hermes",
    openclaw: "OpenClaw",
  };

  // Cron cadence for cron-setup prompts. Whitelisted key → fixed interval
  // metadata; the concrete cron/launchd schedule is generated on the user's
  // machine from the install-time anchor after validation succeeds.
  const cronFrequencies: Record<string, { label: string }> = {
    daily: { label: "every day" },
    weekly: { label: "every week" },
  };
  const cronIntervalMinutes: Record<string, string> = {
    daily: "1440",
    weekly: "10080",
  };
  // The concrete clock time is generated from the post-validation install
  // anchor. One-time runs are handled by the non-cron prompt branch.
  const defaultFreq = "daily";
  const freqRaw = url.searchParams.get("freq");
  const freq = freqRaw && cronFrequencies[freqRaw] ? freqRaw : defaultFreq;
  const cronInterval = cronIntervalMinutes[freq] ?? "1440";
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
  // Forced re-fetch toggle. "1" → re-fetch posts already in the library
  // (ignore the fetchedAt cutoff + externalId dedup). Default off. Closed
  // value set → no injection into the rendered md. Two placeholders:
  //  - {{FETCH_FORCE}} (0/1) is pinned to disk by library-cron-setup; the
  //    runner turns 1 into --force for the recurring run.
  //  - {{FETCH_FLAG}} (--force / "") is baked straight into the library-once
  //    command, which the user pastes to the agent directly (no runner).
  const fetchForce = url.searchParams.get("force") === "1";

  // Library fetch lookback window. Closed numeric range so a copied prompt can
  // only bake a bounded day count into shell commands and cron pins.
  const fetchDays = boundedIntegerParam(url.searchParams, "days", 30, 1, 90);

  // Local worker fan-out. Closed numeric range; absent/invalid uses the
  // current UI default.
  const isLibraryJob = job.startsWith("library") || job.startsWith("cloud-library");
  const isDigestJob = job.startsWith("digest");
  const parallelDefault = 10;
  const parallelMax = 20;
  const parallelRaw = Number(url.searchParams.get("parallel") ?? String(parallelDefault));
  const parallelWorkers =
    (isLibraryJob || isDigestJob) &&
    Number.isFinite(parallelRaw) &&
    Number.isInteger(parallelRaw) &&
    parallelRaw >= 1
      ? String(Math.min(parallelMax, Math.floor(parallelRaw)))
      : String(parallelDefault);

  // Cloud source fetch run knobs. These affect only the local admin runner:
  // how many posts it plans per leased source and how much local fan-out it permits.
  // Source lease request sizes are runner-owned.
  const fetchLimit = boundedIntegerParam(url.searchParams, "postLimit", 3, 1, 20);

  let content = await readFile(join(process.cwd(), path), "utf8");
  // Expand {{INCLUDE:...}} directives (shared fetch-task contract) before
  // the exchange-code / runtime substitutions below.
  content = await expandSkillIncludes(content);

  // Substitute runtime placeholders. Markdown that doesn't use them
  // is unaffected; cron-setup prompts use `{{AGENT_RUNTIME}}` and
  // `{{AGENT_RUNTIME_LABEL}}` to print the choice and write it to
  // ~/.builder-blog/runtime so the runner picks the right unattended
  // invocation. When no runtime is pinned we keep the placeholders as
  // empty strings — the runner falls back to its discovery chain.
  content = content
    .replaceAll("{{AGENT_RUNTIME}}", runtime ?? "")
    .replaceAll("{{AGENT_RUNTIME_LABEL}}", runtime ? runtimeLabels[runtime] : "your Local Agent")
    .replaceAll("{{CRON_FREQUENCY_KEY}}", freq)
    .replaceAll("{{CRON_FREQUENCY_LABEL}}", cronFrequencies[freq].label)
    .replaceAll("{{CRON_INTERVAL_MINUTES}}", cronInterval)
    .replaceAll("{{CRON_INTERVAL_SECONDS}}", cronIntervalSeconds)
    .replaceAll("{{CRON_TIMEOUT_SECONDS}}", cronTimeoutSeconds)
    .replaceAll("{{FETCH_FORCE}}", fetchForce ? "1" : "0")
    .replaceAll("{{FETCH_FLAG}}", fetchForce ? "--force" : "")
    .replaceAll("{{FETCH_DAYS}}", fetchDays)
    .replaceAll("{{PARALLEL_WORKERS}}", parallelWorkers)
    .replaceAll("{{FETCH_LIMIT}}", fetchLimit)
    // Digest analogue of the fetch force flag. The digest job never fetches —
    // here `force=1` means "re-generate today's digest" (re-cover the full
    // window + replace today's existing digest). Two placeholders mirror the
    // fetch pair: {{DIGEST_REGENERATE_FLAG}} (--regenerate / "") is baked into
    // the digest-once command; {{DIGEST_REGENERATE}} (1/0) is pinned to disk by
    // digest-cron-setup and read back by the runner for the recurring run.
    .replaceAll("{{DIGEST_REGENERATE}}", fetchForce ? "1" : "0")
    .replaceAll("{{DIGEST_REGENERATE_FLAG}}", fetchForce ? "--regenerate" : "");

  const isCronSetupJob = job === "library-cron-setup" || job === "digest-cron-setup";
  let credentialPrep = "";
  let accountEmail = "";
  let accountUserId: string | null = null;
  if (ecParam) {
    // Validate the exchange code while rendering the user-facing setup prompt.
    // The exchange endpoint deletes this row after successful exchange, so the
    // queued OpenClaw child prompt must not depend on this code being reusable.
    const record = await prisma.exchangeCode.findUnique({
      where: { code: ecParam },
      include: {
        agentToken: {
          include: { user: { select: { email: true, id: true } } },
        },
      },
    });

    if (!record || record.expiresAt < new Date()) {
      return NextResponse.json({ error: "Exchange code invalid or expired" }, { status: 403 });
    }

    accountEmail = record.agentToken.user.email ?? "";
    accountUserId = record.agentToken.user.id;
  } else if (openClawSetupChild && isCronSetupJob) {
    if (!setupAccountParam || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(setupAccountParam)) {
      return NextResponse.json({ error: "Setup account missing or invalid" }, { status: 400 });
    }
    accountEmail = setupAccountParam;
  }

  if (accountEmail) {
    // Tell the agent up front which sources need an API token, based on this
    // account's actual source types — so prep happens before the initial setup run
    // instead of only when it surfaces an *_token_missing notice.
    if (accountUserId && content.includes("{{SOURCE_CREDENTIAL_PREP}}")) {
      credentialPrep = await buildSourceCredentialPrep(accountUserId);
    }

    if (accountUserId && isCronSetupJob) {
      const serverActiveCron = job === "library-cron-setup"
        ? await prisma.libraryCronJob.findUnique({
            where: { userId: accountUserId },
            select: {
              status: true,
              startedAt: true,
              frequencyLabel: true,
              runtime: true,
              hostname: true,
              updatedAt: true,
            },
          })
        : await prisma.digestCronJob.findUnique({
            where: { userId: accountUserId },
            select: {
              status: true,
              startedAt: true,
              frequencyLabel: true,
              runtime: true,
              hostname: true,
              updatedAt: true,
            },
          });
      const existingCronWarning = buildExistingCronWarning(job, serverActiveCron);
      if (existingCronWarning) {
        content = content.replace(
          "3. Before changing anything,",
          `${existingCronWarning}\n\n3. Before changing anything,`,
        );
      }
    }

    // Bake the resolved account into every `${BUILDER_BLOG_ACCOUNT}` in the
    // prompt. The cron-setup initial run and the launchd/crontab
    // account derive from this var, but only `node …builder-digest.mjs` lines
    // get an injected account below — the `builder-agent-runner.sh` initial
    // run and the plist do not. codex/hermes run each command in a fresh
    // shell, so an un-exported `${BUILDER_BLOG_ACCOUNT}` is empty there and the
    // run dies with "No agent token". Since the exchange code already
    // identifies the account, substitute it so setup never relies on shell env.
    content = content.replaceAll("${BUILDER_BLOG_ACCOUNT}", accountEmail);

    const openClawSetupBootstrap =
      runtime === "openclaw" &&
      !openClawSetupChild &&
      isCronSetupJob
        ? buildOpenClawInitialRunBootstrap({
            email: accountEmail,
            job,
            childSetupPromptUrl: withOpenClawSetupChildParams(request.url, accountEmail),
            setupTimeoutSeconds: openClawSetupTimeoutSeconds,
          })
        : "";

    // Insert the exchange step as an explicitly numbered sub-step immediately
    // after bootstrap. The setup prompts tell agents to run numbered steps
    // exactly; leaving exchange as an unnumbered preface lets some agents skip
    // it and install an unauthenticated schedule. It must come after bootstrap
    // so first-time machines have builder-digest.mjs before running exchange.
    const exchangeBlock = ecParam
      ? [
          "1a. Exchange the one-time setup code for an agent token after installing the skill.",
          "This writes to",
          `\`~/.builder-blog/accounts/${accountEmail}.json\`. The code is used once and expires.`,
          "If this command fails, stop and report the command, exit code, and stderr.\n",
          "```bash",
          `mkdir -p "\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/accounts"`,
          `node "\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" exchange --ec "${ecParam}"`,
          "```\n",
        ].join("\n")
      : "";

    const contentWithExchange = exchangeBlock
      ? insertExchangeAfterInstallStep(content, exchangeBlock)
      : content;

    // For OpenClaw, keep bootstrap/token exchange/credential checks in the
    // visible parent prompt, then queue the initial run and schedule install as
    // a durable child job. The child prompt starts at the original step 6 so it
    // cannot spend the long-timeout job redoing setup work or consuming the
    // one-time exchange code.
    if (
      openClawSetupChild &&
      isCronSetupJob
    ) {
      content = sliceSetupPromptForOpenClawChild(job, contentWithExchange);
    } else {
      content = openClawSetupBootstrap
        ? sliceSetupPromptForOpenClawParent(job, contentWithExchange, openClawSetupBootstrap)
        : contentWithExchange;
    }

    // 2. Rewrite every bash block: replace any placeholder
    //    `BUILDER_BLOG_ACCOUNT="..." \` line that precedes a
    //    `node ... builder-digest.mjs ...` command with the resolved
    //    email, or prepend one when the command stands alone. Preserve
    //    indentation so nested stop/setup cleanup commands also receive
    //    the account instead of failing with "No agent token".
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

  content = content.replaceAll("{{SOURCE_CREDENTIAL_PREP}}", credentialPrep);

  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
