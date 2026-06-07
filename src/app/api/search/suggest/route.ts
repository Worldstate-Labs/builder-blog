import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { didYouMeanSearch, relatedSearchSuggestions } from "@/lib/search";
import { searchUserLibrary } from "@/lib/user-search";

const defaultSuggestions = [
  "claude",
  "claude ai",
  "claude code",
  "agent memory",
  "embedding search",
  "product launch",
  "AI Digest archive",
  "podcast transcript",
];

type SearchSuggestionItem = {
  query: string;
  label: string;
  detail?: string;
  kind: "query" | "entity" | "result";
};

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!query) {
    return NextResponse.json({
      suggestions: defaultSuggestions,
      items: defaultSuggestions.map((suggestion) => ({
        query: suggestion,
        label: suggestion,
        kind: "query",
      })),
    });
  }

  const { results } = await searchUserLibrary({
    userId: session.user.id,
    query,
    mode: "hybrid",
  });
  const corrected = didYouMeanSearch(query);
  const items: SearchSuggestionItem[] = [];
  const seen = new Set<string>();
  const addItem = (item: SearchSuggestionItem) => {
    const normalized = normalizeSuggestion(item.query);
    if (!normalized || normalized === normalizeSuggestion(query) || seen.has(normalized)) return;
    seen.add(normalized);
    items.push(item);
  };

  if (corrected) {
    addItem({ query: corrected, label: corrected, kind: "query" });
  }

  for (const suggestion of prefixDefaultSuggestions(query)) {
    addItem({ query: suggestion, label: suggestion, kind: "query" });
  }

  for (const suggestion of relatedSearchSuggestions(query)) {
    addItem({ query: suggestion, label: suggestion, kind: "query" });
  }

  for (const result of results.slice(0, 6)) {
    if (result.sourceName) {
      addItem({
        query: result.sourceName,
        label: result.sourceName,
        detail: result.type === "builder" ? result.snippet : resultTypeDetail(result.type),
        kind: "entity",
      });
    }

    addItem({
      query: result.title,
      label: result.title,
      detail: result.sourceName ?? resultTypeDetail(result.type),
      kind: result.type === "builder" ? "entity" : "result",
    });

    for (const completion of titlePrefixCompletions(query, result.title)) {
      addItem({ query: completion, label: completion, kind: "query" });
    }
  }

  return NextResponse.json({
    suggestions: items.map((item) => item.query).slice(0, 8),
    items: items.slice(0, 8),
  });
}

function prefixDefaultSuggestions(query: string) {
  const normalizedQuery = normalizeSuggestion(query);
  return defaultSuggestions.filter((suggestion) => normalizeSuggestion(suggestion).startsWith(normalizedQuery));
}

function titlePrefixCompletions(query: string, title: string) {
  const normalizedQuery = normalizeSuggestion(query);
  const words = title
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}@._-]/gu, ""))
    .filter(Boolean);
  const completions: string[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const phrase = words.slice(index, index + 3).join(" ");
    if (normalizeSuggestion(phrase).startsWith(normalizedQuery)) {
      completions.push(phrase);
    }
  }

  return completions;
}

function resultTypeDetail(type: string) {
  if (type === "builder") return "Source";
  if (type === "feed") return "Post";
  if (type === "digest") return "AI Digest";
  return "Library item";
}

function normalizeSuggestion(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
