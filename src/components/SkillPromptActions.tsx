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
