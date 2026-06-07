"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ORIGINAL_CONTENT_LANGUAGE_LABEL,
  ORIGINAL_CONTENT_LANGUAGE_VALUE,
} from "@/lib/language-preference";

export type SaveStatusKind = "idle" | "saving" | "saved" | "error";
export type SaveStatusState = { kind: SaveStatusKind; message?: string };

// Ratios are constrained to [0, 1]; clamp on input so an admin can't store an
// out-of-range value (e.g. a fat-fingered 5) that would silently disable a gate.
export function clampRatio(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function formatUtcDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function Section({
  step,
  title,
  description,
  optional,
  children,
}: {
  step?: string;
  title: string;
  description?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        {step ? (
          <span
            className="settings-section-step"
            aria-hidden="true"
          >
            {step}
          </span>
        ) : null}
        <div className="settings-section-copy">
          <div className="settings-section-title-row">
            <p className="settings-section-title">
              {title}
            </p>
            {optional ? <OptionalBadge /> : null}
          </div>
          {description ? (
            <p className="settings-section-desc">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export function OptionalBadge() {
  return <span className="settings-optional-badge">Optional</span>;
}

// Shared field label, rendered as the metadata-style caption above a control.
function FieldLabelText({
  optional,
  children,
}: {
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="settings-field-label">
      <span>{children}</span>
      {optional ? (
        <span className="settings-field-label-optional">
          optional
        </span>
      ) : null}
    </span>
  );
}

export function FieldShell({
  label,
  description,
  optional,
  children,
}: {
  label: string;
  description?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-field">
      <FieldLabelText optional={optional}>{label}</FieldLabelText>
      {children}
      {description ? (
        <span className="settings-field-help">
          {description}
        </span>
      ) : null}
    </label>
  );
}

export function FieldBlock({
  label,
  description,
  optional,
  children,
}: {
  label: string;
  description?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-field">
      <FieldLabelText optional={optional}>{label}</FieldLabelText>
      {children}
      {description ? (
        <span className="settings-field-help">
          {description}
        </span>
      ) : null}
    </div>
  );
}

export function FieldText({
  label,
  value,
  onChange,
  placeholder,
  mono,
  description,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  description?: string;
}) {
  return (
    <FieldShell label={label} description={description}>
      <input
        className={`fb-input settings-input${mono ? " mono" : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function FieldSelect({
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
        className="fb-input settings-input"
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

export function FieldNumber({
  label,
  value,
  onChange,
  min,
  max,
  step,
  optional,
  placeholder,
  description,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  optional?: boolean;
  placeholder?: string;
  description?: string;
}) {
  return (
    <FieldShell label={label} optional={optional} description={description}>
      <input
        type="number"
        className="fb-input settings-input settings-number-input"
        value={value}
        min={min}
        max={max}
        placeholder={placeholder}
        step={step ?? 1}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function FieldTextarea({
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
        className={`fb-textarea settings-textarea${mono ? " mono" : ""}`}
        rows={rows}
        value={value}
        spellCheck={!mono}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function Toggle({
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
    <label className="settings-toggle">
      <input
        type="checkbox"
        className="settings-toggle-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="settings-toggle-label">{label}</span>
        {description ? (
          <span className="settings-toggle-desc">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function ChipListField({
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
  const legendId = useId();
  const descId = useId();

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setDraft("");
  }

  return (
    <fieldset
      className="settings-choice-field"
      aria-describedby={description ? descId : undefined}
    >
      <legend
        id={legendId}
        className="settings-field-label"
      >
        {label}
      </legend>
      <div className="settings-choice-list">
        <div className="settings-token-list">
          {values.length === 0 ? (
            <span className="settings-choice-empty">
              No entries.
            </span>
          ) : (
            values.map((v) => (
              <span
                key={v}
                className="settings-token"
              >
                <span>{v}</span>
                <button
                  type="button"
                  aria-label={`Remove ${v}`}
                  className="settings-token-remove"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="settings-token-add-row">
          <input
            className="fb-input settings-token-input"
            aria-labelledby={legendId}
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
      {description ? (
        <span id={descId} className="settings-field-help">
          {description}
        </span>
      ) : null}
    </fieldset>
  );
}

export function FooterBar({
  dirty,
  isPending,
  status,
  onSave,
  onReset,
  onStatusAutoDismiss,
  updatedAt,
}: {
  dirty: boolean;
  isPending: boolean;
  status: SaveStatusState;
  onSave: () => void;
  onReset: () => void;
  onStatusAutoDismiss?: () => void;
  updatedAt: string;
}) {
  const showActions = dirty || isPending;
  return (
    <div className="settings-footer-bar">
      {showActions ? (
        <>
          <button
            type="button"
            className="fb-btn dark compact"
            disabled={!dirty || isPending}
            onClick={onSave}
          >
            {isPending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            className="fb-btn light compact"
            disabled={!dirty || isPending}
            onClick={onReset}
          >
            Discard
          </button>
        </>
      ) : status.kind !== "saved" ? (
        <span className="settings-save-status is-saved" aria-live="polite">
          Saved
        </span>
      ) : null}
      <SaveStatus status={status} onAutoDismiss={onStatusAutoDismiss} />
      <span className="settings-footer-updated">
        Updated {formatUtcDateTime(updatedAt)}
      </span>
    </div>
  );
}

// Unified save-feedback element. Renders idle (nothing), saving, saved, and
// error states with consistent color + copy. The "saved" state auto-dismisses
// after ~2.5s; we still clear under prefers-reduced-motion, just without any
// transition (the global reduced-motion rule already neutralizes transitions).
export function SaveStatus({
  status,
  onAutoDismiss,
}: {
  status: SaveStatusState;
  onAutoDismiss?: () => void;
}) {
  const onAutoDismissRef = useRef(onAutoDismiss);
  const [dismissedStatusKey, setDismissedStatusKey] = useState<string | null>(null);
  const statusKey = `${status.kind}:${status.message ?? ""}`;

  useEffect(() => {
    onAutoDismissRef.current = onAutoDismiss;
  }, [onAutoDismiss]);

  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = setTimeout(() => {
      setDismissedStatusKey(statusKey);
      onAutoDismissRef.current?.();
    }, 2500);
    return () => clearTimeout(timer);
  }, [status.kind, statusKey]);

  if (status.kind === "idle") return null;
  if (status.kind === "saved" && dismissedStatusKey === statusKey) return null;

  if (status.kind === "saving") {
    return (
      <span className="settings-save-status is-saving" aria-live="polite">
        Saving…
      </span>
    );
  }

  if (status.kind === "saved") {
    return (
      <span className="settings-save-status is-saved" aria-live="polite">
        {status.message ?? "Saved"}
      </span>
    );
  }

  return (
    <span className="settings-save-status is-error" role="alert">
      {status.message ?? "Could not save changes."}
    </span>
  );
}

// Account-wide summary output languages — the same list the cron / copy-prompt
// dialog offers, kept here as the single source of truth. Fixed-language values
// are fed into prompts; `source` is interpreted by the job context/CLI as
// "match the raw content or existing summary language".
export const SUMMARY_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: ORIGINAL_CONTENT_LANGUAGE_VALUE, label: `Use ${ORIGINAL_CONTENT_LANGUAGE_LABEL.toLowerCase()}` },
  { value: "zh", label: "中文 (Chinese)" },
  { value: "English", label: "English" },
  { value: "日本語", label: "日本語 (Japanese)" },
  { value: "한국어", label: "한국어 (Korean)" },
  { value: "Español", label: "Español (Spanish)" },
  { value: "Français", label: "Français (French)" },
  { value: "Deutsch", label: "Deutsch (German)" },
];

// Build select options for a language field, appending the current value as its
// own option when it isn't one of the known choices (so a custom language a
// source was already configured with stays selectable rather than vanishing).
export function languageOptions(
  current: string,
): ReadonlyArray<{ value: string; label: string }> {
  if (!current || SUMMARY_LANGUAGE_OPTIONS.some((o) => o.value === current)) {
    return SUMMARY_LANGUAGE_OPTIONS;
  }
  return [...SUMMARY_LANGUAGE_OPTIONS, { value: current, label: current }];
}

// An ordered multi-select: pick from a fixed set of known choices, keep them in
// an explicit order, and reorder/remove. Replaces error-prone free-text "id1,
// id2" inputs where only known values are valid and order is meaningful.
export function OrderedChoiceField({
  label,
  description,
  value,
  options,
  onChange,
  addLabel = "Add…",
}: {
  label: string;
  description?: string;
  value: string[];
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string[]) => void;
  addLabel?: string;
}) {
  const legendId = useId();
  const descId = useId();
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const remaining = options.filter((o) => !value.includes(o.value));

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = value.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <fieldset className="settings-choice-field" aria-describedby={description ? descId : undefined}>
      <legend
        id={legendId}
        className="settings-field-label"
      >
        {label}
      </legend>
      <div className="settings-choice-list">
        {value.length === 0 ? (
          <span className="settings-choice-empty">
            None selected.
          </span>
        ) : (
          <ol className="settings-choice-order">
            {value.map((v, i) => (
              <li
                key={v}
                className="settings-choice-row"
              >
                <span className="settings-choice-index">
                  {i + 1}
                </span>
                <span className="settings-choice-label">
                  {labelFor(v)}
                </span>
                <button
                  type="button"
                  aria-label={`Move ${labelFor(v)} up`}
                  className="fb-btn light compact"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${labelFor(v)} down`}
                  className="fb-btn light compact"
                  disabled={i === value.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${labelFor(v)}`}
                  className="fb-btn light compact"
                  onClick={() => onChange(value.filter((x) => x !== v))}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        {remaining.length > 0 ? (
          <select
            className="fb-input settings-choice-add"
            aria-labelledby={legendId}
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...value, e.target.value]);
            }}
          >
            <option value="">{addLabel}</option>
            {remaining.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {description ? (
        <span id={descId} className="settings-field-help">
          {description}
        </span>
      ) : null}
    </fieldset>
  );
}
