import { normalizeUiLocale } from "@/lib/ui-locales";

export const DEFAULT_SUMMARY_LANGUAGE = "zh";
export const ORIGINAL_CONTENT_LANGUAGE_VALUE = "source";
export const ORIGINAL_CONTENT_LANGUAGE_LABEL = "original";
const LEGACY_ORIGINAL_CONTENT_LANGUAGE_LABEL = "Original content language";
const DISPLAY_ORIGINAL_CONTENT_LANGUAGE_LABEL = "Original";

const LEGACY_LANGUAGE_DISPLAY_NAMES = new Map<string, string>([
  ["zh", "Chinese"],
  ["chinese", "Chinese"],
  ["english", "English"],
  ["日本語", "日本語"],
  ["한국어", "한국어"],
  ["español", "Español"],
  ["français", "Français"],
  ["deutsch", "Deutsch"],
]);

const CANONICAL_LANGUAGE_DISPLAY_NAMES = new Map<string, string>([
  ["en", "English"],
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁體中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["es", "Español"],
]);

export function isOriginalContentLanguagePreference(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    normalized === ORIGINAL_CONTENT_LANGUAGE_VALUE ||
    normalized === ORIGINAL_CONTENT_LANGUAGE_LABEL.toLowerCase() ||
    normalized === LEGACY_ORIGINAL_CONTENT_LANGUAGE_LABEL.toLowerCase()
  );
}

export function normalizeSummaryLanguagePreference(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return DEFAULT_SUMMARY_LANGUAGE;
  if (isOriginalContentLanguagePreference(trimmed)) return ORIGINAL_CONTENT_LANGUAGE_VALUE;
  return trimmed;
}

export function summaryLanguagesMatch(
  value: string | null | undefined,
  target: string | null | undefined,
) {
  const valueKey = summaryLanguageMatchKey(value);
  const targetKey = summaryLanguageMatchKey(target);
  if (!valueKey || !targetKey) return false;
  return valueKey === targetKey;
}

export function displayLanguagePreference(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || isOriginalContentLanguagePreference(trimmed)) {
    return DISPLAY_ORIGINAL_CONTENT_LANGUAGE_LABEL;
  }
  const legacyLabel = LEGACY_LANGUAGE_DISPLAY_NAMES.get(trimmed.toLowerCase());
  if (legacyLabel) return legacyLabel;
  const canonicalLocale = normalizeUiLocale(trimmed);
  if (canonicalLocale) return CANONICAL_LANGUAGE_DISPLAY_NAMES.get(canonicalLocale) ?? canonicalLocale;
  return trimmed;
}

function summaryLanguageMatchKey(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (isOriginalContentLanguagePreference(trimmed)) return ORIGINAL_CONTENT_LANGUAGE_VALUE;
  const legacyLabel = LEGACY_LANGUAGE_DISPLAY_NAMES.get(trimmed.toLowerCase());
  if (legacyLabel === "Chinese") return "zh-CN";
  if (legacyLabel === "English") return "en";
  if (legacyLabel === "日本語") return "ja";
  if (legacyLabel === "한국어") return "ko";
  if (legacyLabel === "Español") return "es";
  if (legacyLabel) return legacyLabel.toLowerCase();
  return normalizeUiLocale(trimmed) ?? trimmed.toLowerCase();
}
