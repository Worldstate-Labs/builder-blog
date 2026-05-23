import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { didYouMeanSearch, relatedSearchSuggestions } from "@/lib/search";
import { searchUserLibrary } from "@/lib/user-search";

const defaultSuggestions = [
  "agent memory",
  "embedding search",
  "builder launch",
  "digest archive",
  "podcast transcript",
];

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!query) {
    return NextResponse.json({ suggestions: defaultSuggestions });
  }

  const { results } = await searchUserLibrary({
    userId: session.user.id,
    query,
    mode: "hybrid",
  });
  const corrected = didYouMeanSearch(query);
  const suggestions = [
    ...(corrected ? [corrected] : []),
    ...relatedSearchSuggestions(query),
    ...results.slice(0, 5).map((result) => result.title),
  ];

  return NextResponse.json({
    suggestions: [...new Set(suggestions)].slice(0, 8),
  });
}
