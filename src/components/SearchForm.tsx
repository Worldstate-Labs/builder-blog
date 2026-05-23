"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Search } from "lucide-react";
import type { SearchDocumentType } from "@/lib/search";

export type SearchTypeFilter = "all" | SearchDocumentType;

export function SearchForm({
  query,
  typeFilter = "all",
}: {
  query: string;
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
        const params = new URLSearchParams();

        if (nextQuery) {
          params.set("q", nextQuery);
        }
        if (typeFilter !== "all") {
          params.set("type", typeFilter);
        }

        startTransition(() => {
          const queryString = params.toString();
          router.push(queryString ? `/search?${queryString}` : "/search");
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
