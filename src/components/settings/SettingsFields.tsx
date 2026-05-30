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
    <section className="mt-7 first:mt-0">
      <div className="mb-3 flex items-baseline gap-3 border-b border-[var(--line)] pb-2">
        {step ? (
          <span
            className="text-[11px] tracking-[0.16em]"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
            aria-hidden="true"
          >
            {step}
          </span>
        ) : null}
        <div className="min-w-0">
          <p
            className="text-[11px] uppercase tracking-[0.16em]"
            style={{ color: "var(--ink)", fontFamily: "var(--font-geist-mono)" }}
          >
            {title}
          </p>
          {description ? (
            <p className="mt-0.5 text-sm" style={{ color: "var(--muted-strong)" }}>
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-4">{children}</div>
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
      className="mb-1 flex items-baseline gap-1.5 text-[11px] uppercase tracking-[0.12em]"
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
    <label className="block text-sm">
      <FieldLabelText optional={optional}>{label}</FieldLabelText>
      {children}
      {description ? (
        <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
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
  updatedBy,
}: {
  dirty: boolean;
  isPending: boolean;
  status: SaveStatusState;
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
      <SaveStatus status={status} />
      <span
        className="ml-auto text-xs"
        style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
      >
        Updated {formatUtcDateTime(updatedAt)}
        {updatedBy ? ` · ${updatedBy}` : ""}
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
  onAutoDismissRef.current = onAutoDismiss;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    if (status.kind !== "saved") return;
    const timer = setTimeout(() => {
      setDismissed(true);
      onAutoDismissRef.current?.();
    }, 2500);
    return () => clearTimeout(timer);
  }, [status.kind, status.message]);

  if (status.kind === "idle") return null;
  if (status.kind === "saved" && dismissed) return null;

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
