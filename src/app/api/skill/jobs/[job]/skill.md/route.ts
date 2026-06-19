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
  const label = job.startsWith("digest") ? "AI Digest" : "Fetch sources";
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
  const runtimeAllowed = new Set(["claude", "codex", "gemini", "openclaw"]);
  const runtime = runtimeRaw && runtimeAllowed.has(runtimeRaw) ? runtimeRaw : null;
  const runtimeLabels: Record<string, string> = {
    claude: "Claude Code",
    codex: "Codex",
    gemini: "Gemini CLI",
    openclaw: "OpenClaw",
  };

  // Cron cadence for cron-setup prompts. Whitelisted key → fixed cron
  // expression so the schedule that lands in the generated crontab printf
  // can never carry arbitrary/injected text. Defaults to every 6 hours
  // (the prior hard-coded behavior) when absent or unrecognized — so old
  // copied prompts and the no-freq case keep working.
  const cronSchedules: Record<string, { schedule: string; label: string }> = {
    "30m": { schedule: "*/30 * * * *", label: "every 30 minutes" },
    "1h": { schedule: "0 * * * *", label: "every hour" },
    "12h": { schedule: "0 */12 * * *", label: "every 12 hours" },
    daily: { schedule: "0 8 * * *", label: "once a day at 08:00" },
    weekly: { schedule: "0 8 * * 1", label: "once a week (Monday 08:00)" },
    // Legacy keys kept so any previously-copied ?freq= link still resolves.
    "3h": { schedule: "0 */3 * * *", label: "every 3 hours" },
    "6h": { schedule: "0 */6 * * *", label: "every 6 hours" },
  };
  const cronIntervalMinutes: Record<string, string> = {
    "30m": "30",
    "1h": "60",
    "12h": "720",
    daily: "1440",
    weekly: "10080",
    "3h": "180",
    "6h": "360",
  };
  // Default cadence matches each job's prior hard-coded schedule, so old
  // copied prompts (no freq param) are unchanged: digest = daily, the
  // fetch/library job = every 6 hours.
  const defaultFreq = job.startsWith("digest") ? "daily" : "6h";
  const freqRaw = url.searchParams.get("freq");
  const freq = freqRaw && cronSchedules[freqRaw] ? freqRaw : defaultFreq;
  const cronInterval = cronIntervalMinutes[freq] ?? "360";
  const cronIntervalSeconds = String(Number(cronInterval) * 60);
  const cronTimeoutSeconds = localAgentTimeoutSeconds(cronInterval, job);
  // macOS uses a launchd LaunchAgent (runs in the user's login session, so
  // the agent CLI can reach the login keychain — plain cron cannot). Run a
  // short scheduler tick every minute; the runner anchors real jobs to
  // schedule-anchor-* + N * interval so long workers cannot drift the cadence.
  const launchdSchedule = `  <key>StartInterval</key>\n  <integer>60</integer>`;

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
  const daysRaw = Number(url.searchParams.get("days") ?? "30");
  const fetchDays =
    Number.isFinite(daysRaw) && daysRaw >= 1
      ? String(Math.min(90, Math.floor(daysRaw)))
      : "30";

  // Library worker fan-out. Closed numeric range; absent/invalid keeps the
  // conservative single-agent behavior so old copied prompts do not change.
  const parallelRaw = Number(url.searchParams.get("parallel") ?? "1");
  const parallelWorkers =
    job.startsWith("library") &&
    Number.isFinite(parallelRaw) &&
    Number.isInteger(parallelRaw) &&
    parallelRaw >= 1
      ? String(Math.min(8, Math.floor(parallelRaw)))
      : "1";

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
    .replaceAll("{{CRON_SCHEDULE}}", cronSchedules[freq].schedule)
    .replaceAll("{{CRON_FREQUENCY_LABEL}}", cronSchedules[freq].label)
    .replaceAll("{{CRON_INTERVAL_MINUTES}}", cronInterval)
    .replaceAll("{{CRON_INTERVAL_SECONDS}}", cronIntervalSeconds)
    .replaceAll("{{CRON_TIMEOUT_SECONDS}}", cronTimeoutSeconds)
    .replaceAll("{{LAUNCHD_SCHEDULE}}", launchdSchedule)
    .replaceAll("{{FETCH_FORCE}}", fetchForce ? "1" : "0")
    .replaceAll("{{FETCH_FLAG}}", fetchForce ? "--force" : "")
    .replaceAll("{{FETCH_DAYS}}", fetchDays)
    .replaceAll("{{PARALLEL_WORKERS}}", parallelWorkers)
    // Digest analogue of the fetch force flag. The digest job never fetches —
    // here `force=1` means "re-generate today's digest" (re-cover the full
    // window + replace today's existing digest). Two placeholders mirror the
    // fetch pair: {{DIGEST_REGENERATE_FLAG}} (--regenerate / "") is baked into
    // the digest-once command; {{DIGEST_REGENERATE}} (1/0) is pinned to disk by
    // digest-cron-setup and read back by the runner for the recurring run.
    .replaceAll("{{DIGEST_REGENERATE}}", fetchForce ? "1" : "0")
    .replaceAll("{{DIGEST_REGENERATE_FLAG}}", fetchForce ? "--regenerate" : "");

  let credentialPrep = "";
  if (ecParam) {
    // Validate the exchange code: must exist, not expired, not yet used.
    // Do NOT mark usedAt here — only the CLI exchange endpoint marks it.
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

    const email = record.agentToken.user.email ?? "";

    // Tell the agent up front which sources need an API token, based on this
    // account's actual source types — so prep happens before the initial setup run
    // instead of only when it surfaces an *_token_missing notice.
    if (content.includes("{{SOURCE_CREDENTIAL_PREP}}")) {
      credentialPrep = await buildSourceCredentialPrep(record.agentToken.user.id);
    }

    if (job === "library-cron-setup" || job === "digest-cron-setup") {
      const serverActiveCron = job === "library-cron-setup"
        ? await prisma.libraryCronJob.findUnique({
            where: { userId: record.agentToken.user.id },
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
            where: { userId: record.agentToken.user.id },
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
    // run and the plist do not. codex/gemini run each command in a fresh
    // shell, so an un-exported `${BUILDER_BLOG_ACCOUNT}` is empty there and the
    // run dies with "No agent token". Since the exchange code already
    // identifies the account, substitute it so setup never relies on shell env.
    if (email) {
      content = content.replaceAll("${BUILDER_BLOG_ACCOUNT}", email);
    }

    // 1. Prepend the exchange step as an explicitly numbered step. The setup
    // prompts tell agents to run numbered steps exactly; leaving exchange as an
    // unnumbered preface lets some agents skip it and install an unauthenticated
    // schedule.
    const exchangeBlock = [
      "0. Exchange the one-time setup code for an agent token before step 1.",
      "This writes to",
      `\`~/.builder-blog/accounts/${email}.json\`. The code is used once and expires.`,
      "If this command fails, stop and report the command, exit code, and stderr.\n",
      "```bash",
      `mkdir -p "\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/accounts"`,
      `node "\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" exchange --ec "${ecParam}"`,
      "```\n",
    ].join("\n");

    // Insert before the first heading or content
    content = exchangeBlock + "\n" + content;

    // 2. Rewrite every bash block: replace any placeholder
    //    `BUILDER_BLOG_ACCOUNT="..." \` line that precedes a
    //    `node ... builder-digest.mjs ...` command with the resolved
    //    email, or prepend one when the command stands alone. Preserve
    //    indentation so nested stop/setup cleanup commands also receive
    //    the account instead of failing with "No agent token".
    const accountEnv = `BUILDER_BLOG_ACCOUNT="${email}"`;
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
