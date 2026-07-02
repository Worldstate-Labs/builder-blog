export const DEFAULT_SUMMARY_LANGUAGE = "zh";
export const ORIGINAL_CONTENT_LANGUAGE_VALUE = "source";
export const ORIGINAL_CONTENT_LANGUAGE_LABEL = "original";
const LEGACY_ORIGINAL_CONTENT_LANGUAGE_LABEL = "Original content language";

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
  const rawValue = String(value ?? "").trim();
  const rawTarget = String(target ?? "").trim();
  if (!rawValue || !rawTarget) return false;
  const normalizedValue = normalizeSummaryLanguagePreference(rawValue);
  const normalizedTarget = normalizeSummaryLanguagePreference(rawTarget);
  const valueIsOriginal = isOriginalContentLanguagePreference(normalizedValue);
  const targetIsOriginal = isOriginalContentLanguagePreference(normalizedTarget);
  if (valueIsOriginal || targetIsOriginal) return valueIsOriginal && targetIsOriginal;
  return normalizedValue.toLowerCase() === normalizedTarget.toLowerCase();
}

export function displayLanguagePreference(value: string | null | undefined) {
  const normalized = normalizeSummaryLanguagePreference(value);
  if (isOriginalContentLanguagePreference(normalized)) return ORIGINAL_CONTENT_LANGUAGE_LABEL;
  const lower = normalized.toLowerCase();
  if (lower === ORIGINAL_CONTENT_LANGUAGE_LABEL.toLowerCase()) return ORIGINAL_CONTENT_LANGUAGE_LABEL;
  if (lower === LEGACY_ORIGINAL_CONTENT_LANGUAGE_LABEL.toLowerCase()) return ORIGINAL_CONTENT_LANGUAGE_LABEL;
  if (lower === "zh" || lower === "zh-cn" || lower === "chinese") return "Chinese";
  if (lower === "en" || lower === "en-us" || lower === "english") return "English";
  return normalized.toUpperCase();
}
