"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Search, Sparkles, X } from "lucide-react";
import {
  mergeSearchSuggestions,
  normalizeRecentSearches,
  type SearchDocumentType,
  type SearchMode,
  type SearchSort,
  type SearchTimeRange,
} from "@/lib/search";

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
  const [inputValue, setInputValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return normalizeRecentSearches(
        JSON.parse(localStorage.getItem("builder-blog-searches") ?? "[]"),
      );
    } catch {
      return [];
    }
  });
  const [liveSuggestions, setLiveSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const suggestionOptions = useMemo(
    () =>
      mergeSearchSuggestions({
        query: inputValue,
        recentSearches,
        liveSuggestions: inputValue.trim().length >= 2 ? liveSuggestions : [],
        serverSuggestions: suggestions,
      }),
    [inputValue, liveSuggestions, recentSearches, suggestions],
  );
  const visibleSuggestions = suggestionOptions.slice(0, 5);
  const activeSuggestion =
    suggestionsOpen && activeSuggestionIndex >= 0
      ? visibleSuggestions[activeSuggestionIndex]
      : undefined;
  const activeSuggestionId = activeSuggestion
    ? `search-suggestion-${activeSuggestionIndex}`
    : undefined;

  useEffect(() => {
    const nextQuery = inputValue.trim();
    if (nextQuery.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(nextQuery)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { suggestions: [] }))
        .then((data: { suggestions?: unknown }) => {
          if (controller.signal.aborted) return;
          setLiveSuggestions(
            Array.isArray(data.suggestions)
              ? data.suggestions.filter((value): value is string => typeof value === "string")
              : [],
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) setLiveSuggestions([]);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [inputValue]);

  function submitSearch({
    form,
    isLucky = false,
    nextQuery,
  }: {
    form: HTMLFormElement | null;
    isLucky?: boolean;
    nextQuery: string;
  }) {
    const formData = form ? new FormData(form) : null;
    const trimmedQuery = nextQuery.trim();
    const nextMode = String(formData?.get("mode") ?? mode);
    const nextSort = String(formData?.get("sort") ?? sort);
    const nextTime = String(formData?.get("time") ?? time);
    const params = new URLSearchParams();

    if (trimmedQuery) {
      params.set("q", trimmedQuery);
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
    if (isLucky && trimmedQuery) {
      params.set("lucky", "1");
    }

    if (trimmedQuery) {
      const nextRecent = normalizeRecentSearches([trimmedQuery, ...recentSearches]);
      setRecentSearches(nextRecent);
      try {
        localStorage.setItem("builder-blog-searches", JSON.stringify(nextRecent));
      } catch {
        // Recent searches are a progressive enhancement.
      }
    }

    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    startTransition(() => {
      const queryString = params.toString();
      router.push(queryString ? `/search?${queryString}` : "/search");
    });
  }

  function submitSuggestion(suggestion: string, form: HTMLFormElement | null) {
    setInputValue(suggestion);
    submitSearch({ form, nextQuery: suggestion });
  }

  function clearQuery() {
    setInputValue("");
    setLiveSuggestions([]);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    inputRef.current?.focus();
  }

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
        const isLucky = submitter?.value === "1";

        submitSearch({ form: event.currentTarget, isLucky, nextQuery });
      }}
    >
      <div className="search-form-row">
        <label className="search-query-label min-w-0">
          <span className="sr-only">Search query</span>
          <span className="search-input-wrap">
            <Search className="search-input-icon" />
            <input
              className="search-input"
              ref={inputRef}
              type="search"
              name="q"
              role="combobox"
              value={inputValue}
              aria-activedescendant={activeSuggestionId}
              aria-autocomplete="list"
              aria-controls="search-suggestion-list"
              aria-expanded={suggestionsOpen && visibleSuggestions.length > 0}
              onChange={(event) => {
                setInputValue(event.currentTarget.value);
                setSuggestionsOpen(true);
                setActiveSuggestionIndex(-1);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onKeyDown={(event) => {
                if (visibleSuggestions.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSuggestionsOpen(true);
                  setActiveSuggestionIndex((current) =>
                    current < visibleSuggestions.length - 1 ? current + 1 : 0,
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSuggestionsOpen(true);
                  setActiveSuggestionIndex((current) =>
                    current > 0 ? current - 1 : visibleSuggestions.length - 1,
                  );
                } else if (event.key === "Escape") {
                  setSuggestionsOpen(false);
                  setActiveSuggestionIndex(-1);
                } else if (event.key === "Enter" && activeSuggestion) {
                  event.preventDefault();
                  submitSuggestion(activeSuggestion, event.currentTarget.form);
                }
              }}
              placeholder="Search builders, feed items, or digests"
            />
            {inputValue ? (
              <button
                aria-label="Clear search query"
                className="search-input-clear"
                onClick={clearQuery}
                type="button"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
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
      {suggestionsOpen && visibleSuggestions.length > 0 ? (
        <div
          className="search-suggestion-row"
          aria-label="Search suggestions"
          aria-live="polite"
          id="search-suggestion-list"
          role="listbox"
        >
          {visibleSuggestions.map((suggestion, index) => (
            <button
              className="search-suggestion-chip"
              data-active={index === activeSuggestionIndex ? "true" : undefined}
              id={`search-suggestion-${index}`}
              key={suggestion}
              name="suggestion"
              role="option"
              type="submit"
              value={suggestion}
              aria-selected={index === activeSuggestionIndex}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
