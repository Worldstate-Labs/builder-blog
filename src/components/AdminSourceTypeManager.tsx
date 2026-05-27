"use client";

import { useMemo, useState, useTransition } from "react";

export type AdminSourceTypeConfig = {
  sourceId: string;
  label: string;
  agentDefaultStatus: string;
  defaultCrawlDays: number;
  defaultCrawlLimit: number;
  contentQuality: unknown;
  summaryPromptBody: string;
  summaryPromptSinglePostAdaptation: string;
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
  defaultCrawlDays: string;
  defaultCrawlLimit: string;
  summaryLengthHint: string;
  summaryPromptBody: string;
  summaryPromptSinglePostAdaptation: string;
  contentQuality: ContentQuality;
};

type Status = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

const SUMMARY_STYLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "x_twitter", label: "X / Twitter" },
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
    defaultCrawlDays: String(config.defaultCrawlDays),
    defaultCrawlLimit: String(config.defaultCrawlLimit),
    summaryLengthHint: config.summaryLengthHint ?? "",
    summaryPromptBody: config.summaryPromptBody,
    summaryPromptSinglePostAdaptation: config.summaryPromptSinglePostAdaptation,
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
    const days = Number(draft.defaultCrawlDays);
    const limit = Number(draft.defaultCrawlLimit);
    if (!Number.isInteger(days) || days < 1) {
      setStatus({ kind: "error", message: "Default crawl days must be an integer ≥ 1." });
      return;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      setStatus({ kind: "error", message: "Default crawl limit must be an integer ≥ 1." });
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
      defaultCrawlDays: days,
      defaultCrawlLimit: limit,
      summaryLengthHint:
        draft.summaryLengthHint.trim() === "" ? null : draft.summaryLengthHint.trim(),
      summaryPromptBody: draft.summaryPromptBody,
      summaryPromptSinglePostAdaptation: draft.summaryPromptSinglePostAdaptation,
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
        setStatus({ kind: "saved", message: "Saved." });
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
        <Section title="Identity & display">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_8rem]">
            <FieldText
              label="Label"
              value={draft.label}
              onChange={(v) => update("label", v)}
            />
            <FieldSelect
              label="Summary style"
              value={draft.summaryStyle}
              options={SUMMARY_STYLE_OPTIONS}
              onChange={(v) => update("summaryStyle", v)}
            />
            <FieldText
              label="Language"
              mono
              value={draft.summaryLanguage}
              onChange={(v) => update("summaryLanguage", v)}
            />
          </div>
        </Section>

        <Section title="Crawl & agent behavior">
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
              value={draft.defaultCrawlDays}
              onChange={(v) => update("defaultCrawlDays", v)}
            />
            <FieldNumber
              label="Default limit"
              min={1}
              value={draft.defaultCrawlLimit}
              onChange={(v) => update("defaultCrawlLimit", v)}
            />
          </div>
        </Section>

        <Section
          title="Summary prompt"
          description="Used by both digest-once and library-once when summarizing items of this source type."
        >
          <FieldText
            label="Length hint"
            placeholder="Optional · e.g. 100–300 words"
            value={draft.summaryLengthHint}
            onChange={(v) => update("summaryLengthHint", v)}
          />
          <FieldTextarea
            label="Prompt body"
            rows={16}
            mono
            value={draft.summaryPromptBody}
            onChange={(v) => update("summaryPromptBody", v)}
          />
          <FieldTextarea
            label="Single-post adaptation"
            rows={5}
            description="One-line instruction prepended in library-once tasks."
            value={draft.summaryPromptSinglePostAdaptation}
            onChange={(v) => update("summaryPromptSinglePostAdaptation", v)}
          />
        </Section>

        <Section title="Content quality">
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
              step={0.01}
              value={
                draft.contentQuality.minUniqueWordRatio === null
                  ? ""
                  : String(draft.contentQuality.minUniqueWordRatio)
              }
              onChange={(v) =>
                updateQuality("minUniqueWordRatio", v === "" ? null : Number(v))
              }
            />
            <FieldNumber
              label="Max timestamp-word ratio"
              optional
              min={0}
              step={0.01}
              value={
                draft.contentQuality.maxTimestampWordRatio === null
                  ? ""
                  : String(draft.contentQuality.maxTimestampWordRatio)
              }
              onChange={(v) =>
                updateQuality("maxTimestampWordRatio", v === "" ? null : Number(v))
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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-3 border-b border-[var(--line)] pb-1.5">
        <p
          className="text-[11px] uppercase tracking-[0.16em]"
          style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
        >
          {title}
        </p>
        {description ? (
          <p className="mt-1 text-sm" style={{ color: "var(--muted-strong)" }}>
            {description}
          </p>
        ) : null}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function FieldShell({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span
        className="mb-1 block text-[11px] uppercase tracking-[0.12em]"
        style={{ color: "var(--muted)" }}
      >
        {label}
      </span>
      {children}
      {description ? (
        <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
          {description}
        </span>
      ) : null}
    </label>
  );
}

function FieldText({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <FieldShell label={label}>
      <input
        className="fb-input w-full"
        value={value}
        placeholder={placeholder}
        style={mono ? { fontFamily: "var(--font-geist-mono)" } : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell label={label}>
      <select
        className="fb-input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
  min,
  step,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  step?: number;
  optional?: boolean;
}) {
  return (
    <FieldShell label={optional ? `${label} · optional` : label}>
      <input
        type="number"
        className="fb-input w-full"
        value={value}
        min={min}
        step={step ?? 1}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  rows = 6,
  description,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  description?: string;
  mono?: boolean;
}) {
  return (
    <FieldShell label={label} description={description}>
      <textarea
        className="fb-textarea w-full"
        rows={rows}
        value={value}
        spellCheck={!mono}
        style={{
          resize: "vertical",
          ...(mono
            ? { fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }
            : {}),
        }}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function ChipListField({
  label,
  description,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  description?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setDraft("");
  }

  return (
    <FieldShell label={label} description={description}>
      <div
        className="rounded-[10px] border border-[var(--line)]"
        style={{ background: "var(--paper-strong)", padding: "0.625rem" }}
      >
        <div className="flex flex-wrap gap-1.5">
          {values.length === 0 ? (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              No entries.
            </span>
          ) : (
            values.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
                style={{
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  fontFamily: "var(--font-geist-mono)",
                }}
              >
                <span>{v}</span>
                <button
                  type="button"
                  aria-label={`Remove ${v}`}
                  className="ml-0.5"
                  style={{ color: "var(--muted)" }}
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="fb-input flex-1"
            placeholder={placeholder ?? "Add entry, press Enter"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              } else if (e.key === "Backspace" && !draft && values.length > 0) {
                onChange(values.slice(0, -1));
              }
            }}
          />
          <button
            type="button"
            className="fb-btn light compact"
            onClick={add}
            disabled={!draft.trim()}
          >
            Add
          </button>
        </div>
      </div>
    </FieldShell>
  );
}

function FooterBar({
  dirty,
  isPending,
  status,
  onSave,
  onReset,
  updatedAt,
  updatedBy,
}: {
  dirty: boolean;
  isPending: boolean;
  status: Status;
  onSave: () => void;
  onReset: () => void;
  updatedAt: string;
  updatedBy: string | null;
}) {
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--line)]"
      style={{ paddingTop: "0.875rem" }}
    >
      <button
        type="button"
        className="fb-btn"
        disabled={!dirty || isPending}
        onClick={onSave}
      >
        {isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
      </button>
      <button
        type="button"
        className="fb-btn light compact"
        disabled={!dirty || isPending}
        onClick={onReset}
      >
        Discard
      </button>
      {status.message ? (
        <span
          className="text-sm"
          style={{
            color:
              status.kind === "error" ? "var(--danger)" : "var(--muted-strong)",
          }}
          role={status.kind === "error" ? "alert" : undefined}
        >
          {status.message}
        </span>
      ) : null}
      <span
        className="ml-auto text-xs"
        style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
      >
        Updated {new Date(updatedAt).toLocaleString()}
        {updatedBy ? ` · ${updatedBy}` : ""}
      </span>
    </div>
  );
}
