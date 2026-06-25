"use client";

import { Globe } from "lucide-react";
import { useId } from "react";
import { useI18n } from "@/components/I18nProvider";
import { uiLocaleOptions, type UiLocale } from "@/lib/i18n";

export function LanguageSwitcher({
  compact = false,
}: {
  compact?: boolean;
}) {
  const id = useId();
  const { locale, setLocale, t } = useI18n();

  return (
    <label className={`language-switcher${compact ? " language-switcher-compact" : ""}`} htmlFor={id}>
      <Globe aria-hidden="true" className="language-switcher-icon" />
      <span className="sr-only">{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        className="language-switcher-select"
        id={id}
        onChange={(event) => setLocale(event.currentTarget.value as UiLocale)}
        value={locale}
      >
        {uiLocaleOptions.map((option) => (
          <option key={option.code} value={option.code}>
            {compact ? option.shortLabel : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
