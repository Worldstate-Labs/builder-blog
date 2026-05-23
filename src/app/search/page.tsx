import { formatDistanceToNow } from "date-fns";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ExternalLink, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { authOptions } from "@/lib/auth";
import { searchUserLibrary } from "@/lib/user-search";
import type { SearchMode, SearchResult } from "@/lib/search";

type SearchParams = Promise<{
  q?: string | string[];
  mode?: string | string[];
}>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;
  const query = firstParam(params.q);
  const requestedMode = firstParam(params.mode);
  const { mode, results } = await searchUserLibrary({
    userId: session.user.id,
    query,
    mode: requestedMode,
  });

  return (
    <AppShell>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_24rem]">
          <div>
            <p className="section-label">Search</p>
            <h1 className="mt-3 max-w-4xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
              Find builders, crawled inputs, and digest history.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              Search your active library, the web-app crawled feed items in it,
              and every digest synced to your archive.
            </p>
          </div>
          <div className="stats-panel search-stats-panel">
            <Stat label="Mode" value={mode === "exact" ? "Exact" : "Semantic"} />
            <Stat label="Results" value={String(results.length)} />
          </div>
        </section>

        <form action="/search" className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-4 md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Search query</span>
              <input
                className="input"
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Search builders, feed items, or digests"
              />
            </label>
            <fieldset className="search-mode">
              <legend className="sr-only">Search mode</legend>
              <ModeOption value="semantic" label="Semantic" current={mode} />
              <ModeOption value="exact" label="Exact" current={mode} />
            </fieldset>
            <button className="button-dark gap-2" type="submit">
              <Search className="h-4 w-4" />
              Search
            </button>
          </div>
        </form>

        <section className="mt-8">
          {query.trim() ? (
            <div className="mb-4 text-sm text-[var(--muted)]">
              Showing {results.length} result{results.length === 1 ? "" : "s"} for{" "}
              <span className="font-semibold text-[var(--ink)]">{query}</span>
            </div>
          ) : null}
          <div className="item-list">
            {results.map((result) => (
              <ResultCard key={`${result.type}:${result.id}`} result={result} />
            ))}
          </div>
          {query.trim() && results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--line)] p-6 md:p-10">
              No matches found. Try Semantic mode for related wording, or Exact
              mode for a literal phrase.
            </div>
          ) : null}
          {!query.trim() ? (
            <div className="rounded-lg border border-dashed border-[var(--line)] p-6 text-[var(--muted-strong)] md:p-10">
              Enter a query to search across your builder library, crawled feed
              inputs, and synced digest archive.
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function ModeOption({
  value,
  label,
  current,
}: {
  value: SearchMode;
  label: string;
  current: SearchMode;
}) {
  return (
    <label className="search-mode-option">
      <input type="radio" name="mode" value={value} defaultChecked={current === value} />
      <span>{label}</span>
    </label>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  const isExternal = result.url?.startsWith("http");
  return (
    <article className="feed-card feed-card-compact">
      <div className="item-summary-static">
        <div className="min-w-0">
          <div className="item-kicker">
            <span className="kind-pill">{result.type}</span>
            {result.sourceName ? <span>{result.sourceName}</span> : null}
            {result.date ? <span>{formatDistanceToNow(result.date, { addSuffix: true })}</span> : null}
          </div>
          <h2 className="item-title">{result.title}</h2>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted-strong)]">
            {result.snippet}
          </p>
        </div>
        {result.url ? (
          <a
            className="button-light min-w-24 gap-2"
            href={result.url}
            rel={isExternal ? "noreferrer" : undefined}
            target={isExternal ? "_blank" : undefined}
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </a>
        ) : null}
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-5">
      <div className="font-serif text-4xl font-semibold">{value}</div>
      <div className="mt-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
