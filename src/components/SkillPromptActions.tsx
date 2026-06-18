"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, CircleStop, Copy, KeyRound } from "lucide-react";
import {
  AccessKeyDeviceIcon,
  describeAccessDevice,
  describeAccessStatus,
  sortAccessTokensByRecentConnection,
  type AgentTokenListItem,
} from "@/components/AgentTokenPanel";
import { EmptyState } from "@/components/EmptyState";
import { languageOptions } from "@/components/settings/SettingsFields";
import { useHydrated } from "@/components/ThemeToggle";
import { ORIGINAL_CONTENT_LANGUAGE_VALUE } from "@/lib/language-preference";

type SkillPromptContext = "library" | "digest";
type CopyTarget = "once" | "cron" | "stop";
type AgentRuntime = "claude" | "codex" | "gemini" | "openclaw";

const RUNTIME_OPTIONS: { id: AgentRuntime; label: string; hint: string }[] = [
  {
    id: "claude",
    label: "Claude Code",
    hint: "Runs with Claude Code.",
  },
  {
    id: "codex",
    label: "Codex",
    hint: "Runs with Codex.",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    hint: "Runs with Gemini CLI.",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    hint: "Runs with OpenClaw.",
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
  fetchDays: number;
  parallelWorkers: number;
};
type SchedulePromptSelection =
  | {
      target: "once";
      runtime: AgentRuntime;
      overrideFetched: boolean;
      fetchDays: number;
      parallelWorkers: number;
    }
  | { target: "cron"; cron: CronConfig };
// What a copy carries beyond the exchange code. `cron` is set for the cron
// flow (its own override lives inside it); `force` is the once flow's override
// (no cadence to pick). Both flows carry a runtime; cron pins it, one-time
// passes it as a per-run env override.
type CopyExtras = {
  cron: CronConfig | null;
  runtime: AgentRuntime;
  force: boolean;
  fetchDays: number;
  parallelWorkers: number;
};
type ManualCopyPrompt = { target: CopyTarget; text: string };
const missingAccessMessage = "Add an access key to set up Local Agent runs.";
const promptDialogDescription = () => "Choose frequency, Local Agent, language, and lookback.";

async function copyTextToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText && document.hasFocus()) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below when focus or clipboard permissions block writeText.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      if (previousRange) selection.addRange(previousRange);
    }
  }
}

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

// Account-wide summary output language. The fixed-language values are fed into
// prompts; the special "source" value means summarize in the source content's
// own language.
const DEFAULT_PROMPT_WINDOW_DAYS = 30;
const MAX_PROMPT_WINDOW_DAYS = 90;
const DEFAULT_PARALLEL_WORKERS = 1;
const MAX_PARALLEL_WORKERS = 8;

// The override toggle reuses one URL channel (?force=1) but means different
// things per context, so its copy is context-specific. Library: re-fetch posts
// already in the source library. Digest: re-include posts already used in AI Digest
// (additive — adds a new AI Digest that re-covers those posts, never deletes or
// replaces past ones).
const OVERRIDE_COPY: Record<
  SkillPromptContext,
  { name: string; cronHint: string; onceHint: string }
> = {
  library: {
    name: "Re-fetch existing posts",
    cronHint:
      "Re-fetch existing source posts each run. Leave off for normal updates.",
    onceHint:
      "Re-fetch existing source posts once.",
  },
  digest: {
    name: "Reuse posts from past issues",
    cronHint:
      "Reuse posts from past issues each run.",
    onceHint:
      "Reuse posts from past issues once.",
  },
};

// Persist the account-wide summary language (shared by the cron + once dialogs).
// No-op when unchanged. Returns false on failure so the caller can surface it.
async function persistSummaryLanguage(
  picked: string,
  initial: string | null,
): Promise<boolean> {
  if (initial !== null && picked === initial) return true;
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
  label = "Summary language",
  value,
  onChange,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="cron-field">
      <label htmlFor={id} className="cron-field-label">
        {label}
      </label>
      <select
        id={id}
        className="cron-field-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {languageOptions(value).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
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

function parseWindowDays(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_PROMPT_WINDOW_DAYS;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  if (!Number.isInteger(numeric)) return null;
  if (numeric < 1 || numeric > MAX_PROMPT_WINDOW_DAYS) return null;
  return numeric;
}

function parseParallelWorkers(value: string): number | null {
  const numeric = Number(value.trim());
  if (!Number.isFinite(numeric)) return null;
  if (!Number.isInteger(numeric)) return null;
  if (numeric < 1 || numeric > MAX_PARALLEL_WORKERS) return null;
  return numeric;
}

function MaxAgeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="cron-field">
      <label htmlFor={id} className="cron-field-label">
        {label}
      </label>
      <input
        id={id}
        className="cron-field-select"
        type="number"
        min={1}
        max={MAX_PROMPT_WINDOW_DAYS}
        step={1}
        inputMode="numeric"
        placeholder={String(DEFAULT_PROMPT_WINDOW_DAYS)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const PROMPT_CONFIG = {
  library: {
    title: "Fetch sources",
    onceLabel: "Copy one-time prompt",
    cronLabel: "Fetch sources",
    onceJob: "library-once",
    cronJob: "library-cron-setup",
    stopJob: "library-cron-stop",
    stopLabel: "Copy stop prompt",
  },
  digest: {
    title: "Build AI Digest",
    onceLabel: "Copy one-time prompt",
    cronLabel: "Build AI Digest",
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
  const activeTokens = useMemo(
    () => sortAccessTokensByRecentConnection(tokens.filter((token) => !token.revokedAt)),
    [tokens],
  );
  // The `in` narrow keeps this typed against the per-context literal config
  // shapes if a future context omits stop support.
  const stopJob = "stopJob" in config ? config.stopJob : undefined;
  const stopLabel = "stopLabel" in config ? config.stopLabel : "Copy stop prompt";

  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [manualCopyPrompt, setManualCopyPrompt] = useState<ManualCopyPrompt | null>(null);
  const [pickerTarget, setPickerTarget] = useState<CopyTarget | null>(null);
  // Job dialog: pick one-time or recurring cadence before the token picker.
  // Both flows include runtime URL params. Recurring setup pins the runtime;
  // one-time prompts pass it as a per-run env override without touching pins.
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
    if (target === "once" || target === "cron") {
      params.set("runtime", extras.cron?.runtime ?? extras.runtime);
    }
    if (extras.cron) {
      params.set("freq", extras.cron.freq);
    }
    if (extras.cron?.overrideFetched || extras.force) {
      params.set("force", "1");
    }
    if (context === "library" && (target === "once" || target === "cron")) {
      params.set("days", String(extras.fetchDays));
      params.set("parallel", String(extras.cron?.parallelWorkers ?? extras.parallelWorkers));
    }
    const promptUrl = `${origin}/api/skill/jobs/${job}/skill.md?${params.toString()}`;
    return `Read ${promptUrl} and follow the instructions.`;
  }

  function markPromptCopied(target: CopyTarget) {
    setManualCopyPrompt(null);
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget(null), 1800);
    setStatus({ kind: "info", text: "Copied. Valid for 10 minutes." });
    window.setTimeout(() => setStatus(null), 8000);
  }

  async function copyPreparedCommand(target: CopyTarget, command: string) {
    const copied = await copyTextToClipboard(command);
    if (copied) {
      markPromptCopied(target);
      return true;
    }
    setManualCopyPrompt({ target, text: command });
    setStatus({
      kind: "error",
      text: "Clipboard did not update. Select the prompt text and copy it.",
    });
    return false;
  }

  async function prepareCommandForToken(
    target: CopyTarget,
    tokenId: string,
    extras: CopyExtras,
  ) {
    const code = await fetchExchangeCode(tokenId);
    if (!code) throw new Error("Could not prepare a secure setup code");
    const command = buildCommand(target, code, extras);
    if (!command) throw new Error("Could not prepare a Local Agent prompt");
    return command;
  }

  async function copyForToken(
    target: CopyTarget,
    tokenId: string,
    extras: CopyExtras,
  ) {
    setStatus(null);
    setManualCopyPrompt(null);
    try {
      const command = await prepareCommandForToken(target, tokenId, extras);
      return await copyPreparedCommand(target, command);
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not prepare a Local Agent prompt",
      });
      return false;
    }
  }

  // After the cron runtime is picked, continue to the token picker
  // (or skip it when there's only one active token). The chosen
  // runtime is held in a closure-captured ref so it survives the
  // dialog round trip.
  async function continueCronCopy(cron: CronConfig) {
    const extras: CopyExtras = {
      cron,
      runtime: cron.runtime,
      force: false,
      fetchDays: cron.fetchDays,
      parallelWorkers: cron.parallelWorkers,
    };
    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: missingAccessMessage });
      return false;
    }
    if (activeTokens.length === 1) {
      return await copyForToken("cron", activeTokens[0].id, extras);
    }
    // Open the token picker with the cron config stashed; we read it back
    // when the user confirms a token.
    pendingExtrasRef.current = extras;
    setPickerTarget("cron");
    return true;
  }

  // Once flow: after the override (+ language) choice, continue to the token picker
  // (or copy directly when there's a single token).
  async function continueOnceCopy(
    runtime: AgentRuntime,
    overrideFetched: boolean,
    fetchDays: number,
    parallelWorkers: number,
  ) {
    const extras: CopyExtras = {
      cron: null,
      runtime,
      force: overrideFetched,
      fetchDays,
      parallelWorkers,
    };
    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: missingAccessMessage });
      return false;
    }
    if (activeTokens.length === 1) {
      return await copyForToken("once", activeTokens[0].id, extras);
    }
    pendingExtrasRef.current = extras;
    setPickerTarget("once");
    return true;
  }

  async function continueScheduleCopy(selection: SchedulePromptSelection) {
    if (selection.target === "once") {
      return await continueOnceCopy(
        selection.runtime,
        selection.overrideFetched,
        selection.fetchDays,
        selection.parallelWorkers,
      );
    }
    return await continueCronCopy(selection.cron);
  }

  async function copyCommand(target: CopyTarget) {
    setStatus(null);

    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: missingAccessMessage });
      return;
    }

    // Schedule dialog handles both one-time and recurring runs. Both selections
    // bake runtime into the prompt URL; recurring selections also bake cadence.
    if (target === "cron") {
      setCronConfigOpen(true);
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken(target, activeTokens[0].id, {
        cron: null,
        runtime: RUNTIME_OPTIONS[0].id,
        force: false,
        fetchDays: DEFAULT_PROMPT_WINDOW_DAYS,
        parallelWorkers: DEFAULT_PARALLEL_WORKERS,
      });
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
      setStatus({ kind: "info", text: missingAccessMessage });
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken("stop", activeTokens[0].id, {
        cron: null,
        runtime: RUNTIME_OPTIONS[0].id,
        force: false,
        fetchDays: DEFAULT_PROMPT_WINDOW_DAYS,
        parallelWorkers: DEFAULT_PARALLEL_WORKERS,
      });
      return;
    }
    setPickerTarget("stop");
  }

  return (
    <div className={compactOnly ? "skill-prompt-compact" : "fb-skill"}>
      {!compactOnly ? (
        <div className="fb-skill-text">
          <span className="fb-section-label skill-prompt-label">{config.title}</span>
          {promptDialogDescription()}
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

      {activeTokens.length === 0 ? (
        <div aria-live="polite" className="skill-prompt-access-required" role="status">
          <KeyRound aria-hidden="true" className="skill-prompt-access-icon" />
          <span className="skill-prompt-access-copy">
            <span className="skill-prompt-access-title">Access key required</span>
            <span className="skill-prompt-access-body">
              Add an access key to set up Local Agent runs.
            </span>
          </span>
          <Link className="fb-btn dark compact" href="/settings">
            Open Settings
          </Link>
        </div>
      ) : (
        <span aria-live="polite" className="skill-prompt-status">
          {status ? (
            status.kind === "info" ? (
              <span className="skill-prompt-status-text">{status.text}</span>
            ) : (
              <span className="skill-prompt-status-text is-error">{status.text}</span>
            )
          ) : null}
        </span>
      )}

      <CronConfigDialog
        open={cronConfigOpen}
        context={context}
        summaryLanguage={summaryLanguage}
        digestMaxPostAgeDays={digestMaxPostAgeDays}
        onCancel={() => setCronConfigOpen(false)}
        onConfirm={async (selection) => {
          const completed = await continueScheduleCopy(selection);
          if (completed) setCronConfigOpen(false);
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
          const extras = pendingExtrasRef.current ?? {
            cron: null,
            runtime: RUNTIME_OPTIONS[0].id,
            force: false,
            fetchDays: DEFAULT_PROMPT_WINDOW_DAYS,
            parallelWorkers: DEFAULT_PARALLEL_WORKERS,
          };
          setPickerTarget(null);
          pendingExtrasRef.current = null;
          if (target) await copyForToken(target, tokenId, extras);
        }}
      />

      {manualCopyPrompt ? (
        <ManualCopyPromptPanel
          key={manualCopyPrompt.text}
          prompt={manualCopyPrompt}
          onCopy={copyPreparedCommand}
        />
      ) : null}
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
  const hydrated = useHydrated();

  // Default = most-recently-used token. Computed; not stored, so opening
  // the dialog with a new token list doesn't need an effect to reset state.
  const defaultTokenId = useMemo(() => {
    if (tokens.length === 0) return "";
    return sortAccessTokensByRecentConnection(tokens)[0]?.id ?? "";
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
            Choose access key
          </h2>
          <p className="token-picker-sub">
            Setup code expires in 10 minutes.
          </p>
        </header>

        <fieldset className="token-picker-list">
          <legend className="sr-only">Access keys</legend>
          {!open ? null : tokens.length === 0 ? (
            <EmptyState
              actions={
                <Link className="fb-btn light compact" href="/settings">
                  Add access key
                </Link>
              }
              body={
                <>
                  Add an access key to set up Local Agent runs.
                </>
              }
              className="token-picker-empty"
              title="No access keys yet"
            />
          ) : (
            tokens.map((token) => {
              const active = token.id === selectedTokenId;
              const tokenLabel = describeAccessDevice(token);
              const statusLabel = describeAccessStatus(token, hydrated);
              return (
                <label
                  key={token.id}
                  className={`token-picker-row${active ? " is-active" : ""}`}
                  data-target={target ?? undefined}
                  aria-label={`${tokenLabel}. ${statusLabel}`}
                >
                  <AccessKeyDeviceIcon className="token-picker-device-icon" token={token} />
                  <span className="token-picker-row-body">
                    <span className="token-picker-row-name">{tokenLabel}</span>
                    <span className="token-picker-row-meta">
                      <span>{statusLabel}</span>
                    </span>
                  </span>
                  <input
                    type="radio"
                    name="agent-token"
                    value={token.id}
                    checked={active}
                    onChange={() => setPickedTokenId(token.id)}
                    className="token-picker-radio"
                  />
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
            {submitting ? "Copying" : "Copy prompt"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function ManualCopyPromptPanel({
  prompt,
  onCopy,
}: {
  prompt: ManualCopyPrompt;
  onCopy: (target: CopyTarget, command: string) => boolean | Promise<boolean>;
}) {
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptTextId = `manual-copy-prompt-${prompt.target}`;

  async function copyPrompt() {
    if (copying) return;
    setCopying(true);
    setError(null);
    try {
      const copied = await onCopy(prompt.target, prompt.text);
      if (!copied) {
        setError("Clipboard did not update. Select the prompt text and copy it.");
      }
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="skill-prompt-manual-copy">
      <label className="skill-prompt-manual-label" htmlFor={promptTextId}>
        Prompt
      </label>
      <textarea
        id={promptTextId}
        className="fb-textarea skill-prompt-manual-text"
        readOnly
        rows={4}
        value={prompt.text}
        onFocus={(e) => e.currentTarget.select()}
      />
      {error ? <p className="cron-field-error skill-prompt-manual-error">{error}</p> : null}
      <button
        className="fb-btn dark compact"
        disabled={copying}
        onClick={() => void copyPrompt()}
        type="button"
      >
        <Copy aria-hidden="true" />
        {copying ? "Copying" : "Copy"}
      </button>
    </div>
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
  const savedLanguage = summaryLanguage ?? null;
  const initialLanguage = savedLanguage ?? ORIGINAL_CONTENT_LANGUAGE_VALUE;
  const [pickedLanguage, setPickedLanguage] = useState(initialLanguage);
  const initialMaxAge = digestMaxPostAgeDays ?? DEFAULT_PROMPT_WINDOW_DAYS;
  const [pickedMaxAge, setPickedMaxAge] = useState(
    String(initialMaxAge),
  );
  const [pickedFetchDays, setPickedFetchDays] = useState(String(DEFAULT_PROMPT_WINDOW_DAYS));
  const [pickedParallelWorkers, setPickedParallelWorkers] = useState(
    String(DEFAULT_PARALLEL_WORKERS),
  );
  const [overrideFetched, setOverrideFetched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogConfig = PROMPT_CONFIG[context];
  const runtimeHint = RUNTIME_OPTIONS.find((o) => o.id === pickedRuntime)?.hint ?? "";

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
      const saved = await persistSummaryLanguage(pickedLanguage, savedLanguage);
      if (!saved) {
        setError("Could not save the summary language. Try again.");
        setSubmitting(false);
        return;
      }
      if (context === "digest") {
        const maxAge = parseWindowDays(pickedMaxAge);
        if (maxAge === null) {
          setError("Lookback window must be a whole number from 1 to 90 days.");
          setSubmitting(false);
          return;
        }
        const savedAge = await persistDigestMaxAge(maxAge, initialMaxAge);
        if (!savedAge) {
          setError("Could not save the lookback window. Try again.");
          setSubmitting(false);
          return;
        }
      }
      const fetchDays =
        context === "library" ? parseWindowDays(pickedFetchDays) : DEFAULT_PROMPT_WINDOW_DAYS;
      if (fetchDays === null) {
        setError("Lookback window must be a whole number from 1 to 90 days.");
        setSubmitting(false);
        return;
      }
      const parallelWorkers =
        context === "library"
          ? parseParallelWorkers(pickedParallelWorkers)
          : DEFAULT_PARALLEL_WORKERS;
      if (parallelWorkers === null) {
        setError(`Parallel tasks must be a whole number from 1 to ${MAX_PARALLEL_WORKERS}.`);
        setSubmitting(false);
        return;
      }
      if (pickedFreq === "once") {
        await onConfirm({
          target: "once",
          runtime: pickedRuntime,
          overrideFetched,
          fetchDays,
          parallelWorkers,
        });
      } else {
        await onConfirm({
          target: "cron",
          cron: {
            runtime: pickedRuntime,
            freq: pickedFreq,
            overrideFetched,
            fetchDays,
            parallelWorkers,
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
        className="token-picker-form"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <header className="token-picker-header">
          <h2 id="cron-config-title" className="token-picker-title">
            {dialogConfig.title}
          </h2>
          <p className="token-picker-sub">
            {promptDialogDescription()}
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

          {context === "library" ? (
            <>
              <div className="cron-field">
                <label htmlFor="cron-parallel-workers" className="cron-field-label">
                  Parallel tasks
                </label>
                <select
                  id="cron-parallel-workers"
                  className="cron-field-select"
                  value={pickedParallelWorkers}
                  onChange={(e) => setPickedParallelWorkers(e.target.value)}
                >
                  {Array.from({ length: MAX_PARALLEL_WORKERS }, (_, index) => index + 1).map(
                    (count) => (
                      <option key={count} value={count}>
                        {count === 1 ? "1 task" : `${count} tasks`}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <p className="cron-field-hint">
                Use 1 for reliability.
              </p>
            </>
          ) : null}

          <SummaryLanguageField
            id="cron-lang"
            label={context === "digest" ? "AI Digest language" : "Summary language"}
            value={pickedLanguage}
            onChange={setPickedLanguage}
          />

          {context === "digest" ? (
            <>
              <MaxAgeField
                id="cron-max-age"
                label="Lookback window (days)"
                value={pickedMaxAge}
                onChange={setPickedMaxAge}
              />
              <p className="cron-field-hint">
                Default: 30 days. Range: 1-90.
              </p>
            </>
          ) : (
            <>
              <MaxAgeField
                id="cron-fetch-days"
                label="Lookback window (days)"
                value={pickedFetchDays}
                onChange={setPickedFetchDays}
              />
              <p className="cron-field-hint">
                Default: 30 days. Range: 1-90.
              </p>
            </>
          )}

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
            {submitting ? "Copying" : "Copy"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
