"use client";

import { useMemo, useState, useTransition } from "react";
import {
  clampRatio,
  FieldNumber,
  FieldSelect,
  FieldText,
  FieldTextarea,
  FooterBar,
  languageOptions,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";

export type AdminSourceTypeConfig = {
  sourceId: string;
  label: string;
  agentDefaultStatus: string;
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
  minChars: number;
  minWords: number;
  minUniqueWordRatio: number | null;
  maxTimestampWordRatio: number | null;
};

type Draft = {
  summaryStyle: string;
  summaryLanguage: string;
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

function toContentQuality(raw: unknown): ContentQuality {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
  return {
    minChars: typeof obj.minChars === "number" ? obj.minChars : 0,
    minWords: typeof obj.minWords === "number" ? obj.minWords : 0,
    minUniqueWordRatio: typeof obj.minUniqueWordRatio === "number" ? obj.minUniqueWordRatio : null,
    maxTimestampWordRatio:
      typeof obj.maxTimestampWordRatio === "number" ? obj.maxTimestampWordRatio : null,
  };
}

function toDraft(config: AdminSourceTypeConfig): Draft {
  return {
    summaryStyle: config.summaryStyle,
    summaryLanguage: config.summaryLanguage,
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
      minChars: cq.minChars,
      minWords: cq.minWords,
    };
    if (cq.minUniqueWordRatio !== null && Number.isFinite(cq.minUniqueWordRatio)) {
      contentQuality.minUniqueWordRatio = cq.minUniqueWordRatio;
    }
    if (cq.maxTimestampWordRatio !== null && Number.isFinite(cq.maxTimestampWordRatio)) {
      contentQuality.maxTimestampWordRatio = cq.maxTimestampWordRatio;
    }

    const patch = {
      summaryStyle: draft.summaryStyle,
      summaryLanguage: draft.summaryLanguage.trim(),
      summaryLengthHint:
        draft.summaryLengthHint.trim() === "" ? null : draft.summaryLengthHint.trim(),
      summaryPromptBody: draft.summaryPromptBody,
      fetchPromptBody: draft.fetchPromptBody.trim() === "" ? null : draft.fetchPromptBody,
      contentQuality,
    };

    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/source-types", {
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
        <CardHeader config={config} dirty={dirty} />
      </summary>

      <div className="border-t border-[var(--line)]" style={{ padding: "1.25rem 1.125rem 1rem" }}>
        <Section
          step="01"
          title="Fetching"
          description="The fetch prompt the agent receives when this source needs agent extraction."
        >
          <FieldTextarea
            label="Fetch prompt · optional"
            rows={12}
            mono
            description={
              config.agentDefaultStatus === "requires_agent"
                ? "Surfaced to the agent in fallback fetch tasks so it can decide HOW to acquire content (e.g. for podcasts: try show notes first, else download audio + Whisper transcribe)."
                : "Only used when this source requires agent extraction. Currently unused for this source — kept in case that changes."
            }
            value={draft.fetchPromptBody}
            onChange={(v) => update("fetchPromptBody", v)}
          />
        </Section>

        <Section
          step="02"
          title="Summarization"
          description="How each item of this source is turned into a brief. Used by both digest-once and library-once."
        >
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
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
          step="03"
          title="Quality gates"
          description="Size and repetition floors applied after extraction. Items that fail are dropped from the pipeline."
        >
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <FieldNumber
              label="Min chars"
              min={0}
              description="Drop items whose body has fewer characters than this."
              value={String(draft.contentQuality.minChars)}
              onChange={(v) => updateQuality("minChars", Math.max(0, Number(v) || 0))}
            />
            <FieldNumber
              label="Min words"
              min={0}
              description="Drop items whose body has fewer words than this."
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
}: {
  config: AdminSourceTypeConfig;
  dirty: boolean;
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
      <span className="text-base font-medium">{config.label}</span>
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
