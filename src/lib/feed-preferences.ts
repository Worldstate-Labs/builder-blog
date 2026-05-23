import { DigestFrequency, type UserFeedPreference } from "@prisma/client";

export const defaultDigestMaxPostAgeDays = 90;
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

export function digestMaxPostAgeDays(
  preference?: Partial<DigestWindowPreference> | null,
) {
  return clampWholeDays(
    preference?.digestMaxPostAgeDays,
    1,
    365,
    defaultDigestMaxPostAgeDays,
  );
}

export function digestFallbackSince(
  now: Date,
  preference?: Partial<DigestWindowPreference> | null,
) {
  return new Date(now.getTime() - digestFrequencyDays(preference) * dayMs);
}

export function digestMaxAgeCutoff(
  now: Date,
  preference?: Partial<DigestWindowPreference> | null,
) {
  return new Date(now.getTime() - digestMaxPostAgeDays(preference) * dayMs);
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
