"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  defaultUiLocale,
  localeHtmlLang,
  translate,
  uiLocaleCookieName,
  uiLocaleStorageKey,
  type I18nKey,
  type UiLocale,
} from "@/lib/i18n";

type I18nContextValue = {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: (key: I18nKey, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function persistLocale(locale: UiLocale) {
  const htmlLang = localeHtmlLang(locale);
  document.documentElement.lang = htmlLang;
  document.documentElement.dataset.locale = locale;
  try {
    localStorage.setItem(uiLocaleStorageKey, locale);
  } catch {
    // Locale persistence is a progressive enhancement.
  }
  document.cookie = `${uiLocaleCookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function I18nProvider({
  children,
  initialLocale: serverLocale = defaultUiLocale,
}: {
  children: ReactNode;
  initialLocale?: UiLocale;
}) {
  const [locale, setLocaleState] = useState<UiLocale>(serverLocale);

  const setLocale = useCallback((nextLocale: UiLocale) => {
    setLocaleState(nextLocale);
    persistLocale(nextLocale);
  }, []);

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  return value ?? fallbackI18n;
}

export function I18nText({
  id,
  values,
}: {
  id: I18nKey;
  values?: Record<string, string | number>;
}) {
  const { t } = useI18n();
  return <>{t(id, values)}</>;
}

const fallbackI18n: I18nContextValue = {
  locale: defaultUiLocale,
  setLocale: () => {},
  t: (key, values) => translate(defaultUiLocale, key, values),
};
