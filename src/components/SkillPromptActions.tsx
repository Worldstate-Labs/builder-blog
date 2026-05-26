"use client";

import { useState } from "react";
import { CalendarClock, Check, Copy, Terminal } from "lucide-react";
import type { AgentTokenListItem } from "@/components/AgentTokenPanel";

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

export function SkillPromptActions({
  context,
  tokens = [],
}: {
  context: SkillPromptContext;
  tokens?: AgentTokenListItem[];
}) {
  const config = PROMPT_CONFIG[context];
  const activeTokens = tokens.filter((t) => !t.revokedAt);

  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [pickerTarget, setPickerTarget] = useState<CopyTarget | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState<string>("");

  async function fetchTokenValue(tokenId: string): Promise<string | null> {
    try {
      const response = await fetch(`/api/settings/tokens/${tokenId}/value`);
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      return body?.token ?? null;
    } catch {
      return null;
    }
  }

  async function buildCommand(target: CopyTarget, tokenValue: string): Promise<string> {
    const origin = window.location.origin;
    const job = target === "once" ? config.onceJob : config.cronJob;
    const promptUrl = `${origin}/api/skill/jobs/${job}/skill.md?token=${encodeURIComponent(tokenValue)}`;
    return `Read ${promptUrl} and follow the instructions.`;
  }

  async function copyCommand(target: CopyTarget) {
    setStatus(null);

    if (activeTokens.length === 0) {
      setStatus({
        kind: "info",
        text: "Create a token in Settings first",
      });
      return;
    }

    if (activeTokens.length === 1) {
      const tokenValue = await fetchTokenValue(activeTokens[0].id);
      if (!tokenValue) {
        setStatus({ kind: "error", text: "Could not fetch token value" });
        return;
      }
      const command = await buildCommand(target, tokenValue);
      try {
        await navigator.clipboard.writeText(command);
        setCopiedTarget(target);
        window.setTimeout(() => setCopiedTarget(null), 1800);
      } catch (error) {
        setStatus({
          kind: "error",
          text: error instanceof Error ? error.message : "Could not copy command",
        });
      }
      return;
    }

    // 2+ tokens: open picker
    setPickerTarget(target);
    if (!selectedTokenId && activeTokens.length > 0) {
      setSelectedTokenId(activeTokens[0].id);
    }
  }

  async function copyWithPicked() {
    if (!pickerTarget || !selectedTokenId) return;
    setStatus(null);
    const tokenValue = await fetchTokenValue(selectedTokenId);
    if (!tokenValue) {
      setStatus({ kind: "error", text: "Could not fetch token value" });
      return;
    }
    const command = await buildCommand(pickerTarget, tokenValue);
    try {
      await navigator.clipboard.writeText(command);
      setPickerTarget(null);
      setCopiedTarget(pickerTarget);
      window.setTimeout(() => setCopiedTarget(null), 1800);
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not copy command",
      });
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
          status.kind === "info" ? (
            <span className="text-[11px] text-[var(--muted-strong)]">
              {status.text}{" "}
              <a className="underline" href="/settings">
                Go to Settings
              </a>
            </span>
          ) : (
            <span className="text-[11px] text-[var(--danger)]">{status.text}</span>
          )
        ) : null}
      </span>

      {/* Multi-token picker */}
      {pickerTarget && activeTokens.length >= 2 ? (
        <div className="mt-3 w-full rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-strong)]">
            Choose token for {pickerTarget === "once" ? config.onceLabel : config.cronLabel}
          </p>
          <div className="grid gap-1.5">
            {activeTokens.map((token) => (
              <label
                key={token.id}
                className="flex cursor-pointer items-start gap-2 rounded-[8px] px-2 py-1.5 hover:bg-[var(--line)]"
              >
                <input
                  checked={selectedTokenId === token.id}
                  className="mt-0.5"
                  name="token-picker"
                  onChange={() => setSelectedTokenId(token.id)}
                  type="radio"
                  value={token.id}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{token.name}</span>
                  <span className="block text-[11px] text-[var(--muted-strong)]">
                    {token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : "Never used"}
                    {token.lastIp ? ` · ${token.lastIp}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="fb-btn dark compact"
              disabled={!selectedTokenId}
              onClick={copyWithPicked}
              type="button"
            >
              <Copy aria-hidden="true" />
              Copy prompt
            </button>
            <button
              className="fb-btn light compact"
              onClick={() => setPickerTarget(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
