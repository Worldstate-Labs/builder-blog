"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Search, Sparkles } from "lucide-react";
import type { SearchDocumentType, SearchMode, SearchSort, SearchTimeRange } from "@/lib/search";

export type SearchTypeFilter = "all" | SearchDocumentType;

export function SearchForm({
  query,
  typeFilter = "all",
  mode = "hybrid",
  sort = "relevance",
  time = "any",
  suggestions = [],
}: {
  query: string;
  typeFilter?: SearchTypeFilter;
  mode?: SearchMode;
  sort?: SearchSort;
  time?: SearchTimeRange;
  suggestions?: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const suggestionOptions = useMemo(
    () =>
      [...new Set([...recentSearches, ...suggestions])]
        .map((value) => value.trim())
        .filter((value) => value && value.toLowerCase() !== query.trim().toLowerCase())
        .slice(0, 8),
    [query, recentSearches, suggestions],
  );

  return (
    <form
      action="/search"
      className="search-form"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const formData = new FormData(event.currentTarget);
        const nextQuery =
          submitter?.name === "suggestion"
            ? submitter.value.trim()
            : String(formData.get("q") ?? "").trim();
        const nextMode = String(formData.get("mode") ?? "hybrid");
        const nextSort = String(formData.get("sort") ?? "relevance");
        const nextTime = String(formData.get("time") ?? "any");
        const isLucky = submitter?.value === "1";
        const params = new URLSearchParams();

        if (nextQuery) {
          params.set("q", nextQuery);
        }
        if (typeFilter !== "all") {
          params.set("type", typeFilter);
        }
        if (nextMode !== "hybrid") {
          params.set("mode", nextMode);
        }
        if (nextSort !== "relevance") {
          params.set("sort", nextSort);
        }
        if (nextTime !== "any") {
          params.set("time", nextTime);
        }
        if (isLucky && nextQuery) {
          params.set("lucky", "1");
        }

        if (nextQuery) {
          const nextRecent = [
            nextQuery,
            ...recentSearches.filter(
              (recent) => recent.toLowerCase() !== nextQuery.toLowerCase(),
            ),
          ].slice(0, 5);
          setRecentSearches(nextRecent);
          try {
            localStorage.setItem("builder-blog-searches", JSON.stringify(nextRecent));
          } catch {
            // Recent searches are a progressive enhancement.
          }
        }

        startTransition(() => {
          const queryString = params.toString();
          router.push(queryString ? `/search?${queryString}` : "/search");
        });
      }}
    >
      <div className="search-form-row">
        <label className="search-query-label min-w-0">
          <span className="sr-only">Search query</span>
          <span className="search-input-wrap">
            <Search className="search-input-icon" />
            <input
              className="search-input"
              type="search"
              name="q"
              list="search-suggestions"
              defaultValue={query}
              placeholder="Search builders, feed items, or digests"
            />
            <datalist id="search-suggestions">
              {suggestionOptions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </span>
        </label>
        <label className="search-mode-select">
          <span>Search mode</span>
          <select name="mode" defaultValue={mode}>
            <option value="hybrid">Hybrid</option>
            <option value="exact">Exact</option>
            <option value="semantic">Semantic</option>
          </select>
        </label>
        <label className="search-mode-select">
          <span>Time range</span>
          <select name="time" defaultValue={time}>
            <option value="any">Any time</option>
            <option value="day">Past day</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
            <option value="year">Past year</option>
          </select>
        </label>
        <label className="search-mode-select">
          <span>Sort by</span>
          <select name="sort" defaultValue={sort}>
            <option value="relevance">Relevance</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        <button
          aria-busy={isPending}
          className="button-dark relative justify-center gap-2"
          disabled={isPending}
          name="search"
          type="submit"
        >
          <span
            className={`inline-flex items-center justify-center gap-2 ${
              isPending ? "invisible" : ""
            }`}
          >
            Search
          </span>
          {isPending ? (
            <span className="absolute inset-0 inline-flex items-center justify-center px-3">
              Searching...
            </span>
          ) : null}
        </button>
        <button
          className="button-light search-lucky-button gap-2"
          disabled={isPending}
          name="lucky"
          type="submit"
          value="1"
        >
          <Sparkles className="h-4 w-4" />
          Lucky
        </button>
      </div>
      {suggestionOptions.length > 0 ? (
        <div className="search-suggestion-row" aria-label="Search suggestions">
          {suggestionOptions.slice(0, 5).map((suggestion) => (
            <button
              className="search-suggestion-chip"
              key={suggestion}
              name="suggestion"
              type="submit"
              value={suggestion}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
