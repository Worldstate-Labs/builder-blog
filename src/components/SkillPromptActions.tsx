"use client";

import { useState } from "react";
import { CalendarClock, Check, Copy } from "lucide-react";

type SkillPromptContext = "library" | "digest";
type CopyTarget = "once" | "cron";

const PROMPT_CONFIG = {
  library: {
    title: "Build library",
    onceLabel: "Copy once prompt",
    cronLabel: "Copy cron prompt",
    oncePrompt: (origin: string) => `Build my Builder Blog private library once.

Execution contract:
- Run the commands exactly in order.
- Do not substitute another workflow.
- If any command fails, stop and report the command, exit code, and stderr.
- Do not use --force.
- Do not browse for extra context.
- Only use agent judgment if the CLI reports agentTasks or says a personal source needs local cookies, credentials, transcription, or custom tooling.
- For YouTube, description or title as content is not acceptable; they are auxiliary metadata only.

1. Install or refresh the skill:
/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"

2. Crawl and sync normal personal builder items, and save the full result:
BUILDER_BLOG_URL="${origin}" node $HOME/.builder-blog/builder-digest.mjs crawl-personal --days 30 --limit 3 > /tmp/builder-blog-crawl-result.json

3. Print the crawl result:
cat /tmp/builder-blog-crawl-result.json

If it contains a non-empty agentTasks array, this agent must complete those tasks with its own local capabilities, subscriptions, browser/cookie access, transcription tools, or model access. The content must meet each task's minimumContentQuality. Do not use title, description, or page metadata as the item body.

4. If you completed agentTasks, write a sync payload to /tmp/builder-blog-agent-sync.json. Every agent-produced item must include rawJson.agentTaskId, rawJson.agentRuntime, rawJson.agentModel if known, rawJson.agentCompletedAt, rawJson.agentExecutionProof, and for YouTube rawJson.transcriptSource="agent-transcript" unless a better primary transcript source is used. Then run these commands exactly:
BUILDER_BLOG_URL="${origin}" node $HOME/.builder-blog/builder-digest.mjs validate-agent-sync --tasks /tmp/builder-blog-crawl-result.json --file /tmp/builder-blog-agent-sync.json
BUILDER_BLOG_URL="${origin}" node $HOME/.builder-blog/builder-digest.mjs sync-builders --file /tmp/builder-blog-agent-sync.json

5. Report the crawl JSON plus any validate-agent-sync and sync-builders JSON. Success means status is ok, localErrors is empty, and agentTasks is empty or validate-agent-sync reports all tasks validated and sync-builders succeeds. Already-synced posts should remain skipped.`,
    cronPrompt: (origin: string) => `Set up the Builder Blog private library scheduled job.

Execution contract:
- Run the commands exactly in order.
- Do not substitute another workflow.
- If any command fails, stop and report the command, exit code, and stderr.
- Do not use --force.
- Do not browse for extra context.
- Only use agent judgment if the scheduled runner reports agentTasks or says a personal source needs local cookies, credentials, transcription, or custom tooling.
- For YouTube, description or title as content is not acceptable; they are auxiliary metadata only.

1. Install or refresh the skill:
/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"

2. Create required directories:
mkdir -p $HOME/.builder-blog/logs

3. First attempt the exact crontab install below. It removes any previous Builder Blog library job and installs one idempotent job that runs every 6 hours:
( crontab -l 2>/dev/null | grep -v 'builder-agent-runner.sh library-cron' ; echo '0 */6 * * * BUILDER_BLOG_URL="${origin}" $HOME/.builder-blog/builder-agent-runner.sh library-cron >> $HOME/.builder-blog/logs/library-cron.log 2>&1' ) | crontab -

4. Verify the installed schedule:
crontab -l | grep 'builder-agent-runner.sh library-cron'

5. Run one immediate smoke check:
BUILDER_BLOG_URL="${origin}" $HOME/.builder-blog/builder-agent-runner.sh library-cron

If the smoke check JSON contains a non-empty agentTasks array, the local agent runtime must complete and sync those tasks. The item body must be real primary content meeting minimumContentQuality, not a title, description, or page metadata. The agent-produced sync payload must pass validate-agent-sync before sync-builders is considered successful.

Only if crontab is unavailable or blocked, install the same command and cadence through launchd or the local agent scheduler:
0 */6 * * * BUILDER_BLOG_URL="${origin}" $HOME/.builder-blog/builder-agent-runner.sh library-cron >> $HOME/.builder-blog/logs/library-cron.log 2>&1

The runner selection order is:
1. BUILDER_BLOG_AGENT_COMMAND, if the user configured one
2. Codex CLI
3. Claude Code CLI
4. OpenClaw CLI
5. Gemini CLI
6. Non-AI library crawl fallback for simple supported sources only

Do not duplicate an existing Builder Blog private library job.`,
  },
  digest: {
    title: "Build digest feed",
    onceLabel: "Copy once prompt",
    cronLabel: "Copy cron prompt",
    oncePrompt: (origin: string) => `Build my Builder Blog subscription digest feed once.

Execution contract:
- Run the commands exactly in order.
- Do not substitute another workflow.
- If any command fails, stop and report the command, exit code, and stderr.
- Do not browse for extra context.
- Only use agent judgment to write the digest body from the returned JSON items.

1. Install or refresh the skill:
/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"

2. Fetch the digest context and save it:
BUILDER_BLOG_URL="${origin}" node $HOME/.builder-blog/builder-digest.mjs prepare --days 1 > /tmp/builder-blog-context.json

3. Read /tmp/builder-blog-context.json. Write a concise Chinese digest using only context.items, include source URLs, and save it to /tmp/builder-blog-digest.md. If there are no items, write a short Chinese digest saying there were no new subscription updates.

4. Sync the digest:
BUILDER_BLOG_URL="${origin}" node $HOME/.builder-blog/builder-digest.mjs sync --file /tmp/builder-blog-digest.md --title "AI Builder Digest"`,
    cronPrompt: (origin: string) => `Set up the Builder Blog subscription digest scheduled job.

Execution contract:
- Run the commands exactly in order.
- Do not substitute another workflow.
- If any command fails, stop and report the command, exit code, and stderr.
- Do not browse for extra context.
- Only use agent judgment to write the digest body from the Builder Blog context items.

1. Install or refresh the skill:
/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"

2. Create required directories:
mkdir -p $HOME/.builder-blog/logs

3. First attempt the exact crontab install below. It removes any previous Builder Blog digest job and installs one idempotent job that runs daily at 8:00 local time:
( crontab -l 2>/dev/null | grep -v 'builder-agent-runner.sh digest-cron' ; echo '0 8 * * * BUILDER_BLOG_URL="${origin}" $HOME/.builder-blog/builder-agent-runner.sh digest-cron >> $HOME/.builder-blog/logs/digest-cron.log 2>&1' ) | crontab -

4. Verify the installed schedule:
crontab -l | grep 'builder-agent-runner.sh digest-cron'

5. Run one immediate smoke check:
BUILDER_BLOG_URL="${origin}" $HOME/.builder-blog/builder-agent-runner.sh digest-cron

Only if crontab is unavailable or blocked, install the same command and cadence through launchd or the local agent scheduler:
0 8 * * * BUILDER_BLOG_URL="${origin}" $HOME/.builder-blog/builder-agent-runner.sh digest-cron >> $HOME/.builder-blog/logs/digest-cron.log 2>&1

The runner selection order is:
1. BUILDER_BLOG_AGENT_COMMAND, if the user configured one
2. Codex CLI
3. Claude Code CLI
4. OpenClaw CLI
5. Gemini CLI

If no local agent runtime is available, do not claim the digest cron is installed successfully. Record that the user must install/configure an agent or set BUILDER_BLOG_AGENT_COMMAND. Do not duplicate an existing Builder Blog digest feed job.`,
  },
} satisfies Record<
  SkillPromptContext,
  {
    title: string;
    onceLabel: string;
    cronLabel: string;
    oncePrompt: (origin: string) => string;
    cronPrompt: (origin: string) => string;
  }
>;

export function SkillPromptActions({ context }: { context: SkillPromptContext }) {
  const config = PROMPT_CONFIG[context];
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [status, setStatus] = useState("");

  async function copyPrompt(target: CopyTarget) {
    setStatus("");
    const origin = window.location.origin;
    const prompt = target === "once" ? config.oncePrompt(origin) : config.cronPrompt(origin);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget(null), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy prompt");
    }
  }

  return (
    <div className="skill-prompt-actions">
      <div className="min-w-0">
        <p className="section-label">{config.title}</p>
      </div>
      <div className="skill-prompt-buttons">
        <button
          className="button-light button-compact gap-2"
          onClick={() => copyPrompt("once")}
          type="button"
        >
          {copiedTarget === "once" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiedTarget === "once" ? "Copied" : config.onceLabel}
        </button>
        <button
          className="button-light button-compact gap-2"
          onClick={() => copyPrompt("cron")}
          type="button"
        >
          {copiedTarget === "cron" ? (
            <Check className="h-4 w-4" />
          ) : (
            <CalendarClock className="h-4 w-4" />
          )}
          {copiedTarget === "cron" ? "Copied" : config.cronLabel}
        </button>
      </div>
      <span aria-live="polite">
        {status ? <span className="status-chip status-chip-danger">{status}</span> : null}
      </span>
    </div>
  );
}
