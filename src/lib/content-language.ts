import { isOriginalContentLanguagePreference } from "@/lib/language-preference";

export type TextLanguageDetection = {
  language: string | null;
  confidence: "high" | "low";
  source: "text";
};

const LANGUAGE_LABELS = new Map<string, string>([
  ["english", "en"],
  ["chinese", "zh-Hans"],
  ["简体中文", "zh-Hans"],
  ["繁體中文", "zh-Hant"],
  ["繁体中文", "zh-Hant"],
  ["日本語", "ja"],
  ["한국어", "ko"],
  ["español", "es"],
  ["français", "fr"],
  ["deutsch", "de"],
]);

const ENGLISH_MARKERS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has",
  "have", "i", "in", "is", "it", "more", "not", "of", "on", "or", "so", "that",
  "the", "this", "to", "was", "we", "with", "you",
]);

const SPANISH_MARKERS = new Set([
  "como", "con", "de", "del", "el", "en", "es", "esta", "la", "las", "lo", "los",
  "para", "por", "que", "se", "un", "una", "y",
]);

const TRADITIONAL_CHINESE = /[體臺灣與為這個們來時說後開發網頁車馬龍門見學習總結測試驗證]/u;

export function normalizeConcreteLanguageTag(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || isOriginalContentLanguagePreference(trimmed)) return null;

  const label = LANGUAGE_LABELS.get(trimmed.toLowerCase()) ?? LANGUAGE_LABELS.get(trimmed);
  const candidate = (label ?? trimmed).replaceAll("_", "-");
  try {
    const locale = new Intl.Locale(candidate);
    if (!/^[a-z]{2,3}$/u.test(locale.language)) return null;
    if (locale.language === "zh") return normalizeChineseLocale(locale);
    return locale.toString();
  } catch {
    return null;
  }
}

function normalizeChineseLocale(locale: Intl.Locale): string {
  const script = locale.script?.toLowerCase();
  const region = locale.region?.toUpperCase();
  if (script === "hant" || region === "TW" || region === "HK" || region === "MO") {
    return "zh-Hant";
  }
  return "zh-Hans";
}

export function actualContentLanguagesMatch(
  value: string | null | undefined,
  target: string | null | undefined,
): boolean {
  const left = normalizeConcreteLanguageTag(value);
  const right = normalizeConcreteLanguageTag(target);
  if (!left || !right) return false;

  const leftLocale = new Intl.Locale(left);
  const rightLocale = new Intl.Locale(right);
  if (leftLocale.language !== rightLocale.language) return false;
  if (leftLocale.language !== "zh") return true;
  return leftLocale.script === rightLocale.script;
}

export function resolveSummaryTargetLanguage(
  requestedSummaryLanguage: string | null | undefined,
  contentLanguage: string | null | undefined,
): string | null {
  if (isOriginalContentLanguagePreference(requestedSummaryLanguage)) {
    return normalizeConcreteLanguageTag(contentLanguage);
  }
  return normalizeConcreteLanguageTag(requestedSummaryLanguage);
}

export function detectTextLanguage(value: string | null | undefined): TextLanguageDetection {
  const text = String(value ?? "").replace(/https?:\/\/\S+/giu, " ").trim();
  if (text.length < 20) return lowConfidenceDetection();

  const kana = countMatches(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  if (kana >= 2) return highConfidenceDetection("ja");

  const hangul = countMatches(text, /[\p{Script=Hangul}]/gu);
  if (hangul >= 4) return highConfidenceDetection("ko");

  const han = countMatches(text, /[\p{Script=Han}]/gu);
  if (han >= 6) {
    return highConfidenceDetection(TRADITIONAL_CHINESE.test(text) ? "zh-Hant" : "zh-Hans");
  }

  const latin = countMatches(text, /[\p{Script=Latin}]/gu);
  if (latin < 20) return lowConfidenceDetection();
  const words = text.toLowerCase().match(/[\p{Script=Latin}]+(?:['’-][\p{Script=Latin}]+)*/gu) ?? [];
  const englishScore = words.filter((word) => ENGLISH_MARKERS.has(word)).length;
  const spanishScore = words.filter((word) => SPANISH_MARKERS.has(word)).length;
  if (spanishScore >= 3 && spanishScore > englishScore) return highConfidenceDetection("es");
  if (englishScore >= 3 && englishScore >= spanishScore) return highConfidenceDetection("en");
  return lowConfidenceDetection();
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function highConfidenceDetection(language: string): TextLanguageDetection {
  return { language, confidence: "high", source: "text" };
}

function lowConfidenceDetection(): TextLanguageDetection {
  return { language: null, confidence: "low", source: "text" };
}
