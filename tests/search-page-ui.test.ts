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
  assert.doesNotMatch(defaultSuggestionBlock, /"AI Briefs"/);
  assert.doesNotMatch(apiDefaultSuggestionBlock, /"AI Briefs"/);
  assert.match(searchPage, /digest:\s*"AI Briefs"/);
  assert.match(searchPage, /const resultTypeItemLabels[\s\S]*digest:\s*"AI Brief",/);
  assert.match(suggestRoute, /return "AI Brief"/);
  assert.doesNotMatch(searchPage, /digest:\s*"AI Brief archives"/);
  assert.doesNotMatch(suggestRoute, /return "AI Brief archive"/);
});

test("source search results expose add and in-library states", () => {
  const searchPage = source("src/app/(workspace)/search/page.tsx");
  const sourceAction = source("src/components/SearchSourceLibraryAction.tsx");

  assert.match(searchPage, /SearchSourceLibraryAction/);
  assert.match(sourceAction, /Add source/);
  assert.match(sourceAction, /In library/);
  assert.match(searchPage, /sourceValue=\{result\.sourceValue/);
  assert.match(searchPage, /libraryStatus=\{result\.libraryStatus/);
});

test("source search result add action exposes clickable source-type suggestions", () => {
  const sourceAction = source("src/components/SearchSourceLibraryAction.tsx");

  assert.match(sourceAction, /suggestId\?:\s*DetectedSourceId/);
  assert.match(sourceAction, /add-source-text-action/);
  assert.match(sourceAction, /Switch source type/);
  assert.match(sourceAction, /suggestedSourceType/);
  assert.match(sourceAction, /submitAdd\(\{ sourceTypeOverride: suggestedSourceType \}\)/);
});

test("header search suggestions use source avatars instead of letter placeholders", () => {
  const searchForm = source("src/components/SearchForm.tsx");
  const suggestRoute = source("src/app/api/search/suggest/route.ts");

  assert.match(searchForm, /import \{ SourceAvatar \} from "@\/components\/SourceAvatar"/);
  assert.match(searchForm, /avatarUrl\?: string \| null/);
  assert.match(searchForm, /avatarDataUrl\?: string \| null/);
  assert.match(searchForm, /sourceType\?: string \| null/);
  assert.match(searchForm, /<SourceAvatar[\s\S]*className="search-suggestion-avatar"/);
  assert.doesNotMatch(searchForm, /suggestion\.label\.slice\(0,\s*1\)\.toUpperCase\(\)/);
  assert.match(suggestRoute, /avatarUrl:\s*result\.avatarUrl/);
  assert.match(suggestRoute, /avatarDataUrl:\s*result\.avatarDataUrl/);
  assert.match(suggestRoute, /sourceType:\s*result\.sourceType/);
  assert.match(suggestRoute, /result\.type !== "builder"/);
});
