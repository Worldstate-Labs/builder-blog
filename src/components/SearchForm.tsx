"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Search } from "lucide-react";
import type { SearchDocumentType, SearchMode } from "@/lib/search";

export type SearchTypeFilter = "all" | SearchDocumentType;

export function SearchForm({
  query,
  mode,
  typeFilter = "all",
}: {
  query: string;
  mode: SearchMode;
  typeFilter?: SearchTypeFilter;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action="/search"
      className="search-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const nextQuery = String(formData.get("q") ?? "").trim();
        const nextMode = String(formData.get("mode") ?? mode);
        const params = new URLSearchParams();

        if (nextQuery) {
          params.set("q", nextQuery);
        }
        params.set("mode", nextMode);
        if (typeFilter !== "all") {
          params.set("type", typeFilter);
        }

        startTransition(() => {
          router.push(`/search?${params.toString()}`);
        });
      }}
    >
      <div className="search-form-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search query</span>
          <span className="search-input-wrap">
            <Search className="search-input-icon" />
            <input
              className="search-input"
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search builders, feed items, or digests"
            />
          </span>
        </label>
        <fieldset className="search-mode" disabled={isPending}>
          <legend className="sr-only">Search mode</legend>
          <ModeOption value="semantic" label="Semantic" current={mode} />
          <ModeOption value="exact" label="Exact" current={mode} />
        </fieldset>
        <button
          aria-busy={isPending}
          className="button-dark relative justify-center gap-2"
          disabled={isPending}
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
      </div>
    </form>
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
