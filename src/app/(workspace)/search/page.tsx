import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  RotateCcw,
  X,
} from "lucide-react";
import { CountBadge, CountRange, formatCount } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PostCard } from "@/components/PostCard";
import { PostFavoriteControl } from "@/components/PostFavoriteControl";
import { SearchForm, type SearchTypeFilter } from "@/components/SearchForm";
import { SourceAvatar } from "@/components/SourceAvatar";
import { SourceBadge } from "@/components/SourceBadge";
import { getCurrentSession } from "@/lib/auth";
import { withPostReturnTarget } from "@/lib/navigation";
import { searchUserLibrary } from "@/lib/user-search";
import {
  didYouMeanSearch,
  normalizeSearchMode,
  normalizeSearchSort,
  normalizeSearchTime,
  parseSearchQuery,
  relatedSearchSuggestions,
  searchDocumentTypeParamValue,
  searchHighlightTerms,
  searchSiteFromUrl,
  shouldUseCorrectedSearch,
  stripNegativeSearchQueryOperators,
  stripSearchQueryOperators,
  type SearchDocumentType,
  type SearchMode,
  type SearchSort,
  type SearchTimeRange,
  type SearchResult,
  withDateSearchOperators,
  withSiteSearchOperator,
} from "@/lib/search";

type SearchParams = Promise<{
  q?: string | string[];
  type?: string | string[];
  mode?: string | string[];
  page?: string | string[];
  sort?: string | string[];
  time?: string | string[];
}>;

const searchPageSize = 10;
const searchResultsPanelId = "search-results-panel";
const defaultSuggestions = [
  "model pricing",
  "open source models",
  "founder essays",
  "product launch",
  "agent memory",
  "podcast transcript",
  "research notes",
  "tool benchmarks",
];

const advancedSearchExamples = [
  '"model pricing"',
  '"model * pricing"',
  "model pricing -enterprise",
  "model pricing +open",
  'model -"pricing page"',
  "models OR benchmarks",
  '"model pricing" OR "launch notes"',
  '("model pricing" OR "launch notes") open',
  "model AROUND(3) pricing",
  "model pricing site:example.com",
  "model pricing site:example.com/articles",
  "model pricing -site:example.com",
  "model pricing intitle:launch",
  "model pricing -intitle:enterprise",
  "allintitle:model pricing",
  "model pricing -allintitle:enterprise launch",
  "model pricing intext:transcript",
  "allintext:model pricing",
  "model pricing inurl:release",
  "allinurl:release model",
  "model pricing type:post",
  "model pricing type:source",
  "model pricing type:ai-digest-archive",
  "model pricing -type:ai-digest-archive",
  "model pricing after:2026-01-01",
  "model pricing before:2026-12-31",
];

const resultTypeFilterLabels: Record<SearchDocumentType, string> = {
  builder: "Sources",
  feed: "Posts",
  digest: "AI Digest archives",
};

const resultTypeItemLabels: Record<SearchDocumentType, string> = {
  builder: "Source",
  feed: "Post",
  digest: "AI Digest archive",
};

const searchModeLabels: Record<SearchMode, string> = {
  exact: "Exact words",
  hybrid: "Best match",
  semantic: "Meaning",
};

const searchSortLabels: Record<SearchSort, string> = {
  newest: "Newest",
  relevance: "Relevance",
};

const searchTimeLabels: Record<SearchTimeRange, string> = {
  any: "Any time",
  day: "Past day",
  week: "Past week",
  month: "Past month",
  year: "Past year",
};

type ActiveSearchFilter = {
  clearLabel: string;
  href: string;
  label: string;
  value: string;
};

type SearchRecoveryAction = {
  href: string;
  label: string;
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;
  const query = firstParam(params.q);
  const typeFilter = normalizeTypeFilter(firstParam(params.type));
  const mode = normalizeSearchMode(firstParam(params.mode));
  const sort = normalizeSearchSort(firstParam(params.sort));
  const time = normalizeSearchTime(firstParam(params.time));
  const page = normalizePage(firstParam(params.page));
  const hasQuery = query.trim().length > 0;
  const formParsedQuery = parseSearchQuery(query);
  const correctedQuery = hasQuery ? didYouMeanSearch(query) : null;
  const relatedSearches = hasQuery ? relatedSearchSuggestions(query) : defaultSuggestions;
  const formSuggestions = [
    ...(correctedQuery ? [correctedQuery] : []),
    ...relatedSearches,
  ];

  return (
    <div className="page-pad page-pad--reading search-page">
      <PageHeader
        title="Search"
        description="Find sources, posts, and AI Digest archives in one place."
      />

      <div className="workspace-content-stack search-results-workspace">
        <section className="search-hero-form" aria-label="Search controls">
          <SearchForm
            key={`${query}:${typeFilter}:${mode}:${sort}:${time}`}
            query={query}
            typeFilter={typeFilter}
            mode={mode}
            sort={sort}
            time={time}
            afterDate={formatOptionalOperatorDate(formParsedQuery.after)}
            beforeDate={formatOptionalOperatorDate(formParsedQuery.before)}
            suggestions={formSuggestions}
          />
        </section>
        <Suspense
          fallback={
            <SearchResultsFallback
              current={typeFilter}
              hasQuery={hasQuery}
              mode={mode}
              query={query}
              sort={sort}
              time={time}
            />
          }
          key={`${query}:${typeFilter}:${mode}:${sort}:${time}:${page}`}
        >
          <SearchResultsSection
            correctedQuery={correctedQuery}
            hasQuery={hasQuery}
            mode={mode}
            page={page}
            query={query}
            relatedSearches={relatedSearches}
            sort={sort}
            time={time}
            typeFilter={typeFilter}
            userId={session.user.id}
          />
        </Suspense>
      </div>
    </div>
  );
}

async function SearchResultsSection({
  correctedQuery,
  hasQuery,
  mode,
  page,
  query,
  relatedSearches,
  sort,
  time,
  typeFilter,
  userId,
}: {
  correctedQuery: string | null;
  hasQuery: boolean;
  mode: SearchMode;
  page: number;
  query: string;
  relatedSearches: string[];
  sort: SearchSort;
  time: SearchTimeRange;
  typeFilter: SearchTypeFilter;
  userId: string;
}) {
  const originalSearch = hasQuery
    ? await searchUserLibrary({
        userId,
        query,
        mode,
        sort,
        time,
      })
    : { candidateCount: 0, results: [] as SearchResult[] };
  const originalFilteredResults =
    typeFilter === "all"
      ? originalSearch.results
      : originalSearch.results.filter((result) => result.type === typeFilter);
  const correctionSearch =
    shouldUseCorrectedSearch({
      correctedQuery,
      originalResultCount: originalFilteredResults.length,
    }) && correctedQuery
      ? await searchUserLibrary({
          userId,
          query: correctedQuery,
          mode,
          sort,
          time,
        })
      : null;
  const isShowingCorrectedResults = Boolean(correctionSearch);
  const activeQuery = correctionSearch && correctedQuery ? correctedQuery : query;
  const results = correctionSearch?.results ?? originalSearch.results;
  const typeCounts = countResultTypes(results);
  const filteredResults =
    typeFilter === "all" ? results : results.filter((result) => result.type === typeFilter);
  const pageCount = Math.max(1, Math.ceil(filteredResults.length / searchPageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleResults = filteredResults.slice(
    (currentPage - 1) * searchPageSize,
    currentPage * searchPageSize,
  );
  const activeFilters = hasQuery
    ? buildActiveSearchFilters({ mode, query: activeQuery, sort, time, typeFilter })
    : [];
  const recoveryActions = hasQuery
    ? buildSearchRecoveryActions({
        activeFilterCount: activeFilters.length,
        mode,
        query: activeQuery,
        sort,
        time,
        typeFilter,
      })
    : [];

  return (
    <section
      aria-labelledby={searchTypeTabId(typeFilter)}
      className="search-results-shell"
      id={searchResultsPanelId}
      role="tabpanel"
    >
      <SearchTypeTabs
        counts={hasQuery ? typeCounts : null}
        current={typeFilter}
        mode={mode}
        query={activeQuery}
        sort={sort}
        time={time}
      />
      {hasQuery ? (
        <>
          <div className="search-meta-row">
            <CountRange>
              {formatCount(filteredResults.length)}{" "}
              {searchResultCountLabel(typeFilter, filteredResults.length)} for{" "}
              <span>{activeQuery}</span>
            </CountRange>
            {pageCount > 1 ? (
              <CountRange>
                Page {formatCount(currentPage)} of {formatCount(pageCount)}
              </CountRange>
            ) : null}
          </div>
          {isShowingCorrectedResults && correctedQuery ? (
            <div className="search-did-you-mean">
              Showing results for <span>{correctedQuery}</span>.{" "}
              <Link href={searchHref({ query, type: typeFilter, mode, sort, time })}>
                Search instead for {query}
              </Link>
              .
            </div>
          ) : correctedQuery ? (
            <div className="search-did-you-mean">
              Did you mean{" "}
              <Link href={searchHref({ query: correctedQuery, type: typeFilter, mode, sort, time })}>
                {correctedQuery}
              </Link>
              ?
            </div>
          ) : null}
          {activeFilters.length > 0 ? (
            <ActiveSearchFilters filters={activeFilters} clearAllHref={clearAllSearchHref(activeQuery)} />
          ) : null}
          <details className="search-advanced-tools search-advanced-tools-compact">
            <summary>
              Search details
              <ChevronDown aria-hidden="true" className="search-advanced-tools-icon" />
            </summary>
            <SearchQueryInsights
              actions={recoveryActions}
              mode={mode}
              query={activeQuery}
              resultCount={filteredResults.length}
              sort={sort}
              time={time}
              typeFilter={typeFilter}
            />
          </details>
          {visibleResults.length > 0 ? (
            <div className="search-results-list">
              {visibleResults.map((result) => (
                <ResultCard
                  currentPage={currentPage}
                  key={`${result.type}:${result.id}`}
                  mode={mode}
                  query={activeQuery}
                  result={result}
                  sort={sort}
                  time={time}
                  typeFilter={typeFilter}
                />
              ))}
            </div>
          ) : null}
          {pageCount > 1 ? (
            <nav className="search-pagination" aria-label="Search result pages">
              <PageLink
                disabled={currentPage === 1}
                href={searchHref({
                  query: activeQuery,
                  type: typeFilter,
                  mode,
                  sort,
                  time,
                  page: currentPage - 1,
                })}
                label="Previous"
                icon="previous"
              />
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                <Link
                  aria-current={pageNumber === currentPage ? "page" : undefined}
                  className="search-page-link"
                  data-active={pageNumber === currentPage ? "true" : undefined}
                  href={searchHref({
                    query: activeQuery,
                    type: typeFilter,
                    mode,
                    sort,
                    time,
                    page: pageNumber,
                  })}
                  key={pageNumber}
                >
                  {pageNumber}
                </Link>
              ))}
              <PageLink
                disabled={currentPage === pageCount}
                href={searchHref({
                  query: activeQuery,
                  type: typeFilter,
                  mode,
                  sort,
                  time,
                  page: currentPage + 1,
                })}
                label="Next"
                icon="next"
              />
            </nav>
          ) : null}
          {filteredResults.length === 0 ? (
            <SearchEmptyState actions={recoveryActions} title="No matches found">
              {searchNoMatchesCopy({ activeFilterCount: activeFilters.length, time, typeFilter })}
            </SearchEmptyState>
          ) : null}
          {relatedSearches.length > 0 ? (
            <RelatedSearches
              mode={mode}
              query={activeQuery}
              searches={relatedSearches}
              sort={sort}
              time={time}
              typeFilter={typeFilter}
            />
          ) : null}
        </>
      ) : (
        <>
          <RelatedSearches
            heading="Suggested searches"
            mode={mode}
            query={query}
            searches={defaultSuggestions}
            sort={sort}
            time={time}
            typeFilter={typeFilter}
          />
          <details className="search-advanced-tools search-advanced-tools-compact">
            <summary>
              Search operators
              <ChevronDown aria-hidden="true" className="search-advanced-tools-icon" />
            </summary>
            <AdvancedSearchTips mode={mode} sort={sort} time={time} />
          </details>
        </>
      )}
    </section>
  );
}

function SearchResultsFallback({
  current,
  hasQuery,
  mode,
  query,
  sort,
  time,
}: {
  current: SearchTypeFilter;
  hasQuery: boolean;
  mode: SearchMode;
  query: string;
  sort: SearchSort;
  time: SearchTimeRange;
}) {
  return (
    <section
      aria-busy="true"
      aria-labelledby={searchTypeTabId(current)}
      aria-live="polite"
      className="search-results-shell"
      id={searchResultsPanelId}
      role="tabpanel"
    >
      <SearchTypeTabs
        counts={null}
        current={current}
        mode={mode}
        query={query}
        sort={sort}
        time={time}
      />
      {hasQuery ? (
        <>
          <div className="search-meta-row" role="status">
            <span className="sr-only">Loading search results</span>
            <span aria-hidden="true" className="search-meta-skeleton search-meta-skeleton--count" />
            <span aria-hidden="true" className="search-meta-skeleton search-meta-skeleton--page" />
          </div>
          <div className="search-results-list">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="search-result-skeleton" key={index} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function SearchQueryInsights({
  actions,
  mode,
  query,
  resultCount,
  sort,
  time,
  typeFilter,
}: {
  actions: SearchRecoveryAction[];
  mode: SearchMode;
  query: string;
  resultCount: number;
  sort: SearchSort;
  time: SearchTimeRange;
  typeFilter: SearchTypeFilter;
}) {
  const items = buildQueryInsightItems(query, { mode, sort, time, typeFilter });

  return (
    <section className="search-insights" aria-label="Search interpretation">
      <p className="search-insight-summary">
        Query matched {resultCount} {searchResultCountLabel(typeFilter, resultCount)}.
      </p>
      <dl className="search-insight-grid">
        {items.map((item) => (
          <div className="search-insight-item" key={`${item.label}:${item.value}`}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {actions.length > 0 ? (
        <div
          aria-label="Search recovery actions"
          className="search-insight-actions"
          role="group"
        >
          {actions.map((action) => (
            <Link className="search-recovery-action" href={action.href} key={action.label}>
              <RotateCcw aria-hidden="true" className="search-recovery-action-icon" />
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ActiveSearchFilters({
  clearAllHref,
  filters,
}: {
  clearAllHref: string;
  filters: ActiveSearchFilter[];
}) {
  return (
    <section className="search-active-filters" aria-label="Active search filters">
      <div className="search-active-filters-heading">Active filters</div>
      <div className="search-filter-chip-row">
        {filters.map((filter) => (
          <Link
            aria-label={filter.clearLabel}
            className="search-filter-chip"
            href={filter.href}
            key={`${filter.label}:${filter.value}`}
          >
            <span className="search-filter-label">{filter.label}</span>
            <span>{filter.value}</span>
            <X aria-hidden="true" />
          </Link>
        ))}
        <Link
          className="search-filter-clear"
          href={clearAllHref}
        >
          Clear all
        </Link>
      </div>
    </section>
  );
}

function SearchTypeTabs({
  counts,
  current,
  mode,
  query,
  sort,
  time,
}: {
  counts: ReturnType<typeof countResultTypes> | null;
  current: SearchTypeFilter;
  mode: SearchMode;
  query: string;
  sort: SearchSort;
  time: SearchTimeRange;
}) {
  return (
    <div className="fb-segmented-tabs filter-tabs" aria-label="Search result type filter" role="tablist">
      <TypeTab
        count={counts?.all}
        current={current}
        href={searchHref({ query, type: "all", mode, sort, time })}
        label="All"
        value="all"
      />
      {(["builder", "feed", "digest"] as const).map((type) => (
        <TypeTab
          count={counts?.[type]}
          current={current}
          href={searchHref({ query, type, mode, sort, time })}
          key={type}
          label={resultTypeFilterLabels[type]}
          value={type}
        />
      ))}
    </div>
  );
}

function TypeTab({
  count,
  current,
  href,
  label,
  value,
}: {
  count?: number;
  current: SearchTypeFilter;
  href: string;
  label: string;
  value: SearchTypeFilter;
}) {
  const isActive = current === value;
  const accessibleLabel =
    typeof count === "number"
      ? `${label}, ${formatCount(count)} ${searchResultCountLabel(value, count)}`
      : label;
  return (
    <Link
      aria-controls={searchResultsPanelId}
      aria-label={accessibleLabel}
      aria-selected={isActive}
      className="fb-btn compact"
      data-active={isActive ? "true" : undefined}
      href={href}
      id={searchTypeTabId(value)}
      role="tab"
      tabIndex={isActive ? 0 : -1}
    >
      <span>{label}</span>
      {typeof count === "number" ? <CountBadge value={count} /> : null}
    </Link>
  );
}

function searchTypeTabId(value: SearchTypeFilter) {
  return `search-type-tab-${value}`;
}

function searchResultCountLabel(typeFilter: SearchTypeFilter, count: number) {
  if (typeFilter === "builder") return count === 1 ? "source" : "sources";
  if (typeFilter === "feed") return count === 1 ? "post" : "posts";
  if (typeFilter === "digest") {
    return count === 1 ? "AI Digest archive" : "AI Digest archives";
  }
  return count === 1 ? "result" : "results";
}

function ResultCard({
  currentPage,
  mode,
  query,
  result,
  sort,
  time,
  typeFilter,
}: {
  currentPage: number;
  mode: SearchMode;
  query: string;
  result: SearchResult;
  sort: SearchSort;
  time: SearchTimeRange;
  typeFilter: SearchTypeFilter;
}) {
  const titleIsExternal = isExternalUrl(result.url);
  const originalUrl = result.externalUrl ?? (titleIsExternal ? result.url ?? null : null);
  const resultHref = result.url
    ? withPostReturnTarget(
        result.url,
        searchHref({ query, type: typeFilter, mode, sort, time, page: currentPage }),
        "Search",
      )
    : null;
  const displayUrl = formatDisplayUrl(originalUrl ?? result.url);
  const sourceSite = searchSiteFromUrl(originalUrl ?? result.url);
  const sourceName = result.sourceName ?? resultTypeItemLabels[result.type];
  const originalActionLabel = searchOriginalActionLabel(result.type);

  if (result.type === "feed") {
    return (
      <SearchPostResultCard
        originalUrl={originalUrl}
        result={result}
        resultHref={resultHref}
        sourceName={sourceName}
      />
    );
  }

  const titleContent = <HighlightText text={result.title} query={query} />;
  const title = resultHref ? (
    titleIsExternal ? (
      <a
        className="search-result-title"
        href={resultHref}
        rel="noreferrer"
        target="_blank"
      >
        {titleContent}
      </a>
    ) : (
      <Link className="search-result-title" href={resultHref}>
        {titleContent}
      </Link>
    )
  ) : (
    <span className="search-result-title">
      {titleContent}
    </span>
  );

  return (
    <article className="search-result">
      <div className="search-result-source">
        <SearchResultSourceIcon result={result} sourceName={sourceName} />
        <div className="search-result-source-copy">
          <div className="search-result-source-name">{sourceName}</div>
          {displayUrl ? <div className="search-result-url">{displayUrl}</div> : null}
        </div>
      </div>
      <h2>{title}</h2>
      <p className="search-result-snippet">
        <HighlightText text={result.snippet} query={query} />
      </p>
      <div className="search-result-meta">
        <span>{resultTypeItemLabels[result.type]}</span>
        {result.date ? <span>{formatDistanceToNow(result.date, { addSuffix: true })}</span> : null}
        {originalUrl ? (
          <a
            aria-label={`${originalActionLabel}: ${result.title}`}
            className="post-source-original"
            href={originalUrl}
            rel="noreferrer"
            target="_blank"
            title={originalActionLabel}
          >
            <SourceBadge decorative showLabel={false} sourceType={result.sourceType ?? result.type} />
            <span>{originalActionLabel}</span>
          </a>
        ) : null}
      </div>
      {sourceSite || typeFilter !== result.type ? (
        <details className="search-result-refinements" aria-label={`Narrow search from ${result.title}`}>
          <summary>
            <span>Narrow search</span>
            <ChevronDown aria-hidden="true" className="search-result-refinement-icon" />
          </summary>
          <div className="search-result-refinement-list">
            {sourceSite ? (
              <Link
                className="search-result-refinement"
                href={searchHref({
                  query: withSiteSearchOperator(query, sourceSite),
                  type: "all",
                  mode,
                  sort,
                  time,
                })}
              >
                More from this source
              </Link>
            ) : null}
            {typeFilter !== result.type ? (
              <Link
                className="search-result-refinement"
                href={searchHref({ query, type: result.type, mode, sort, time })}
              >
                Only {resultTypeFilterLabels[result.type]}
              </Link>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function searchOriginalActionLabel(type: SearchDocumentType) {
  return type === "builder" ? "View source site" : "View original";
}

function SearchPostResultCard({
  originalUrl,
  result,
  resultHref,
  sourceName,
}: {
  originalUrl: string | null;
  result: SearchResult;
  resultHref: string | null;
  sourceName: string;
}) {
  const builder = sourceName
    ? {
        id: result.builderId ?? `search:${result.id}`,
        entityId: result.builderEntityId ?? null,
        avatarUrl: result.avatarUrl ?? null,
        name: sourceName,
        kind: result.builderKind ?? sourceKindForSearchResult(result.sourceType),
        sourceType: result.sourceType ?? "website",
        sourceUrl: result.sourceUrl ?? originalUrl,
        fetchUrl: result.fetchUrl ?? null,
      }
    : null;
  const date = result.date?.toISOString() ?? new Date(0).toISOString();

  return (
    <PostCard
      dataRead={Boolean(result.readAt)}
      extraActions={
        <PostFavoriteControl
          feedItemId={result.id}
          initialIsFavorite={Boolean(result.favoritedAt)}
        />
      }
      fallbackBuilder={builder}
      post={{
        id: result.id,
        title: result.title,
        body: result.postBody ?? result.body,
        summary: result.postSummary ?? result.snippet,
        detailUrl: resultHref,
        url: originalUrl ?? result.url ?? "#",
        publishedAt: result.date?.toISOString() ?? null,
        createdAt: date,
        sourceName,
        sourceType: result.sourceType ?? null,
        fetchTool: null,
      }}
    />
  );
}

function sourceKindForSearchResult(
  sourceType: string | null | undefined,
): "X" | "BLOG" | "PODCAST" | "WEBSITE" {
  const normalized = sourceType?.toLowerCase() ?? "";
  if (normalized === "x" || normalized === "twitter") return "X";
  if (normalized.includes("podcast") || normalized === "youtube") return "PODCAST";
  if (normalized.includes("blog") || normalized.includes("rss")) return "BLOG";
  return "WEBSITE";
}

function SearchResultSourceIcon({
  result,
  sourceName,
}: {
  result: SearchResult;
  sourceName: string;
}) {
  if (result.type === "digest") {
    return (
      <span className="search-result-icon search-result-icon-digest" aria-hidden="true">
        <FileText />
      </span>
    );
  }

  return (
    <SourceAvatar
      className="search-result-icon"
      imageSize={32}
      source={{
        avatarUrl: result.avatarUrl ?? null,
        fetchUrl: result.fetchUrl ?? null,
        name: result.type === "builder" ? result.title : sourceName,
        sourceType: result.sourceType ?? "",
        sourceUrl: result.sourceUrl ?? result.externalUrl ?? null,
      }}
    />
  );
}

function isExternalUrl(url: string | null | undefined) {
  return Boolean(url?.startsWith("http"));
}

function PageLink({
  disabled,
  href,
  icon,
  label,
}: {
  disabled: boolean;
  href: string;
  icon: "previous" | "next";
  label: string;
}) {
  const Icon = icon === "previous" ? ChevronLeft : ChevronRight;
  if (disabled) {
    return (
      <span aria-disabled="true" className="search-page-link search-page-link-disabled">
        <Icon aria-hidden="true" className="search-page-link-icon" />
        {label}
      </span>
    );
  }

  return (
    <Link className="search-page-link" href={href}>
      <Icon aria-hidden="true" className="search-page-link-icon" />
      {label}
    </Link>
  );
}

function RelatedSearches({
  heading = "Related searches",
  mode,
  query,
  searches,
  sort,
  time,
  typeFilter,
}: {
  heading?: string;
  mode: SearchMode;
  query: string;
  searches: string[];
  sort: SearchSort;
  time: SearchTimeRange;
  typeFilter: SearchTypeFilter;
}) {
  return (
    <section className="search-related" aria-label={heading}>
      <h2>{heading}</h2>
      <div className="search-related-grid">
        {searches.map((search) => (
          <Link
            className="search-related-link"
            href={searchHref({ query: search, type: typeFilter, mode, sort, time })}
            key={`${query}:${search}`}
          >
            {search}
          </Link>
        ))}
      </div>
    </section>
  );
}

function AdvancedSearchTips({
  mode,
  sort,
  time,
}: {
  mode: SearchMode;
  sort: SearchSort;
  time: SearchTimeRange;
}) {
  return (
    <section className="search-operator-tips" aria-label="Search operators">
      <h2>Search operators</h2>
      <div className="search-operator-grid">
        {advancedSearchExamples.map((search) => (
          <Link
            className="search-related-link"
            href={searchHref({ query: search, type: "all", mode, sort, time })}
            key={search}
          >
            {search}
          </Link>
        ))}
      </div>
    </section>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const decodedText = decodeHtmlEntities(text);
  const terms = searchHighlightTerms(query).filter(Boolean);
  if (terms.length === 0) return decodedText;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(${[...terms]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})(es|s)?(?=$|[^\\p{L}\\p{N}_])`,
    "giu",
  );
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(decodedText)) !== null) {
    const fullMatch = match[0] ?? "";
    const prefix = match[1] ?? "";
    const highlightedText = `${match[2] ?? ""}${match[3] ?? ""}`;
    const highlightStart = match.index + prefix.length;

    if (highlightStart > lastIndex) {
      parts.push(
        <span key={`text:${key++}`}>
          {decodedText.slice(lastIndex, highlightStart)}
        </span>,
      );
    }
    parts.push(<mark key={`mark:${key++}`}>{highlightedText}</mark>);
    lastIndex = match.index + fullMatch.length;
  }

  if (parts.length === 0) return decodedText;
  if (lastIndex < decodedText.length) {
    parts.push(<span key={`text:${key++}`}>{decodedText.slice(lastIndex)}</span>);
  }

  return (
    <>
      {parts}
    </>
  );
}

function SearchEmptyState({
  actions = [],
  children,
  title,
}: {
  actions?: SearchRecoveryAction[];
  children: React.ReactNode;
  title: string;
}) {
  const actionContent = actions.length > 0 ? (
    <div
      aria-label="Search recovery actions"
      className="search-empty-actions"
      role="group"
    >
      {actions.map((action) => (
        <Link className="search-recovery-action" href={action.href} key={action.label}>
          <RotateCcw aria-hidden="true" className="search-recovery-action-icon" />
          {action.label}
        </Link>
      ))}
    </div>
  ) : null;

  return (
    <EmptyState
      actions={actionContent}
      body={children}
      className="search-empty"
      title={title}
    />
  );
}

function searchNoMatchesCopy({
  activeFilterCount,
  time,
  typeFilter,
}: {
  activeFilterCount: number;
  time: SearchTimeRange;
  typeFilter: SearchTypeFilter;
}) {
  if (typeFilter !== "all") {
    return "Try a broader phrase, fewer words, or search all result types.";
  }
  if (time !== "any" || activeFilterCount > 0) {
    return "Try a broader phrase, fewer words, or remove active filters.";
  }
  return "Try a broader phrase or fewer words.";
}

function countResultTypes(results: SearchResult[]) {
  return results.reduce(
    (counts, result) => {
      counts.all += 1;
      counts[result.type] += 1;
      return counts;
    },
    { all: 0, builder: 0, feed: 0, digest: 0 },
  );
}

function buildSearchRecoveryActions({
  activeFilterCount,
  mode,
  query,
  sort,
  time,
  typeFilter,
}: {
  activeFilterCount: number;
  mode: SearchMode;
  query: string;
  sort: SearchSort;
  time: SearchTimeRange;
  typeFilter: SearchTypeFilter;
}) {
  const parsed = parseSearchQuery(query);
  const actions: SearchRecoveryAction[] = [];
  const queryWithoutDate = withDateSearchOperators(query, { after: null, before: null });

  if (mode !== "hybrid") {
    actions.push({
      href: searchHref({ query, type: typeFilter, mode: "hybrid", sort, time }),
      label: "Use best match",
    });
  }
  if (typeFilter !== "all") {
    actions.push({
      href: searchHref({ query, type: "all", mode, sort, time }),
      label: "Search all result types",
    });
  }
  if (time !== "any" || parsed.after || parsed.before) {
    actions.push({
      href: searchHref({ query: queryWithoutDate, type: typeFilter, mode, sort, time: "any" }),
      label: "Search any time",
    });
  }
  if (activeFilterCount > 0) {
    actions.push({
      href: clearAllSearchHref(query),
      label: "Clear filters",
    });
  }

  return actions;
}

function buildQueryInsightItems(
  query: string,
  {
    mode,
    sort,
    time,
    typeFilter,
  }: {
    mode: SearchMode;
    sort: SearchSort;
    time: SearchTimeRange;
    typeFilter: SearchTypeFilter;
  },
) {
  const parsed = parseSearchQuery(query);
  const scopedTerms = [
    ...parsed.titleTerms.map((term) => `title:${term}`),
    ...parsed.bodyTerms.map((term) => `text:${term}`),
    ...parsed.urlTerms.map((term) => `url:${term}`),
  ];
  const items = [
    { label: "Mode", value: searchModeLabels[mode] },
    { label: "Sort", value: searchSortLabels[sort] },
    { label: "Result type", value: typeFilter === "all" ? "All results" : resultTypeFilterLabels[typeFilter] },
    { label: "Time", value: dateInsightLabel(parsed, time) },
  ];
  const phraseValue = [
    ...parsed.phrases,
    ...parsed.requiredPhrases,
    ...parsed.orPhrases.map((phrase) => `OR ${phrase}`),
  ].join(", ");
  if (phraseValue) items.push({ label: "Phrases", value: phraseValue });
  if (parsed.site) items.push({ label: "Site", value: parsed.site });
  if (scopedTerms.length > 0) items.push({ label: "Fields", value: scopedTerms.join(", ") });
  if (parsed.requiredOperatorTerms.length > 0) {
    items.push({ label: "Must include", value: parsed.requiredOperatorTerms.join(", ") });
  }
  if (parsed.excludedTerms.length > 0 || parsed.excludedPhrases.length > 0) {
    items.push({
      label: "Excluding",
      value: [...parsed.excludedTerms, ...parsed.excludedPhrases].join(", "),
    });
  }

  return items.slice(0, 8);
}

function dateInsightLabel(parsed: ReturnType<typeof parseSearchQuery>, time: SearchTimeRange) {
  if (parsed.after || parsed.before) {
    return [
      parsed.after ? `after ${formatOptionalOperatorDate(parsed.after)}` : "",
      parsed.before ? `before ${formatOptionalOperatorDate(parsed.before)}` : "",
    ]
      .filter(Boolean)
      .join(", ");
  }

  return searchTimeLabels[time];
}

function normalizeTypeFilter(value: string): SearchTypeFilter {
  const normalized = value.trim().toLowerCase();
  if (normalized === "builder" || normalized === "source" || normalized === "sources") {
    return "builder";
  }
  if (normalized === "feed" || normalized === "post" || normalized === "posts") {
    return "feed";
  }
  if (
    normalized === "digest" ||
    normalized === "digests" ||
    normalized === "ai-digest" ||
    normalized === "ai-digest-archive" ||
    normalized === "ai-digest-archives"
  ) {
    return "digest";
  }
  return "all";
}

function searchHref({
  mode,
  page,
  query,
  sort,
  time,
  type,
}: {
  mode: SearchMode;
  page?: number;
  query: string;
  sort: SearchSort;
  time: SearchTimeRange;
  type: SearchTypeFilter;
}) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (type !== "all") params.set("type", searchDocumentTypeParamValue(type));
  if (mode !== "hybrid") params.set("mode", mode);
  if (sort !== "relevance") params.set("sort", sort);
  if (time !== "any") params.set("time", time);
  if (page && page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return queryString ? `/search?${queryString}` : "/search";
}

function buildActiveSearchFilters({
  mode,
  query,
  sort,
  time,
  typeFilter,
}: {
  mode: SearchMode;
  query: string;
  sort: SearchSort;
  time: SearchTimeRange;
  typeFilter: SearchTypeFilter;
}) {
  const parsed = parseSearchQuery(query);
  const filters: ActiveSearchFilter[] = [];

  if (typeFilter !== "all") {
    filters.push({
      clearLabel: `Remove ${resultTypeFilterLabels[typeFilter]} result type filter`,
      href: searchHref({ query, type: "all", mode, sort, time }),
      label: "Result type",
      value: resultTypeFilterLabels[typeFilter],
    });
  }
  if (mode !== "hybrid") {
    filters.push({
      clearLabel: `Remove ${searchModeLabels[mode]} search mode`,
      href: searchHref({ query, type: typeFilter, mode: "hybrid", sort, time }),
      label: "Mode",
      value: searchModeLabels[mode],
    });
  }
  if (time !== "any") {
    filters.push({
      clearLabel: `Remove ${searchTimeLabels[time]} time filter`,
      href: searchHref({ query, type: typeFilter, mode, sort, time: "any" }),
      label: "Time",
      value: searchTimeLabels[time],
    });
  }
  if (sort !== "relevance") {
    filters.push({
      clearLabel: `Remove ${searchSortLabels[sort]} sort`,
      href: searchHref({ query, type: typeFilter, mode, sort: "relevance", time }),
      label: "Sort",
      value: searchSortLabels[sort],
    });
  }
  if (parsed.site) {
    filters.push({
      clearLabel: `Remove site filter ${parsed.site}`,
      href: searchHref({
        query: stripSearchQueryOperators(query, ["site"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Site",
      value: parsed.site,
    });
  }
  if (parsed.excludedSites.length > 0) {
    const excludedSiteLabel =
      parsed.excludedSites.length === 1 ? "Excluded site" : "Excluded sites";
    filters.push({
      clearLabel: `Remove ${excludedSiteLabel.toLowerCase()}`,
      href: searchHref({
        query: stripNegativeSearchQueryOperators(query, ["site"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: excludedSiteLabel,
      value: parsed.excludedSites.join(", "),
    });
  }
  if (parsed.type) {
    filters.push({
      clearLabel: `Remove result type ${resultTypeFilterLabels[parsed.type]}`,
      href: searchHref({
        query: stripSearchQueryOperators(query, ["type", "filetype"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Result type",
      value: resultTypeFilterLabels[parsed.type],
    });
  }
  if (parsed.excludedTypes.length > 0) {
    const excludedTypeLabel =
      parsed.excludedTypes.length === 1
        ? "Excluded result type"
        : "Excluded result types";
    filters.push({
      clearLabel: `Remove ${excludedTypeLabel.toLowerCase()}`,
      href: searchHref({
        query: stripNegativeSearchQueryOperators(query, ["type", "filetype"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: excludedTypeLabel,
      value: parsed.excludedTypes.map((type) => resultTypeFilterLabels[type]).join(", "),
    });
  }
  if (parsed.titleTerms.length > 0) {
    filters.push({
      clearLabel: "Remove title search terms",
      href: searchHref({
        query: stripSearchQueryOperators(query, ["title", "intitle", "allintitle"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Title",
      value: parsed.titleTerms.join(", "),
    });
  }
  if (parsed.bodyTerms.length > 0) {
    filters.push({
      clearLabel: "Remove text search terms",
      href: searchHref({
        query: stripSearchQueryOperators(query, ["text", "intext", "allintext"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Text",
      value: parsed.bodyTerms.join(", "),
    });
  }
  if (parsed.urlTerms.length > 0) {
    filters.push({
      clearLabel: "Remove URL search terms",
      href: searchHref({
        query: stripSearchQueryOperators(query, ["url", "inurl", "allinurl"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "URL",
      value: parsed.urlTerms.join(", "),
    });
  }
  const requiredValues = [
    ...parsed.requiredPhrases.map((phrase) => `"${phrase}"`),
    ...parsed.requiredOperatorTerms,
  ];
  if (requiredValues.length > 0) {
    filters.push({
      clearLabel: "Remove required terms",
      href: searchHref({
        query: stripRequiredTerms(query),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Must include",
      value: requiredValues.join(", "),
    });
  }
  const excludedTitleValues = [
    ...parsed.excludedTitleTerms,
    ...parsed.excludedAllTitleTermGroups.map((terms) => terms.join(" + ")),
  ];
  if (excludedTitleValues.length > 0) {
    filters.push({
      clearLabel: "Remove excluded title terms",
      href: searchHref({
        query: stripNegativeSearchQueryOperators(query, ["title", "intitle", "allintitle"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Excludes title",
      value: excludedTitleValues.join(", "),
    });
  }
  const excludedBodyValues = [
    ...parsed.excludedBodyTerms,
    ...parsed.excludedAllBodyTermGroups.map((terms) => terms.join(" + ")),
  ];
  if (excludedBodyValues.length > 0) {
    filters.push({
      clearLabel: "Remove excluded text terms",
      href: searchHref({
        query: stripNegativeSearchQueryOperators(query, ["text", "intext", "allintext"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Excludes text",
      value: excludedBodyValues.join(", "),
    });
  }
  const excludedUrlValues = [
    ...parsed.excludedUrlTerms,
    ...parsed.excludedAllUrlTermGroups.map((terms) => terms.join(" + ")),
  ];
  if (excludedUrlValues.length > 0) {
    filters.push({
      clearLabel: "Remove excluded URL terms",
      href: searchHref({
        query: stripNegativeSearchQueryOperators(query, ["url", "inurl", "allinurl"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Excludes URL",
      value: excludedUrlValues.join(", "),
    });
  }
  if (parsed.after) {
    const value = formatOperatorDate(parsed.after);
    filters.push({
      clearLabel: `Remove after ${value} date filter`,
      href: searchHref({
        query: stripSearchQueryOperators(query, ["after"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "After",
      value,
    });
  }
  if (parsed.before) {
    const value = formatOperatorDate(parsed.before);
    filters.push({
      clearLabel: `Remove before ${value} date filter`,
      href: searchHref({
        query: stripSearchQueryOperators(query, ["before"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Before",
      value,
    });
  }
  if (parsed.excludedTerms.length > 0) {
    filters.push({
      clearLabel: "Remove excluded terms",
      href: searchHref({
        query: stripExcludedTerms(query),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Excludes",
      value: parsed.excludedTerms.join(", "),
    });
  }
  if (parsed.excludedPhrases.length > 0) {
    filters.push({
      clearLabel: "Remove excluded phrases",
      href: searchHref({
        query: stripExcludedPhrases(query),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Excludes phrases",
      value: parsed.excludedPhrases.map((phrase) => `"${phrase}"`).join(", "),
    });
  }

  return filters;
}

function clearAllSearchHref(query: string) {
  return searchHref({
    query: parseSearchQuery(query).cleanQuery,
    type: "all",
    mode: "hybrid",
    sort: "relevance",
    time: "any",
  });
}

function stripExcludedTerms(query: string) {
  const excludedPhrases: string[] = [];
  const preservedQuery = query.replace(/(^|\s)-"([^"]+)"/g, (match, prefix: string) => {
    const placeholder = `__excluded_phrase_${excludedPhrases.length}__`;
    excludedPhrases.push(match.trim());
    return `${prefix}${placeholder}`;
  });

  const stripped = preservedQuery
    .split(/\s+/)
    .filter((token) => !(token.startsWith("-") && token.length > 1))
    .join(" ")
    .trim();

  return excludedPhrases
    .reduce((value, phrase, index) => value.replace(`__excluded_phrase_${index}__`, phrase), stripped)
    .trim();
}

function stripRequiredTerms(query: string) {
  const withoutRequiredPhrases = query.replace(/(^|\s)\+"([^"]+)"/g, "$1");
  return withoutRequiredPhrases
    .split(/\s+/)
    .filter((token) => !(token.startsWith("+") && token.length > 1))
    .join(" ")
    .trim();
}

function stripExcludedPhrases(query: string) {
  return query
    .replace(/(^|\s)-"([^"]+)"/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function formatOperatorDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatOptionalOperatorDate(date: Date | null) {
  return date ? formatOperatorDate(date) : "";
}

function formatDisplayUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith("/")) return `FollowBrief ${url.split("#")[0]}`;
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function normalizePage(value: string) {
  return Math.max(1, Number(value) || 1);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const htmlEntityMap: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const normalizedCode = code.toLowerCase();
    if (normalizedCode.startsWith("#x")) {
      return codePointEntity(entity, Number.parseInt(normalizedCode.slice(2), 16));
    }
    if (normalizedCode.startsWith("#")) {
      return codePointEntity(entity, Number.parseInt(normalizedCode.slice(1), 10));
    }
    return htmlEntityMap[normalizedCode] ?? entity;
  });
}

function codePointEntity(entity: string, codePoint: number) {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}
