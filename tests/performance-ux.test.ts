import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("primary app navigation keeps route prefetching enabled", () => {
  const appNav = source("src/components/AppNav.tsx");

  assert.equal(appNav.includes("prefetch={false}"), false);
});

test("app shell reuses the page session instead of fetching it again", () => {
  const appShell = source("src/components/AppShell.tsx");

  assert.equal(appShell.includes("getServerSession"), false);
  assert.match(appShell, /session\??:/);
});

test("settings live in the clickable user avatar menu", () => {
  const appShell = source("src/components/AppShell.tsx");
  const appNav = source("src/components/AppNav.tsx");
  const settingsPage = source("src/app/settings/page.tsx");
  const globals = source("src/app/globals.css");

  assert.doesNotMatch(appShell, /label: "Agent"/);
  assert.doesNotMatch(appNav, /"key"/);
  assert.match(appShell, /className="user-menu-trigger"/);
  assert.match(appShell, /aria-label="Open user menu"/);
  assert.match(appShell, /href="\/settings"[\s\S]*Settings/);
  assert.match(appShell, /href="\/api\/auth\/signout"[\s\S]*Sign out/);
  assert.match(settingsPage, />\s*Settings\s*</);
  assert.doesNotMatch(settingsPage, /Agent login/);
  assert.match(globals, /\.user-avatar/);
  assert.match(globals, /\.user-menu-popover/);
});

test("desktop shell uses home rail, header search, and merged home feeds", () => {
  const appShell = source("src/components/AppShell.tsx");
  const appNav = source("src/components/AppNav.tsx");
  const dashboardPage = source("src/app/dashboard/page.tsx");
  const recommendationsPage = source("src/app/recommendations/page.tsx");
  const globals = source("src/app/globals.css");

  assert.match(appShell, /label: "Home"/);
  assert.doesNotMatch(appShell, /label: "Digest"/);
  assert.doesNotMatch(appShell, /label: "For You"/);
  assert.doesNotMatch(appShell, /label: "Search"/);
  assert.doesNotMatch(appNav, /recommendations/);
  assert.doesNotMatch(appNav, /"search"/);
  assert.match(appShell, /className="app-topbar"/);
  assert.match(appShell, /className="header-search"/);
  assert.match(appShell, /name="q"/);
  assert.match(dashboardPage, /HomeTabLink/);
  assert.match(dashboardPage, /For You/);
  assert.match(dashboardPage, /Subscription/);
  assert.match(dashboardPage, /RecommendationFeed/);
  assert.match(dashboardPage, /getRecommendationTimeline/);
  assert.match(recommendationsPage, /redirect\("\/dashboard"\)/);
  assert.match(globals, /\.home-layout/);
  assert.match(globals, /\.home-rail/);
});

test("skill context caps personal seen items to keep payloads bounded", () => {
  const contextRoute = source("src/app/api/skill/context/route.ts");

  assert.match(contextRoute, /personalSeenItemLimit/);
  assert.match(contextRoute, /take:\s*personalSeenItemLimit/);
});

test("history page paginates digests instead of rendering the full archive", () => {
  const historyPage = source("src/app/history/page.tsx");

  assert.match(historyPage, /historyPageSize/);
  assert.match(historyPage, /take:\s*historyPageSize/);
});

test("search page uses a client form with pending feedback", () => {
  const searchPage = source("src/app/search/page.tsx");
  const searchForm = source("src/components/SearchForm.tsx");
  const globals = source("src/app/globals.css");

  assert.match(searchPage, /@\/components\/SearchForm/);
  assert.match(searchPage, /searchPageSize/);
  assert.match(searchPage, /relatedSearchSuggestions/);
  assert.match(searchPage, /didYouMeanSearch/);
  assert.match(searchPage, /shouldUseCorrectedSearch/);
  assert.match(searchPage, /Search instead for/);
  assert.match(searchPage, /isShowingCorrectedResults/);
  assert.match(searchPage, /Advanced search/);
  assert.match(searchPage, /"agent \* memory"/);
  assert.match(searchPage, /-"memory leak"/);
  assert.match(searchPage, /\+retrieval/);
  assert.match(searchPage, /agent OR embedding/);
  assert.match(searchPage, /"agent memory" OR "retrieval quality"/);
  assert.match(searchPage, /\("agent memory" OR "retrieval quality"\) launch/);
  assert.match(searchPage, /agent AROUND\(3\) memory/);
  assert.match(searchPage, /site:example\.com/);
  assert.match(searchPage, /site:example\.com\/articles/);
  assert.match(searchPage, /-site:example\.com/);
  assert.match(searchPage, /intitle:launch/);
  assert.match(searchPage, /-intitle:pricing/);
  assert.match(searchPage, /allintitle:agent memory/);
  assert.match(searchPage, /-allintitle:pricing launch/);
  assert.match(searchPage, /intext:transcript/);
  assert.match(searchPage, /allintext:agent memory/);
  assert.match(searchPage, /inurl:release/);
  assert.match(searchPage, /allinurl:release agent/);
  assert.match(searchPage, /type:feed/);
  assert.match(searchPage, /filetype:digest/);
  assert.match(searchPage, /-filetype:digest/);
  assert.match(searchPage, /after:2026-01-01/);
  assert.match(searchPage, /-pricing/);
  assert.match(searchPage, /ActiveSearchFilters/);
  assert.match(searchPage, /searchHighlightTerms/);
  assert.match(searchPage, /search-result-refinements/);
  assert.match(searchPage, /More from this source/);
  assert.match(searchPage, /Search tools/);
  assert.match(searchPage, /Clear all/);
  assert.match(searchPage, /SearchQueryInsights/);
  assert.match(searchPage, /SearchTypeTabs/);
  assert.match(searchPage, /counts=\{hasQuery \? typeCounts : null\}/);
  assert.match(searchPage, /buildQueryInsightItems/);
  assert.match(searchPage, /search-insights/);
  assert.match(searchPage, /search-insight-card/);
  assert.match(searchPage, /Query understood/);
  assert.match(searchPage, /Broaden to Hybrid/);
  assert.match(searchPage, /Search all result types/);
  assert.match(searchPage, /Search all time/);
  assert.match(searchPage, /search-empty-actions/);
  assert.match(searchPage, /stripSearchQueryOperators/);
  assert.match(searchPage, /clearAllSearchHref/);
  assert.match(searchPage, /Remove title search terms/);
  assert.match(searchPage, /Remove text search terms/);
  assert.match(searchPage, /Remove URL search terms/);
  assert.match(searchPage, /Remove required terms/);
  assert.match(searchPage, /Must include/);
  assert.match(searchPage, /Remove excluded title terms/);
  assert.match(searchPage, /Remove excluded sites/);
  assert.match(searchPage, /Remove excluded phrases/);
  assert.match(searchPage, /Remove excluded file types/);
  assert.match(searchPage, /Remove file type/);
  assert.match(searchPage, /normalizeSearchTime/);
  assert.match(searchForm, /useTransition/);
  assert.match(searchForm, /Searching/);
  assert.match(searchForm, /localStorage\.getItem\("builder-blog-searches"\)/);
  assert.match(searchForm, /normalizeRecentSearches/);
  assert.match(searchForm, /Search mode/);
  assert.match(searchForm, /Time range/);
  assert.match(searchForm, /Sort by/);
  assert.match(searchForm, /Custom date range/);
  assert.match(searchForm, /withDateSearchOperators/);
  assert.match(searchForm, /name="after"/);
  assert.match(searchForm, /name="before"/);
  assert.match(searchForm, /useRef<HTMLInputElement>/);
  assert.match(searchForm, /Clear search query/);
  assert.match(searchForm, /clearQuery/);
  assert.match(searchForm, /inputRef\.current\?\.focus/);
  assert.match(searchForm, /recentSuggestionKeys/);
  assert.match(searchForm, /Remove recent search/);
  assert.match(searchForm, /removeRecentSearch/);
  assert.match(searchForm, /normalizeSuggestionKey/);
  assert.doesNotMatch(searchForm, /datalist/);
  assert.match(searchForm, /\/api\/search\/suggest/);
  assert.match(searchForm, /AbortController/);
  assert.match(searchForm, /aria-live="polite"/);
  assert.match(searchForm, /search-suggestion-dropdown/);
  assert.match(searchForm, /search-suggestion-title/);
  assert.match(searchForm, /search-suggestion-detail/);
  assert.match(searchForm, /normalizeAutocompleteItems/);
  assert.match(searchForm, /onKeyDown/);
  assert.match(searchForm, /ArrowDown/);
  assert.match(searchForm, /ArrowUp/);
  assert.match(searchForm, /Escape/);
  assert.match(searchForm, /aria-activedescendant/);
  assert.match(searchForm, /role="listbox"/);
  assert.match(searchForm, /role="option"/);
  assert.match(searchForm, /Lucky/);
  assert.doesNotMatch(searchForm, /type="radio"/);
  assert.match(globals, /\.search-suggestion-dropdown/);
  assert.doesNotMatch(globals, /\.search-page-active \.search-suggestion-row\s*\{[\s\S]*display:\s*none/);
  assert.match(globals, /\.search-page-active \.search-heading\s*\{[\s\S]*position:\s*absolute/);
});

test("search suggestions API exists for autocomplete-style queries", () => {
  const suggestRoute = source("src/app/api/search/suggest/route.ts");

  assert.match(suggestRoute, /relatedSearchSuggestions/);
  assert.match(suggestRoute, /searchUserLibrary/);
  assert.match(suggestRoute, /items:/);
  assert.match(suggestRoute, /titlePrefixCompletions/);
  assert.match(suggestRoute, /claude code/);
  assert.match(suggestRoute, /NextResponse/);
});

test("user library search can fetch operator-only candidate sets", () => {
  const userSearch = source("src/lib/user-search.ts");

  assert.match(userSearch, /terms\.length > 0/);
  assert.match(userSearch, /builderSearchConditions\(terms\)/);
  assert.match(userSearch, /feedSearchConditions\(terms\)/);
  assert.match(userSearch, /digestSearchConditions\(terms\)/);
});

test("heavy route sections have route-specific loading fallbacks", () => {
  for (const path of [
    "src/app/admin/loading.tsx",
    "src/app/builders/loading.tsx",
    "src/app/history/loading.tsx",
    "src/app/library-hub/loading.tsx",
    "src/app/search/loading.tsx",
  ]) {
    assert.equal(existsSync(join(root, path)), true, path);
  }
});

test("builders page streams crawled content behind a suspense boundary", () => {
  const buildersPage = source("src/app/builders/page.tsx");

  assert.match(buildersPage, /Suspense/);
  assert.match(buildersPage, /RecentCrawledContent/);
});

test("builders page exposes per-builder crawled posts ordered by time", () => {
  const buildersPage = source("src/app/builders/page.tsx");

  assert.match(buildersPage, /feedItems:\s*{/);
  assert.match(buildersPage, /orderBy:\s*\[\{ publishedAt: "desc" \}, \{ createdAt: "desc" \}\]/);
  assert.match(buildersPage, /title="Private library"[\s\S]*defaultOpen/);
  assert.match(buildersPage, /Imported libraries/);
  assert.match(buildersPage, /importedLibrarySections/);
  assert.match(buildersPage, /library-section-panel-indented/);
  assert.doesNotMatch(buildersPage, /Central defaults/);
  assert.match(buildersPage, /BuilderFeedItems/);
  assert.match(buildersPage, /Crawled posts/);
  assert.match(buildersPage, /Crawled/);
  assert.match(buildersPage, /External id/);
  assert.match(buildersPage, /Read full crawl/);
  assert.match(buildersPage, /crawlingTool/);
});

test("library hub exposes share and multi-import flows", () => {
  const appShell = source("src/components/AppShell.tsx");
  const buildersPage = source("src/app/builders/page.tsx");
  const hubPage = source("src/app/library-hub/page.tsx");
  const actions = source("src/app/actions.ts");
  const skillRoute = source("src/app/api/skill/builders/route.ts");
  const schema = source("prisma/schema.prisma");

  assert.match(appShell, /library-hub/);
  assert.match(buildersPage, /togglePersonalLibraryHubAvailabilityAction/);
  assert.match(buildersPage, /library-visibility-toggle/);
  assert.match(buildersPage, /aria-pressed/);
  assert.match(buildersPage, /allowRemove=\{false\}/);
  assert.match(actions, /BuilderPoolOrigin\.HUB_IMPORT/);
  assert.match(actions, /imported-builder-remove-denied/);
  assert.doesNotMatch(hubPage, /sharePersonalLibraryToHubAction/);
  assert.match(hubPage, /importHubLibrariesAction/);
  assert.match(hubPage, /importCount/);
  assert.match(hubPage, /viewCount/);
  assert.match(hubPage, /orderBy:\s*\[\{ kind: "desc" \}, \{ importCount: "desc" \}, \{ viewCount: "desc" \}/);
  assert.match(hubPage, /libraryId/);
  assert.match(actions, /sharePersonalLibraryToHub/);
  assert.match(actions, /unsharePersonalLibraryFromHub/);
  assert.match(actions, /importLibrariesFromHub/);
  assert.match(skillRoute, /crawlingTool: "Legacy crawl\/import"/);
  assert.match(schema, /model LibraryHubEntry/);
  assert.match(schema, /model LibraryImport/);
});

test("list actions use compact controls instead of full-width mobile buttons", () => {
  const css = source("src/app/globals.css");
  const buildersPage = source("src/app/builders/page.tsx");
  const settingsPage = source("src/app/settings/page.tsx");
  const adminPage = source("src/app/admin/page.tsx");

  assert.match(css, /\.button-compact/);
  assert.match(css, /\.row-actions/);
  assert.doesNotMatch(css, /\.builder-row form,\s*\n\s*\.builder-row button\s*{\s*\n\s*width:\s*100%/);
  assert.match(buildersPage, /row-actions/);
  assert.match(buildersPage, /button-light button-compact/);
  assert.match(settingsPage, /button-light button-compact/);
  assert.match(adminPage, /button-light button-compact/);
});
