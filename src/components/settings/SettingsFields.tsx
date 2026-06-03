"use client";

import { useEffect, useId, useRef, useState } from "react";

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
  children,
}: {
  step?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section mt-7 first:mt-0">
      <div className="settings-section-head mb-3 flex items-baseline gap-3 border-b border-[var(--line)] pb-2">
        {step ? (
          <span
            className="settings-section-step text-[11px] tracking-[0.16em]"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
            aria-hidden="true"
          >
            {step}
          </span>
        ) : null}
        <div className="min-w-0">
          <p
            className="settings-section-title text-[11px] uppercase tracking-[0.16em]"
            style={{ color: "var(--ink)", fontFamily: "var(--font-geist-mono)" }}
          >
            {title}
          </p>
          {description ? (
            <p className="settings-section-desc mt-0.5 text-sm" style={{ color: "var(--muted-strong)" }}>
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="settings-section-body grid gap-4">{children}</div>
    </section>
  );
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
    <span
      className="settings-field-label mb-1 flex items-baseline gap-1.5 text-[11px] uppercase tracking-[0.12em]"
      style={{ color: "var(--muted)" }}
    >
      <span>{children}</span>
      {optional ? (
        <span
          className="text-[10px] normal-case tracking-normal"
          style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
        >
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
    <label className="settings-field block text-sm">
      <FieldLabelText optional={optional}>{label}</FieldLabelText>
      {children}
      {description ? (
        <span className="settings-field-help mt-1 block text-xs" style={{ color: "var(--muted)" }}>
          {description}
        </span>
      ) : null}
    </label>
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
        className="fb-input w-full"
        value={value}
        placeholder={placeholder}
        style={mono ? { fontFamily: "var(--font-geist-mono)" } : undefined}
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

export function FieldNumber({
  label,
  value,
  onChange,
  min,
  max,
  step,
  optional,
  description,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  optional?: boolean;
  description?: string;
}) {
  return (
    <FieldShell label={label} optional={optional} description={description}>
      <input
        type="number"
        className="fb-input w-full"
        style={{ maxWidth: "9rem" }}
        value={value}
        min={min}
        max={max}
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
      className="block text-sm"
      aria-describedby={description ? descId : undefined}
    >
      <legend
        id={legendId}
        className="mb-1 block text-[11px] uppercase tracking-[0.12em]"
        style={{ color: "var(--muted)" }}
      >
        {label}
      </legend>
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
        <span id={descId} className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
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
  updatedAt,
}: {
  dirty: boolean;
  isPending: boolean;
  status: SaveStatusState;
  onSave: () => void;
  onReset: () => void;
  updatedAt: string;
}) {
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--line)]"
      style={{ paddingTop: "0.875rem" }}
    >
      <button
        type="button"
        className={dirty ? "fb-btn dark" : "fb-btn light compact"}
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
      <SaveStatus status={status} />
      <span
        className="ml-auto text-xs"
        style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
      >
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
      <span className="text-sm" style={{ color: "var(--muted-strong)" }} aria-live="polite">
        Saving…
      </span>
    );
  }

  if (status.kind === "saved") {
    return (
      <span className="text-sm" style={{ color: "var(--signal)" }} aria-live="polite">
        {status.message ?? "Saved"}
      </span>
    );
  }

  return (
    <span className="text-sm" style={{ color: "var(--danger)" }} role="alert">
      {status.message ?? "Save failed"}
    </span>
  );
}

// Account-wide summary output languages — the same list the cron / copy-prompt
// dialog offers, kept here as the single source of truth. The stored value is
// fed verbatim to the model, so a custom value is allowed and preserved.
export const SUMMARY_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
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
    <fieldset className="settings-choice-field block text-sm" aria-describedby={description ? descId : undefined}>
      <legend
        id={legendId}
        className="settings-field-label mb-1 block text-[11px] uppercase tracking-[0.12em]"
        style={{ color: "var(--muted)" }}
      >
        {label}
      </legend>
      <div
        className="settings-choice-list rounded-[10px] border border-[var(--line)]"
        style={{ background: "var(--paper-strong)", padding: "0.625rem" }}
      >
        {value.length === 0 ? (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            None selected.
          </span>
        ) : (
          <ol className="grid gap-1.5">
            {value.map((v, i) => (
              <li
                key={v}
                className="settings-choice-row flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
              >
                <span
                  className="w-4 shrink-0 text-right text-xs"
                  style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate" style={{ fontFamily: "var(--font-geist-mono)" }}>
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
            className="fb-input mt-2 w-full"
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
        <span id={descId} className="settings-field-help mt-1 block text-xs" style={{ color: "var(--muted)" }}>
          {description}
        </span>
      ) : null}
    </fieldset>
  );
}
