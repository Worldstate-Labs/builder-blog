import assert from "node:assert/strict";
import test from "node:test";

import {
  ORIGINAL_CONTENT_LANGUAGE_LABEL,
  ORIGINAL_CONTENT_LANGUAGE_VALUE,
  displayLanguagePreference,
  summaryLanguagesMatch,
} from "../src/lib/language-preference";
import {
  SUMMARY_LANGUAGE_OPTIONS,
  languageOptions,
} from "../src/components/settings/SettingsFields";

test("summary language options use source plus the supported UI locale codes", () => {
  assert.deepEqual(SUMMARY_LANGUAGE_OPTIONS, [
    { value: ORIGINAL_CONTENT_LANGUAGE_VALUE, label: ORIGINAL_CONTENT_LANGUAGE_LABEL },
    { value: "en", label: "English" },
    { value: "zh-CN", label: "简体中文" },
    { value: "zh-TW", label: "繁體中文" },
    { value: "ja", label: "日本語" },
    { value: "ko", label: "한국어" },
    { value: "es", label: "Español" },
  ]);
});

test("language options append a saved legacy value without reintroducing it for new selections", () => {
  assert.deepEqual(languageOptions("Français"), [
    ...SUMMARY_LANGUAGE_OPTIONS,
    { value: "Français", label: "Français" },
  ]);
  assert.deepEqual(languageOptions("Deutsch"), [
    ...SUMMARY_LANGUAGE_OPTIONS,
    { value: "Deutsch", label: "Deutsch" },
  ]);
  assert.equal(languageOptions("en"), SUMMARY_LANGUAGE_OPTIONS);
});

test("displayLanguagePreference formats canonical locale codes and preserves published legacy labels", () => {
  const cases: Array<[string | null | undefined, string]> = [
    [undefined, "Original"],
    [null, "Original"],
    ["", "Original"],
    ["source", "Original"],
    ["original", "Original"],
    ["en", "English"],
    ["zh-CN", "简体中文"],
    ["zh-TW", "繁體中文"],
    ["ja", "日本語"],
    ["ko", "한국어"],
    ["es", "Español"],
    ["zh", "Chinese"],
    ["English", "English"],
    ["日本語", "日本語"],
    ["한국어", "한국어"],
    ["Español", "Español"],
    ["Français", "Français"],
    ["français", "Français"],
    ["Deutsch", "Deutsch"],
    ["deutsch", "Deutsch"],
  ];

  for (const [value, expected] of cases) {
    assert.equal(displayLanguagePreference(value), expected, String(value));
  }
});

test("summary language matching treats canonical locale codes and legacy saved values as the same language", () => {
  assert.equal(summaryLanguagesMatch("source", "original"), true);
  assert.equal(summaryLanguagesMatch("en", "English"), true);
  assert.equal(summaryLanguagesMatch("zh-CN", "zh"), true);
  assert.equal(summaryLanguagesMatch("ja", "日本語"), true);
  assert.equal(summaryLanguagesMatch("ko", "한국어"), true);
  assert.equal(summaryLanguagesMatch("es", "Español"), true);
  assert.equal(summaryLanguagesMatch("Français", "français"), true);
  assert.equal(summaryLanguagesMatch("Deutsch", "deutsch"), true);
  assert.equal(summaryLanguagesMatch("source", "zh-CN"), false);
});
