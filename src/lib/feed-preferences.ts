import { type UserFeedPreference } from "@prisma/client";

export const DEFAULT_DIGEST_MAX_POST_AGE_DAYS = 30;
export const MAX_DIGEST_MAX_POST_AGE_DAYS = 90;

export type DigestWindowPreference = Pick<
  UserFeedPreference,
  "digestMaxPostAgeDays"
>;

// Optional publishedAt lookback (days) for digest candidate selection.
// Null/absent → the runtime default 30-day floor. The per-user DigestedItem
// marker remains the repeat gate inside that window.
// A set value is clamped to [1, 90].
export function digestMaxPostAgeDays(
  preference?: Partial<DigestWindowPreference> | null,
): number | null {
  const raw = preference?.digestMaxPostAgeDays;
  if (raw === null || raw === undefined) return DEFAULT_DIGEST_MAX_POST_AGE_DAYS;
  return clampWholeDays(raw, 1, MAX_DIGEST_MAX_POST_AGE_DAYS);
}

// Resolve the lookback floor into a cutoff Date.
export function digestMaxAgeCutoff(
  now: Date,
  preference?: Partial<DigestWindowPreference> | null,
): Date | null {
  const days = digestMaxPostAgeDays(preference);
  if (days === null) return null;
  return new Date(now.getTime() - days * dayMs);
}

function clampWholeDays(
  value: number | null | undefined,
  min: number,
  max: number,
  fallback = min,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

const dayMs = 24 * 60 * 60 * 1000;
