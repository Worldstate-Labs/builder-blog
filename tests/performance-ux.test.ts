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
  const workspaceLayout = source("src/app/(workspace)/layout.tsx");

  assert.equal(appShell.includes("getServerSession"), false);
  assert.match(appShell, /session\??:/);
  assert.match(workspaceLayout, /<AppShell session=\{session\}>/);
  for (const pagePath of [
    "src/app/(workspace)/dashboard/page.tsx",
    "src/app/(workspace)/builders/page.tsx",
    "src/app/(workspace)/library-hub/page.tsx",
    "src/app/(workspace)/search/page.tsx",
    "src/app/(workspace)/settings/page.tsx",
  ]) {
    assert.doesNotMatch(source(pagePath), /AppShell/);
  }
});

test("settings live in the clickable user avatar menu", () => {
  const appShell = source("src/components/AppShell.tsx");
  const appNav = source("src/components/AppNav.tsx");
  const settingsPage = source("src/app/(workspace)/settings/page.tsx");
  const settingsLoading = source("src/app/(workspace)/settings/loading.tsx");
  const userMenu = source("src/components/UserMenu.tsx");
  const globals = source("src/app/globals.css");

  assert.doesNotMatch(appShell, /label: "Agent"/);
  assert.doesNotMatch(appNav, /"key"/);
  assert.match(appShell, /@\/components\/UserMenu/);
  assert.match(userMenu, /"use client"/);
  assert.match(userMenu, /className="user-menu-trigger"/);
  assert.match(userMenu, /aria-label=\{email \? `Account menu for \$\{email\}` : `Account menu for \$\{name\}`\}/);
  assert.match(userMenu, /detailsRef\.current\.open = false/);
  assert.match(userMenu, /href="\/settings" onClick=\{closeMenu\}[\s\S]*Settings/);
  assert.match(userMenu, /href="\/api\/auth\/signout"[\s\S]*onClick=\{closeMenu\}[\s\S]*Sign out/);
  assert.match(settingsPage, />\s*Settings\s*</);
  assert.match(settingsLoading, /RouteLoading/);
  assert.match(settingsLoading, /Loading settings/);
  assert.doesNotMatch(settingsPage, /Agent login/);
  assert.match(globals, /\.user-avatar/);
  assert.match(globals, /\.user-menu-popover/);
});

test("desktop shell uses home rail, header search, and merged home feeds", () => {
  const appShell = source("src/components/AppShell.tsx");
  const appNav = source("src/components/AppNav.tsx");
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const dashboardTabs = source("src/components/DashboardHomeTabs.tsx");
  const searchForm = source("src/components/SearchForm.tsx");
  const digestDetails = source("src/components/DigestDetails.tsx");
  const recommendationsPage = source("src/app/(workspace)/recommendations/page.tsx");
  const globals = source("src/app/globals.css");

  assert.match(appShell, /label: "Home"/);
  assert.doesNotMatch(appShell, /label: "Digest"/);
  assert.doesNotMatch(appShell, /label: "For You"/);
  assert.doesNotMatch(appShell, /label: "History"/);
  assert.match(appShell, /aria-label="Search"/);
  assert.doesNotMatch(appNav, /recommendations/);
  assert.match(appNav, /"search"/);
  assert.match(appShell, /className="fb-top /);
  assert.match(appShell, /<SearchForm query="" variant="header" \/>/);
  assert.match(searchForm, /name="q"/);
  assert.match(dashboardPage, /DashboardHomeTabs/);
  assert.match(dashboardTabs, /role="tablist"/);
  assert.match(dashboardTabs, /window\.history\.pushState/);
  assert.doesNotMatch(dashboardTabs, /router\.push/);
  assert.doesNotMatch(dashboardTabs, /<Link/);
  assert.match(dashboardTabs, /AI digest/);
  assert.match(dashboardTabs, /ai-digest/);
  assert.match(dashboardTabs, /AI digest[\s\S]*Subscription[\s\S]*For You/);
  assert.match(dashboardTabs, /\{ id: "ai-digest", label: "AI digest" \}[\s\S]*\{ id: "subscription", label: "Subscription" \}[\s\S]*\{ id: "for-you", label: "For You" \}/);
  assert.match(dashboardPage, /scope="subscription"/);
  assert.match(dashboardPage, /scope="for-you"/);
  assert.match(dashboardPage, /Recent digest/);
  assert.match(dashboardPage, /Digest archive/);
  assert.match(dashboardPage, /ForYouRecommendationSection/);
  assert.doesNotMatch(dashboardPage, /getRecommendationTimeline/);
  assert.match(digestDetails, /mode === "today"/);
  assert.match(recommendationsPage, /redirect\("\/dashboard\?tab=for-you"\)/);
  assert.match(globals, /\.home-layout/);
  assert.match(globals, /\.home-rail/);
});

test("dashboard defers heavy recommendation timeline work to a client island", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const forYouSection = source("src/components/ForYouRecommendationSection.tsx");
  const timelineRoute = source("src/app/api/recommendations/timeline/route.ts");
  const serializer = source("src/lib/recommendation-view-model.ts");

  assert.doesNotMatch(dashboardPage, /getRecommendationTimeline/);
  assert.doesNotMatch(dashboardPage, /RecommendationFeed/);
  assert.match(dashboardPage, /ForYouRecommendationSection/);
  assert.match(forYouSection, /"use client"/);
  assert.match(forYouSection, /scope=\$\{scope\}/);
  assert.doesNotMatch(forYouSection, /followBriefDataChanged/);
  assert.match(forYouSection, /Loading \{scopeLabel\(scope\)\} recommendations/);
  assert.match(forYouSection, /aria-live="polite"/);
  assert.match(timelineRoute, /export async function GET/);
  assert.match(timelineRoute, /getRecommendationTimeline/);
  assert.match(timelineRoute, /serializeRecommendationTimeline/);
  assert.match(timelineRoute, /NextResponse\.json/);
  assert.match(serializer, /serializeRecommendationTimeline/);
  assert.match(serializer, /serializeRecommendationSnapshot/);
});

test("skill context caps personal fetched items to keep payloads bounded", () => {
  const contextRoute = source("src/app/api/skill/context/route.ts");

  assert.match(contextRoute, /personalFetchedItemLimit/);
  assert.match(contextRoute, /take:\s*personalFetchedItemLimit/);
  assert.match(contextRoute, /personalFetchedItems/);
  assert.match(contextRoute, /includePrompts/);
});

test("dashboard subscription feed owns the paginated digest archive", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const historyPage = source("src/app/history/page.tsx");
  const digestDetails = source("src/components/DigestDetails.tsx");
  const digestRoute = source("src/app/api/digests/[digestId]/route.ts");

  assert.match(dashboardPage, /archivePageSize/);
  assert.match(dashboardPage, /take:\s*archivePageSize/);
  assert.match(dashboardPage, /digestSummarySelect/);
  assert.match(dashboardPage, /id:\s*true/);
  assert.match(dashboardPage, /select:\s*digestSummarySelect/);
  assert.doesNotMatch(dashboardPage, /digest\.content/);
  assert.match(dashboardPage, /DigestDetails/);
  assert.match(dashboardPage, /id="digest-archive"/);
  assert.match(dashboardPage, /Digest archive/);
  assert.match(historyPage, /redirect\(`\/dashboard\?tab=ai-digest&archivePage=\$\{page\}#digest-archive`\)/);
  assert.doesNotMatch(historyPage, /AppShell/);
  assert.match(digestDetails, /"use client"/);
  assert.match(digestDetails, /fetch\(`\/api\/digests\/\$\{digestId\}`/);
  assert.match(digestDetails, /Loading digest/);
  assert.match(digestDetails, /aria-live="polite"/);
  assert.match(digestRoute, /export async function GET/);
  assert.match(digestRoute, /content: true/);
  assert.match(digestRoute, /userId: session\.user\.id/);
  assert.match(digestRoute, /NextResponse\.json/);
});

test("search page uses a client form with pending feedback", () => {
  const searchPage = source("src/app/(workspace)/search/page.tsx");
  const searchForm = source("src/components/SearchForm.tsx");
  const globals = source("src/app/globals.css");

  assert.match(searchPage, /@\/components\/SearchForm/);
  assert.match(searchPage, /searchPageSize/);
  assert.match(searchPage, /relatedSearchSuggestions/);
  assert.match(searchPage, /didYouMeanSearch/);
  assert.match(searchPage, /shouldUseCorrectedSearch/);
  assert.match(searchPage, /<Suspense/);
  assert.match(searchPage, /SearchResultsFallback/);
  assert.match(searchPage, /SearchResultsSection/);
  assert.match(globals, /\.search-result-skeleton/);
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
  assert.match(searchForm, /variant\?: "page" \| "header"/);
  assert.match(searchForm, /header-search-suggestion/);
  assert.match(searchForm, /\/api\/search\/suggest/);
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
  assert.match(searchForm, /autoComplete="off"/);
  assert.match(searchForm, /autoCorrect="off"/);
  assert.match(searchForm, /spellCheck=\{false\}/);
  assert.match(searchForm, /role="listbox"/);
  assert.match(searchForm, /role="option"/);
  assert.match(searchForm, /submitSuggestion\(activeSuggestion, event\.currentTarget\.form\)/);
  assert.match(searchForm, /className="search-suggestion-chip"[\s\S]*submitSuggestion\(suggestion, inputRef\.current\?\.form \?\? null\)[\s\S]*type="button"/);
  assert.doesNotMatch(searchForm, /name="suggestion"/);
  assert.doesNotMatch(searchForm, /Lucky/);
  assert.doesNotMatch(searchForm, /lucky/);
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

test("primary tabs use local loading fallbacks instead of full-route loaders", () => {
  assert.equal(existsSync(join(root, "src/app/history/loading.tsx")), true);
  for (const path of [
    "src/app/(workspace)/builders/loading.tsx",
    "src/app/(workspace)/library-hub/loading.tsx",
    "src/app/(workspace)/search/loading.tsx",
  ]) {
    assert.equal(existsSync(join(root, path)), false, path);
  }
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  const libraryHubPage = source("src/app/(workspace)/library-hub/page.tsx");
  const searchPage = source("src/app/(workspace)/search/page.tsx");
  assert.match(buildersPage, /<Suspense fallback=\{<BuilderStatsFallback \/>/);
  assert.match(buildersPage, /<Suspense fallback=\{<BuilderSectionsFallback \/>/);
  assert.match(buildersPage, /function BuilderSectionsFallback/);
  assert.match(libraryHubPage, /<Suspense fallback=\{<LibraryHubImportFallback \/>/);
  assert.match(libraryHubPage, /function LibraryHubImportFallback/);
  assert.match(searchPage, /<Suspense[\s\S]*fallback=\{[\s\S]*<SearchResultsFallback/);
});

test("builders page avoids a global fetched-content query", () => {
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  const builderLibraryList = source("src/components/BuilderLibraryList.tsx");

  assert.doesNotMatch(buildersPage, /RecentFetchedContent/);
  assert.doesNotMatch(buildersPage, /prisma\.feedItem\.findMany/);
  assert.match(builderLibraryList, /BuilderFeedItems/);
});

test("builders page exposes per-builder fetched posts ordered by time", () => {
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  const addBuilderForm = source("src/components/AddBuilderForm.tsx");
  const builderLibraryList = source("src/components/BuilderLibraryList.tsx");
  const builderFeedItems = source("src/components/BuilderFeedItems.tsx");
  const personalBuilderRoute = source("src/app/api/builders/personal/route.ts");
  const feedItemsRoute = source("src/app/api/builders/[builderId]/feed-items/route.ts");

  assert.doesNotMatch(buildersPage, /feedItems:\s*{/);
  assert.match(buildersPage, /title=\{data\.isAdmin \? adminCommunityLibraryName : "Private library"\}[\s\S]*defaultOpen/);
  assert.match(builderLibraryList, /Latest \{formatCompactDate\(latestPostCreatedAt\)\}/);
  assert.match(buildersPage, /publishedAt:\s*{\s*not:\s*null\s*}/);
  assert.match(buildersPage, /Imported libraries/);
  assert.match(buildersPage, /importedLibrarySections/);
  assert.match(buildersPage, /library-section-panel-indented/);
  assert.doesNotMatch(buildersPage, /Central defaults|Central library/);
  assert.match(buildersPage, /BuilderLibraryList/);
  assert.match(builderLibraryList, /BuilderFeedItems/);
  assert.match(buildersPage, /AddBuilderForm/);
  assert.doesNotMatch(buildersPage, /addPersonalBuilderAction/);
  assert.match(addBuilderForm, /"use client"/);
  assert.match(addBuilderForm, /fetch\("\/api\/builders\/personal"/);
  assert.match(addBuilderForm, /builderLibraryBuilderAdded/);
  assert.match(addBuilderForm, /name="sourceType"/);
  assert.match(addBuilderForm, /name="sourceValue"/);
  assert.match(addBuilderForm, /Handle or URL/);
  assert.match(personalBuilderRoute, /export async function POST/);
  assert.match(personalBuilderRoute, /resolvePersonalBuilderInput/);
  assert.match(personalBuilderRoute, /NextResponse\.json/);
  assert.doesNotMatch(personalBuilderRoute, /redirect\(/);
  assert.match(builderLibraryList, /SourceBadge/);
  assert.doesNotMatch(buildersPage, /Technical details/);
  assert.doesNotMatch(buildersPage, /name="handle"/);
  assert.doesNotMatch(buildersPage, /name="sourceUrl"/);
  assert.doesNotMatch(buildersPage, /name="fetchUrl"/);
  assert.match(builderFeedItems, /"use client"/);
  assert.match(builderFeedItems, /fetch\(`\/api\/builders\/\$\{builderId\}\/feed-items`/);
  assert.match(builderFeedItems, /Fetched posts/);
  assert.match(builderFeedItems, /FetchedPostCard/);
  assert.match(builderFeedItems, /Fetched/);
  assert.match(source("src/components/FetchedPostCard.tsx"), /Summary/);
  assert.match(source("src/components/FetchedPostCard.tsx"), /See more/);
  assert.match(source("src/components/FetchedPostCard.tsx"), /Raw fetched content/);
  assert.match(source("src/components/FetchedPostCard.tsx"), /Open source/);
  assert.match(source("src/components/FetchedPostCard.tsx"), /\/builders#\$\{builder\.id\}/);
  assert.match(feedItemsRoute, /fetchDedupedFeedForEntities/);
  assert.match(feedItemsRoute, /activePoolBuilderIds/);
  assert.match(feedItemsRoute, /NextResponse\.json/);
});

test("library hub exposes share and multi-import flows", () => {
  const appShell = source("src/components/AppShell.tsx");
  const workspaceLayout = source("src/app/(workspace)/layout.tsx");
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  const builderActions = source("src/components/BuilderLibraryActions.tsx");
  const visibilityToggle = source("src/components/LibraryVisibilityToggle.tsx");
  const builderLibraryList = source("src/components/BuilderLibraryList.tsx");
  const builderLibraryStats = source("src/components/BuilderLibraryStats.tsx");
  const builderLibraryAutoRefresh = source("src/components/BuilderLibraryAutoRefresh.tsx");
  const builderLibraryEvents = source("src/lib/builder-library-events.ts");
  const builderLibraryState = source("src/lib/builder-library-state.ts");
  const builderLibraryStateRoute = source("src/app/api/builders/library-state/route.ts");
  const libraryImportRemoveButton = source("src/components/LibraryImportRemoveButton.tsx");
  const builderPool = source("src/lib/builder-pool.ts");
  const visibilityRoute = source("src/app/api/library-hub/personal-availability/route.ts");
  const builderSubscriptionRoute = source("src/app/api/builders/[builderId]/subscription/route.ts");
  const builderLibraryRoute = source("src/app/api/builders/[builderId]/library/route.ts");
  const builderSubscribeAllRoute = source("src/app/api/builders/subscriptions/route.ts");
  const hubImportForm = source("src/components/LibraryHubImportForm.tsx");
  const hubImportRoute = source("src/app/api/library-hub/imports/route.ts");
  const hubPage = source("src/app/(workspace)/library-hub/page.tsx");
  const skillRoute = source("src/app/api/skill/builders/route.ts");
  const schema = source("prisma/schema.prisma");

  assert.match(appShell, /library-hub/);
  assert.doesNotMatch(appShell, /UserDataAutoRefresh/);
  assert.doesNotMatch(workspaceLayout, /builderLibraryState/);
  assert.doesNotMatch(appShell, /\{ href: "\/admin"/);
  assert.match(appShell, /UserMenu/);
  assert.match(buildersPage, /LibraryVisibilityToggle/);
  assert.match(buildersPage, /adminCommunityLibraryName/);
  assert.match(buildersPage, /ensureAdminCommunityLibrary/);
  assert.doesNotMatch(buildersPage, /adminCommunityBuilders/);
  assert.doesNotMatch(buildersPage, /ownSharedLibrary\?\.items\.map/);
  assert.match(buildersPage, /ownSharedLibrary\._count\.items !== privateBuilders\.length/);
  assert.match(buildersPage, /fetchLabel: "Agent synced"/);
  assert.match(buildersPage, /BuilderLibraryList/);
  assert.match(buildersPage, /BuilderLibraryStats/);
  assert.match(buildersPage, /BuilderLibraryAutoRefresh/);
  assert.match(buildersPage, /builderLibraryState/);
  assert.match(builderLibraryList, /BuilderLibraryActions/);
  assert.doesNotMatch(buildersPage, /togglePersonalLibraryHubAvailabilityAction/);
  assert.doesNotMatch(buildersPage, /subscribeAllLibraryBuildersAction/);
  assert.doesNotMatch(buildersPage, /unsubscribeBuilderAction/);
  assert.doesNotMatch(buildersPage, /removeBuilderFromLibraryAction/);
  assert.match(visibilityToggle, /"use client"/);
  assert.match(visibilityToggle, /fetch\("\/api\/library-hub\/personal-availability"/);
  assert.match(visibilityToggle, /library-visibility-toggle/);
  assert.match(visibilityToggle, /aria-pressed/);
  assert.match(visibilityRoute, /export async function PATCH/);
  assert.match(visibilityRoute, /unsharePersonalLibraryFromHub/);
  assert.match(visibilityRoute, /adminCommunityLibraryName/);
  assert.doesNotMatch(visibilityRoute, /redirect\(/);
  assert.match(builderActions, /"use client"/);
  assert.match(builderActions, /allowRemove = true/);
  assert.match(builderActions, /allowRemove \? \(/);
  assert.match(builderActions, /fetch\(`\/api\/builders\/\$\{builderId\}\/subscription`/);
  assert.match(builderActions, /fetch\(`\/api\/builders\/\$\{builderId\}\/library`/);
  assert.match(builderActions, /onRemoveStateChange\?\.\(builderId, true\)/);
  assert.match(builderActions, /onRemoveStateChange\?\.\(builderId, false\)/);
  assert.match(builderActions, /onSubscriptionStateChange\?\.\(builderId, nextSubscribed, previousSubscribed\)/);
  assert.match(builderActions, /fetch\("\/api\/builders\/subscriptions"/);
  assert.match(builderLibraryList, /"use client"/);
  assert.match(builderLibraryList, /removedBuilderIds/);
  assert.match(builderLibraryList, /subscribedByBuilderId/);
  assert.match(builderLibraryList, /setRemovedBuilderIds/);
  assert.match(builderLibraryList, /dispatchEvent/);
  assert.match(builderLibraryList, /builderLibraryBuilderAdded/);
  assert.match(builderLibraryList, /allBuilders\s*\.\s*filter/);
  assert.match(builderLibraryList, /onRemoveStateChange/);
  assert.match(builderLibraryList, /onSubscriptionStateChange/);
  assert.match(builderLibraryList, /BuilderFeedItems/);
  assert.match(builderLibraryStats, /"use client"/);
  assert.match(builderLibraryStats, /builderLibraryStatsChanged/);
  assert.match(builderLibraryStats, /addEventListener/);
  assert.match(builderLibraryStats, /SubscribeAllLibraryBuildersButton/);
  assert.match(builderLibraryAutoRefresh, /fetch\("\/api\/builders\/library-state"/);
  assert.match(builderLibraryAutoRefresh, /visibleCheckIntervalMs = 30_000/);
  assert.match(builderLibraryAutoRefresh, /visibilitychange/);
  assert.match(builderLibraryAutoRefresh, /document\.visibilityState !== "visible"/);
  assert.doesNotMatch(builderLibraryAutoRefresh, /EventSource/);
  assert.match(builderLibraryState, /builder\.aggregate/);
  assert.match(builderLibraryState, /feedItem\.aggregate/);
  assert.doesNotMatch(builderLibraryState, /digest\.aggregate/);
  assert.doesNotMatch(builderLibraryState, /recommendationSnapshot\.aggregate/);
  assert.doesNotMatch(builderLibraryState, /feedRead\.aggregate/);
  assert.match(builderLibraryStateRoute, /NextResponse\.json/);
  assert.match(builderLibraryStateRoute, /Cache-Control": "no-store"/);
  assert.match(builderLibraryStateRoute, /activePoolBuilderIds/);
  assert.equal(existsSync(join(root, "src/app/api/builders/library-stream/route.ts")), false);
  assert.match(builderLibraryEvents, /builderLibraryStatsChanged/);
  assert.doesNotMatch(builderLibraryEvents, /followBriefDataChanged/);
  assert.match(builderLibraryEvents, /builderLibrarySubscribeAll/);
  assert.match(buildersPage, /allowRemove:\s*false/);
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
  assert.match(hubPage, /ensureDefaultCommunityLibraryImport\(session\.user\.id\)/);
  assert.match(hubPage, /LibraryHubImportForm/);
  assert.match(hubPage, /adminCommunityLibraryName/);
  assert.match(hubPage, /library\.isFeatured/);
  assert.match(hubPage, /recordLibraryHubViews\(libraries\.map/);
  assert.match(hubImportForm, /"use client"/);
  assert.match(hubImportForm, /fetch\("\/api\/library-hub\/imports"/);
  assert.match(hubImportForm, /isCommunity/);
  assert.match(hubImportForm, /counts\[filter\.key\]/);
  assert.match(hubImportForm, /function importLibrary\(libraryId: string\)/);
  assert.match(hubImportForm, /JSON\.stringify\(\{ libraryIds: \[libraryId\] \}\)/);
  assert.match(hubImportForm, /aria-label=\{`Import \$\{library\.name\}`\}/);
  assert.match(hubImportForm, /: "Import"/);
  assert.match(hubImportForm, /Importing/);
  assert.match(hubImportForm, /Imported/);
  assert.match(hubImportForm, /method: "DELETE"/);
  assert.match(hubImportForm, /Remove/);
  assert.doesNotMatch(hubImportForm, /Import selected/);
  assert.doesNotMatch(hubImportForm, /selectedIds/);
  assert.doesNotMatch(hubImportForm, /aria-pressed/);
  assert.doesNotMatch(hubImportForm, /hub-select-button/);
  assert.doesNotMatch(hubImportForm, /Deselect/);
  assert.doesNotMatch(hubImportForm, /hub-checkbox/);
  assert.doesNotMatch(hubImportForm, /library\.kind === "CENTRAL"/);
  assert.match(hubImportRoute, /export async function POST/);
  assert.match(hubImportRoute, /export async function DELETE/);
  assert.match(hubImportRoute, /importLibrariesFromHub/);
  assert.match(hubImportRoute, /removeLibraryImportFromHub/);
  assert.doesNotMatch(hubImportRoute, /redirect\(/);
  assert.match(libraryImportRemoveButton, /router\.refresh/);
  assert.match(libraryImportRemoveButton, /event\.stopPropagation/);
  assert.match(buildersPage, /LibraryImportRemoveButton/);
  assert.match(hubPage, /importCount/);
  assert.match(hubPage, /viewCount/);
  assert.match(hubPage, /orderBy:\s*\[\{ importCount: "desc" \}, \{ viewCount: "desc" \}/);
  assert.match(hubImportForm, /libraryId/);
  assert.match(visibilityRoute, /unsharePersonalLibraryFromHub/);
  assert.equal(existsSync(join(root, "src/app/actions.ts")), false);
  assert.match(skillRoute, /syncPersonalLibraryHubForUser/);
  assert.match(skillRoute, /fetchTool: "Legacy fetch\/import"/);
  assert.match(schema, /model LibraryHubEntry/);
  assert.match(schema, /model LibraryImport/);
  assert.match(schema, /UserLibraryVisibility/);
  assert.match(builderPool, /ensureDefaultCommunityLibraryImport/);
  assert.match(builderPool, /isAdminEmail\(user\.email\)/);
  assert.match(builderPool, /userLibraryVisibility/);
  assert.match(builderPool, /BuilderPoolOrigin\.HUB_IMPORT/);
  assert.match(builderPool, /prisma\.libraryImport/);
});

test("settings mutations stay local instead of refreshing the whole route", () => {
  const settingsPage = source("src/app/(workspace)/settings/page.tsx");
  const feedPreferenceForm = source("src/components/FeedPreferenceForm.tsx");
  const tokenPanel = source("src/components/AgentTokenPanel.tsx");
  const feedPreferenceRoute = source("src/app/api/settings/feed-preferences/route.ts");
  const tokensRoute = source("src/app/api/settings/tokens/route.ts");
  const tokenRoute = source("src/app/api/settings/tokens/[tokenId]/route.ts");

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
  assert.match(tokenPanel, /"New agent token"/);
  assert.match(tokenPanel, /fb-dialog/);
  assert.match(feedPreferenceRoute, /export async function PATCH/);
  assert.match(feedPreferenceRoute, /userFeedPreference\.upsert/);
  assert.match(feedPreferenceRoute, /NextResponse\.json/);
  assert.doesNotMatch(feedPreferenceRoute, /redirect\(/);
  assert.match(tokensRoute, /export async function POST/);
  assert.match(tokensRoute, /createAgentToken/);
  assert.doesNotMatch(tokensRoute, /redirect\(/);
  assert.match(tokenRoute, /export async function DELETE/);
  assert.match(tokenRoute, /agentToken\.deleteMany/);
  assert.doesNotMatch(tokenRoute, /redirect\(/);
});

test("list actions use compact controls instead of full-width mobile buttons", () => {
  const css = source("src/app/globals.css");
  const builderActions = source("src/components/BuilderLibraryActions.tsx");
  const settingsPage = source("src/app/(workspace)/settings/page.tsx");
  const agentTokenPanel = source("src/components/AgentTokenPanel.tsx");

  assert.match(css, /\.button-compact/);
  assert.match(css, /\.row-actions/);
  assert.doesNotMatch(css, /\.builder-row form,\s*\n\s*\.builder-row button\s*{\s*\n\s*width:\s*100%/);
  assert.match(source("src/components/BuilderLibraryList.tsx"), /row-actions/);
  assert.match(builderActions, /fb-btn/);
  assert.match(settingsPage, /AgentTokenPanel/);
  assert.match(agentTokenPanel, /fb-btn/);
});
