"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, CircleStop, Copy, Terminal } from "lucide-react";
import {
  describeMachine,
  type AgentTokenListItem,
} from "@/components/AgentTokenPanel";
import { SUMMARY_LANGUAGE_OPTIONS } from "@/components/settings/SettingsFields";

type SkillPromptContext = "library" | "digest";
type CopyTarget = "once" | "cron" | "stop";
type AgentRuntime = "claude" | "codex" | "gemini" | "openclaw";

const RUNTIME_OPTIONS: { id: AgentRuntime; label: string; hint: string }[] = [
  {
    id: "claude",
    label: "Claude Code",
    hint: "Unattended: --permission-mode acceptEdits + Bash/Edit/Read/Write/Grep/Glob/WebFetch allowlist",
  },
  { id: "codex", label: "Codex", hint: "Unattended: --full-auto (approval=never, workspace-write sandbox)" },
  { id: "gemini", label: "Gemini CLI", hint: "Unattended: --yolo (skip all confirmation prompts)" },
  { id: "openclaw", label: "OpenClaw", hint: "Unattended: exec-policy preset yolo (auto-approves exec host-wide)" },
];

// Cron cadence. `id` values match the server whitelist in the
// jobs/[job]/skill.md route, which maps each to a fixed cron expression.
type CronFrequency = "30m" | "1h" | "12h" | "daily" | "weekly";
// `overrideFetched` = re-fetch posts already in the library (pass --force to
// fetch-personal, which ignores both the fetchedAt cutoff and the externalId
// dedup). Library context only — the digest job doesn't fetch personal items.
type CronConfig = {
  runtime: AgentRuntime;
  freq: CronFrequency;
  overrideFetched: boolean;
};
// What a copy carries beyond the exchange code. `cron` is set for the cron
// flow (its own override lives inside it); `force` is the once flow's override
// (no runtime/cadence to pick). Either source flips ?force=1.
type CopyExtras = { cron: CronConfig | null; force: boolean };

const FREQUENCY_CHOICES: { id: CronFrequency; label: string }[] = [
  { id: "30m", label: "Every 30 minutes" },
  { id: "1h", label: "Every hour" },
  { id: "12h", label: "Every 12 hours" },
  { id: "daily", label: "Once a day · 08:00" },
  { id: "weekly", label: "Once a week · Mon 08:00" },
];

const FREQUENCY_OPTIONS: Record<SkillPromptContext, { id: CronFrequency; label: string }[]> = {
  library: FREQUENCY_CHOICES,
  digest: FREQUENCY_CHOICES,
};

const DEFAULT_FREQUENCY: Record<SkillPromptContext, CronFrequency> = {
  library: "12h",
  digest: "daily",
};

// Account-wide summary output language. `value` is fed verbatim into the
// summary prompt ("…summary in <value>"); the option list lives in
// SettingsFields as the single source of truth, shared with the admin
// per-source Language field. "zh" is the per-source default, so 中文 is a no-op.
const DEFAULT_SUMMARY_LANGUAGE = "zh";

// The override toggle reuses one URL channel (?force=1) but means different
// things per context, so its copy is context-specific. Library: re-fetch posts
// already in the library. Digest: re-generate today's digest (the job never
// fetches — it re-covers the window and replaces today's stored digest).
const OVERRIDE_COPY: Record<
  SkillPromptContext,
  { name: string; cronHint: string; onceHint: string }
> = {
  library: {
    name: "Override already-fetched posts",
    cronHint:
      "Re-fetch on every run (--force): re-pulls posts already in your library. Off by default.",
    onceHint:
      "Passes --force: ignores the last-fetched cutoff and re-pulls posts already in your library. One-time for this run only.",
  },
  digest: {
    name: "Re-generate today's digest",
    cronHint:
      "Re-includes posts already digested and replaces today's digest, instead of only covering not-yet-digested posts. Off by default.",
    onceHint:
      "Re-includes posts already digested and replaces today's digest, instead of only covering not-yet-digested posts. One-time for this run only.",
  },
};

// Persist the account-wide summary language (shared by the cron + once dialogs).
// No-op when unchanged. Returns false on failure so the caller can surface it.
async function persistSummaryLanguage(
  picked: string,
  initial: string,
): Promise<boolean> {
  if (picked === initial) return true;
  try {
    const res = await fetch("/api/settings/summary-language", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summaryLanguage: picked }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function SummaryLanguageField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="cron-field">
      <label htmlFor={id} className="cron-field-label">
        Summary language
      </label>
      <select
        id={id}
        className="cron-field-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {SUMMARY_LANGUAGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {SUMMARY_LANGUAGE_OPTIONS.every((o) => o.value !== value) ? (
          <option value={value}>{value}</option>
        ) : null}
      </select>
    </div>
  );
}

const PROMPT_CONFIG = {
  library: {
    title: "Source sync",
    onceLabel: "Copy once prompt",
    cronLabel: "Copy cron prompt",
    onceJob: "library-once",
    cronJob: "library-cron-setup",
    // Stopping is runtime-agnostic — it only removes the launchd LaunchAgent
    // (macOS) or crontab entry (Linux), neither of which depends on which
    // agent ran the job — so there's no runtime/cadence/token to pick.
    stopJob: "library-cron-stop",
    stopLabel: "Stop cron",
  },
  digest: {
    title: "Digest sync",
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
    stopJob?: string;
    stopLabel?: string;
  }
>;

export function SkillPromptActions({
  context,
  tokens = [],
  summaryLanguage = null,
}: {
  context: SkillPromptContext;
  tokens?: AgentTokenListItem[];
  // Current account-wide summary language (null = per-source default). Set in
  // the library cron dialog; persisted via /api/settings/summary-language.
  summaryLanguage?: string | null;
}) {
  const config = PROMPT_CONFIG[context];
  const activeTokens = tokens.filter((t) => !t.revokedAt);
  // Only the library context ships a stop prompt today; the `in` narrow keeps
  // this typed against the per-context literal config shapes.
  const stopJob = "stopJob" in config ? config.stopJob : undefined;
  const stopLabel = "stopLabel" in config ? config.stopLabel : "Stop cron";

  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [pickerTarget, setPickerTarget] = useState<CopyTarget | null>(null);
  // Cron-only: the runtime + cadence the scheduled job should use. Picked
  // in one dialog before the token picker, then appended to the prompt URL
  // so the server-rendered markdown bakes in the right unattended
  // invocation and crontab schedule.
  const [cronConfigOpen, setCronConfigOpen] = useState(false);
  // Once flow: a small dialog to pick language (digest) and the override
  // before copying. Opened for both contexts.
  const [onceConfigOpen, setOnceConfigOpen] = useState(false);
  // The picked config survives between a config dialog and the token picker.
  // A ref (not state) so the picker's onConfirm can read it without an extra
  // render. Holds the cron config (cron flow) and/or the once force toggle.
  const pendingExtrasRef = useRef<CopyExtras | null>(null);

  async function fetchExchangeCode(tokenId: string): Promise<string | null> {
    try {
      const response = await fetch(`/api/settings/tokens/${tokenId}/exchange-code`, {
        method: "POST",
      });
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      return body?.code ?? null;
    } catch {
      return null;
    }
  }

  function buildCommand(
    target: CopyTarget,
    exchangeCode: string,
    extras: CopyExtras,
  ): string {
    const origin = window.location.origin;
    const job = target === "once" ? config.onceJob : config.cronJob;
    const params = new URLSearchParams({ ec: exchangeCode });
    if (extras.cron) {
      params.set("runtime", extras.cron.runtime);
      params.set("freq", extras.cron.freq);
    }
    if (extras.cron?.overrideFetched || extras.force) {
      params.set("force", "1");
    }
    const promptUrl = `${origin}/api/skill/jobs/${job}/skill.md?${params.toString()}`;
    return `Read ${promptUrl} and follow the instructions.`;
  }

  async function copyForToken(
    target: CopyTarget,
    tokenId: string,
    extras: CopyExtras,
  ) {
    setStatus(null);
    const code = await fetchExchangeCode(tokenId);
    if (!code) {
      setStatus({ kind: "error", text: "Could not generate exchange code" });
      return;
    }
    const command = buildCommand(target, code, extras);
    try {
      await navigator.clipboard.writeText(command);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget(null), 1800);
      setStatus({ kind: "info", text: "Copied · expires in 10 min" });
      window.setTimeout(() => setStatus(null), 8000);
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not copy command",
      });
    }
  }

  // After the cron runtime is picked, continue to the token picker
  // (or skip it when there's only one active token). The chosen
  // runtime is held in a closure-captured ref so it survives the
  // dialog round trip.
  async function continueCronCopy(cron: CronConfig) {
    const extras: CopyExtras = { cron, force: false };
    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: "Create a token in Settings first" });
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken("cron", activeTokens[0].id, extras);
      return;
    }
    // Open the token picker with the cron config stashed; we read it back
    // when the user confirms a token.
    pendingExtrasRef.current = extras;
    setPickerTarget("cron");
  }

  // Once flow: after the override (+ language) choice, continue to the token picker
  // (or copy directly when there's a single token).
  async function continueOnceCopy(overrideFetched: boolean) {
    const extras: CopyExtras = { cron: null, force: overrideFetched };
    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: "Create a token in Settings first" });
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken("once", activeTokens[0].id, extras);
      return;
    }
    pendingExtrasRef.current = extras;
    setPickerTarget("once");
  }

  async function copyCommand(target: CopyTarget) {
    setStatus(null);

    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: "Create a token in Settings first" });
      return;
    }
    // Cron flow: pick runtime + cadence + language + override first. Once flow:
    // a small dialog to pick language (digest) and the override. Both bake their
    // choice into the rendered prompt (and persist language account-wide).
    if (target === "cron") {
      setCronConfigOpen(true);
      return;
    }
    if (target === "once") {
      setOnceConfigOpen(true);
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken(target, activeTokens[0].id, { cron: null, force: false });
      return;
    }
    setPickerTarget(target);
  }

  // Stop flow: removing the schedule touches nothing on the server, so it
  // needs no exchange code, no token, and no runtime/cadence — just copy the
  // self-contained prompt. Works even with zero tokens.
  async function copyStopCommand() {
    if (!stopJob) return;
    setStatus(null);
    const command = `Read ${window.location.origin}/api/skill/jobs/${stopJob}/skill.md and follow the instructions.`;
    try {
      await navigator.clipboard.writeText(command);
      setCopiedTarget("stop");
      window.setTimeout(() => setCopiedTarget(null), 1800);
      setStatus({ kind: "info", text: "Copied · paste into your terminal agent" });
      window.setTimeout(() => setStatus(null), 8000);
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
      {stopJob ? (
        <button
          className="fb-btn light compact"
          onClick={copyStopCommand}
          type="button"
        >
          {copiedTarget === "stop" ? (
            <Check aria-hidden="true" />
          ) : (
            <CircleStop aria-hidden="true" />
          )}
          {copiedTarget === "stop" ? "Copied" : stopLabel}
        </button>
      ) : null}

      <span aria-live="polite" className="ml-2">
        {status ? (
          status.kind === "info" ? (
            <span className="text-[11px] text-[var(--muted-strong)]">
              {status.text}
              {status.text.includes("Create a token") ? (
                <>
                  {" "}
                  <a className="underline" href="/settings">
                    Go to Settings
                  </a>
                </>
              ) : null}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--danger)]">{status.text}</span>
          )
        ) : null}
      </span>

      <CronConfigDialog
        open={cronConfigOpen}
        context={context}
        summaryLanguage={summaryLanguage}
        onCancel={() => setCronConfigOpen(false)}
        onConfirm={async (cron) => {
          setCronConfigOpen(false);
          await continueCronCopy(cron);
        }}
      />

      <OnceConfigDialog
        open={onceConfigOpen}
        context={context}
        summaryLanguage={summaryLanguage}
        onCancel={() => setOnceConfigOpen(false)}
        onConfirm={async (overrideFetched) => {
          setOnceConfigOpen(false);
          await continueOnceCopy(overrideFetched);
        }}
      />

      <TokenPickerDialog
        open={pickerTarget !== null}
        target={pickerTarget}
        tokens={activeTokens}
        actionLabel={
          pickerTarget === "once" ? config.onceLabel : pickerTarget === "cron" ? config.cronLabel : ""
        }
        onCancel={() => {
          setPickerTarget(null);
          pendingExtrasRef.current = null;
        }}
        onConfirm={async (tokenId) => {
          const target = pickerTarget;
          const extras = pendingExtrasRef.current ?? { cron: null, force: false };
          setPickerTarget(null);
          pendingExtrasRef.current = null;
          if (target) await copyForToken(target, tokenId, extras);
        }}
      />
    </div>
  );
}

function TokenPickerDialog({
  open,
  target,
  tokens,
  actionLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  target: CopyTarget | null;
  tokens: AgentTokenListItem[];
  actionLabel: string;
  onCancel: () => void;
  onConfirm: (tokenId: string) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pickedTokenId, setPickedTokenId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Default = most-recently-used token. Computed; not stored, so opening
  // the dialog with a new token list doesn't need an effect to reset state.
  const defaultTokenId = useMemo(() => {
    if (tokens.length === 0) return "";
    const sorted = [...tokens].sort((a, b) => {
      const at = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
      const bt = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
      return bt - at;
    });
    return sorted[0]?.id ?? "";
  }, [tokens]);

  const selectedTokenId =
    pickedTokenId && tokens.some((t) => t.id === pickedTokenId)
      ? pickedTokenId
      : defaultTokenId;

  // Sync <dialog> open state.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        // showModal throws if the dialog is already open; ignore.
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // Browser-fired close (Escape, programmatic) → tell parent.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => {
      setSubmitting(false);
      onCancel();
    };
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [onCancel]);

  async function confirm() {
    if (!selectedTokenId || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(selectedTokenId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="token-picker-title"
      className="token-picker-dialog"
      onClick={(e) => {
        // Backdrop click closes (target === dialog itself, not children).
        if (e.target === dialogRef.current) onCancel();
      }}
    >
      <form
        method="dialog"
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <header className="token-picker-header">
          <h2 id="token-picker-title" className="token-picker-title">
            Choose a token
          </h2>
          <p className="token-picker-sub">
            We&rsquo;ll mint a one-time exchange code (expires in 10 minutes) and copy the
            runner command for {actionLabel.toLowerCase().replace(/^copy\s/, "")}.
          </p>
        </header>

        <fieldset className="token-picker-list">
          <legend className="sr-only">Active tokens</legend>
          {!open ? null : tokens.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--muted-strong)]">
              No active tokens.{" "}
              <a className="underline" href="/settings">
                Create one in Settings
              </a>
              .
            </p>
          ) : (
            tokens.map((token) => {
              const active = token.id === selectedTokenId;
              return (
                <label
                  key={token.id}
                  className={`token-picker-row${active ? " is-active" : ""}`}
                  data-target={target ?? undefined}
                >
                  <input
                    type="radio"
                    name="agent-token"
                    value={token.id}
                    checked={active}
                    onChange={() => setPickedTokenId(token.id)}
                    className="token-picker-radio"
                  />
                  <span className="token-picker-row-body">
                    <span className="token-picker-row-name">{token.name}</span>
                    <span className="token-picker-row-meta">
                      <span>{describeMachine(token)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {token.lastUsedAt
                          ? `Last used ${formatRelative(token.lastUsedAt)}`
                          : "Never used"}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </fieldset>

        <footer className="token-picker-footer">
          <button
            type="button"
            className="fb-btn light compact"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="fb-btn dark compact"
            disabled={!selectedTokenId || submitting || tokens.length === 0}
          >
            <Copy aria-hidden="true" />
            {submitting ? "Copying…" : "Copy prompt"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function CronConfigDialog({
  open,
  context,
  summaryLanguage,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  context: SkillPromptContext;
  summaryLanguage: string | null;
  onCancel: () => void;
  onConfirm: (cron: CronConfig) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pickedRuntime, setPickedRuntime] = useState<AgentRuntime>(RUNTIME_OPTIONS[0].id);
  const freqOptions = FREQUENCY_OPTIONS[context];
  const [pickedFreq, setPickedFreq] = useState<CronFrequency>(DEFAULT_FREQUENCY[context]);
  const override = OVERRIDE_COPY[context];
  const initialLanguage = summaryLanguage ?? DEFAULT_SUMMARY_LANGUAGE;
  const [pickedLanguage, setPickedLanguage] = useState(initialLanguage);
  const [overrideFetched, setOverrideFetched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runtimeHint =
    RUNTIME_OPTIONS.find((o) => o.id === pickedRuntime)?.hint ?? "";

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        // showModal throws if already open; ignore.
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => {
      setSubmitting(false);
      onCancel();
    };
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [onCancel]);

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Summary language is account-wide, so persist it server-side (not via
      // the cron URL) — /api/skill/context reads it at every fetch. No-op when
      // unchanged.
      const saved = await persistSummaryLanguage(pickedLanguage, initialLanguage);
      if (!saved) {
        setError("Couldn't save the summary language — try again.");
        setSubmitting(false);
        return;
      }
      await onConfirm({
        runtime: pickedRuntime,
        freq: pickedFreq,
        overrideFetched,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="cron-config-title"
      className="token-picker-dialog"
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel();
      }}
    >
      <form
        method="dialog"
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <header className="token-picker-header">
          <h2 id="cron-config-title" className="token-picker-title">
            Configure the scheduled job
          </h2>
          <p className="token-picker-sub">
            Runs unattended — every setting below is pinned (or saved to your
            account) so no permission prompts fire at run time.
          </p>
        </header>

        <div className="cron-config-body">
          <p className="token-picker-grouplabel">Schedule</p>
          <div className="cron-field">
            <label htmlFor="cron-freq" className="cron-field-label">
              Frequency
            </label>
            <select
              id="cron-freq"
              className="cron-field-select"
              value={pickedFreq}
              onChange={(e) => setPickedFreq(e.target.value as CronFrequency)}
            >
              {freqOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="cron-field">
            <label htmlFor="cron-runtime" className="cron-field-label">
              Agent runtime
            </label>
            <select
              id="cron-runtime"
              className="cron-field-select"
              value={pickedRuntime}
              onChange={(e) => setPickedRuntime(e.target.value as AgentRuntime)}
            >
              {RUNTIME_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="cron-field-hint">{runtimeHint}</p>

          <p className="token-picker-grouplabel">Output</p>
          <SummaryLanguageField
            id="cron-lang"
            value={pickedLanguage}
            onChange={setPickedLanguage}
          />
          <p className="cron-field-hint">
            Account-wide — applies to all your summaries (library + digest).
          </p>

          <label className="cron-check">
            <input
              type="checkbox"
              name="override-fetched"
              checked={overrideFetched}
              onChange={(e) => setOverrideFetched(e.target.checked)}
              className="cron-check-input"
            />
            <span className="cron-check-body">
              <span className="cron-check-name">{override.name}</span>
              <span className="cron-field-hint">{override.cronHint}</span>
            </span>
          </label>

          {error ? <p className="cron-field-error">{error}</p> : null}
        </div>

        <footer className="token-picker-footer">
          <button
            type="button"
            className="fb-btn light compact"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="fb-btn dark compact"
            disabled={submitting}
          >
            <CalendarClock aria-hidden="true" />
            {submitting ? "…" : "Continue"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

// Once dialog: optional per-run config before copying. Library = a single
// override toggle (re-fetch posts already saved in the library). Digest =
// summary language + "re-generate today's digest" override. Cron has its own
// dialog with runtime + cadence; once only needs these. Both reuse the same
// ?force=1 channel for the override — the meaning differs by context.
function OnceConfigDialog({
  open,
  context,
  summaryLanguage,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  context: SkillPromptContext;
  summaryLanguage: string | null;
  onCancel: () => void;
  onConfirm: (overrideFetched: boolean) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const override = OVERRIDE_COPY[context];
  // Language is account-wide; digest output honors it, library once doesn't
  // expose it (parity with the library cron/once split).
  const showLanguage = context === "digest";
  const initialLanguage = summaryLanguage ?? DEFAULT_SUMMARY_LANGUAGE;
  const [pickedLanguage, setPickedLanguage] = useState(initialLanguage);
  const [overrideFetched, setOverrideFetched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        // showModal throws if already open; ignore.
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => {
      setSubmitting(false);
      onCancel();
    };
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [onCancel]);

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (showLanguage) {
        const saved = await persistSummaryLanguage(pickedLanguage, initialLanguage);
        if (!saved) {
          setError("Couldn't save the summary language — try again.");
          setSubmitting(false);
          return;
        }
      }
      await onConfirm(overrideFetched);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="once-config-title"
      className="token-picker-dialog"
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel();
      }}
    >
      <form
        method="dialog"
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <header className="token-picker-header">
          <h2 id="once-config-title" className="token-picker-title">
            {context === "digest" ? "Generate the digest once" : "Run the sync once"}
          </h2>
          <p className="token-picker-sub">
            {context === "digest"
              ? "By default this adds a digest from new items since your last one."
              : "By default this fetches only posts newer than what’s already in your library."}
          </p>
        </header>

        <div className="cron-config-body">
          {showLanguage ? (
            <>
              <p className="token-picker-grouplabel">Output</p>
              <SummaryLanguageField
                id="once-lang"
                value={pickedLanguage}
                onChange={setPickedLanguage}
              />
              <p className="cron-field-hint">
                Account-wide — applies to all your summaries (library + digest).
              </p>
            </>
          ) : null}

          <label className="cron-check">
            <input
              type="checkbox"
              name="override-fetched"
              checked={overrideFetched}
              onChange={(e) => setOverrideFetched(e.target.checked)}
              className="cron-check-input"
            />
            <span className="cron-check-body">
              <span className="cron-check-name">{override.name}</span>
              <span className="cron-field-hint">{override.onceHint}</span>
            </span>
          </label>

          {error ? <p className="cron-field-error">{error}</p> : null}
        </div>

        <footer className="token-picker-footer">
          <button
            type="button"
            className="fb-btn light compact"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="fb-btn dark compact"
            disabled={submitting}
          >
            <Copy aria-hidden="true" />
            {submitting ? "…" : "Continue"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) {
    return new Date(iso).toLocaleDateString();
  }
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}
