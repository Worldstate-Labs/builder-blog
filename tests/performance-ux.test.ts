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
  assert.doesNotMatch(appShell, /label: "History"/);
  assert.doesNotMatch(appShell, /label: "Search"/);
  assert.doesNotMatch(appNav, /recommendations/);
  assert.doesNotMatch(appNav, /"search"/);
  assert.match(appShell, /className="app-topbar"/);
  assert.match(appShell, /className="header-search"/);
  assert.match(appShell, /name="q"/);
  assert.match(dashboardPage, /HomeTabLink/);
  assert.match(dashboardPage, /For You/);
  assert.match(dashboardPage, /Subscription/);
  assert.match(dashboardPage, /Today digest/);
  assert.match(dashboardPage, /Digest archive/);
  assert.match(dashboardPage, /ForYouRecommendationSection/);
  assert.doesNotMatch(dashboardPage, /getRecommendationTimeline/);
  assert.match(recommendationsPage, /redirect\("\/dashboard"\)/);
  assert.match(globals, /\.home-layout/);
  assert.match(globals, /\.home-rail/);
});

test("dashboard defers heavy recommendation timeline work to a client island", () => {
  const dashboardPage = source("src/app/dashboard/page.tsx");
  const forYouSection = source("src/components/ForYouRecommendationSection.tsx");
  const timelineRoute = source("src/app/api/recommendations/timeline/route.ts");
  const serializer = source("src/lib/recommendation-view-model.ts");

  assert.doesNotMatch(dashboardPage, /getRecommendationTimeline/);
  assert.doesNotMatch(dashboardPage, /RecommendationFeed/);
  assert.match(dashboardPage, /ForYouRecommendationSection/);
  assert.match(forYouSection, /"use client"/);
  assert.match(forYouSection, /fetch\("\/api\/recommendations\/timeline"/);
  assert.match(forYouSection, /Loading recommendations/);
  assert.match(forYouSection, /aria-live="polite"/);
  assert.match(timelineRoute, /export async function GET/);
  assert.match(timelineRoute, /getRecommendationTimeline/);
  assert.match(timelineRoute, /serializeRecommendationTimeline/);
  assert.match(timelineRoute, /NextResponse\.json/);
  assert.match(serializer, /serializeRecommendationTimeline/);
  assert.match(serializer, /serializeRecommendationSnapshot/);
});

test("skill context caps personal seen items to keep payloads bounded", () => {
  const contextRoute = source("src/app/api/skill/context/route.ts");

  assert.match(contextRoute, /personalSeenItemLimit/);
  assert.match(contextRoute, /take:\s*personalSeenItemLimit/);
});

test("dashboard subscription feed owns the paginated digest archive", () => {
  const dashboardPage = source("src/app/dashboard/page.tsx");
  const historyPage = source("src/app/history/page.tsx");

  assert.match(dashboardPage, /archivePageSize/);
  assert.match(dashboardPage, /take:\s*archivePageSize/);
  assert.match(dashboardPage, /id="digest-archive"/);
  assert.match(dashboardPage, /Digest archive/);
  assert.match(historyPage, /redirect\(`\/dashboard\?tab=subscription&archivePage=\$\{page\}#digest-archive`\)/);
  assert.doesNotMatch(historyPage, /AppShell/);
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
  const builderFeedItems = source("src/components/BuilderFeedItems.tsx");
  const feedItemsRoute = source("src/app/api/builders/[builderId]/feed-items/route.ts");

  assert.doesNotMatch(buildersPage, /feedItems:\s*{/);
  assert.match(buildersPage, /title="Private library"[\s\S]*defaultOpen/);
  assert.match(buildersPage, /Latest post:/);
  assert.match(buildersPage, /publishedAt:\s*{\s*not:\s*null\s*}/);
  assert.match(buildersPage, /Imported libraries/);
  assert.match(buildersPage, /importedLibrarySections/);
  assert.match(buildersPage, /library-section-panel-indented/);
  assert.doesNotMatch(buildersPage, /Central defaults|Central library/);
  assert.match(buildersPage, /BuilderFeedItems/);
  assert.match(builderFeedItems, /"use client"/);
  assert.match(builderFeedItems, /fetch\(`\/api\/builders\/\$\{builderId\}\/feed-items`/);
  assert.match(builderFeedItems, /Crawled posts/);
  assert.match(builderFeedItems, /Crawled/);
  assert.match(builderFeedItems, /External id/);
  assert.match(builderFeedItems, /Read full crawl/);
  assert.match(builderFeedItems, /crawlingTool/);
  assert.match(feedItemsRoute, /orderBy:\s*\[\{ publishedAt: "desc" \}, \{ createdAt: "desc" \}\]/);
  assert.match(feedItemsRoute, /activePoolBuilderIds/);
  assert.match(feedItemsRoute, /NextResponse\.json/);
});

test("library hub exposes share and multi-import flows", () => {
  const appShell = source("src/components/AppShell.tsx");
  const buildersPage = source("src/app/builders/page.tsx");
  const builderActions = source("src/components/BuilderLibraryActions.tsx");
  const visibilityToggle = source("src/components/LibraryVisibilityToggle.tsx");
  const visibilityRoute = source("src/app/api/library-hub/personal-availability/route.ts");
  const builderSubscriptionRoute = source("src/app/api/builders/[builderId]/subscription/route.ts");
  const builderLibraryRoute = source("src/app/api/builders/[builderId]/library/route.ts");
  const builderSubscribeAllRoute = source("src/app/api/builders/subscriptions/route.ts");
  const hubImportForm = source("src/components/LibraryHubImportForm.tsx");
  const hubImportRoute = source("src/app/api/library-hub/imports/route.ts");
  const hubPage = source("src/app/library-hub/page.tsx");
  const actions = source("src/app/actions.ts");
  const skillRoute = source("src/app/api/skill/builders/route.ts");
  const schema = source("prisma/schema.prisma");

  assert.match(appShell, /library-hub/);
  assert.match(buildersPage, /LibraryVisibilityToggle/);
  assert.match(buildersPage, /BuilderLibraryActions/);
  assert.doesNotMatch(buildersPage, /togglePersonalLibraryHubAvailabilityAction/);
  assert.doesNotMatch(buildersPage, /subscribeAllLibraryBuildersAction/);
  assert.doesNotMatch(buildersPage, /unsubscribeBuilderAction/);
  assert.doesNotMatch(buildersPage, /removeBuilderFromLibraryAction/);
  assert.match(visibilityToggle, /"use client"/);
  assert.match(visibilityToggle, /fetch\("\/api\/library-hub\/personal-availability"/);
  assert.match(visibilityToggle, /library-visibility-toggle/);
  assert.match(visibilityToggle, /aria-pressed/);
  assert.match(visibilityRoute, /export async function PATCH/);
  assert.doesNotMatch(visibilityRoute, /redirect\(/);
  assert.match(builderActions, /"use client"/);
  assert.match(builderActions, /allowRemove = true/);
  assert.match(builderActions, /allowRemove \? \(/);
  assert.match(builderActions, /fetch\(`\/api\/builders\/\$\{builderId\}\/subscription`/);
  assert.match(builderActions, /fetch\(`\/api\/builders\/\$\{builderId\}\/library`/);
  assert.match(builderActions, /fetch\("\/api\/builders\/subscriptions"/);
  assert.match(buildersPage, /allowRemove=\{false\}/);
  assert.match(builderSubscriptionRoute, /export async function PATCH/);
  assert.match(builderLibraryRoute, /export async function DELETE/);
  assert.match(builderLibraryRoute, /BuilderPoolOrigin\.HUB_IMPORT/);
  assert.match(builderLibraryRoute, /cannot be removed individually/);
  assert.match(builderSubscribeAllRoute, /export async function POST/);
  assert.doesNotMatch(builderSubscriptionRoute, /redirect\(/);
  assert.doesNotMatch(builderLibraryRoute, /redirect\(/);
  assert.doesNotMatch(builderSubscribeAllRoute, /redirect\(/);
  assert.doesNotMatch(hubPage, /sharePersonalLibraryToHubAction/);
  assert.doesNotMatch(hubPage, /importHubLibrariesAction/);
  assert.match(hubPage, /LibraryHubImportForm/);
  assert.match(hubImportForm, /"use client"/);
  assert.match(hubImportForm, /fetch\("\/api\/library-hub\/imports"/);
  assert.match(hubImportForm, /libraryId/);
  assert.match(hubImportRoute, /export async function POST/);
  assert.match(hubImportRoute, /importLibrariesFromHub/);
  assert.doesNotMatch(hubImportRoute, /redirect\(/);
  assert.match(hubPage, /importCount/);
  assert.match(hubPage, /viewCount/);
  assert.match(hubPage, /orderBy:\s*\[\{ kind: "desc" \}, \{ importCount: "desc" \}, \{ viewCount: "desc" \}/);
  assert.match(hubImportForm, /libraryId/);
  assert.match(actions, /sharePersonalLibraryToHub/);
  assert.match(visibilityRoute, /unsharePersonalLibraryFromHub/);
  assert.doesNotMatch(actions, /importLibrariesFromHub/);
  assert.match(skillRoute, /crawlingTool: "Legacy crawl\/import"/);
  assert.match(schema, /model LibraryHubEntry/);
  assert.match(schema, /model LibraryImport/);
});

test("settings mutations stay local instead of refreshing the whole route", () => {
  const settingsPage = source("src/app/settings/page.tsx");
  const feedPreferenceForm = source("src/components/FeedPreferenceForm.tsx");
  const tokenPanel = source("src/components/AgentTokenPanel.tsx");
  const feedPreferenceRoute = source("src/app/api/settings/feed-preferences/route.ts");
  const tokensRoute = source("src/app/api/settings/tokens/route.ts");
  const tokenRoute = source("src/app/api/settings/tokens/[tokenId]/route.ts");
  const actions = source("src/app/actions.ts");

  assert.match(settingsPage, /FeedPreferenceForm/);
  assert.match(settingsPage, /AgentTokenPanel/);
  assert.doesNotMatch(settingsPage, /createPersonalTokenAction/);
  assert.doesNotMatch(settingsPage, /revokeTokenAction/);
  assert.doesNotMatch(settingsPage, /updateFeedPreferenceAction/);
  assert.doesNotMatch(settingsPage, /FormSubmitButton/);
  assert.match(feedPreferenceForm, /"use client"/);
  assert.match(feedPreferenceForm, /fetch\("\/api\/settings\/feed-preferences"/);
  assert.match(feedPreferenceForm, /useTransition/);
  assert.match(feedPreferenceForm, /aria-live="polite"/);
  assert.match(tokenPanel, /"use client"/);
  assert.match(tokenPanel, /fetch\("\/api\/settings\/tokens"/);
  assert.match(tokenPanel, /fetch\(`\/api\/settings\/tokens\/\$\{tokenId\}`/);
  assert.match(tokenPanel, /Copy once/);
  assert.match(feedPreferenceRoute, /export async function PATCH/);
  assert.match(feedPreferenceRoute, /userFeedPreference\.upsert/);
  assert.match(feedPreferenceRoute, /NextResponse\.json/);
  assert.doesNotMatch(feedPreferenceRoute, /redirect\(/);
  assert.match(tokensRoute, /export async function POST/);
  assert.match(tokensRoute, /createAgentToken/);
  assert.doesNotMatch(tokensRoute, /redirect\(/);
  assert.match(tokenRoute, /export async function DELETE/);
  assert.match(tokenRoute, /revokedAt/);
  assert.doesNotMatch(tokenRoute, /redirect\(/);
  assert.doesNotMatch(actions, /createPersonalTokenAction/);
  assert.doesNotMatch(actions, /revokeTokenAction/);
  assert.doesNotMatch(actions, /updateFeedPreferenceAction/);
});

test("device authorization gives local pending feedback without route redirects", () => {
  const devicePage = source("src/app/device/page.tsx");
  const deviceApproveButton = source("src/components/DeviceApproveButton.tsx");
  const approveRoute = source("src/app/api/device/approve/route.ts");
  const actions = source("src/app/actions.ts");

  assert.match(devicePage, /DeviceApproveButton/);
  assert.doesNotMatch(devicePage, /approveDeviceLoginAction/);
  assert.doesNotMatch(devicePage, /FormSubmitButton/);
  assert.match(deviceApproveButton, /"use client"/);
  assert.match(deviceApproveButton, /fetch\("\/api\/device\/approve"/);
  assert.match(deviceApproveButton, /Approving/);
  assert.match(deviceApproveButton, /Approved\. Return to your terminal\./);
  assert.match(approveRoute, /export async function POST/);
  assert.match(approveRoute, /createAgentToken/);
  assert.match(approveRoute, /NextResponse\.json/);
  assert.doesNotMatch(approveRoute, /redirect\(/);
  assert.doesNotMatch(actions, /approveDeviceLoginAction/);
});

test("admin builder mutations stay local instead of using server action forms", () => {
  const adminPage = source("src/app/admin/page.tsx");
  const adminBuilderManager = source("src/components/AdminBuilderManager.tsx");
  const adminBuildersRoute = source("src/app/api/admin/builders/route.ts");
  const adminBuilderRoute = source("src/app/api/admin/builders/[builderId]/route.ts");
  const actions = source("src/app/actions.ts");

  assert.match(adminPage, /AdminBuilderManager/);
  assert.doesNotMatch(adminPage, /addCentralBuilderAction/);
  assert.doesNotMatch(adminPage, /deleteCentralBuilderAction/);
  assert.doesNotMatch(adminPage, /FormSubmitButton/);
  assert.match(adminBuilderManager, /"use client"/);
  assert.match(adminBuilderManager, /fetch\("\/api\/admin\/builders"/);
  assert.match(adminBuilderManager, /fetch\(`\/api\/admin\/builders\/\$\{builderId\}`/);
  assert.match(adminBuilderManager, /aria-live="polite"/);
  assert.match(adminBuilderManager, /Adding/);
  assert.match(adminBuilderManager, /Removing/);
  assert.match(adminBuildersRoute, /export async function POST/);
  assert.match(adminBuildersRoute, /isAdminEmail/);
  assert.match(adminBuildersRoute, /upsertBuilder/);
  assert.match(adminBuildersRoute, /NextResponse\.json/);
  assert.doesNotMatch(adminBuildersRoute, /redirect\(/);
  assert.match(adminBuilderRoute, /export async function DELETE/);
  assert.match(adminBuilderRoute, /isAdminEmail/);
  assert.match(adminBuilderRoute, /deleteMany/);
  assert.doesNotMatch(adminBuilderRoute, /redirect\(/);
  assert.doesNotMatch(actions, /addCentralBuilderAction/);
  assert.doesNotMatch(actions, /deleteCentralBuilderAction/);
});

test("list actions use compact controls instead of full-width mobile buttons", () => {
  const css = source("src/app/globals.css");
  const buildersPage = source("src/app/builders/page.tsx");
  const builderActions = source("src/components/BuilderLibraryActions.tsx");
  const settingsPage = source("src/app/settings/page.tsx");
  const agentTokenPanel = source("src/components/AgentTokenPanel.tsx");
  const adminPage = source("src/app/admin/page.tsx");
  const adminBuilderManager = source("src/components/AdminBuilderManager.tsx");

  assert.match(css, /\.button-compact/);
  assert.match(css, /\.row-actions/);
  assert.doesNotMatch(css, /\.builder-row form,\s*\n\s*\.builder-row button\s*{\s*\n\s*width:\s*100%/);
  assert.match(buildersPage, /row-actions/);
  assert.match(builderActions, /button-light.*button-compact/);
  assert.match(settingsPage, /AgentTokenPanel/);
  assert.match(agentTokenPanel, /button-light button-compact/);
  assert.match(adminPage, /AdminBuilderManager/);
  assert.match(adminBuilderManager, /button-light button-compact/);
});
