"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ChipListField,
  clampRatio,
  FieldNumber,
  FieldSelect,
  FieldText,
  FieldTextarea,
  FooterBar,
  languageOptions,
  Section,
  Toggle,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";

export type AdminSourceTypeConfig = {
  sourceId: string;
  label: string;
  agentDefaultStatus: string;
  defaultFetchDays: number;
  defaultFetchLimit: number;
  contentQuality: unknown;
  summaryPromptBody: string;
  fetchPromptBody: string | null;
  summaryStyle: string;
  summaryLanguage: string;
  summaryLengthHint: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

type ContentQuality = {
  primaryContentOnly: boolean;
  minChars: number;
  minWords: number;
  minUniqueWordRatio: number | null;
  maxTimestampWordRatio: number | null;
  disallowedPrimarySources: string[];
};

type Draft = {
  label: string;
  summaryStyle: string;
  summaryLanguage: string;
  agentDefaultStatus: string;
  defaultFetchDays: string;
  defaultFetchLimit: string;
  summaryLengthHint: string;
  summaryPromptBody: string;
  fetchPromptBody: string;
  contentQuality: ContentQuality;
};

type Status = SaveStatusState;

const SUMMARY_STYLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "x_twitter", label: "X" },
  { value: "podcast_or_video", label: "Podcast / Video" },
  { value: "blog_or_document", label: "Blog / Document" },
];

const AGENT_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ready", label: "Ready · no agent needed" },
  { value: "requires_agent", label: "Requires agent" },
];

function toContentQuality(raw: unknown): ContentQuality {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
  const disallowed = Array.isArray(obj.disallowedPrimarySources)
    ? (obj.disallowedPrimarySources.filter((v) => typeof v === "string") as string[])
    : [];
  return {
    primaryContentOnly: obj.primaryContentOnly !== false,
    minChars: typeof obj.minChars === "number" ? obj.minChars : 0,
    minWords: typeof obj.minWords === "number" ? obj.minWords : 0,
    minUniqueWordRatio: typeof obj.minUniqueWordRatio === "number" ? obj.minUniqueWordRatio : null,
    maxTimestampWordRatio:
      typeof obj.maxTimestampWordRatio === "number" ? obj.maxTimestampWordRatio : null,
    disallowedPrimarySources: disallowed,
  };
}

function toDraft(config: AdminSourceTypeConfig): Draft {
  return {
    label: config.label,
    summaryStyle: config.summaryStyle,
    summaryLanguage: config.summaryLanguage,
    agentDefaultStatus: config.agentDefaultStatus,
    defaultFetchDays: String(config.defaultFetchDays),
    defaultFetchLimit: String(config.defaultFetchLimit),
    summaryLengthHint: config.summaryLengthHint ?? "",
    summaryPromptBody: config.summaryPromptBody,
    fetchPromptBody: config.fetchPromptBody ?? "",
    contentQuality: toContentQuality(config.contentQuality),
  };
}

export function AdminSourceTypeManager({
  initialConfigs,
}: {
  initialConfigs: AdminSourceTypeConfig[];
}) {
  const [configs, setConfigs] = useState(initialConfigs);
  return (
    <div className="grid gap-3">
      {configs.map((config) => (
        <SourceTypeCard
          key={config.sourceId}
          config={config}
          onSaved={(next) =>
            setConfigs((current) =>
              current.map((c) => (c.sourceId === next.sourceId ? next : c)),
            )
          }
        />
      ))}
    </div>
  );
}

function SourceTypeCard({
  config,
  onSaved,
}: {
  config: AdminSourceTypeConfig;
  onSaved: (next: AdminSourceTypeConfig) => void;
}) {
  const baseline = useMemo(() => toDraft(config), [config]);
  const [draft, setDraft] = useState<Draft>(baseline);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (status.kind !== "idle") setStatus({ kind: "idle" });
  }
  function updateQuality<K extends keyof ContentQuality>(key: K, value: ContentQuality[K]) {
    setDraft((current) => ({
      ...current,
      contentQuality: { ...current.contentQuality, [key]: value },
    }));
    if (status.kind !== "idle") setStatus({ kind: "idle" });
  }

  function reset() {
    setDraft(baseline);
    setStatus({ kind: "idle" });
  }

  function save() {
    const days = Number(draft.defaultFetchDays);
    const limit = Number(draft.defaultFetchLimit);
    if (!Number.isInteger(days) || days < 1) {
      setStatus({ kind: "error", message: "Default fetch days must be an integer ≥ 1." });
      return;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      setStatus({ kind: "error", message: "Default fetch limit must be an integer ≥ 1." });
      return;
    }
    const cq = draft.contentQuality;
    if (!Number.isInteger(cq.minChars) || cq.minChars < 0) {
      setStatus({ kind: "error", message: "Min chars must be a non-negative integer." });
      return;
    }
    if (!Number.isInteger(cq.minWords) || cq.minWords < 0) {
      setStatus({ kind: "error", message: "Min words must be a non-negative integer." });
      return;
    }
    for (const [field, label] of [
      ["minUniqueWordRatio", "Min unique-word ratio"],
      ["maxTimestampWordRatio", "Max timestamp-word ratio"],
    ] as const) {
      const ratio = cq[field];
      if (ratio !== null && (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)) {
        setStatus({ kind: "error", message: `${label} must be between 0 and 1.` });
        return;
      }
    }

    const contentQuality: Record<string, unknown> = {
      primaryContentOnly: cq.primaryContentOnly,
      minChars: cq.minChars,
      minWords: cq.minWords,
      disallowedPrimarySources: cq.disallowedPrimarySources,
    };
    if (cq.minUniqueWordRatio !== null && Number.isFinite(cq.minUniqueWordRatio)) {
      contentQuality.minUniqueWordRatio = cq.minUniqueWordRatio;
    }
    if (cq.maxTimestampWordRatio !== null && Number.isFinite(cq.maxTimestampWordRatio)) {
      contentQuality.maxTimestampWordRatio = cq.maxTimestampWordRatio;
    }

    const patch = {
      label: draft.label.trim(),
      summaryStyle: draft.summaryStyle,
      summaryLanguage: draft.summaryLanguage.trim(),
      agentDefaultStatus: draft.agentDefaultStatus,
      defaultFetchDays: days,
      defaultFetchLimit: limit,
      summaryLengthHint:
        draft.summaryLengthHint.trim() === "" ? null : draft.summaryLengthHint.trim(),
      summaryPromptBody: draft.summaryPromptBody,
      fetchPromptBody: draft.fetchPromptBody.trim() === "" ? null : draft.fetchPromptBody,
      contentQuality,
    };

    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/source-types", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: config.sourceId, patch }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        onSaved(body.config);
        setStatus({ kind: "saved", message: "Saved" });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Save failed",
        });
      }
    });
  }

  return (
    <details className="fb-panel" style={{ padding: 0 }}>
      <summary
        className="cursor-pointer select-none"
        style={{ listStyle: "none", padding: "0.875rem 1.125rem" }}
      >
        <CardHeader config={config} dirty={dirty} draftLabel={draft.label} />
      </summary>

      <div className="border-t border-[var(--line)]" style={{ padding: "1.25rem 1.125rem 1rem" }}>
        <Section
          step="01"
          title="Identity"
          description="How this source type is named in the UI."
        >
          <FieldText
            label="Label"
            value={draft.label}
            onChange={(v) => update("label", v)}
          />
        </Section>

        <Section
          step="02"
          title="Fetching"
          description="When and how the CLI / agent acquires items for this source."
        >
          <div className="grid gap-4 md:grid-cols-[1fr_8rem_8rem]">
            <FieldSelect
              label="Agent default status"
              value={draft.agentDefaultStatus}
              options={AGENT_STATUS_OPTIONS}
              onChange={(v) => update("agentDefaultStatus", v)}
            />
            <FieldNumber
              label="Default days"
              min={1}
              value={draft.defaultFetchDays}
              onChange={(v) => update("defaultFetchDays", v)}
            />
            <FieldNumber
              label="Default limit"
              min={1}
              value={draft.defaultFetchLimit}
              onChange={(v) => update("defaultFetchLimit", v)}
            />
          </div>
          <FieldTextarea
            label="Fetch prompt · optional"
            rows={12}
            mono
            description={
              draft.agentDefaultStatus === "requires_agent"
                ? "Surfaced to the agent in fallback fetch tasks so it can decide HOW to acquire content (e.g. for podcasts: try show notes first, else download audio + Whisper transcribe)."
                : "Only used when this source is set to Requires agent. Currently unused — kept here in case the status changes."
            }
            value={draft.fetchPromptBody}
            onChange={(v) => update("fetchPromptBody", v)}
          />
        </Section>

        <Section
          step="03"
          title="Summarization"
          description="How each item of this source is turned into a brief. Used by both digest-once and library-once."
        >
          <div className="grid gap-4 md:grid-cols-[1fr_8rem_1fr]">
            <FieldSelect
              label="Summary style"
              value={draft.summaryStyle}
              options={SUMMARY_STYLE_OPTIONS}
              onChange={(v) => update("summaryStyle", v)}
            />
            <FieldSelect
              label="Language"
              value={draft.summaryLanguage}
              options={languageOptions(draft.summaryLanguage)}
              onChange={(v) => update("summaryLanguage", v)}
            />
            <FieldText
              label="Length hint"
              placeholder="Optional · e.g. 100–300 words"
              value={draft.summaryLengthHint}
              onChange={(v) => update("summaryLengthHint", v)}
            />
          </div>
          <FieldTextarea
            label="Summary prompt body"
            rows={16}
            mono
            value={draft.summaryPromptBody}
            onChange={(v) => update("summaryPromptBody", v)}
          />
        </Section>

        <Section
          step="04"
          title="Quality gates"
          description="Filters applied after extraction. Items that fail are dropped from the pipeline."
        >
          <Toggle
            label="Primary content only"
            description="Reject extractions that fall back to title, description, or other metadata."
            checked={draft.contentQuality.primaryContentOnly}
            onChange={(v) => updateQuality("primaryContentOnly", v)}
          />
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <FieldNumber
              label="Min chars"
              min={0}
              value={String(draft.contentQuality.minChars)}
              onChange={(v) => updateQuality("minChars", Math.max(0, Number(v) || 0))}
            />
            <FieldNumber
              label="Min words"
              min={0}
              value={String(draft.contentQuality.minWords)}
              onChange={(v) => updateQuality("minWords", Math.max(0, Number(v) || 0))}
            />
            <FieldNumber
              label="Min unique-word ratio"
              optional
              min={0}
              max={1}
              step={0.01}
              description="Averaged over 100-word windows (0–1). Real speech sits around 0.6; lower lets more repetitive transcripts through before an item is dropped."
              value={
                draft.contentQuality.minUniqueWordRatio === null
                  ? ""
                  : String(draft.contentQuality.minUniqueWordRatio)
              }
              onChange={(v) =>
                updateQuality(
                  "minUniqueWordRatio",
                  v === "" ? null : clampRatio(v),
                )
              }
            />
            <FieldNumber
              label="Max timestamp-word ratio"
              optional
              min={0}
              max={1}
              step={0.01}
              description="Fraction of tokens that look like timestamps (0–1). Above this the body is treated as timestamp noise and dropped."
              value={
                draft.contentQuality.maxTimestampWordRatio === null
                  ? ""
                  : String(draft.contentQuality.maxTimestampWordRatio)
              }
              onChange={(v) =>
                updateQuality(
                  "maxTimestampWordRatio",
                  v === "" ? null : clampRatio(v),
                )
              }
            />
          </div>
          <ChipListField
            label="Disallowed primary sources"
            description="Strings the extractor must not accept as primary body content."
            values={draft.contentQuality.disallowedPrimarySources}
            placeholder='e.g. "title"'
            onChange={(next) => updateQuality("disallowedPrimarySources", next)}
          />
        </Section>

        <FooterBar
          dirty={dirty}
          isPending={isPending}
          status={status}
          onSave={save}
          onReset={reset}
          updatedAt={config.updatedAt}
          updatedBy={config.updatedBy}
        />
      </div>
    </details>
  );
}

function CardHeader({
  config,
  dirty,
  draftLabel,
}: {
  config: AdminSourceTypeConfig;
  dirty: boolean;
  draftLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span
        className="rounded-md px-2 py-0.5 text-xs"
        style={{
          fontFamily: "var(--font-geist-mono)",
          background: "var(--paper-strong)",
          color: "var(--muted-strong)",
        }}
      >
        {config.sourceId}
      </span>
      <span className="text-base font-medium">{draftLabel || config.label}</span>
      <span
        className="text-xs"
        style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
      >
        {config.summaryStyle} · {config.agentDefaultStatus}
      </span>
      {dirty ? (
        <span
          className="ml-auto inline-flex items-center gap-1.5 text-xs"
          style={{ color: "var(--warm)" }}
          aria-label="Unsaved changes"
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: "0.4rem",
              height: "0.4rem",
              borderRadius: "999px",
              background: "var(--warm)",
            }}
          />
          Unsaved
        </span>
      ) : null}
    </div>
  );
}
