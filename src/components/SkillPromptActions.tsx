"use client";

import { useState } from "react";
import { CalendarClock, Check, Copy } from "lucide-react";

type SkillPromptContext = "library" | "digest";
type CopyTarget = "once" | "cron";

const PROMPT_CONFIG = {
  library: {
    title: "Build library",
    onceLabel: "Copy once command",
    cronLabel: "Copy cron command",
    onceJob: "library-once",
    onceFile: "builder-blog-library-once.md",
    cronJob: "library-cron-setup",
    cronFile: "builder-blog-library-cron-setup.md",
  },
  digest: {
    title: "Build digest feed",
    onceLabel: "Copy once command",
    cronLabel: "Copy cron command",
    onceJob: "digest-once",
    onceFile: "builder-blog-digest-once.md",
    cronJob: "digest-cron-setup",
    cronFile: "builder-blog-digest-cron-setup.md",
  },
} satisfies Record<
  SkillPromptContext,
  {
    title: string;
    onceLabel: string;
    cronLabel: string;
    onceJob: string;
    onceFile: string;
    cronJob: string;
    cronFile: string;
  }
>;

export function SkillPromptActions({ context }: { context: SkillPromptContext }) {
  const config = PROMPT_CONFIG[context];
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [status, setStatus] = useState("");

  async function copyCommand(target: CopyTarget) {
    setStatus("");
    const origin = window.location.origin;
    const job = target === "once" ? config.onceJob : config.cronJob;
    const file = target === "once" ? config.onceFile : config.cronFile;
    const promptUrl = `${origin}/api/skill/files/${file}`;
    const command = `/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)" && BUILDER_BLOG_URL="${origin}" BUILDER_BLOG_PROMPT_URL="${promptUrl}" $HOME/.builder-blog/builder-agent-runner.sh ${job}`;

    try {
      await navigator.clipboard.writeText(command);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget(null), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy command");
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
          onClick={() => copyCommand("once")}
          type="button"
        >
          {copiedTarget === "once" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiedTarget === "once" ? "Copied" : config.onceLabel}
        </button>
        <button
          className="button-light button-compact gap-2"
          onClick={() => copyCommand("cron")}
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
