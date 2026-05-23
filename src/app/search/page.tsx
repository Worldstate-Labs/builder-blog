import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SearchForm, type SearchTypeFilter } from "@/components/SearchForm";
import { getCurrentSession } from "@/lib/auth";
import { searchUserLibrary } from "@/lib/user-search";
import {
  didYouMeanSearch,
  normalizeSearchMode,
  normalizeSearchSort,
  normalizeSearchTime,
  parseSearchQuery,
  relatedSearchSuggestions,
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
  lucky?: string | string[];
  sort?: string | string[];
  time?: string | string[];
}>;

const searchPageSize = 10;
const defaultSuggestions = [
  "agent memory",
  "embedding search",
  "builder launch",
  "digest archive",
  "podcast transcript",
];

const advancedSearchExamples = [
  '"agent memory"',
  '"agent * memory"',
  "agent memory -pricing",
  "agent memory +retrieval",
  'agent -"memory leak"',
  "agent OR embedding",
  '"agent memory" OR "retrieval quality"',
  '("agent memory" OR "retrieval quality") launch',
  "agent AROUND(3) memory",
  "agent memory site:example.com",
  "agent memory site:example.com/articles",
  "agent memory -site:example.com",
  "agent memory intitle:launch",
  "agent memory -intitle:pricing",
  "allintitle:agent memory",
  "agent memory -allintitle:pricing launch",
  "agent memory intext:transcript",
  "allintext:agent memory",
  "agent memory inurl:release",
  "allinurl:release agent",
  "agent memory type:feed",
  "agent memory filetype:digest",
  "agent memory -filetype:digest",
  "agent memory after:2026-01-01",
  "agent memory before:2026-12-31",
];

const resultTypeLabels: Record<SearchDocumentType, string> = {
  builder: "Builders",
  feed: "Feed",
  digest: "Digests",
};

const searchModeLabels: Record<SearchMode, string> = {
  exact: "Exact",
  hybrid: "Hybrid",
  semantic: "Semantic",
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
  const originalSearch = await searchUserLibrary({
    userId: session.user.id,
    query,
    mode,
    sort,
    time,
  });
  const hasQuery = query.trim().length > 0;
  const formParsedQuery = parseSearchQuery(query);
  const correctedQuery = hasQuery ? didYouMeanSearch(query) : null;
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
          userId: session.user.id,
          query: correctedQuery,
          mode,
          sort,
          time,
        })
      : null;
  const isShowingCorrectedResults = Boolean(correctionSearch);
  const activeQuery = correctionSearch && correctedQuery ? correctedQuery : query;
  const results = correctionSearch?.results ?? originalSearch.results;
  const candidateCount = correctionSearch?.candidateCount ?? originalSearch.candidateCount;
  const typeCounts = countResultTypes(results);
  const filteredResults =
    typeFilter === "all" ? results : results.filter((result) => result.type === typeFilter);
  const pageCount = Math.max(1, Math.ceil(filteredResults.length / searchPageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleResults = filteredResults.slice(
    (currentPage - 1) * searchPageSize,
    currentPage * searchPageSize,
  );
  const relatedSearches = hasQuery ? relatedSearchSuggestions(activeQuery) : defaultSuggestions;
  const formSuggestions = [
    ...(correctedQuery ? [correctedQuery] : []),
    ...relatedSearches,
    ...results.slice(0, 5).map((result) => result.title),
  ];
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
  const luckyResult = filteredResults[0];
  if (hasQuery && firstParam(params.lucky) === "1" && luckyResult?.url) {
    redirect(luckyResult.url);
  }

  return (
    <AppShell session={session}>
      <div className={hasQuery ? "page-pad search-page search-page-active" : "page-pad search-page"}>
        <section className="search-hero">
          <div className="search-brand">Builder Blog</div>
          <h1 className="search-heading">Search</h1>
          <p className="search-subtitle">
            Find builders, crawled inputs, and digest history from your active library.
          </p>
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
          {hasQuery ? (
            <div className="search-quick-stats" aria-label="Search summary">
              <Stat label="Results" value={String(filteredResults.length)} />
              <Stat label="Candidates" value={String(candidateCount)} />
              <Stat label="Types" value={String(nonzeroTypeCount(typeCounts))} />
            </div>
          ) : null}
        </section>

        <section className="search-results-shell">
          {hasQuery ? (
            <>
              <nav className="search-tabs" aria-label="Result type">
                <TypeTab
                  count={typeCounts.all}
                  current={typeFilter}
                  href={searchHref({ query: activeQuery, type: "all", mode, sort, time })}
                  label="All"
                  value="all"
                />
                {(["builder", "feed", "digest"] as const).map((type) => (
                  <TypeTab
                    count={typeCounts[type]}
                    current={typeFilter}
                    href={searchHref({ query: activeQuery, type, mode, sort, time })}
                    key={type}
                    label={resultTypeLabels[type]}
                    value={type}
                  />
                ))}
              </nav>
              <div className="search-meta-row">
                About {filteredResults.length} result
                {filteredResults.length === 1 ? "" : "s"} for{" "}
                <span>{activeQuery}</span>. Searched {candidateCount} candidates in {mode} mode.
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
              <SearchQueryInsights
                actions={recoveryActions}
                candidateCount={candidateCount}
                mode={mode}
                query={activeQuery}
                resultCount={filteredResults.length}
                sort={sort}
                time={time}
                typeFilter={typeFilter}
              />
              <div className="search-tools-row">
                {luckyResult?.url ? (
                  <a
                    className="button-light button-compact gap-2"
                    href={luckyResult.url}
                    rel={luckyResult.url.startsWith("http") ? "noreferrer" : undefined}
                    target={luckyResult.url.startsWith("http") ? "_blank" : undefined}
                  >
                    <Sparkles className="h-4 w-4" />
                    I&apos;m Feeling Lucky
                  </a>
                ) : null}
                <span>
                  Page {currentPage} of {pageCount}
                </span>
              </div>
              <div className="search-results-list">
                {visibleResults.map((result) => (
                  <ResultCard
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
              {pageCount > 1 ? (
                <nav className="search-pagination" aria-label="Search result pages">
                  <PageLink
                    disabled={currentPage === 1}
                    href={searchHref({ query: activeQuery, type: typeFilter, mode, sort, time, page: currentPage - 1 })}
                    label="Previous"
                    icon="previous"
                  />
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                    <Link
                      className="search-page-link"
                      data-active={pageNumber === currentPage ? "true" : undefined}
                      href={searchHref({ query: activeQuery, type: typeFilter, mode, sort, time, page: pageNumber })}
                      key={pageNumber}
                    >
                      {pageNumber}
                    </Link>
                  ))}
                  <PageLink
                    disabled={currentPage === pageCount}
                    href={searchHref({ query: activeQuery, type: typeFilter, mode, sort, time, page: currentPage + 1 })}
                    label="Next"
                    icon="next"
                  />
                </nav>
              ) : null}
              {filteredResults.length === 0 ? (
                <EmptyState actions={recoveryActions}>
                  No matches found. Try a broader phrase, fewer words, or switch back
                  to All results.
                </EmptyState>
              ) : null}
              {relatedSearches.length > 0 ? (
                <RelatedSearches query={activeQuery} searches={relatedSearches} mode={mode} sort={sort} time={time} />
              ) : null}
              <AdvancedSearchTips mode={mode} sort={sort} time={time} />
            </>
          ) : (
            <>
              <EmptyState>
                Enter a query to search across your builder library, crawled feed
                inputs, and synced digest archive.
              </EmptyState>
              <RelatedSearches query={query} searches={defaultSuggestions} mode={mode} sort={sort} time={time} />
              <AdvancedSearchTips mode={mode} sort={sort} time={time} />
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function SearchQueryInsights({
  actions,
  candidateCount,
  mode,
  query,
  resultCount,
  sort,
  time,
  typeFilter,
}: {
  actions: SearchRecoveryAction[];
  candidateCount: number;
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
      <div className="search-insight-card">
        <div className="search-insight-heading">
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
          <div>
            <span>Query understood</span>
            <strong>
              {resultCount} result{resultCount === 1 ? "" : "s"} from {candidateCount} candidates
            </strong>
          </div>
        </div>
        <dl className="search-insight-grid">
          {items.map((item) => (
            <div className="search-insight-item" key={`${item.label}:${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {actions.length > 0 ? (
        <div className="search-insight-actions" aria-label="Broaden search">
          {actions.map((action) => (
            <Link className="search-recovery-action" href={action.href} key={action.label}>
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
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
      <div className="search-active-filters-heading">Search tools</div>
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
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        ))}
        <Link className="search-filter-clear" href={clearAllHref}>
          Clear all
        </Link>
      </div>
    </section>
  );
}

function TypeTab({
  count,
  current,
  href,
  label,
  value,
}: {
  count: number;
  current: SearchTypeFilter;
  href: string;
  label: string;
  value: SearchTypeFilter;
}) {
  return (
    <Link className="search-tab" data-active={current === value ? "true" : undefined} href={href}>
      <span>{label}</span>
      <span className="search-tab-count">{count}</span>
    </Link>
  );
}

function ResultCard({
  mode,
  query,
  result,
  sort,
  time,
  typeFilter,
}: {
  mode: SearchMode;
  query: string;
  result: SearchResult;
  sort: SearchSort;
  time: SearchTimeRange;
  typeFilter: SearchTypeFilter;
}) {
  const isExternal = result.url?.startsWith("http");
  const displayUrl = formatDisplayUrl(result.url);
  const sourceSite = searchSiteFromUrl(result.url);
  const sourceName = result.sourceName ?? resultTypeLabels[result.type];
  const title = result.url ? (
    <a
      className="search-result-title"
      href={result.url}
      rel={isExternal ? "noreferrer" : undefined}
      target={isExternal ? "_blank" : undefined}
    >
      <HighlightText text={result.title} query={query} />
    </a>
  ) : (
    <span className="search-result-title">
      <HighlightText text={result.title} query={query} />
    </span>
  );

  return (
    <article className="search-result">
      <div className="search-result-source">
        <span className="search-result-icon">{sourceName.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <div className="search-result-source-name">{sourceName}</div>
          {displayUrl ? <div className="search-result-url">{displayUrl}</div> : null}
        </div>
      </div>
      <h2>{title}</h2>
      <p className="search-result-snippet">
        <HighlightText text={result.snippet} query={query} />
      </p>
      <div className="search-result-meta">
        <span>{resultTypeLabels[result.type]}</span>
        {result.date ? <span>{formatDistanceToNow(result.date, { addSuffix: true })}</span> : null}
        {result.url ? (
          <a
            className="search-result-open"
            href={result.url}
            rel={isExternal ? "noreferrer" : undefined}
            target={isExternal ? "_blank" : undefined}
          >
            Open
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <div className="search-result-refinements" aria-label={`Refine search for ${result.title}`}>
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
            Only {resultTypeLabels[result.type]}
          </Link>
        ) : null}
      </div>
    </article>
  );
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
      <span className="search-page-link search-page-link-disabled">
        <Icon className="h-4 w-4" />
        {label}
      </span>
    );
  }

  return (
    <Link className="search-page-link" href={href}>
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function RelatedSearches({
  mode,
  query,
  searches,
  sort,
  time,
}: {
  mode: SearchMode;
  query: string;
  searches: string[];
  sort: SearchSort;
  time: SearchTimeRange;
}) {
  return (
    <section className="search-related" aria-label="Related searches">
      <h2>Related searches</h2>
      <div className="search-related-grid">
        {searches.map((search) => (
          <Link
            className="search-related-link"
            href={searchHref({ query: search, type: "all", mode, sort, time })}
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
    <section className="search-related" aria-label="Advanced search">
      <h2>Advanced search</h2>
      <div className="search-related-grid">
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
  const terms = searchHighlightTerms(query);
  if (terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        terms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
          <mark key={`${part}:${index}`}>{part}</mark>
        ) : (
          <span key={`${part}:${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="search-stat">
      <div className="search-stat-value">{value}</div>
      <div className="search-stat-label">{label}</div>
    </div>
  );
}

function EmptyState({
  actions = [],
  children,
}: {
  actions?: SearchRecoveryAction[];
  children: React.ReactNode;
}) {
  return (
    <div className="search-empty">
      <div>{children}</div>
      {actions.length > 0 ? (
        <div className="search-empty-actions">
          {actions.map((action) => (
            <Link className="search-recovery-action" href={action.href} key={action.label}>
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
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

function nonzeroTypeCount(counts: ReturnType<typeof countResultTypes>) {
  return (["builder", "feed", "digest"] as const).filter((type) => counts[type] > 0).length;
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
      label: "Broaden to Hybrid",
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
      label: "Search all time",
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
    { label: "Type", value: typeFilter === "all" ? "All results" : resultTypeLabels[typeFilter] },
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
  if (value === "builder" || value === "feed" || value === "digest") return value;
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
  if (type !== "all") params.set("type", type);
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
      clearLabel: `Remove ${resultTypeLabels[typeFilter]} result filter`,
      href: searchHref({ query, type: "all", mode, sort, time }),
      label: "Type",
      value: resultTypeLabels[typeFilter],
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
    filters.push({
      clearLabel: "Remove excluded sites",
      href: searchHref({
        query: stripNegativeSearchQueryOperators(query, ["site"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Excludes sites",
      value: parsed.excludedSites.join(", "),
    });
  }
  if (parsed.type) {
    const isFiletype = parsed.typeOperator === "filetype";
    filters.push({
      clearLabel: isFiletype
        ? `Remove file type ${resultTypeLabels[parsed.type]}`
        : `Remove query type ${resultTypeLabels[parsed.type]}`,
      href: searchHref({
        query: stripSearchQueryOperators(query, ["type", "filetype"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: isFiletype ? "File type" : "Query type",
      value: resultTypeLabels[parsed.type],
    });
  }
  if (parsed.excludedTypes.length > 0) {
    filters.push({
      clearLabel: "Remove excluded file types",
      href: searchHref({
        query: stripNegativeSearchQueryOperators(query, ["type", "filetype"]),
        type: typeFilter,
        mode,
        sort,
        time,
      }),
      label: "Excludes file types",
      value: parsed.excludedTypes.map((type) => resultTypeLabels[type]).join(", "),
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
  if (url.startsWith("/")) return `Builder Blog ${url.split("#")[0]}`;
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
