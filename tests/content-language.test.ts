import assert from "node:assert/strict";
import test from "node:test";

import {
  actualContentLanguagesMatch,
  detectTextLanguage,
  normalizeConcreteLanguageTag,
  resolveSummaryTargetLanguage,
} from "../src/lib/content-language";

test("concrete language normalization rejects request modes and canonicalizes real tags", () => {
  assert.equal(normalizeConcreteLanguageTag("source"), null);
  assert.equal(normalizeConcreteLanguageTag("Original"), null);
  assert.equal(normalizeConcreteLanguageTag("Original content language"), null);
  assert.equal(normalizeConcreteLanguageTag("English"), "en");
  assert.equal(normalizeConcreteLanguageTag("zh_CN"), "zh-Hans");
  assert.equal(normalizeConcreteLanguageTag("zh-TW"), "zh-Hant");
  assert.equal(normalizeConcreteLanguageTag("fr-fr"), "fr-FR");
  assert.equal(normalizeConcreteLanguageTag("not a language"), null);
});

test("actual language matching respects Chinese script while accepting compatible regional tags", () => {
  assert.equal(actualContentLanguagesMatch("en", "en-US"), true);
  assert.equal(actualContentLanguagesMatch("zh-CN", "zh-Hans"), true);
  assert.equal(actualContentLanguagesMatch("zh-TW", "zh-Hant"), true);
  assert.equal(actualContentLanguagesMatch("zh-Hans", "zh-Hant"), false);
  assert.equal(actualContentLanguagesMatch("source", "source"), false);
  assert.equal(actualContentLanguagesMatch(null, "en"), false);
});

test("text language detection returns only high-confidence concrete languages", () => {
  assert.deepEqual(
    detectTextLanguage("More on the pelican on the bicycle test. I uploaded the source so it is playable in the browser."),
    { language: "en", confidence: "high", source: "text" },
  );
  assert.deepEqual(
    detectTextLanguage("这是一个用于验证简体中文摘要语言识别的完整句子。"),
    { language: "zh-Hans", confidence: "high", source: "text" },
  );
  assert.deepEqual(
    detectTextLanguage("これは日本語の文章で、言語判定を確認するための十分な長さがあります。"),
    { language: "ja", confidence: "high", source: "text" },
  );
  assert.deepEqual(detectTextLanguage("LLM API v2"), {
    language: null,
    confidence: "low",
    source: "text",
  });
});

test("summary target resolution converts Original mode into a concrete body language", () => {
  assert.equal(resolveSummaryTargetLanguage("source", "en"), "en");
  assert.equal(resolveSummaryTargetLanguage("original", "zh-TW"), "zh-Hant");
  assert.equal(resolveSummaryTargetLanguage("source", null), null);
  assert.equal(resolveSummaryTargetLanguage("English", "zh-Hans"), "en");
  assert.equal(resolveSummaryTargetLanguage("zh", "en"), "zh-Hans");
});
