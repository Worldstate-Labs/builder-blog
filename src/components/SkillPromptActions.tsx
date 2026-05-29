"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, Copy, Terminal } from "lucide-react";
import {
  describeMachine,
  type AgentTokenListItem,
} from "@/components/AgentTokenPanel";

type SkillPromptContext = "library" | "digest";
type CopyTarget = "once" | "cron";
type AgentRuntime = "claude" | "codex" | "gemini" | "openclaw";

const RUNTIME_OPTIONS: { id: AgentRuntime; label: string; hint: string }[] = [
  {
    id: "claude",
    label: "Claude Code",
    hint: "Unattended: --permission-mode acceptEdits + Bash/Edit/Read/Write/Grep/Glob/WebFetch allowlist",
  },
  { id: "codex", label: "Codex", hint: "Unattended: --full-auto (approval=never, workspace-write sandbox)" },
  { id: "gemini", label: "Gemini CLI", hint: "Unattended: --yolo (skip all confirmation prompts)" },
  { id: "openclaw", label: "OpenClaw", hint: "Unattended: --auto-approve" },
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

const PROMPT_CONFIG = {
  library: {
    title: "Source sync",
    onceLabel: "Copy once prompt",
    cronLabel: "Copy cron prompt",
    onceJob: "library-once",
    cronJob: "library-cron-setup",
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
  // Cron-only: the runtime + cadence the scheduled job should use. Picked
  // in one dialog before the token picker, then appended to the prompt URL
  // so the server-rendered markdown bakes in the right unattended
  // invocation and crontab schedule.
  const [cronConfigOpen, setCronConfigOpen] = useState(false);
  // Library once: a tiny dialog to optionally override already-fetched posts
  // before copying (digest once has nothing to configure → no dialog).
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

  // Library once: after the override choice, continue to the token picker
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
    // Cron flow: pick runtime + cadence (+ override) first. Library once
    // flow: a small dialog to pick the override. Both bake their choice into
    // the rendered prompt. Digest once has nothing to configure.
    if (target === "cron") {
      setCronConfigOpen(true);
      return;
    }
    if (target === "once" && context === "library") {
      setOnceConfigOpen(true);
      return;
    }
    if (activeTokens.length === 1) {
      await copyForToken(target, activeTokens[0].id, { cron: null, force: false });
      return;
    }
    setPickerTarget(target);
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
        onCancel={() => setCronConfigOpen(false)}
        onConfirm={async (cron) => {
          setCronConfigOpen(false);
          await continueCronCopy(cron);
        }}
      />

      <OnceConfigDialog
        open={onceConfigOpen}
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
  onCancel,
  onConfirm,
}: {
  open: boolean;
  context: SkillPromptContext;
  onCancel: () => void;
  onConfirm: (cron: CronConfig) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pickedRuntime, setPickedRuntime] = useState<AgentRuntime>(RUNTIME_OPTIONS[0].id);
  const freqOptions = FREQUENCY_OPTIONS[context];
  const [pickedFreq, setPickedFreq] = useState<CronFrequency>(DEFAULT_FREQUENCY[context]);
  // Override = re-fetch already-saved posts on every run. Only the library
  // job fetches personal items, so the toggle is hidden for digest.
  const showOverride = context === "library";
  const [overrideFetched, setOverrideFetched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    try {
      await onConfirm({
        runtime: pickedRuntime,
        freq: pickedFreq,
        overrideFetched: showOverride && overrideFetched,
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
            Cron is unattended — the runner pins the runtime and invokes it in
            its allowlist / auto-approve mode so no permission prompts fire, and
            installs the crontab at the cadence you choose.
          </p>
        </header>

        <p className="token-picker-grouplabel">Agent runtime</p>
        <fieldset className="token-picker-list">
          <legend className="sr-only">Agent runtimes</legend>
          {RUNTIME_OPTIONS.map((option) => {
            const active = option.id === pickedRuntime;
            return (
              <label
                key={option.id}
                className={`token-picker-row${active ? " is-active" : ""}`}
              >
                <input
                  type="radio"
                  name="agent-runtime"
                  value={option.id}
                  checked={active}
                  onChange={() => setPickedRuntime(option.id)}
                  className="token-picker-radio"
                />
                <span className="token-picker-row-body">
                  <span className="token-picker-row-name">{option.label}</span>
                  <span className="token-picker-row-meta">
                    <span>{option.hint}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <p className="token-picker-grouplabel">Frequency</p>
        <fieldset className="token-picker-list">
          <legend className="sr-only">Schedule frequency</legend>
          {freqOptions.map((option) => {
            const active = option.id === pickedFreq;
            return (
              <label
                key={option.id}
                className={`token-picker-row${active ? " is-active" : ""}`}
              >
                <input
                  type="radio"
                  name="cron-frequency"
                  value={option.id}
                  checked={active}
                  onChange={() => setPickedFreq(option.id)}
                  className="token-picker-radio"
                />
                <span className="token-picker-row-body">
                  <span className="token-picker-row-name">{option.label}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {showOverride ? (
          <>
            <p className="token-picker-grouplabel">Already-fetched posts</p>
            <fieldset className="token-picker-list">
              <legend className="sr-only">Re-fetch behavior</legend>
              <label
                className={`token-picker-row${overrideFetched ? " is-active" : ""}`}
              >
                <input
                  type="checkbox"
                  name="override-fetched"
                  checked={overrideFetched}
                  onChange={(e) => setOverrideFetched(e.target.checked)}
                  className="token-picker-radio"
                />
                <span className="token-picker-row-body">
                  <span className="token-picker-row-name">
                    Override already-fetched posts
                  </span>
                  <span className="token-picker-row-meta">
                    <span>
                      Re-fetch on every run (passes --force): ignores the
                      last-fetched cutoff and re-pulls posts already in your
                      library. Off by default — leave off unless you want each
                      scheduled run to refresh everything.
                    </span>
                  </span>
                </span>
              </label>
            </fieldset>
          </>
        ) : null}

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

// Library once: a single optional toggle — re-fetch posts already saved in the
// library (passes --force to the one-off fetch). Cron has its own dialog with
// runtime + cadence; once only needs this.
function OnceConfigDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (overrideFetched: boolean) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [overrideFetched, setOverrideFetched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    try {
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
            Run the sync once
          </h2>
          <p className="token-picker-sub">
            By default this fetches only posts newer than what&rsquo;s already in
            your library.
          </p>
        </header>

        <p className="token-picker-grouplabel">Already-fetched posts</p>
        <fieldset className="token-picker-list">
          <legend className="sr-only">Re-fetch behavior</legend>
          <label
            className={`token-picker-row${overrideFetched ? " is-active" : ""}`}
          >
            <input
              type="checkbox"
              name="override-fetched"
              checked={overrideFetched}
              onChange={(e) => setOverrideFetched(e.target.checked)}
              className="token-picker-radio"
            />
            <span className="token-picker-row-body">
              <span className="token-picker-row-name">
                Override already-fetched posts
              </span>
              <span className="token-picker-row-meta">
                <span>
                  Passes --force: ignores the last-fetched cutoff and re-pulls
                  posts already in your library. One-time for this run only.
                </span>
              </span>
            </span>
          </label>
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
