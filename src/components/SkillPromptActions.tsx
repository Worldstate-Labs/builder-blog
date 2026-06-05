"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, CircleStop, Copy } from "lucide-react";
import {
  describeMachine,
  type AgentTokenListItem,
} from "@/components/AgentTokenPanel";
import { EmptyState } from "@/components/EmptyState";
import { SUMMARY_LANGUAGE_OPTIONS } from "@/components/settings/SettingsFields";

type SkillPromptContext = "library" | "digest";
type CopyTarget = "once" | "cron" | "stop";
type AgentRuntime = "claude" | "codex" | "gemini" | "openclaw";

const RUNTIME_OPTIONS: { id: AgentRuntime; label: string; hint: string }[] = [
  {
    id: "claude",
    label: "Claude Code",
    hint: "Use this if Claude Code is the Local Agent that will run it.",
  },
  {
    id: "codex",
    label: "Codex",
    hint: "Use this if Codex is the Local Agent that will run it.",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    hint: "Use this if Gemini CLI is the Local Agent that will run it.",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    hint: "Use this if OpenClaw is the Local Agent that will run it.",
  },
];

// Cron cadence. `id` values match the server whitelist in the
// jobs/[job]/skill.md route, which maps each to a fixed cron expression.
type CronFrequency = "30m" | "1h" | "12h" | "daily" | "weekly";
type ScheduleFrequency = "once" | CronFrequency;
// `overrideFetched` = re-fetch posts already in the library (pass --force to
// fetch-personal, which ignores both the fetchedAt cutoff and the externalId
// dedup). Library context only — the digest job doesn't fetch personal items.
type CronConfig = {
  runtime: AgentRuntime;
  freq: CronFrequency;
  overrideFetched: boolean;
};
type SchedulePromptSelection =
  | { target: "once"; overrideFetched: boolean }
  | { target: "cron"; cron: CronConfig };
// What a copy carries beyond the exchange code. `cron` is set for the cron
// flow (its own override lives inside it); `force` is the once flow's override
// (no runtime/cadence to pick). Either source flips ?force=1.
type CopyExtras = { cron: CronConfig | null; force: boolean };

const FREQUENCY_CHOICES: { id: ScheduleFrequency; label: string }[] = [
  { id: "once", label: "One-time" },
  { id: "30m", label: "Every 30 minutes" },
  { id: "1h", label: "Every hour" },
  { id: "12h", label: "Every 12 hours" },
  { id: "daily", label: "Once a day · 08:00" },
  { id: "weekly", label: "Once a week · Mon 08:00" },
];

const FREQUENCY_OPTIONS: Record<SkillPromptContext, { id: ScheduleFrequency; label: string }[]> = {
  library: FREQUENCY_CHOICES,
  digest: FREQUENCY_CHOICES,
};

const DEFAULT_FREQUENCY: Record<SkillPromptContext, ScheduleFrequency> = {
  library: "once",
  digest: "once",
};

// Account-wide summary output language. `value` is fed verbatim into the
// summary prompt ("…summary in <value>"); the option list lives in
// SettingsFields as the single source of truth. "zh" is the default when no
// one-time or cron prompt has selected another language.
const DEFAULT_SUMMARY_LANGUAGE = "zh";

// The override toggle reuses one URL channel (?force=1) but means different
// things per context, so its copy is context-specific. Library: re-fetch posts
// already in the library. Digest: re-include already-digested posts (additive —
// adds a new digest that re-covers those posts, never deletes or replaces past ones).
const OVERRIDE_COPY: Record<
  SkillPromptContext,
  { name: string; cronHint: string; onceHint: string }
> = {
  library: {
    name: "Refresh posts already saved",
    cronHint:
      "Refreshes posts already in your library on every run. Leave off for normal updates.",
    onceHint:
      "Refreshes posts already in your library this time only.",
  },
  digest: {
    name: "Include already digested items",
    cronHint:
      "Already digested posts can be included again on each run.",
    onceHint:
      "Already digested posts can be included again this time.",
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

// Persist the account-wide digest max post-age floor (digest dialogs only).
// No-op when unchanged. Returns false on failure so the caller can surface it.
async function persistDigestMaxAge(
  picked: number | null,
  initial: number | null,
): Promise<boolean> {
  if (picked === initial) return true;
  try {
    const res = await fetch("/api/settings/digest-max-age", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ digestMaxPostAgeDays: picked }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function MaxAgeField({
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
        Max post age (days)
      </label>
      <input
        id={id}
        className="cron-field-select"
        type="number"
        min={1}
        max={365}
        step={1}
        inputMode="numeric"
        placeholder="No limit"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const PROMPT_CONFIG = {
  library: {
    title: "Update sources",
    onceLabel: "Copy one-time prompt",
    cronLabel: "Update sources",
    onceJob: "library-once",
    cronJob: "library-cron-setup",
    stopJob: "library-cron-stop",
    stopLabel: "Copy stop prompt",
  },
  digest: {
    title: "Build digest",
    onceLabel: "Copy one-time prompt",
    cronLabel: "Run or schedule",
    onceJob: "digest-once",
    cronJob: "digest-cron-setup",
    stopJob: "digest-cron-stop",
    stopLabel: "Copy stop prompt",
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
  digestMaxPostAgeDays = null,
  compactOnly = false,
  showStop = true,
}: {
  context: SkillPromptContext;
  tokens?: AgentTokenListItem[];
  // Current account-wide summary language (null = default zh). Set in the
  // one-time/cron dialogs; persisted via /api/settings/summary-language.
  summaryLanguage?: string | null;
  // Current digest max post-age floor (null = no limit). Set in the digest
  // dialogs; persisted via /api/settings/digest-max-age.
  digestMaxPostAgeDays?: number | null;
  compactOnly?: boolean;
  showStop?: boolean;
}) {
  const config = PROMPT_CONFIG[context];
  const activeTokens = tokens.filter((t) => !t.revokedAt);
  // The `in` narrow keeps this typed against the per-context literal config
  // shapes if a future context omits stop support.
  const stopJob = "stopJob" in config ? config.stopJob : undefined;
  const stopLabel = "stopLabel" in config ? config.stopLabel : "Copy stop prompt";

  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [pickerTarget, setPickerTarget] = useState<CopyTarget | null>(null);
  // Job dialog: pick one-time or recurring cadence before the token picker.
  // Recurring copies also include runtime + cadence URL params so the
  // server-rendered markdown bakes in the unattended invocation and schedule.
  const [cronConfigOpen, setCronConfigOpen] = useState(false);
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
    const job =
      target === "once"
        ? config.onceJob
        : target === "cron"
          ? config.cronJob
          : stopJob;
    if (!job) return "";
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
      setStatus({ kind: "error", text: "Could not prepare a secure setup code" });
      return;
    }
    const command = buildCommand(target, code, extras);
    try {
      await navigator.clipboard.writeText(command);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget(null), 1800);
      setStatus({ kind: "info", text: "Copied · valid for 10 minutes" });
      window.setTimeout(() => setStatus(null), 8000);
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not copy prompt",
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
      setStatus({ kind: "info", text: "Connect a Local Agent in Settings first" });
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
      setStatus({ kind: "info", text: "Connect a Local Agent in Settings first" });
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken("once", activeTokens[0].id, extras);
      return;
    }
    pendingExtrasRef.current = extras;
    setPickerTarget("once");
  }

  async function continueScheduleCopy(selection: SchedulePromptSelection) {
    if (selection.target === "once") {
      await continueOnceCopy(selection.overrideFetched);
      return;
    }
    await continueCronCopy(selection.cron);
  }

  async function copyCommand(target: CopyTarget) {
    setStatus(null);

    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: "Connect a Local Agent in Settings first" });
      return;
    }
    // Schedule dialog handles both one-time and recurring runs. Recurring
    // selections bake runtime/cadence into the prompt URL; one-time selections
    // reuse the once prompt with the same output settings.
    if (target === "cron") {
      setCronConfigOpen(true);
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken(target, activeTokens[0].id, { cron: null, force: false });
      return;
    }
    setPickerTarget(target);
  }

  // Stop flows report "stopped" back to the server after local removal, so they
  // need a token-backed prompt just like setup.
  async function copyStopCommand() {
    if (!stopJob) return;
    setStatus(null);
    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: "Connect a Local Agent in Settings first" });
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken("stop", activeTokens[0].id, { cron: null, force: false });
      return;
    }
    setPickerTarget("stop");
  }

  return (
    <div className={compactOnly ? "skill-prompt-compact" : "fb-skill"}>
      {!compactOnly ? (
        <div className="fb-skill-text">
          <span className="fb-section-label mr-2">{config.title}</span>
          {context === "digest"
            ? "Copy a prompt for your Local Agent to build new digests."
            : "Copy a prompt for your Local Agent to update every source."}
        </div>
      ) : null}
      <button
        className="fb-btn dark compact"
        onClick={() => copyCommand("cron")}
        type="button"
      >
        {copiedTarget === "cron" || copiedTarget === "once" ? (
          <Check aria-hidden="true" />
        ) : (
          <CalendarClock aria-hidden="true" />
        )}
        {copiedTarget === "cron" || copiedTarget === "once" ? "Copied" : config.cronLabel}
      </button>
      {stopJob && showStop ? (
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

      <span aria-live="polite" className="skill-prompt-status">
        {status ? (
          status.kind === "info" ? (
            <span className="skill-prompt-status-text">
              {status.text}
              {status.text.includes("Connect a Local Agent") ? (
                <>
                  {" "}
                  <a className="underline" href="/settings">
                    Go to Settings
                  </a>
                </>
              ) : null}
            </span>
          ) : (
            <span className="skill-prompt-status-text is-error">{status.text}</span>
          )
        ) : null}
      </span>

      <CronConfigDialog
        open={cronConfigOpen}
        context={context}
        summaryLanguage={summaryLanguage}
        digestMaxPostAgeDays={digestMaxPostAgeDays}
        onCancel={() => setCronConfigOpen(false)}
        onConfirm={async (selection) => {
          setCronConfigOpen(false);
          await continueScheduleCopy(selection);
        }}
      />

      <TokenPickerDialog
        open={pickerTarget !== null}
        target={pickerTarget}
        tokens={activeTokens}
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
  onCancel,
  onConfirm,
}: {
  open: boolean;
  target: CopyTarget | null;
  tokens: AgentTokenListItem[];
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
        className="token-picker-form"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <header className="token-picker-header">
          <h2 id="token-picker-title" className="token-picker-title">
            Choose a Local Agent
          </h2>
          <p className="token-picker-sub">
            We&rsquo;ll create a short-lived setup code and copy the prompt.
          </p>
        </header>

        <fieldset className="token-picker-list">
          <legend className="sr-only">Connected helpers</legend>
          {!open ? null : tokens.length === 0 ? (
            <EmptyState
              className="token-picker-empty"
              body={
                <>
                  No connected helpers.{" "}
                  <a className="underline" href="/settings">
                    Add one in Settings
                  </a>
                  .
                </>
              }
            />
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
  digestMaxPostAgeDays,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  context: SkillPromptContext;
  summaryLanguage: string | null;
  digestMaxPostAgeDays: number | null;
  onCancel: () => void;
  onConfirm: (selection: SchedulePromptSelection) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pickedRuntime, setPickedRuntime] = useState<AgentRuntime>(RUNTIME_OPTIONS[0].id);
  const freqOptions = FREQUENCY_OPTIONS[context];
  const [pickedFreq, setPickedFreq] = useState<ScheduleFrequency>(DEFAULT_FREQUENCY[context]);
  const isOneTime = pickedFreq === "once";
  const override = OVERRIDE_COPY[context];
  const initialLanguage = summaryLanguage ?? DEFAULT_SUMMARY_LANGUAGE;
  const [pickedLanguage, setPickedLanguage] = useState(initialLanguage);
  const initialMaxAge = digestMaxPostAgeDays;
  const [pickedMaxAge, setPickedMaxAge] = useState(
    initialMaxAge === null ? "" : String(initialMaxAge),
  );
  const [overrideFetched, setOverrideFetched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runtimeHint =
    isOneTime ? "" : RUNTIME_OPTIONS.find((o) => o.id === pickedRuntime)?.hint ?? "";

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
      if (context === "digest") {
        const trimmed = pickedMaxAge.trim();
        if (trimmed !== "" && !Number.isFinite(Number(trimmed))) {
          setError("Max post age must be a whole number of days.");
          setSubmitting(false);
          return;
        }
        const maxAge =
          trimmed === ""
            ? null
            : Math.min(365, Math.max(1, Math.floor(Number(trimmed))));
        const savedAge = await persistDigestMaxAge(maxAge, initialMaxAge);
        if (!savedAge) {
          setError("Couldn't save max post age. Try again.");
          setSubmitting(false);
          return;
        }
      }
      if (pickedFreq === "once") {
        await onConfirm({ target: "once", overrideFetched });
      } else {
        await onConfirm({
          target: "cron",
          cron: {
            runtime: pickedRuntime,
            freq: pickedFreq,
            overrideFetched,
          },
        });
      }
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
        className="token-picker-form"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <header className="token-picker-header">
          <h2 id="cron-config-title" className="token-picker-title">
            {context === "digest" ? "Build digest" : "Update sources"}
          </h2>
          <p className="token-picker-sub">
            {context === "digest"
              ? "Copy a prompt for your Local Agent to build your AI Digest."
              : "Copy a prompt for your Local Agent to fetch, summarize, and sync every source."}
          </p>
        </header>

        <div className="cron-config-body">
          <div className="cron-field">
            <label htmlFor="cron-freq" className="cron-field-label">
              Frequency
            </label>
            <select
              id="cron-freq"
              className="cron-field-select"
              value={pickedFreq}
              onChange={(e) => setPickedFreq(e.target.value as ScheduleFrequency)}
            >
              {freqOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {isOneTime ? null : (
            <>
              <div className="cron-field">
                <label htmlFor="cron-runtime" className="cron-field-label">
                  Local Agent
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
            </>
          )}

          <SummaryLanguageField
            id="cron-lang"
            value={pickedLanguage}
            onChange={setPickedLanguage}
          />

          {context === "digest" ? (
            <>
              <MaxAgeField
                id="cron-max-age"
                value={pickedMaxAge}
                onChange={setPickedMaxAge}
              />
              <p className="cron-field-hint">
                Excludes older posts. Leave blank for no limit.
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
              <span className="cron-field-hint">
                {isOneTime ? override.onceHint : override.cronHint}
              </span>
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
            {submitting ? "…" : "Copy"}
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
