export const defaultUiLocale = "en";

export const uiLocaleOptions = [
  { code: "en", label: "English", shortLabel: "EN", htmlLang: "en" },
  { code: "zh-CN", label: "简体中文", shortLabel: "简", htmlLang: "zh-CN" },
  { code: "zh-TW", label: "繁體中文", shortLabel: "繁", htmlLang: "zh-TW" },
  { code: "ja", label: "日本語", shortLabel: "日", htmlLang: "ja" },
  { code: "ko", label: "한국어", shortLabel: "한", htmlLang: "ko" },
  { code: "es", label: "Español", shortLabel: "ES", htmlLang: "es" },
] as const;

export type UiLocale = (typeof uiLocaleOptions)[number]["code"];

export const uiLocaleStorageKey = "fb-ui-locale";
export const uiLocaleCookieName = "fb-ui-locale";

export function isUiLocale(value: string): value is UiLocale {
  return uiLocaleOptions.some((option) => option.code === value);
}

export function normalizeUiLocale(value: string | null | undefined): UiLocale | null {
  if (!value) return null;
  const normalized = value.trim().replace("_", "-");
  if (isUiLocale(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower === "zh-hans") return "zh-CN";
  if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-hant") return "zh-TW";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("en")) return "en";
  return null;
}

export function localeHtmlLang(locale: UiLocale) {
  return uiLocaleOptions.find((option) => option.code === locale)?.htmlLang ?? defaultUiLocale;
}
