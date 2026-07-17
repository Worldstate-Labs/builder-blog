import {
  ORIGINAL_CONTENT_LANGUAGE_LABEL,
  ORIGINAL_CONTENT_LANGUAGE_VALUE,
} from "@/lib/language-preference";
import { uiLocaleOptions } from "@/lib/ui-locales";

export type SummaryLanguageOption = { value: string; label: string };

const FIXED_SUMMARY_LANGUAGE_OPTIONS: ReadonlyArray<SummaryLanguageOption> = uiLocaleOptions.map(
  ({ code, label }) => ({ value: code, label }),
);

export const SUMMARY_LANGUAGE_OPTIONS: ReadonlyArray<SummaryLanguageOption> = [
  { value: ORIGINAL_CONTENT_LANGUAGE_VALUE, label: ORIGINAL_CONTENT_LANGUAGE_LABEL },
  ...FIXED_SUMMARY_LANGUAGE_OPTIONS,
];

export function languageOptions(current: string): ReadonlyArray<SummaryLanguageOption> {
  if (!current || SUMMARY_LANGUAGE_OPTIONS.some((option) => option.value === current)) {
    return SUMMARY_LANGUAGE_OPTIONS;
  }
  return [...SUMMARY_LANGUAGE_OPTIONS, { value: current, label: current }];
}
