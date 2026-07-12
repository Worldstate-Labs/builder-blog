"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Clock, Search, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { SourceAvatar } from "@/components/SourceAvatar";
import {
  normalizeRecentSearches,
  searchDocumentTypeParamValue,
  type SearchDocumentType,
  type SearchMode,
  type SearchSort,
  type SearchTimeRange,
  withDateSearchOperators,
} from "@/lib/search";

export type SearchTypeFilter = "all" | SearchDocumentType;

type AutocompleteSuggestion = {
  avatarDataUrl?: string | null;
  avatarUrl?: string | null;
  query: string;
  label: string;
  detail?: string;
  fetchUrl?: string | null;
  kind: "recent" | "query" | "entity" | "result";
  sourceType?: string | null;
  sourceUrl?: string | null;
};

const recentSearchesStorageKey = "followbrief-searches";
const legacyRecentSearchesStorageKey = "builder-blog-searches";

export function SearchForm({
  variant = "page",
  query,
  typeFilter = "all",
  mode = "hybrid",
  sort = "relevance",
  time = "any",
  afterDate = "",
  beforeDate = "",
  suggestions = [],
}: {
  variant?: "page" | "header";
  query: string;
  typeFilter?: SearchTypeFilter;
  mode?: SearchMode;
  sort?: SearchSort;
  time?: SearchTimeRange;
  afterDate?: string;
  beforeDate?: string;
  suggestions?: string[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const isHeader = variant === "header";
  const [isPending, startTransition] = useTransition();
  const [inputValue, setInputValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return readRecentSearches();
  });
  const [liveSuggestions, setLiveSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const suggestionOptions = useMemo(
    () =>
      mergeAutocompleteSuggestions({
        query: inputValue,
        recentSearches,
        liveSuggestions: inputValue.trim().length >= 2 ? liveSuggestions : [],
        serverSuggestions: suggestions,
      }),
    [inputValue, liveSuggestions, recentSearches, suggestions],
  );
  const visibleSuggestions = suggestionOptions.slice(0, 5);
  const recentSuggestionKeys = useMemo(
    () => new Set(recentSearches.map(normalizeSuggestionKey)),
    [recentSearches],
  );
  const activeSuggestion =
    suggestionsOpen && activeSuggestionIndex >= 0
      ? visibleSuggestions[activeSuggestionIndex]
      : undefined;
  const suggestionIdPrefix = isHeader ? "header-search-suggestion" : "search-suggestion";
  const suggestionListId = `${suggestionIdPrefix}-list`;
  const activeSuggestionId = activeSuggestion
    ? `${suggestionIdPrefix}-${activeSuggestionIndex}`
    : undefined;
  const shouldShowSuggestions = suggestionsOpen && visibleSuggestions.length > 0;

  useEffect(() => {
    const nextQuery = inputValue.trim();
    if (nextQuery.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(nextQuery)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { items: [], suggestions: [] }))
        .then((data: { items?: unknown; suggestions?: unknown }) => {
          if (controller.signal.aborted) return;
          setLiveSuggestions(normalizeAutocompleteItems(data));
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
    nextQuery,
  }: {
    form: HTMLFormElement | null;
    nextQuery: string;
  }) {
    const formData = form ? new FormData(form) : null;
    const trimmedQuery = nextQuery.trim();
    const nextMode = String(formData?.get("mode") ?? mode);
    const nextSort = String(formData?.get("sort") ?? sort);
    const nextTime = String(formData?.get("time") ?? time);
    const nextAfterDate = String(formData?.get("after") ?? "");
    const nextBeforeDate = String(formData?.get("before") ?? "");
    const queryWithDateRange = withDateSearchOperators(trimmedQuery, {
      after: nextAfterDate,
      before: nextBeforeDate,
    });
    const hasCustomDateRange = Boolean(nextAfterDate || nextBeforeDate);
    const params = new URLSearchParams();

    if (queryWithDateRange) {
      params.set("q", queryWithDateRange);
    }
    if (typeFilter !== "all") {
      params.set("type", searchDocumentTypeParamValue(typeFilter));
    }
    if (nextMode !== "hybrid") {
      params.set("mode", nextMode);
    }
    if (nextSort !== "relevance") {
      params.set("sort", nextSort);
    }
    if (nextTime !== "any" && !hasCustomDateRange) {
      params.set("time", nextTime);
    }
    if (queryWithDateRange) {
      const nextRecent = normalizeRecentSearches([queryWithDateRange, ...recentSearches]);
      setRecentSearches(nextRecent);
      writeRecentSearches(nextRecent);
    }

    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    startTransition(() => {
      const queryString = params.toString();
      router.push(queryString ? `/search?${queryString}` : "/search");
    });
  }

  function submitSuggestion(suggestion: AutocompleteSuggestion, form: HTMLFormElement | null) {
    setInputValue(suggestion.query);
    submitSearch({ form, nextQuery: suggestion.query });
  }

  function clearQuery() {
    setInputValue("");
    setLiveSuggestions([]);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    inputRef.current?.focus();
  }

  function removeRecentSearch(search: string) {
    const normalizedSearch = normalizeSuggestionKey(search);
    const nextRecent = recentSearches.filter(
      (recentSearch) => normalizeSuggestionKey(recentSearch) !== normalizedSearch,
    );
    setRecentSearches(nextRecent);
    setActiveSuggestionIndex(-1);
    writeRecentSearches(nextRecent);
    inputRef.current?.focus();
  }

  const suggestionDropdown = (className: string) => shouldShowSuggestions ? (
    <div
      className={className}
      aria-label={t("search.suggestions")}
      aria-live="polite"
      id={suggestionListId}
      role="listbox"
    >
      {visibleSuggestions.map((suggestion, index) => (
        <div
          aria-selected={index === activeSuggestionIndex}
          data-active={index === activeSuggestionIndex ? "true" : undefined}
          id={`${suggestionIdPrefix}-${index}`}
          key={`${suggestion.kind}:${suggestion.query}`}
          role="option"
          className="search-suggestion-item"
        >
          <button
            aria-label={t("search.searchFor", { query: suggestion.query })}
            className="search-suggestion-chip"
            onClick={(event) => {
              submitSuggestion(suggestion, event.currentTarget.form);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            {suggestion.kind === "recent" ? (
              <Clock aria-hidden="true" className="search-suggestion-icon" />
            ) : suggestionAvatarSource(suggestion) ? (
              <SourceAvatar
                className="search-suggestion-avatar"
                imageSize={32}
                source={suggestionAvatarSource(suggestion)!}
              />
            ) : (
              <Search aria-hidden="true" className="search-suggestion-icon" />
            )}
            <span className="search-suggestion-copy">
              <span className="search-suggestion-title">{suggestion.label}</span>
              {suggestion.detail ? (
                <span className="search-suggestion-detail">{suggestion.detail}</span>
              ) : null}
            </span>
          </button>
          {recentSuggestionKeys.has(normalizeSuggestionKey(suggestion.query)) ? (
            <button
              aria-label={t("search.removeRecent", { query: suggestion.query })}
              className="search-suggestion-remove"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                removeRecentSearch(suggestion.query);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              type="button"
            >
              <X aria-hidden="true" className="search-action-icon" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <form
      action="/search"
      autoComplete="off"
      className={isHeader ? "header-search header-search-form" : "search-form"}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setSuggestionsOpen(false);
          setActiveSuggestionIndex(-1);
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const nextQuery = String(formData.get("q") ?? "").trim();
        submitSearch({ form: event.currentTarget, nextQuery });
      }}
    >
      <div className={isHeader ? "header-search-row" : "search-form-row"}>
        <label className={isHeader ? "header-search-label" : "search-query-label"}>
          <span className="sr-only">{t("search.query")}</span>
          <span className={isHeader ? "header-search-input-wrap search-input-wrap" : "search-input-wrap"}>
            <Search className="search-input-icon" />
            <input
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className={isHeader ? "header-search-input search-input" : "search-input"}
              ref={inputRef}
              spellCheck={false}
              type="search"
              name="q"
              role="combobox"
              value={inputValue}
              aria-activedescendant={activeSuggestionId}
              aria-autocomplete="list"
              aria-controls={suggestionListId}
              aria-expanded={shouldShowSuggestions}
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
              placeholder={t("search.placeholder")}
            />
            {inputValue ? (
              <button
                aria-label={t("search.clear")}
                className="search-input-clear"
                onClick={clearQuery}
                type="button"
              >
                <X aria-hidden="true" className="search-action-icon" />
              </button>
            ) : null}
            {isHeader ? suggestionDropdown("search-suggestion-dropdown") : null}
          </span>
          {isHeader ? null : suggestionDropdown("search-suggestion-dropdown search-page-suggestion-dropdown")}
        </label>
        {isHeader ? null : (
          <>
            <label className="search-mode-select">
              <span>{t("search.mode")}</span>
              <select name="mode" defaultValue={mode}>
                <option value="hybrid">{t("search.bestMatch")}</option>
                <option value="exact">{t("search.exactWords")}</option>
                <option value="semantic">{t("search.meaning")}</option>
              </select>
            </label>
            <label className="search-mode-select">
              <span>{t("search.time")}</span>
              <select name="time" defaultValue={time}>
                <option value="any">{t("search.anyTime")}</option>
                <option value="day">{t("search.pastDay")}</option>
                <option value="week">{t("search.pastWeek")}</option>
                <option value="month">{t("search.pastMonth")}</option>
                <option value="year">{t("search.pastYear")}</option>
              </select>
            </label>
            <label className="search-mode-select">
              <span>{t("search.sort")}</span>
              <select name="sort" defaultValue={sort}>
                <option value="relevance">{t("search.relevance")}</option>
                <option value="newest">{t("search.newest")}</option>
              </select>
            </label>
            <div className="search-date-range" aria-label="Custom date range">
              <label className="search-date-field">
                <span>{t("search.from")}</span>
                <input name="after" type="date" defaultValue={afterDate} />
              </label>
              <label className="search-date-field">
                <span>{t("search.to")}</span>
                <input name="before" type="date" defaultValue={beforeDate} />
              </label>
            </div>
            <button
              aria-busy={isPending}
              className="fb-btn dark submit-button"
              disabled={isPending}
              name="search"
              type="submit"
            >
              <span
                className={`submit-button-content${isPending ? " is-pending" : ""}`}
              >
                {t("common.search")}
              </span>
              {isPending ? (
                <span className="submit-button-pending">
                  {t("search.searching")}
                </span>
              ) : null}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function normalizeSuggestionKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function readRecentSearches() {
  try {
    const stored =
      localStorage.getItem(recentSearchesStorageKey) ??
      localStorage.getItem(legacyRecentSearchesStorageKey);
    const recent = normalizeRecentSearches(JSON.parse(stored ?? "[]"));
    if (!localStorage.getItem(recentSearchesStorageKey) && recent.length > 0) {
      writeRecentSearches(recent);
    }
    return recent;
  } catch {
    return [];
  }
}

function writeRecentSearches(recentSearches: string[]) {
  try {
    localStorage.setItem(recentSearchesStorageKey, JSON.stringify(recentSearches));
  } catch {
    // Recent searches are a progressive enhancement.
  }
}

function mergeAutocompleteSuggestions({
  query,
  recentSearches,
  liveSuggestions,
  serverSuggestions,
  limit = 8,
}: {
  query: string;
  recentSearches: string[];
  liveSuggestions: AutocompleteSuggestion[];
  serverSuggestions: string[];
  limit?: number;
}) {
  const normalizedQuery = normalizeSuggestionKey(query);
  const seen = new Set<string>();
  const merged: AutocompleteSuggestion[] = [];
  const hasQuery = normalizedQuery.length > 0;
  const recentSuggestions = recentSearches.flatMap((recentSearch): AutocompleteSuggestion[] => {
    if (hasQuery && !normalizeSuggestionKey(recentSearch).includes(normalizedQuery)) {
      return [];
    }
    return [{
      query: recentSearch,
      label: recentSearch,
      kind: "recent",
    }];
  });
  const addSuggestion = (suggestion: AutocompleteSuggestion) => {
    const normalized = normalizeSuggestionKey(suggestion.query);
    if (!normalized || normalized === normalizedQuery || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(suggestion);
  };

  if (!hasQuery) {
    for (const suggestion of recentSuggestions) addSuggestion(suggestion);
  }
  for (const suggestion of liveSuggestions) addSuggestion(suggestion);
  if (!hasQuery) {
    for (const suggestion of serverSuggestions) {
      addSuggestion({
        query: suggestion,
        label: suggestion,
        kind: "query",
      });
    }
  }
  if (hasQuery) {
    for (const suggestion of recentSuggestions) addSuggestion(suggestion);
  }

  return merged.slice(0, limit);
}

function normalizeAutocompleteItems(data: { items?: unknown; suggestions?: unknown }) {
  if (Array.isArray(data.items)) {
    return data.items.flatMap((item): AutocompleteSuggestion[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const query = typeof record.query === "string" ? record.query.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : query;
      const detail = typeof record.detail === "string" ? record.detail.trim() : undefined;
      const avatarDataUrl =
        typeof record.avatarDataUrl === "string" ? record.avatarDataUrl : null;
      const avatarUrl = typeof record.avatarUrl === "string" ? record.avatarUrl : null;
      const fetchUrl = typeof record.fetchUrl === "string" ? record.fetchUrl : null;
      const sourceType = typeof record.sourceType === "string" ? record.sourceType : null;
      const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl : null;
      const kind =
        record.kind === "entity" || record.kind === "result" || record.kind === "query"
          ? record.kind
          : "query";
      if (!query || !label) return [];
      return [{ avatarDataUrl, avatarUrl, query, label, detail, fetchUrl, kind, sourceType, sourceUrl }];
    });
  }

  if (!Array.isArray(data.suggestions)) return [];
  return data.suggestions.flatMap((suggestion): AutocompleteSuggestion[] => {
    if (typeof suggestion !== "string") return [];
    const query = suggestion.trim();
    if (!query) return [];
    return [{ query, label: query, kind: "query" }];
  });
}

function suggestionAvatarSource(suggestion: AutocompleteSuggestion) {
  if (!suggestion.avatarUrl && !suggestion.avatarDataUrl && !suggestion.sourceUrl && !suggestion.fetchUrl) {
    return null;
  }
  return {
    avatarDataUrl: suggestion.avatarDataUrl ?? null,
    avatarUrl: suggestion.avatarUrl ?? null,
    fetchUrl: suggestion.fetchUrl ?? null,
    name: suggestion.label,
    sourceType: suggestion.sourceType ?? "website",
    sourceUrl: suggestion.sourceUrl ?? null,
  };
}
