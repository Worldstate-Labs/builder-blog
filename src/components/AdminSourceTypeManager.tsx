"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import {
  clampRatio,
  FieldNumber,
  FooterBar,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";
import { MarkdownEditor } from "@/components/settings/MarkdownEditor";

export type AdminSourceTypeConfig = {
  sourceId: string;
  label: string;
  agentDefaultStatus: string;
  contentQuality: unknown;
  summaryPromptBody: string;
  fetchPromptBody: string | null;
  summaryStyle: string;
  updatedAt: string;
  updatedBy: string | null;
};

type ContentQuality = {
  minChars: number;
  minContentUnits: number;
  minLocalDiversity: number | null;
  maxTimestampDensity: number | null;
};

type Draft = {
  summaryPromptBody: string;
  fetchPromptBody: string;
  contentQuality: ContentQuality;
};

type Status = SaveStatusState;

const FETCH_PROMPT_PLACEHOLDER = [
  "Example:",
  "Use the supplied item URL to fetch the full primary content.",
  "",
  "- Prefer official transcripts, captions, article body text, or show notes.",
  "- Do not use title, description, or page metadata as the item body.",
  "- Record the extraction method in rawJson.contentSource or rawJson.transcriptSource.",
].join("\n");

const SUMMARY_PROMPT_PLACEHOLDER = [
  "Example:",
  "Summarize this one item for a busy AI professional.",
  "",
  "- Lead with the most important announcement, finding, or insight.",
  "- Include concrete product names, numbers, benchmarks, and source links when present.",
  "- Do not invent claims that are not in task.item.body.",
].join("\n");

function toContentQuality(raw: unknown): ContentQuality {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
  return {
    minChars: typeof obj.minChars === "number" ? obj.minChars : 0,
    minContentUnits:
      typeof obj.minContentUnits === "number"
        ? obj.minContentUnits
        : typeof obj.minWords === "number"
          ? obj.minWords
          : 0,
    minLocalDiversity:
      typeof obj.minLocalDiversity === "number"
        ? obj.minLocalDiversity
        : typeof obj.minUniqueWordRatio === "number"
          ? obj.minUniqueWordRatio
          : null,
    maxTimestampDensity:
      typeof obj.maxTimestampDensity === "number"
        ? obj.maxTimestampDensity
        : typeof obj.maxTimestampWordRatio === "number"
          ? obj.maxTimestampWordRatio
          : null,
  };
}

function toDraft(config: AdminSourceTypeConfig): Draft {
  return {
    summaryPromptBody: config.summaryPromptBody,
    fetchPromptBody: config.fetchPromptBody ?? "",
    contentQuality: toContentQuality(config.contentQuality),
  };
}

export function AdminSourceTypeManager({
  canEditQualityGates,
  initialConfigs,
}: {
  canEditQualityGates?: boolean;
  initialConfigs: AdminSourceTypeConfig[];
}) {
  const [configs, setConfigs] = useState(initialConfigs);
  return (
    <div className="settings-source-type-manager">
      {configs.map((config) => (
        <SourceTypeCard
          key={config.sourceId}
          canEditQualityGates={Boolean(canEditQualityGates)}
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
  canEditQualityGates,
  config,
  onSaved,
}: {
  canEditQualityGates: boolean;
  config: AdminSourceTypeConfig;
  onSaved: (next: AdminSourceTypeConfig) => void;
}) {
  const baseline = useMemo(() => toDraft(config), [config]);
  const [draft, setDraft] = useState<Draft>(baseline);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [fetchPromptExpanded, setFetchPromptExpanded] = useState(
    baseline.fetchPromptBody.trim().length > 0,
  );
  const [isPending, startTransition] = useTransition();

  const editableDraft = useMemo(
    () => ({
      summaryPromptBody: draft.summaryPromptBody,
      fetchPromptBody: draft.fetchPromptBody,
      ...(canEditQualityGates ? { contentQuality: draft.contentQuality } : {}),
    }),
    [canEditQualityGates, draft],
  );
  const editableBaseline = useMemo(
    () => ({
      summaryPromptBody: baseline.summaryPromptBody,
      fetchPromptBody: baseline.fetchPromptBody,
      ...(canEditQualityGates ? { contentQuality: baseline.contentQuality } : {}),
    }),
    [baseline, canEditQualityGates],
  );
  const dirty = JSON.stringify(editableDraft) !== JSON.stringify(editableBaseline);

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
    setFetchPromptExpanded(baseline.fetchPromptBody.trim().length > 0);
    setStatus({ kind: "idle" });
  }

  function clearSavedStatus() {
    setStatus((current) => (current.kind === "saved" ? { kind: "idle" } : current));
  }

  function save() {
    const patch: {
      summaryPromptBody: string;
      fetchPromptBody: string | null;
      contentQuality?: Record<string, unknown>;
    } = {
      summaryPromptBody: draft.summaryPromptBody,
      fetchPromptBody: draft.fetchPromptBody.trim() === "" ? null : draft.fetchPromptBody,
    };
    if (canEditQualityGates) {
      const cq = draft.contentQuality;
      if (!Number.isInteger(cq.minChars) || cq.minChars < 0) {
        setStatus({ kind: "error", message: "Min chars must be a non-negative integer." });
        return;
      }
      if (!Number.isInteger(cq.minContentUnits) || cq.minContentUnits < 0) {
        setStatus({ kind: "error", message: "Min content units must be a non-negative integer." });
        return;
      }
      for (const [field, label] of [
        ["minLocalDiversity", "Min local diversity"],
        ["maxTimestampDensity", "Max timestamp density"],
      ] as const) {
        const ratio = cq[field];
        if (ratio !== null && (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)) {
          setStatus({ kind: "error", message: `${label} must be between 0 and 1.` });
          return;
        }
      }

      const contentQuality: Record<string, unknown> = {
        minChars: cq.minChars,
        minContentUnits: cq.minContentUnits,
      };
      if (cq.minLocalDiversity !== null && Number.isFinite(cq.minLocalDiversity)) {
        contentQuality.minLocalDiversity = cq.minLocalDiversity;
      }
      if (cq.maxTimestampDensity !== null && Number.isFinite(cq.maxTimestampDensity)) {
        contentQuality.maxTimestampDensity = cq.maxTimestampDensity;
      }
      patch.contentQuality = contentQuality;
    }

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
        if (draft.fetchPromptBody.trim() === "") setFetchPromptExpanded(false);
        setStatus({ kind: "saved", message: "Saved" });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not save source type settings.",
        });
      }
    });
  }

  return (
    <details className="source-type-config-card">
      <summary className="source-type-config-summary">
        <CardHeader config={config} dirty={dirty} />
        <span className="source-type-config-toggle-icon" aria-hidden="true">
          <ChevronDown className="source-type-config-toggle-svg" />
        </span>
      </summary>

      <div className="settings-config-form source-type-config-form">
        <Section
          step="01"
          title="Fetching"
          optional
          description="Extra instructions for this source type when Fetch sources needs Local Agent extraction."
        >
          <OptionalMarkdownField
            ariaLabel={`${config.label} fetch prompt`}
            buttonLabel="Add fetch prompt"
            emptyText="No fetch prompt is set for this source type."
            expanded={fetchPromptExpanded}
            height={340}
            onExpand={() => setFetchPromptExpanded(true)}
            placeholder={FETCH_PROMPT_PLACEHOLDER}
            value={draft.fetchPromptBody}
            onChange={(v) => update("fetchPromptBody", v)}
          />
        </Section>

        <Section
          step="02"
          title="Summarization"
          description="How each post becomes a summary. Output language comes from the run prompt."
        >
          <MarkdownEditor
            ariaLabel={`${config.label} summary prompt`}
            height={420}
            placeholder={SUMMARY_PROMPT_PLACEHOLDER}
            value={draft.summaryPromptBody}
            onChange={(v) => update("summaryPromptBody", v)}
          />
        </Section>

        {canEditQualityGates ? (
          <Section
            step="03"
            title="Quality gates"
            description="Checks applied after extraction. Posts that fail are not saved or used in Following or AI Digest."
          >
            <div className="source-type-quality-grid">
              <FieldNumber
                label="Min chars"
                min={0}
                placeholder="Example: 200"
                description="Drop posts whose body has fewer characters than this."
                value={String(draft.contentQuality.minChars)}
                onChange={(v) => updateQuality("minChars", Math.max(0, Number(v) || 0))}
              />
              <FieldNumber
                label="Min content units"
                min={0}
                placeholder="Example: 35"
                description="Drop posts with too little real text. Latin words count as units; CJK text counts by character."
                value={String(draft.contentQuality.minContentUnits)}
                onChange={(v) =>
                  updateQuality("minContentUnits", Math.max(0, Number(v) || 0))
                }
              />
              <FieldNumber
                label="Min local diversity"
                optional
                min={0}
                max={1}
                placeholder="Example: 0.35"
                step={0.01}
                description="Average unique-unit ratio over 100-unit windows (0-1). Lower allows more repetition."
                value={
                  draft.contentQuality.minLocalDiversity === null
                    ? ""
                    : String(draft.contentQuality.minLocalDiversity)
                }
                onChange={(v) =>
                  updateQuality(
                    "minLocalDiversity",
                    v === "" ? null : clampRatio(v),
                  )
                }
              />
              <FieldNumber
                label="Max timestamp density"
                optional
                min={0}
                max={1}
                placeholder="Example: 0.08"
                step={0.01}
                description="Timestamp count divided by content units (0-1). Higher values count as timestamp noise."
                value={
                  draft.contentQuality.maxTimestampDensity === null
                    ? ""
                    : String(draft.contentQuality.maxTimestampDensity)
                }
                onChange={(v) =>
                  updateQuality(
                    "maxTimestampDensity",
                    v === "" ? null : clampRatio(v),
                  )
                }
              />
            </div>
          </Section>
        ) : null}

        <FooterBar
          dirty={dirty}
          isPending={isPending}
          status={status}
          onSave={save}
          onReset={reset}
          onStatusAutoDismiss={clearSavedStatus}
          updatedAt={config.updatedAt}
        />
      </div>
    </details>
  );
}

function OptionalMarkdownField({
  ariaLabel,
  buttonLabel,
  emptyText,
  expanded,
  height,
  onChange,
  onExpand,
  placeholder,
  value,
}: {
  ariaLabel: string;
  buttonLabel: string;
  emptyText: string;
  expanded: boolean;
  height: number;
  onChange: (value: string) => void;
  onExpand: () => void;
  placeholder: string;
  value: string;
}) {
  const hasContent = value.trim().length > 0;
  if (!expanded && !hasContent) {
    return (
      <div className="settings-optional-empty">
        <span className="settings-optional-empty-text">{emptyText}</span>
        <button className="fb-btn light compact" onClick={onExpand} type="button">
          <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
          {buttonLabel}
        </button>
      </div>
    );
  }

  return (
    <MarkdownEditor
      ariaLabel={ariaLabel}
      height={hasContent ? height : 180}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
  );
}

function CardHeader({
  config,
  dirty,
}: {
  config: AdminSourceTypeConfig;
  dirty: boolean;
}) {
  // Just the source label. The sourceId pill duplicated it, agentDefaultStatus
  // isn't editable here, and summaryStyle has no runtime effect (it only seeds
  // the default prompt body) — so none of them belong in the header.
  return (
    <div className="source-type-config-header">
      <span className="source-type-config-title">{config.label}</span>
      {dirty ? (
        <span
          className="source-type-config-dirty"
          aria-label="Unsaved changes"
        >
          <span className="source-type-config-dirty-dot" aria-hidden="true" />
          Unsaved
        </span>
      ) : null}
    </div>
  );
}
