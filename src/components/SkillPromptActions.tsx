"use client";

import { useState } from "react";
import { CalendarClock, Check, Copy, Terminal } from "lucide-react";

type SkillPromptContext = "library" | "digest";
type CopyTarget = "once" | "cron";

const PROMPT_CONFIG = {
  library: {
    title: "Build library",
    onceLabel: "Copy once prompt",
    cronLabel: "Copy cron prompt",
    onceJob: "library-once",
    cronJob: "library-cron-setup",
  },
  digest: {
    title: "Build digest feed",
    onceLabel: "Copy once prompt",
    cronLabel: "Copy cron prompt",
    onceJob: "digest-once",
    cronJob: "digest-cron-setup",
  },
} satisfies Record<
  SkillPromptContext,
  {
    title: string;
    onceLabel: string;
    cronLabel: string;
    onceJob: string;
    cronJob: string;
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
    const promptUrl = `${origin}/api/skill/jobs/${job}/skill.md`;
    const command = `Read ${promptUrl} and follow the instructions.`;

    try {
      await navigator.clipboard.writeText(command);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget(null), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy command");
    }
  }

  return (
    <div className="fb-skill">
      <Terminal aria-hidden="true" className="h-4 w-4 text-[var(--accent)]" />
      <div className="fb-skill-text">
        <span className="fb-section-label mr-2">{config.title}</span>
        Run the terminal skill to sync new {context === "digest" ? "digests" : "sources"}.
      </div>
      <button
        className="fb-btn light compact"
        onClick={() => copyCommand("once")}
        type="button"
      >
        {copiedTarget === "once" ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        {copiedTarget === "once" ? "Copied" : config.onceLabel}
      </button>
      <button
        className="fb-btn dark compact"
        onClick={() => copyCommand("cron")}
        type="button"
      >
        {copiedTarget === "cron" ? (
          <Check aria-hidden="true" />
        ) : (
          <CalendarClock aria-hidden="true" />
        )}
        {copiedTarget === "cron" ? "Copied" : config.cronLabel}
      </button>
      <span aria-live="polite" className="ml-2">
        {status ? (
          <span className="text-[11px] text-[var(--danger)]">{status}</span>
        ) : null}
      </span>
    </div>
  );
}
