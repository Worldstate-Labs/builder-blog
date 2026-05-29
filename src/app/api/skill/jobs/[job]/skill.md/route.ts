import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { jobSkillFiles } from "@/lib/skill-job-files";
import { expandSkillIncludes } from "@/lib/skill-includes";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ job: string }> };

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
  // macOS uses a launchd LaunchAgent (runs in the user's login session, so
  // the agent CLI can reach the login keychain — plain cron cannot). One
  // XML fragment per cadence, dropped into the plist via {{LAUNCHD_SCHEDULE}}.
  const launchdSchedules: Record<string, string> = {
    "30m":
      "  <key>StartCalendarInterval</key>\n  <array>\n    <dict><key>Minute</key><integer>0</integer></dict>\n    <dict><key>Minute</key><integer>30</integer></dict>\n  </array>",
    "1h": "  <key>StartCalendarInterval</key>\n  <dict><key>Minute</key><integer>0</integer></dict>",
    "12h":
      "  <key>StartCalendarInterval</key>\n  <array>\n    <dict><key>Hour</key><integer>0</integer><key>Minute</key><integer>0</integer></dict>\n    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>\n  </array>",
    daily: "  <key>StartCalendarInterval</key>\n  <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>",
    weekly:
      "  <key>StartCalendarInterval</key>\n  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>",
    "3h": "  <key>StartInterval</key>\n  <integer>10800</integer>",
    "6h": "  <key>StartInterval</key>\n  <integer>21600</integer>",
  };

  // Default cadence matches each job's prior hard-coded schedule, so old
  // copied prompts (no freq param) are unchanged: digest = daily, the
  // fetch/library job = every 6 hours.
  const defaultFreq = job.startsWith("digest") ? "daily" : "6h";
  const freqRaw = url.searchParams.get("freq");
  const freq = freqRaw && cronSchedules[freqRaw] ? freqRaw : defaultFreq;

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
    .replaceAll("{{AGENT_RUNTIME_LABEL}}", runtime ? runtimeLabels[runtime] : "your local agent")
    .replaceAll("{{CRON_SCHEDULE}}", cronSchedules[freq].schedule)
    .replaceAll("{{CRON_FREQUENCY_LABEL}}", cronSchedules[freq].label)
    .replaceAll("{{LAUNCHD_SCHEDULE}}", launchdSchedules[freq] ?? launchdSchedules["6h"]);

  if (ecParam) {
    // Validate the exchange code: must exist, not expired, not yet used.
    // Do NOT mark usedAt here — only the CLI exchange endpoint marks it.
    const record = await prisma.exchangeCode.findUnique({
      where: { code: ecParam },
      include: {
        agentToken: {
          include: { user: { select: { email: true } } },
        },
      },
    });

    if (!record || record.expiresAt < new Date()) {
      return NextResponse.json({ error: "Exchange code invalid or expired" }, { status: 403 });
    }

    const email = record.agentToken.user.email ?? "";

    // 1. Prepend the exchange step as the very first bash block
    const exchangeBlock = [
      "Exchange the one-time setup code for an agent token (writes to",
      `\`~/.builder-blog/accounts/${email}.json\`). The code is used once and expires.\n`,
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
    //    email, or prepend one when the command stands alone. Replacing
    //    (not prepending) keeps the rendered block at one ACCOUNT= line
    //    per node call instead of stacking the placeholder and the
    //    resolved value on top of each other.
    const accountEnv = `BUILDER_BLOG_ACCOUNT="${email}"`;
    content = content.replace(/^```bash\n([\s\S]*?)^```/gm, (_match, blockBody) => {
      const rewritten = blockBody.replace(
        /(^|\n)(?:BUILDER_BLOG_ACCOUNT="[^"]*"\s*\\\n)?(node\s+[^\n]*builder-digest\.mjs[^\n]*)/gm,
        (_m: string, lineStart: string, nodeCmd: string) =>
          `${lineStart}${accountEnv} \\\n${nodeCmd}`,
      );
      return "```bash\n" + rewritten + "```";
    });
  }

  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
