import { DigestFrequency, type UserFeedPreference } from "@prisma/client";

export const defaultDigestFrequency = DigestFrequency.DAILY;

export type DigestWindowPreference = Pick<
  UserFeedPreference,
  "digestFrequency" | "digestCustomFrequencyDays" | "digestMaxPostAgeDays"
>;

export function digestFrequencyDays(
  preference?: Partial<DigestWindowPreference> | null,
) {
  if (preference?.digestFrequency === DigestFrequency.WEEKLY) return 7;
  if (preference?.digestFrequency === DigestFrequency.CUSTOM) {
    return clampWholeDays(preference.digestCustomFrequencyDays, 1, 365);
  }
  return 1;
}

// Optional publishedAt lookback (days) for digest candidate selection.
// Null/absent → no floor (the per-user DigestedItem marker is the real gate).
// A set value is clamped to [1, 365]. The old mandatory 90-day default is gone.
export function digestMaxPostAgeDays(
  preference?: Partial<DigestWindowPreference> | null,
): number | null {
  const raw = preference?.digestMaxPostAgeDays;
  if (raw === null || raw === undefined) return null;
  return clampWholeDays(raw, 1, 365);
}

export function digestFallbackSince(
  now: Date,
  preference?: Partial<DigestWindowPreference> | null,
) {
  return new Date(now.getTime() - digestFrequencyDays(preference) * dayMs);
}

// Resolve the lookback floor into a cutoff Date, or null when no floor is set.
export function digestMaxAgeCutoff(
  now: Date,
  preference?: Partial<DigestWindowPreference> | null,
): Date | null {
  const days = digestMaxPostAgeDays(preference);
  if (days === null) return null;
  return new Date(now.getTime() - days * dayMs);
}

export function normalizeDigestFrequency(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  if (normalized === DigestFrequency.WEEKLY) return DigestFrequency.WEEKLY;
  if (normalized === DigestFrequency.CUSTOM) return DigestFrequency.CUSTOM;
  return defaultDigestFrequency;
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
