import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("search suggestions stay query-like instead of repeating result type labels", () => {
  const searchPage = source("src/app/(workspace)/search/page.tsx");
  const suggestRoute = source("src/app/api/search/suggest/route.ts");
  const defaultSuggestionBlock = searchPage.match(
    /const defaultSuggestions = \[([\s\S]*?)\];/,
  )?.[1] ?? "";
  const apiDefaultSuggestionBlock = suggestRoute.match(
    /const defaultSuggestions = \[([\s\S]*?)\];/,
  )?.[1] ?? "";

  assert.match(defaultSuggestionBlock, /"agent memory"/);
  assert.match(apiDefaultSuggestionBlock, /"research notes"/);
  assert.doesNotMatch(defaultSuggestionBlock, /"AI Digest issues"/);
  assert.doesNotMatch(apiDefaultSuggestionBlock, /"AI Digest issues"/);
  assert.match(searchPage, /digest:\s*"AI Digest"/);
  assert.match(suggestRoute, /return "AI Digest issue"/);
  assert.doesNotMatch(searchPage, /digest:\s*"AI Digest archives"/);
  assert.doesNotMatch(suggestRoute, /return "AI Digest archive"/);
});
