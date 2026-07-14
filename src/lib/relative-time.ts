/**
 * Unified "smart relative time" formatting for FollowBrief.
 *
 * Rules (approved):
 *  - < 60s            -> "just now"
 *  - 1-59 min         -> "{n} min ago"   / future "in {n} min"
 *  - 1-23 hr          -> "{n} hr ago"     / future "in {n} hr"
 *  - 1-6 days         -> "{n} day(s) ago" / future "in {n} day(s)"
 *  - >= 7 days        -> absolute date: "Jun 12" (same year) / "Jun 12, 2024" (other year)
 *
 * Rounding: floor on the largest fitting unit (GitHub/Twitter style), so
 * "1h 50m ago" reads "1 hr ago" and "25h ago" reads "1 day ago".
 *
 * All absolute output is rendered in UTC for SSR determinism and to match the
 * app's existing timestamp formatting. The pure functions take an explicit
 * `nowMs` so they stay deterministic and unit-testable.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RELATIVE_CUTOFF = 7 * DAY;

export type DateInput = string | number | Date;

/** Parse any accepted input to epoch ms, or NaN when invalid/empty. */
export function toEpochMs(value: DateInput | null | undefined): number {
  if (value == null) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

/** Short absolute date: "Jun 12" within `referenceMs` year, else "Jun 12, 2024". */
export function formatAbsoluteDate(value: DateInput, referenceMs: number): string {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const sameYear =
    Number.isFinite(referenceMs) &&
    date.getUTCFullYear() === new Date(referenceMs).getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}

/** Full precise timestamp used for the hover tooltip: "Jun 12, 2026, 3:04 PM UTC". */
export function formatAbsoluteDateTime(value: DateInput): string {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(ms));
}

function unit(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Wrap a counted unit as past ("… ago") or future ("in …"). */
function phrase(n: number, singular: string, plural: string, future: boolean): string {
  const body = unit(n, singular, plural);
  return future ? `in ${body}` : `${body} ago`;
}

/**
 * Smart relative time. Symmetric for past and future; falls back to an
 * absolute date once `|now - value| >= 7 days`.
 */
export function relativeTime(value: DateInput, nowMs: number): string {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return "";
  const diff = nowMs - ms; // past > 0, future < 0
  const abs = Math.abs(diff);
  const future = diff < 0;

  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return phrase(Math.floor(abs / MINUTE), "min", "min", future);
  if (abs < DAY) return phrase(Math.floor(abs / HOUR), "hr", "hr", future);
  if (abs < RELATIVE_CUTOFF) return phrase(Math.floor(abs / DAY), "day", "days", future);
  return formatAbsoluteDate(ms, nowMs);
}

/** Locale-aware relative time for client UI while preserving compact English copy. */
export function localizedRelativeTime(
  value: DateInput,
  nowMs: number,
  locale = "en-US",
): string {
  if (locale.toLowerCase().startsWith("en")) return relativeTime(value, nowMs);
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return "";
  const diff = ms - nowMs;
  const abs = Math.abs(diff);
  if (abs >= RELATIVE_CUTOFF) {
    const date = new Date(ms);
    const sameYear = date.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone: "UTC",
    }).format(date);
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (abs < MINUTE) return formatter.format(0, "second");
  if (abs < HOUR) return formatter.format(Math.trunc(diff / MINUTE), "minute");
  if (abs < DAY) return formatter.format(Math.trunc(diff / HOUR), "hour");
  return formatter.format(Math.trunc(diff / DAY), "day");
}
