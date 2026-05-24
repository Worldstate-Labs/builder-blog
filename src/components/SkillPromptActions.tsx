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
    oncePrompt: (origin: string) => `Use the Builder Blog skill to build my private library once.

If the skill is not installed or is out of date, run:
/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"

Then crawl and sync my personal builders:
BUILDER_BLOG_URL="${origin}" node ~/.builder-blog/builder-digest.mjs crawl-personal --days 30 --limit 3

Use the user's local API keys, cookies, subscriptions, and model/audio tools when a source needs them. Skip posts that are already synced.`,
    cronPrompt: (origin: string) => `Set up a cron job for my Builder Blog private library.

If the skill is not installed or is out of date, run:
/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"

Add a cron entry that runs every 6 hours:
0 */6 * * * BUILDER_BLOG_URL="${origin}" node ~/.builder-blog/builder-digest.mjs crawl-personal --days 30 --limit 3 >> ~/.builder-blog/crawl-personal.log 2>&1

Use crontab to install it, keep the job idempotent, and do not duplicate an existing Builder Blog private library cron entry.`,
  },
  digest: {
    title: "Build digest feed",
    onceLabel: "Copy once prompt",
    cronLabel: "Copy cron prompt",
    oncePrompt: (origin: string) => `Use the Builder Blog skill to build my subscription digest feed once.

If the skill is not installed or is out of date, run:
/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"

Then fetch the digest context:
BUILDER_BLOG_URL="${origin}" node ~/.builder-blog/builder-digest.mjs prepare --days 1

Write a concise Chinese digest using only the returned items, include source URLs, save it to /tmp/builder-blog-digest.md, then sync it:
BUILDER_BLOG_URL="${origin}" node ~/.builder-blog/builder-digest.mjs sync --file /tmp/builder-blog-digest.md --title "AI Builder Digest"`,
    cronPrompt: (origin: string) => `Set up an agent cron job for my Builder Blog subscription digest feed.

If the skill is not installed or is out of date, run:
/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"

Schedule it daily at 8:00 local time. Each run should:
1. Run: BUILDER_BLOG_URL="${origin}" node ~/.builder-blog/builder-digest.mjs prepare --days 1
2. Write a concise Chinese digest using only the returned items and source URLs to /tmp/builder-blog-digest.md
3. Run: BUILDER_BLOG_URL="${origin}" node ~/.builder-blog/builder-digest.mjs sync --file /tmp/builder-blog-digest.md --title "AI Builder Digest"

Use crontab or the local agent's scheduler, keep the job idempotent, and do not duplicate an existing Builder Blog digest feed cron job.`,
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
