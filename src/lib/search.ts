export type SearchMode = "exact" | "semantic" | "hybrid";

export type SearchDocumentType = "builder" | "feed" | "digest";

export type SearchDocument = {
  id: string;
  type: SearchDocumentType;
  title: string;
  body: string;
  url?: string | null;
  sourceName?: string | null;
  date?: Date | null;
};

export type SearchResult = SearchDocument & {
  score: number;
  snippet: string;
};

const semanticSynonyms: Record<string, string[]> = {
  ai: ["agent", "llm", "model"],
  agent: ["agents", "ai", "assistant", "workflow"],
  agents: ["agent", "ai", "assistant", "workflow"],
  archive: ["history", "library", "saved"],
  builder: ["builders", "creator", "developer"],
  builders: ["builder", "creators", "developers"],
  digest: ["summary", "summaries", "feed", "archive"],
  embedding: ["embeddings", "vector", "semantic"],
  embeddings: ["embedding", "vector", "semantic"],
  feed: ["items", "content", "digest"],
  history: ["archive", "past", "saved"],
  library: ["archive", "collection", "pool"],
  llm: ["ai", "model", "agent"],
  recall: ["retrieval", "search", "lookup"],
  retrieval: ["search", "lookup", "recall"],
  search: ["retrieval", "lookup", "recall"],
  semantic: ["meaning", "vector", "embedding"],
  vector: ["embedding", "semantic", "retrieval"],
};

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const typePriority: Record<SearchDocumentType, number> = {
  digest: 0,
  feed: 1,
  builder: 2,
};

export function normalizeSearchMode(value: string | null | undefined): SearchMode {
  if (value === "exact" || value === "semantic") return value;
  return "hybrid";
}

export function candidateSearchTerms(query: string, mode: SearchMode, limit = 12) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  if (mode === "exact") return [normalizedQuery];

  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0) return [normalizedQuery];

  return [...buildWeightedTerms(queryTokens).keys()].slice(0, limit);
}

export function rankSearchDocuments({
  query,
  mode,
  documents,
  limit = 30,
}: {
  query: string;
  mode: SearchMode;
  documents: SearchDocument[];
  limit?: number;
}): SearchResult[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const queryTokens = tokenize(normalizedQuery);
  const weightedTerms =
    mode === "exact" ? new Map<string, number>() : buildWeightedTerms(queryTokens);

  return documents
    .map((document) => {
      const title = normalizeText(document.title);
      const body = normalizeText(document.body);
      const haystack = `${title} ${body}`;
      const exactScore = exactMatchScore(normalizedQuery, title, body);
      const semanticScore =
        mode === "exact" ? 0 : semanticMatchScore(weightedTerms, title, body);
      const score =
        mode === "exact"
          ? exactScore
          : mode === "hybrid"
            ? exactScore * 1.35 + semanticScore
            : Math.max(exactScore, semanticScore);

      if (score <= 0) return null;
      return {
        ...document,
        score,
        snippet: buildSnippet(document, normalizedQuery, queryTokens, haystack),
      };
    })
    .filter((result): result is SearchResult => result !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (typePriority[a.type] !== typePriority[b.type]) {
        return typePriority[a.type] - typePriority[b.type];
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

function exactMatchScore(query: string, title: string, body: string) {
  let score = 0;
  if (title.includes(query)) score += 80;
  if (body.includes(query)) score += 50;
  return score;
}

function semanticMatchScore(
  weightedTerms: Map<string, number>,
  title: string,
  body: string,
) {
  if (weightedTerms.size === 0) return 0;
  const titleTokens = new Set(tokenize(title));
  const bodyTokens = new Set(tokenize(body));
  let score = 0;

  for (const [term, weight] of weightedTerms) {
    if (titleTokens.has(term)) score += weight * 4;
    if (bodyTokens.has(term)) score += weight * 2;
  }

  return score;
}

function buildWeightedTerms(tokens: string[]) {
  const terms = new Map<string, number>();
  for (const token of tokens) {
    addTerm(terms, token, 4);
    for (const synonym of semanticSynonyms[token] ?? []) {
      addTerm(terms, stemToken(synonym), 1.5);
    }
  }
  return terms;
}

function addTerm(terms: Map<string, number>, term: string, weight: number) {
  if (!term || stopWords.has(term)) return;
  terms.set(term, Math.max(terms.get(term) ?? 0, weight));
}

function buildSnippet(
  document: SearchDocument,
  normalizedQuery: string,
  queryTokens: string[],
  normalizedHaystack: string,
) {
  const source = document.body || document.title;
  const normalizedBody = normalizeText(document.body);
  const exactIndex = normalizedBody.indexOf(normalizedQuery);
  if (exactIndex >= 0) {
    return trimSnippet(source, exactIndex, normalizedQuery.length);
  }

  const tokenIndex = queryTokens
    .map((token) => normalizedHaystack.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return trimSnippet(source, tokenIndex ?? 0, 120);
}

function trimSnippet(value: string, index: number, matchLength: number) {
  const start = Math.max(index - 70, 0);
  const end = Math.min(index + Math.max(matchLength, 120), value.length);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < value.length ? "..." : "";
  return `${prefix}${value.slice(start, end).trim()}${suffix}`;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  const matches = normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  return matches.map(stemToken).filter((token) => token && !stopWords.has(token));
}

function stemToken(token: string) {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}
