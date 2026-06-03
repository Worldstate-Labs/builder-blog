import type { ReactNode } from "react";

const countFormatter = new Intl.NumberFormat("en-US");

export function formatCount(value: number) {
  return countFormatter.format(value);
}

export function CountBadge({
  value,
}: {
  value: number;
}) {
  return <span className="count-badge">{formatCount(value)}</span>;
}

export function CountChip({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="count-chip">
      <span className="count-chip-value">{formatCount(value)}</span>
      <span>{label}</span>
    </span>
  );
}

export function CountMeta({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="count-meta">
      <span className="count-meta-value">{formatCount(value)}</span>
      <span>{label}</span>
    </span>
  );
}

export function CountRange({ children }: { children: ReactNode }) {
  return <span className="count-range">{children}</span>;
}

export function CountMetric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "ok" | "issue" | "waiting";
  value: number;
}) {
  return (
    <div className="count-metric" data-tone={tone}>
      <div className="count-metric-value">{formatCount(value)}</div>
      <div className="count-metric-label">{label}</div>
    </div>
  );
}
