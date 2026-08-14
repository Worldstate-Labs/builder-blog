import {
  actualContentLanguagesMatch,
  normalizeConcreteLanguageTag,
  resolveSummaryTargetLanguage,
} from "@/lib/content-language";
import { normalizeSummaryLanguagePreference } from "@/lib/language-preference";

export type SharedPostReuseMode =
  | "copy_summary"
  | "translate_summary_fixed"
  | "translate_summary_to_content_language"
  | "summarize_reused_body"
  | "none";

export type SharedPostReusePlan = {
  version: 2;
  mode: SharedPostReuseMode;
  requestedSummaryLanguage: string;
  contentLanguage: string | null;
  sourceSummaryLanguage: string | null;
  targetLanguage: string | null;
};

export function planSharedPostReuse({
  requestedSummaryLanguage,
  contentLanguage,
  summaryContentLanguage,
  hasUsableSummary,
  hasUsableHeadline,
  hasUsableBody,
}: {
  requestedSummaryLanguage: string | null | undefined;
  contentLanguage: string | null | undefined;
  summaryContentLanguage: string | null | undefined;
  hasUsableSummary: boolean;
  hasUsableHeadline: boolean;
  hasUsableBody: boolean;
}): SharedPostReusePlan {
  const requested = normalizeSummaryLanguagePreference(requestedSummaryLanguage);
  const concreteContentLanguage = normalizeConcreteLanguageTag(contentLanguage);
  const concreteSummaryLanguage = normalizeConcreteLanguageTag(summaryContentLanguage);
  const targetLanguage = resolveSummaryTargetLanguage(requested, concreteContentLanguage);

  let mode: SharedPostReuseMode = "none";
  if (
    hasUsableSummary &&
    hasUsableHeadline &&
    targetLanguage &&
    actualContentLanguagesMatch(concreteSummaryLanguage, targetLanguage)
  ) {
    mode = "copy_summary";
  } else if (
    hasUsableSummary &&
    concreteSummaryLanguage &&
    targetLanguage &&
    !actualContentLanguagesMatch(concreteSummaryLanguage, targetLanguage)
  ) {
    mode = requested === "source"
      ? "translate_summary_to_content_language"
      : "translate_summary_fixed";
  } else if (hasUsableBody) {
    mode = "summarize_reused_body";
  }

  return {
    version: 2,
    mode,
    requestedSummaryLanguage: requested,
    contentLanguage: concreteContentLanguage,
    sourceSummaryLanguage: concreteSummaryLanguage,
    targetLanguage,
  };
}
