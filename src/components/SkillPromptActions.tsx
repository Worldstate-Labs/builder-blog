"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, CircleStop, Copy, KeyRound } from "lucide-react";
import {
  AccessStatusText,
  AccessKeyDeviceIcon,
  describeAccessDevice,
  describeAccessStatus,
  sortAccessTokensByRecentConnection,
  visibleAccessTokens,
  type AgentTokenListItem,
} from "@/components/AgentTokenPanel";
import { EmptyState } from "@/components/EmptyState";
import { RelativeTime } from "@/components/RelativeTime";
import { languageOptions } from "@/components/settings/SettingsFields";
import { useHydrated } from "@/components/ThemeToggle";
import { ORIGINAL_CONTENT_LANGUAGE_VALUE } from "@/lib/language-preference";

type SkillPromptContext = "library" | "digest";
type CopyTarget = "once" | "cron" | "stop";
type AgentRuntime = "claude" | "codex" | "hermes" | "openclaw";
type RuntimeType = "cloud" | "local";
type StopFetchTarget = "cloud" | "local";

const RUNTIME_OPTIONS: { id: AgentRuntime; label: string }[] = [
  {
    id: "claude",
    label: "Claude Code",
  },
  {
    id: "codex",
    label: "Codex",
  },
  {
    id: "hermes",
    label: "Hermes",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
  },
];

// Cron cadence. `id` values match the server whitelist in the
// jobs/[job]/skill.md route, which maps each to a fixed cron expression.
type CronFrequency = "30m" | "1h" | "12h" | "daily" | "weekly";
type ScheduleFrequency = "once" | CronFrequency;
// `overrideFetched` = one-time re-fetch/reuse behavior. Cron schedules never
// carry it because recurring jobs should keep normal incremental boundaries.
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
export type ActiveScheduleInfo = {
  frequencyLabel: string;
  runtime: string | null;
  startedAt: string;
  hostname: string | null;
  platform: string | null;
};
const missingAccessMessage = "Add an access key to set up Local Agent runs.";
function promptDialogDescription(context: SkillPromptContext, runtimeType: RuntimeType = "local") {
  if (context === "library") {
    return runtimeType === "cloud"
      ? "Submit a request for FollowBrief to fetch sources in your library."
      : "Copy instructions for your agent to fetch sources in your library.";
  }
  return "Copy instructions for your agent to build AI Brief.";
}

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
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Every week" },
];

const FREQUENCY_OPTIONS: Record<SkillPromptContext, { id: ScheduleFrequency; label: string }[]> = {
  library: FREQUENCY_CHOICES,
  digest: FREQUENCY_CHOICES,
};
const CLOUD_FREQUENCY_OPTIONS: { id: "day" | "week"; label: string }[] = [
  { id: "day", label: "Every day" },
  { id: "week", label: "Every week" },
];

const DEFAULT_FREQUENCY: Record<SkillPromptContext, ScheduleFrequency> = {
  library: "once",
  digest: "once",
};

// Account-wide summary output language. The fixed-language values are fed into
// prompts; the special "source" value means summarize in the source content's
// own language.
const DEFAULT_PROMPT_WINDOW_DAYS = 30;
const MAX_PROMPT_WINDOW_DAYS = 90;
const DEFAULT_PARALLEL_WORKERS = 5;
const MAX_PARALLEL_WORKERS = 8;

// The override toggle reuses one URL channel (?force=1) but means different
// things per context, so its copy is context-specific. Library: re-fetch posts
// already in the source library. Digest: re-include posts already used in AI Brief
// (additive — adds a new AI Brief that re-covers those posts, never deletes or
// replaces past ones).
const OVERRIDE_COPY: Record<
  SkillPromptContext,
  { name: string; onceHint: string }
> = {
  library: {
    name: "Re-fetch existing posts",
    onceHint:
      "Re-fetch existing source posts once.",
  },
  digest: {
    name: "Reuse posts from past issues",
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
    stopLabel: "Stop fetching",
  },
  digest: {
    title: "Build AI Brief",
    onceLabel: "Copy one-time prompt",
    cronLabel: "Build AI Brief",
    onceJob: "digest-once",
    cronJob: "digest-cron-setup",
    stopJob: "digest-cron-stop",
    stopLabel: "Stop AI Brief",
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
  activeSchedule = null,
  cloudFetchActive = false,
  context,
  localFetchActive,
  tokens = [],
  summaryLanguage = null,
  digestMaxPostAgeDays = null,
  compactOnly = false,
  showStop = true,
}: {
  activeSchedule?: ActiveScheduleInfo | null;
  cloudFetchActive?: boolean;
  context: SkillPromptContext;
  localFetchActive?: boolean;
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
    () => visibleAccessTokens(tokens),
    [tokens],
  );
  // The `in` narrow keeps this typed against the per-context literal config
  // shapes if a future context omits stop support.
  const stopJob = "stopJob" in config ? config.stopJob : undefined;
  const stopLabel = "stopLabel" in config ? config.stopLabel : "Stop fetching";
  const [cloudStopDismissed, setCloudStopDismissed] = useState(false);
  const router = useRouter();
  // Optimistic flag: a cloud submission POST just succeeded on the client, so
  // the "Stop fetching" button should appear immediately, without waiting for
  // the Sources RSC (page.tsx) to re-render with a fresh submittedSourceCount.
  // A router.refresh() reconciles this with the server-truth prop right after.
  const [optimisticCloudActive, setOptimisticCloudActive] = useState(false);
  const cloudActive = cloudFetchActive || optimisticCloudActive;
  const localStopActive = localFetchActive ?? showStop;
  const canStopLocal = Boolean(stopJob && localStopActive);
  const canStopCloud = context === "library" && cloudActive && !cloudStopDismissed;
  // showStop is derived server-side from submittedSourceCount; when we've
  // optimistically activated cloud, force the stop affordance on as well.
  const effectiveShowStop = showStop || (context === "library" && optimisticCloudActive);
  const showStopButton = effectiveShowStop && (canStopLocal || canStopCloud);

  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [manualCopyPrompt, setManualCopyPrompt] = useState<ManualCopyPrompt | null>(null);
  const [pickerTarget, setPickerTarget] = useState<CopyTarget | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
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

    // Schedule dialog handles both one-time and recurring runs. Both selections
    // bake runtime into the prompt URL; recurring selections also bake cadence.
    if (target === "cron") {
      setCronConfigOpen(true);
      return;
    }
    if (activeTokens.length === 0) {
      setStatus({ kind: "info", text: missingAccessMessage });
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

  function openStopDialog() {
    if (!canStopLocal && !canStopCloud) return;
    setStatus(null);
    setStopDialogOpen(true);
  }

  async function copyStopCommand(target: StopFetchTarget) {
    if (target === "cloud") {
      try {
        const response = await fetch("/api/cloud-library/source-submissions", {
          method: "DELETE",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setStatus({
            kind: "error",
            text: body?.error ?? "Could not stop cloud fetching.",
          });
          return false;
        }
        setCloudStopDismissed(true);
        setOptimisticCloudActive(false);
        setStatus({
          kind: "info",
          text: `Cloud fetching stopped for ${body?.stoppedSources ?? 0} source${
            body?.stoppedSources === 1 ? "" : "s"
          }.`,
        });
        setStopDialogOpen(false);
        router.refresh();
        return true;
      } catch {
        setStatus({ kind: "error", text: "Could not stop cloud fetching." });
        return false;
      }
    }
    if (!stopJob) return false;
    try {
      const response = await fetch("/api/skill/cron-jobs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: context === "digest" ? "digest-cron" : "library-cron" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus({
          kind: "error",
          text: body?.error ?? "Could not stop the local schedule.",
        });
        return false;
      }
      setStatus({
        kind: "info",
        text: "Local schedule stopped. Any installed Local Agent schedule will remove itself on its next check.",
      });
      setStopDialogOpen(false);
      router.refresh();
      return true;
    } catch {
      setStatus({ kind: "error", text: "Could not stop the local schedule." });
      return false;
    }
  }

  // A cloud submission just succeeded: reveal Stop immediately (optimistic),
  // clear any prior stop-dismissal, then reconcile with server truth via a
  // refresh so the RSC re-reads submittedSourceCount.
  function handleCloudSubmitted() {
    setCloudStopDismissed(false);
    setOptimisticCloudActive(true);
    router.refresh();
  }

  return (
    <div className={compactOnly ? "skill-prompt-compact" : "fb-skill"}>
      {!compactOnly ? (
        <div className="fb-skill-text">
          <span className="fb-section-label skill-prompt-label">{config.title}</span>
          {promptDialogDescription(context)}
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
      {showStopButton ? (
        <button
          className="fb-btn light compact"
          onClick={openStopDialog}
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
        onCloudSubmitted={handleCloudSubmitted}
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

      <StopScheduleDialog
        open={stopDialogOpen}
        context={context}
        canStopCloud={canStopCloud}
        canStopLocal={canStopLocal}
        schedule={activeSchedule}
        title={stopLabel}
        onCancel={() => setStopDialogOpen(false)}
        onConfirm={copyStopCommand}
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

function StopScheduleDialog({
  open,
  canStopCloud,
  canStopLocal,
  context,
  schedule,
  title,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  canStopCloud: boolean;
  canStopLocal: boolean;
  context: SkillPromptContext;
  schedule: ActiveScheduleInfo | null;
  title: string;
  onCancel: () => void;
  onConfirm: (target: StopFetchTarget) => boolean | void | Promise<boolean | void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<StopFetchTarget>("local");
  const scheduleName = context === "digest" ? "AI Brief" : "Fetch sources";
  const machineLabel = formatScheduleMachine(schedule);
  const showFetchTargetPicker = context === "library";
  const effectiveSelectedTarget =
    selectedTarget === "cloud" && canStopCloud
      ? "cloud"
      : selectedTarget === "local" && canStopLocal
        ? "local"
        : canStopLocal
          ? "local"
          : "cloud";

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
    if (effectiveSelectedTarget === "local" && !canStopLocal) return;
    if (effectiveSelectedTarget === "cloud" && !canStopCloud) return;
    setSubmitting(true);
    try {
      await onConfirm(effectiveSelectedTarget);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="stop-schedule-title"
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
          <h2 id="stop-schedule-title" className="token-picker-title">
            {title}
          </h2>
          {showFetchTargetPicker ? null : (
            <p className="token-picker-sub">
              Stop the server-authorized recurring schedule.
            </p>
          )}
        </header>

        <div className="stop-schedule-body">
          {showFetchTargetPicker ? (
            <fieldset className="stop-schedule-targets">
              <legend className="cron-field-label">Fetching runtime</legend>
              <label className="cron-check">
                <input
                  type="radio"
                  name="stop-fetch-target"
                  value="local"
                  checked={effectiveSelectedTarget === "local"}
                  disabled={!canStopLocal || submitting}
                  onChange={() => setSelectedTarget("local")}
                  className="cron-check-input"
                />
                <span className="cron-check-body">
                  <span className="cron-check-name">Your Local Agent</span>
                  <span className="cron-field-hint">
                    {canStopLocal
                      ? "Stop the server-authorized local recurring schedule."
                      : "No local run is active."}
                  </span>
                </span>
              </label>
              <label className="cron-check">
                <input
                  type="radio"
                  name="stop-fetch-target"
                  value="cloud"
                  checked={effectiveSelectedTarget === "cloud"}
                  disabled={!canStopCloud || submitting}
                  onChange={() => setSelectedTarget("cloud")}
                  className="cron-check-input"
                />
                <span className="cron-check-body">
                  <span className="cron-check-name">Cloud</span>
                  <span className="cron-field-hint">
                    {canStopCloud
                      ? "Stop cloud fetching for your submitted sources."
                      : "No cloud Fetch sources submission is active."}
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}
          <dl className="stop-schedule-details">
            <div className="stop-schedule-detail">
              <dt>Schedule</dt>
              <dd>
                {showFetchTargetPicker
                  ? effectiveSelectedTarget === "cloud"
                    ? "Cloud Fetch sources"
                    : "Local Agent Fetch sources"
                  : scheduleName}
              </dd>
            </div>
            {effectiveSelectedTarget === "local" ? (
              <>
                <div className="stop-schedule-detail">
                  <dt>Frequency</dt>
                  <dd>{schedule?.frequencyLabel ?? "Active schedule"}</dd>
                </div>
                <div className="stop-schedule-detail">
                  <dt>Runtime</dt>
                  <dd>{formatScheduleRuntime(schedule?.runtime ?? null)}</dd>
                </div>
                <div className="stop-schedule-detail">
                  <dt>Started</dt>
                  <dd>
                    <RelativeTime value={schedule?.startedAt} fallback="Unknown" />
                  </dd>
                </div>
                {machineLabel ? (
                  <div className="stop-schedule-detail">
                    <dt>Device</dt>
                    <dd>{machineLabel}</dd>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="stop-schedule-detail">
                <dt>Effect</dt>
                <dd>Deactivate your cloud source submissions and cancel queued cloud fetches.</dd>
              </div>
            )}
          </dl>
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
            disabled={
              submitting ||
              (effectiveSelectedTarget === "local" && !canStopLocal) ||
              (effectiveSelectedTarget === "cloud" && !canStopCloud)
            }
          >
            <CircleStop aria-hidden="true" />
            {submitting
              ? "Stopping"
              : "Stop"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function formatScheduleRuntime(runtime: string | null) {
  if (!runtime) return "Default runtime";
  return RUNTIME_OPTIONS.find((option) => option.id === runtime)?.label ?? runtime;
}

function formatScheduleMachine(schedule: ActiveScheduleInfo | null) {
  if (!schedule) return null;
  const parts = [schedule.hostname, schedule.platform].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
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
                      <AccessStatusText token={token} />
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
  onCloudSubmitted,
  onConfirm,
}: {
  open: boolean;
  context: SkillPromptContext;
  summaryLanguage: string | null;
  digestMaxPostAgeDays: number | null;
  onCancel: () => void;
  onCloudSubmitted?: () => void;
  onConfirm: (selection: SchedulePromptSelection) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [runtimeType, setRuntimeType] = useState<RuntimeType>("local");
  const [pickedRuntime, setPickedRuntime] = useState<AgentRuntime>(RUNTIME_OPTIONS[0].id);
  const freqOptions = FREQUENCY_OPTIONS[context];
  const [pickedFreq, setPickedFreq] = useState<ScheduleFrequency>(DEFAULT_FREQUENCY[context]);
  const [pickedCloudFrequency, setPickedCloudFrequency] = useState<"day" | "week">("day");
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
  const [cloudSubmitMessage, setCloudSubmitMessage] = useState<string | null>(null);
  const [cloudExisting, setCloudExisting] = useState<{
    hasActiveSubmission: boolean;
    activeSourceCount: number;
    summaryLanguage: string | null;
    frequency: "DAILY" | "WEEKLY" | null;
    lastSubmittedAt: string | null;
  } | null>(null);
  const dialogConfig = PROMPT_CONFIG[context];
  const isCloudMode = context === "library" && runtimeType === "cloud";
  // One submission per user: when a prior submission exists, the submit becomes
  // an explicit overwrite.
  const cloudSubmitLabel = submitting
    ? "Submitting"
    : cloudExisting?.hasActiveSubmission
      ? "Overwrite & submit"
      : "Submit";

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

  // Load the user's existing cloud submission so we can warn before overwriting.
  // Failures degrade silently: no notice, button stays "Submit".
  useEffect(() => {
    if (!open || !isCloudMode) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/cloud-library/source-submissions");
        if (!res.ok) {
          if (!cancelled) setCloudExisting(null);
          return;
        }
        const data = await res.json();
        if (!cancelled) setCloudExisting(data);
      } catch {
        if (!cancelled) setCloudExisting(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isCloudMode]);

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setCloudSubmitMessage(null);
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
      if (isCloudMode) {
        const response = await fetch("/api/cloud-library/source-submissions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            frequency: pickedCloudFrequency,
            summaryLanguage: pickedLanguage,
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.error ?? "Could not submit sources to FollowBrief Cloud.");
          setSubmitting(false);
          return;
        }
        const replaced = Number(body?.supersededSources ?? 0);
        setCloudSubmitMessage(
          `Submitted ${body?.sourcesSubmitted ?? 0} source${body?.sourcesSubmitted === 1 ? "" : "s"} and ${body?.tasksSubmitted ?? 0} task${body?.tasksSubmitted === 1 ? "" : "s"}.${
            replaced > 0 ? ` Replaced ${replaced} previous source${replaced === 1 ? "" : "s"}.` : ""
          }`,
        );
        onCloudSubmitted?.();
        window.setTimeout(onCancel, 700);
        return;
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
            overrideFetched: false,
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
            {promptDialogDescription(context, runtimeType)}
          </p>
        </header>

        <div className="cron-config-body">
          {context === "library" ? (
            <div className="cron-field">
              <label htmlFor="cron-runtime-type" className="cron-field-label">
                Runtime type
              </label>
              <select
                id="cron-runtime-type"
                className="cron-field-select"
                value={runtimeType}
                onChange={(e) => {
                  const next = e.target.value as RuntimeType;
                  setRuntimeType(next);
                }}
              >
                <option value="cloud">Cloud</option>
                <option value="local">Your Local Agent</option>
              </select>
            </div>
          ) : null}

          {isCloudMode && cloudExisting?.hasActiveSubmission ? (
            <p className="cron-field-hint" role="status">
              {`You already submitted ${cloudExisting.activeSourceCount} ${
                cloudExisting.activeSourceCount === 1 ? "source" : "sources"
              }${
                cloudExisting.frequency === "DAILY"
                  ? " · Daily"
                  : cloudExisting.frequency === "WEEKLY"
                    ? " · Weekly"
                    : ""
              }. Submitting again overwrites your previous submission — switching language deactivates the old language.`}
            </p>
          ) : null}

          <div className="cron-field">
            <label htmlFor="cron-freq" className="cron-field-label">
              Frequency
            </label>
            {runtimeType === "cloud" ? (
              <select
                id="cron-freq"
                className="cron-field-select"
                value={pickedCloudFrequency}
                onChange={(e) => setPickedCloudFrequency(e.target.value as "day" | "week")}
              >
                {CLOUD_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
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
            )}
          </div>

          {runtimeType === "local" ? (
            <>
              <div className="cron-field">
                <label htmlFor="cron-runtime" className="cron-field-label">
                  Agent
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
            </>
          ) : null}

          <SummaryLanguageField
            id="cron-lang"
            label={context === "digest" ? "AI Brief language" : "Summary language"}
            value={pickedLanguage}
            onChange={setPickedLanguage}
          />

          {context === "digest" || runtimeType === "local" ? (
            <section className="cron-advanced-section" aria-labelledby="cron-advanced-title">
              <h3 id="cron-advanced-title" className="token-picker-grouplabel">
                Advanced
              </h3>

              {context === "library" && runtimeType === "local" ? (
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
                      {Array.from(
                        { length: MAX_PARALLEL_WORKERS },
                        (_, index) => index + 1,
                      ).map((count) => (
                        <option key={count} value={count}>
                          {count === 1 ? "1 task" : `${count} tasks`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="cron-field-hint">
                    Controls how many source fetch tasks run at the same time.
                  </p>
                </>
              ) : null}

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
              ) : runtimeType === "local" ? (
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
              ) : null}

              {isOneTime && runtimeType === "local" ? (
                <>
                  <div className="cron-field">
                    <label htmlFor="cron-override-fetched" className="cron-field-label">
                      {override.name}
                    </label>
                    <select
                      id="cron-override-fetched"
                      className="cron-field-select"
                      value={overrideFetched ? "yes" : "no"}
                      onChange={(e) => setOverrideFetched(e.target.value === "yes")}
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </div>
                  <p className="cron-field-hint">
                    {override.onceHint}
                  </p>
                </>
              ) : null}
            </section>
          ) : null}

          {error ? <p className="cron-field-error">{error}</p> : null}
          {cloudSubmitMessage ? <p className="cron-field-hint">{cloudSubmitMessage}</p> : null}
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
            {runtimeType === "cloud"
              ? cloudSubmitLabel
              : (submitting ? "Copying" : "Copy")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
