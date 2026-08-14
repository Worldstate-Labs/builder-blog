import assert from "node:assert/strict";
import { test } from "node:test";
import { planSharedPostReuse } from "../src/lib/shared-post-reuse-plan";

test("Original translates a stored summary into the concrete content language", () => {
  assert.deepEqual(
    planSharedPostReuse({
      requestedSummaryLanguage: "source",
      contentLanguage: "en",
      summaryContentLanguage: "zh-Hans",
      hasUsableSummary: true,
      hasUsableHeadline: false,
      hasUsableBody: true,
    }),
    {
      version: 2,
      mode: "translate_summary_to_content_language",
      requestedSummaryLanguage: "source",
      contentLanguage: "en",
      sourceSummaryLanguage: "zh-Hans",
      targetLanguage: "en",
    },
  );
});

test("Original copies only a headline and summary already written in the content language", () => {
  assert.equal(
    planSharedPostReuse({
      requestedSummaryLanguage: "original",
      contentLanguage: "en",
      summaryContentLanguage: "English",
      hasUsableSummary: true,
      hasUsableHeadline: true,
      hasUsableBody: false,
    }).mode,
    "copy_summary",
  );
});

test("fixed-language reuse translates to a concrete target without using source as a language", () => {
  const plan = planSharedPostReuse({
    requestedSummaryLanguage: "简体中文",
    contentLanguage: "en",
    summaryContentLanguage: "en",
    hasUsableSummary: true,
    hasUsableHeadline: false,
    hasUsableBody: false,
  });

  assert.equal(plan.mode, "translate_summary_fixed");
  assert.equal(plan.targetLanguage, "zh-Hans");
});

test("unknown Original content language falls back to reusable body instead of translating to source", () => {
  const plan = planSharedPostReuse({
    requestedSummaryLanguage: "source",
    contentLanguage: null,
    summaryContentLanguage: "zh-Hans",
    hasUsableSummary: true,
    hasUsableHeadline: false,
    hasUsableBody: true,
  });

  assert.equal(plan.mode, "summarize_reused_body");
  assert.equal(plan.targetLanguage, null);
});
