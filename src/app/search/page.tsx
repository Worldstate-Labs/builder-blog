import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SearchForm, type SearchTypeFilter } from "@/components/SearchForm";
import { getCurrentSession } from "@/lib/auth";
import { searchUserLibrary } from "@/lib/user-search";
import type { SearchDocumentType, SearchResult } from "@/lib/search";

type SearchParams = Promise<{
  q?: string | string[];
  type?: string | string[];
}>;

const resultTypeLabels: Record<SearchDocumentType, string> = {
  builder: "Builders",
  feed: "Feed",
  digest: "Digests",
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
  const { results, candidateCount } = await searchUserLibrary({
    userId: session.user.id,
    query,
  });
  const hasQuery = query.trim().length > 0;
  const typeCounts = countResultTypes(results);
  const filteredResults =
    typeFilter === "all" ? results : results.filter((result) => result.type === typeFilter);

  return (
    <AppShell session={session}>
      <div className={hasQuery ? "page-pad search-page search-page-active" : "page-pad search-page"}>
        <section className="search-hero">
          <div className="search-brand">Builder Blog</div>
          <h1 className="search-heading">Search</h1>
          <p className="search-subtitle">
            Find builders, crawled inputs, and digest history from your active library.
          </p>
          <SearchForm query={query} typeFilter={typeFilter} />
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
                  href={searchHref({ query, type: "all" })}
                  label="All"
                  value="all"
                />
                {(["builder", "feed", "digest"] as const).map((type) => (
                  <TypeTab
                    count={typeCounts[type]}
                    current={typeFilter}
                    href={searchHref({ query, type })}
                    key={type}
                    label={resultTypeLabels[type]}
                    value={type}
                  />
                ))}
              </nav>
              <div className="search-meta-row">
                Showing {filteredResults.length} result
                {filteredResults.length === 1 ? "" : "s"} for{" "}
                <span>{query}</span> from {candidateCount} searched items.
              </div>
              <div className="search-results-list">
                {filteredResults.map((result) => (
                  <ResultCard key={`${result.type}:${result.id}`} result={result} />
                ))}
              </div>
              {filteredResults.length === 0 ? (
                <EmptyState>
                  No matches found. Try a broader phrase, fewer words, or switch back
                  to All results.
                </EmptyState>
              ) : null}
            </>
          ) : (
            <EmptyState>
              Enter a query to search across your builder library, crawled feed
              inputs, and synced digest archive.
            </EmptyState>
          )}
        </section>
      </div>
    </AppShell>
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

function ResultCard({ result }: { result: SearchResult }) {
  const isExternal = result.url?.startsWith("http");
  const displayUrl = formatDisplayUrl(result.url);
  const sourceName = result.sourceName ?? resultTypeLabels[result.type];
  const title = result.url ? (
    <a
      className="search-result-title"
      href={result.url}
      rel={isExternal ? "noreferrer" : undefined}
      target={isExternal ? "_blank" : undefined}
    >
      {result.title}
    </a>
  ) : (
    <span className="search-result-title">{result.title}</span>
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
      <p className="search-result-snippet">{result.snippet}</p>
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
    </article>
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="search-empty">{children}</div>;
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

function normalizeTypeFilter(value: string): SearchTypeFilter {
  if (value === "builder" || value === "feed" || value === "digest") return value;
  return "all";
}

function searchHref({
  query,
  type,
}: {
  query: string;
  type: SearchTypeFilter;
}) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (type !== "all") params.set("type", type);
  const queryString = params.toString();
  return queryString ? `/search?${queryString}` : "/search";
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
