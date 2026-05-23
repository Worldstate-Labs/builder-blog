export type SearchMode = "exact" | "semantic" | "hybrid";
export type SearchSort = "relevance" | "newest";
export type SearchTimeRange = "any" | "day" | "week" | "month" | "year";

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

export type SearchProximityPair = {
  left: string;
  right: string;
  distance: number;
};

export type ParsedSearchQuery = {
  rawQuery: string;
  cleanQuery: string;
  phrases: string[];
  requiredTerms: string[];
  excludedTerms: string[];
  orTerms: string[];
  proximityPairs: SearchProximityPair[];
  bodyTerms: string[];
  titleTerms: string[];
  urlTerms: string[];
  site: string | null;
  excludedSites: string[];
  type: SearchDocumentType | null;
  typeOperator: "filetype" | "type" | null;
  after: Date | null;
  before: Date | null;
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

const typoCorrections: Record<string, string> = {
  agnet: "agent",
  archvie: "archive",
  buidler: "builder",
  buidlers: "builders",
  digset: "digest",
  emebdding: "embedding",
  memroy: "memory",
  retrival: "retrieval",
  seach: "search",
  serach: "search",
  semnatic: "semantic",
  sumarize: "summarize",
};

export function normalizeSearchMode(value: string | null | undefined): SearchMode {
  if (value === "exact" || value === "semantic") return value;
  return "hybrid";
}

export function normalizeSearchSort(value: string | null | undefined): SearchSort {
  return value === "newest" ? "newest" : "relevance";
}

export function normalizeSearchTime(value: string | null | undefined): SearchTimeRange {
  if (value === "day" || value === "week" || value === "month" || value === "year") {
    return value;
  }
  return "any";
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const rawQuery = query.trim();
  const phrases: string[] = [];
  const working = rawQuery.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const normalizedPhrase = normalizeText(phrase);
    if (normalizedPhrase) phrases.push(normalizedPhrase);
    return ` ${normalizedPhrase} `;
  });
  const excludedTerms: string[] = [];
  const bodyTerms: string[] = [];
  const titleTerms: string[] = [];
  const urlTerms: string[] = [];
  const excludedSites: string[] = [];
  let site: string | null = null;
  let type: SearchDocumentType | null = null;
  let typeOperator: ParsedSearchQuery["typeOperator"] = null;
  let after: Date | null = null;
  let before: Date | null = null;
  const cleanParts: string[] = [];
  const parts = working.split(/\s+/);

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const token = part.trim();
    if (!token) continue;
    const lower = token.toLowerCase();
    if (lower.startsWith("-site:")) {
      const excludedSite = normalizeSiteOperatorValue(lower.slice(6));
      if (excludedSite) excludedSites.push(excludedSite);
      continue;
    }
    if (lower.startsWith("site:")) {
      site = normalizeSiteOperatorValue(lower.slice(5)) || site;
      continue;
    }
    if (
      lower.startsWith("allintext:") ||
      lower.startsWith("allintitle:") ||
      lower.startsWith("allinurl:")
    ) {
      const isTitleScope = lower.startsWith("allintitle:");
      const isTextScope = lower.startsWith("allintext:");
      const scope = collectScopedOperatorTerms(
        parts,
        index,
        token.slice(isTextScope ? 10 : isTitleScope ? 11 : 9),
      );
      const targetTerms = isTextScope ? bodyTerms : isTitleScope ? titleTerms : urlTerms;
      for (const term of scope.terms) {
        targetTerms.push(term);
        cleanParts.push(term);
      }
      index = scope.nextIndex;
      continue;
    }
    if (lower.startsWith("text:") || lower.startsWith("intext:")) {
      const bodyTerm = normalizeText(lower.startsWith("text:") ? token.slice(5) : token.slice(7));
      if (bodyTerm) {
        bodyTerms.push(bodyTerm);
        cleanParts.push(bodyTerm);
      }
      continue;
    }
    if (lower.startsWith("title:") || lower.startsWith("intitle:")) {
      const titleTerm = normalizeText(lower.startsWith("title:") ? token.slice(6) : token.slice(8));
      if (titleTerm) {
        titleTerms.push(titleTerm);
        cleanParts.push(titleTerm);
      }
      continue;
    }
    if (lower.startsWith("url:") || lower.startsWith("inurl:")) {
      const urlTerm = normalizeText(lower.startsWith("url:") ? token.slice(4) : token.slice(6));
      if (urlTerm) {
        urlTerms.push(urlTerm);
        cleanParts.push(urlTerm);
      }
      continue;
    }
    if (lower.startsWith("type:") || lower.startsWith("filetype:")) {
      const isFiletype = lower.startsWith("filetype:");
      const candidate = normalizeTypeOperatorValue(lower.slice(isFiletype ? 9 : 5));
      if (candidate) {
        type = candidate;
        typeOperator = isFiletype ? "filetype" : "type";
      }
      continue;
    }
    if (lower.startsWith("after:")) {
      after = parseDateOperator(lower.slice(6)) ?? after;
      continue;
    }
    if (lower.startsWith("before:")) {
      before = parseDateOperator(lower.slice(7)) ?? before;
      continue;
    }
    if (lower.startsWith("-") && lower.length > 1) {
      excludedTerms.push(stemToken(lower.slice(1)));
      continue;
    }
    cleanParts.push(token);
  }

  const orTerms = extractOrTerms(cleanParts);
  const proximityPairs = extractProximityPairs(cleanParts);
  const cleanQuery = normalizeText(
    cleanParts
      .filter((part) => part.toLowerCase() !== "or" && !parseAroundOperator(part))
      .join(" "),
  );
  return {
    rawQuery,
    cleanQuery,
    phrases,
    requiredTerms: tokenize(cleanQuery),
    excludedTerms,
    orTerms,
    proximityPairs,
    bodyTerms,
    titleTerms,
    urlTerms,
    site,
    excludedSites,
    type,
    typeOperator,
    after,
    before,
  };
}

export function candidateSearchTerms(query: string, mode: SearchMode, limit = 12) {
  const parsed = parseSearchQuery(query);
  const normalizedQuery = parsed.cleanQuery;
  if (!normalizedQuery) return [];
  if (mode === "exact" && parsed.orTerms.length > 0) return parsed.orTerms.slice(0, limit);
  if (mode === "exact") return [normalizedQuery];

  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0) return [normalizedQuery];

  return [...buildWeightedTerms(queryTokens).keys()].slice(0, limit);
}

export function relatedSearchSuggestions(query: string, limit = 6) {
  const normalizedQuery = parseSearchQuery(query).cleanQuery;
  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0) return [];

  const suggestions: string[] = [];
  const seen = new Set([normalizedQuery]);
  for (const token of queryTokens) {
    const synonyms = semanticSynonyms[token] ?? [];
    for (const synonym of synonyms) {
      const suggestion = normalizedQuery
        .split(" ")
        .map((part) => (stemToken(part) === token ? synonym : part))
        .join(" ");
      if (!seen.has(suggestion)) {
        seen.add(suggestion);
        suggestions.push(suggestion);
      }
      if (suggestions.length >= limit) return suggestions;
    }
  }

  return suggestions;
}

export function didYouMeanSearch(query: string) {
  const parsed = parseSearchQuery(query);
  if (!parsed.cleanQuery) return null;
  const corrected = parsed.cleanQuery
    .split(" ")
    .map((token) => typoCorrections[token] ?? token)
    .join(" ");
  return corrected !== parsed.cleanQuery ? corrected : null;
}

export function mergeSearchSuggestions({
  query,
  recentSearches = [],
  liveSuggestions = [],
  serverSuggestions = [],
  limit = 8,
}: {
  query: string;
  recentSearches?: string[];
  liveSuggestions?: string[];
  serverSuggestions?: string[];
  limit?: number;
}) {
  const normalizedQuery = normalizeText(query);
  const seen = new Set<string>();
  const merged: string[] = [];
  const addSuggestion = (suggestion: string) => {
    const trimmed = suggestion.trim();
    const normalized = normalizeText(trimmed);
    if (!trimmed || normalized === normalizedQuery || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(trimmed);
  };

  for (const suggestion of recentSearches) addSuggestion(suggestion);
  for (const suggestion of liveSuggestions) addSuggestion(suggestion);
  for (const suggestion of serverSuggestions) addSuggestion(suggestion);

  return merged.slice(0, limit);
}

export function normalizeRecentSearches(value: unknown, limit = 5) {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const recentSearches: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    const normalized = normalizeText(trimmed);
    if (!trimmed || seen.has(normalized)) continue;
    seen.add(normalized);
    recentSearches.push(trimmed);
    if (recentSearches.length >= limit) break;
  }

  return recentSearches;
}

export function shouldUseCorrectedSearch({
  correctedQuery,
  originalResultCount,
}: {
  correctedQuery: string | null;
  originalResultCount: number;
}) {
  return Boolean(correctedQuery?.trim()) && originalResultCount === 0;
}

export function rankSearchDocuments({
  query,
  mode,
  documents,
  limit = 30,
  sort = "relevance",
  time = "any",
}: {
  query: string;
  mode: SearchMode;
  documents: SearchDocument[];
  limit?: number;
  sort?: SearchSort;
  time?: SearchTimeRange;
}): SearchResult[] {
  const parsedQuery = parseSearchQuery(query);
  const normalizedQuery = parsedQuery.cleanQuery;
  if (!normalizedQuery) return [];

  const queryTokens = tokenize(normalizedQuery);
  const weightedTerms =
    mode === "exact" ? new Map<string, number>() : buildWeightedTerms(queryTokens);
  const timeBounds = searchTimeBounds(time);

  return documents
    .filter((document) => documentMatchesFilters(document, parsedQuery, timeBounds))
    .map((document) => {
      const title = normalizeText(document.title);
      const body = normalizeText(document.body);
      const haystack = `${title} ${body}`;
      const exactScore = exactMatchScore(normalizedQuery, title, body, parsedQuery.orTerms);
      const phraseScore = phraseMatchScore(parsedQuery.phrases, title, body);
      const proximityScore = proximityMatchScore(parsedQuery.proximityPairs, title, body);
      const semanticScore =
        mode === "exact" ? 0 : semanticMatchScore(weightedTerms, title, body);
      const score =
        mode === "exact"
          ? Math.max(exactScore, phraseScore, proximityScore)
          : mode === "hybrid"
            ? exactScore * 1.35 + phraseScore * 1.35 + proximityScore * 1.2 + semanticScore
            : Math.max(exactScore, phraseScore, proximityScore, semanticScore);

      if (score <= 0) return null;
      return {
        ...document,
        score,
        snippet: buildSnippet(document, normalizedQuery, queryTokens, haystack),
      };
    })
    .filter((result): result is SearchResult => result !== null)
    .sort((a, b) => {
      if (sort === "newest") {
        const dateDiff = (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
        if (dateDiff !== 0) return dateDiff;
      }
      if (b.score !== a.score) return b.score - a.score;
      if (typePriority[a.type] !== typePriority[b.type]) {
        return typePriority[a.type] - typePriority[b.type];
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

function documentMatchesFilters(
  document: SearchDocument,
  parsedQuery: ParsedSearchQuery,
  timeBounds: { after: Date | null; before: Date | null },
) {
  const title = normalizeText(document.title);
  const body = normalizeText(document.body);
  const url = normalizeText(document.url ?? "");
  const source = normalizeText(document.sourceName ?? "");
  const haystack = `${title} ${body} ${url} ${source}`;

  if (parsedQuery.type && document.type !== parsedQuery.type) return false;
  if (parsedQuery.site && !urlHostMatches(document.url, parsedQuery.site)) return false;
  if (parsedQuery.excludedSites.some((site) => urlHostMatches(document.url, site))) return false;
  if (parsedQuery.bodyTerms.some((term) => !body.includes(term))) return false;
  if (parsedQuery.titleTerms.some((term) => !title.includes(term))) return false;
  if (parsedQuery.urlTerms.some((term) => !url.includes(term))) return false;
  if (
    parsedQuery.orTerms.length > 0 &&
    parsedQuery.orTerms.every((term) => !haystack.includes(term))
  ) {
    return false;
  }
  if (parsedQuery.proximityPairs.some((pair) => !proximityMatches(haystack, pair))) {
    return false;
  }
  if (parsedQuery.phrases.some((phrase) => !phraseMatches(haystack, phrase))) return false;
  if (parsedQuery.excludedTerms.some((term) => haystack.includes(term))) return false;

  const date = document.date ?? null;
  const after = parsedQuery.after ?? timeBounds.after;
  const before = parsedQuery.before ?? timeBounds.before;
  if (after && (!date || date < after)) return false;
  if (before && (!date || date > before)) return false;

  return true;
}

function exactMatchScore(
  query: string,
  title: string,
  body: string,
  alternatives: string[] = [],
): number {
  if (alternatives.length > 0) {
    return Math.max(
      ...alternatives.map((alternative) => exactMatchScore(alternative, title, body)),
    );
  }
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

function phraseMatchScore(phrases: string[], title: string, body: string) {
  if (phrases.length === 0) return 0;
  const titleScore = phrases.filter((phrase) => phraseMatches(title, phrase)).length * 85;
  const bodyScore = phrases.filter((phrase) => phraseMatches(body, phrase)).length * 55;
  return titleScore + bodyScore;
}

function proximityMatchScore(
  proximityPairs: SearchProximityPair[],
  title: string,
  body: string,
) {
  if (proximityPairs.length === 0) return 0;
  const titleScore = proximityPairs.filter((pair) => proximityMatches(title, pair)).length * 90;
  const bodyScore = proximityPairs.filter((pair) => proximityMatches(body, pair)).length * 60;
  return titleScore + bodyScore;
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

function normalizeTypeOperatorValue(value: string): SearchDocumentType | null {
  const singular = value.endsWith("s") ? value.slice(0, -1) : value;
  if (singular === "builder" || singular === "feed" || singular === "digest") return singular;
  return null;
}

function normalizeSiteOperatorValue(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "";
}

function collectScopedOperatorTerms(
  parts: string[],
  startIndex: number,
  firstValue: string,
) {
  const terms: string[] = [];
  const firstTerm = normalizeScopedTerm(firstValue);
  if (firstTerm) terms.push(firstTerm);
  let nextIndex = startIndex;

  for (let index = startIndex + 1; index < parts.length; index += 1) {
    const token = parts[index].trim();
    if (!token || isOperatorBoundaryToken(token)) break;
    const term = normalizeScopedTerm(token);
    if (term) terms.push(term);
    nextIndex = index;
  }

  return { terms, nextIndex };
}

function isOperatorBoundaryToken(token: string) {
  const lower = token.toLowerCase();
  return (
    lower === "or" ||
    lower.startsWith("-") ||
    parseAroundOperator(lower) !== null ||
    lower.startsWith("site:") ||
    lower.startsWith("text:") ||
    lower.startsWith("intext:") ||
    lower.startsWith("allintext:") ||
    lower.startsWith("title:") ||
    lower.startsWith("intitle:") ||
    lower.startsWith("allintitle:") ||
    lower.startsWith("url:") ||
    lower.startsWith("inurl:") ||
    lower.startsWith("allinurl:") ||
    lower.startsWith("type:") ||
    lower.startsWith("filetype:") ||
    lower.startsWith("after:") ||
    lower.startsWith("before:")
  );
}

function normalizeScopedTerm(value: string) {
  return normalizeText(value);
}

function phraseMatches(value: string, phrase: string) {
  if (!phrase.includes("*")) return value.includes(phrase);

  const tokens = phraseTokens(value);
  const pattern = normalizeText(phrase)
    .split(/\s+/)
    .map((part) => (part === "*" ? part : stemToken(part)))
    .filter(Boolean);

  if (pattern.length === 0 || pattern.length > tokens.length) return false;

  for (let index = 0; index <= tokens.length - pattern.length; index += 1) {
    if (pattern.every((part, offset) => part === "*" || tokens[index + offset] === part)) {
      return true;
    }
  }

  return false;
}

function phraseTokens(value: string) {
  return normalizeText(value).match(/[\p{L}\p{N}]+/gu)?.map(stemToken) ?? [];
}

function parseDateOperator(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractOrTerms(parts: string[]) {
  const terms = new Set<string>();

  for (let index = 1; index < parts.length - 1; index += 1) {
    if (parts[index].toLowerCase() !== "or") continue;

    for (const candidate of [parts[index - 1], parts[index + 1]]) {
      const term = normalizeText(candidate);
      if (term && term !== "or") terms.add(term);
    }
  }

  return [...terms];
}

function extractProximityPairs(parts: string[]) {
  const pairs: SearchProximityPair[] = [];

  for (let index = 1; index < parts.length - 1; index += 1) {
    const distance = parseAroundOperator(parts[index]);
    if (distance === null) continue;

    const left = normalizeProximityTerm(parts[index - 1]);
    const right = normalizeProximityTerm(parts[index + 1]);
    if (left && right) pairs.push({ left, right, distance });
  }

  return pairs;
}

function parseAroundOperator(value: string) {
  const match = value.match(/^around\((\d{1,2})\)$/i);
  if (!match) return null;
  return Math.max(0, Number(match[1]));
}

function normalizeProximityTerm(value: string) {
  return tokenize(value)[0] ?? "";
}

function proximityMatches(value: string, pair: SearchProximityPair) {
  const tokens = tokenize(value);
  const leftIndexes = tokenIndexes(tokens, pair.left);
  const rightIndexes = tokenIndexes(tokens, pair.right);

  return leftIndexes.some((leftIndex) =>
    rightIndexes.some((rightIndex) => Math.abs(leftIndex - rightIndex) - 1 <= pair.distance),
  );
}

function tokenIndexes(tokens: string[], term: string) {
  const indexes: number[] = [];
  tokens.forEach((token, index) => {
    if (token === term) indexes.push(index);
  });
  return indexes;
}

function searchTimeBounds(time: SearchTimeRange) {
  if (time === "any") return { after: null, before: null };
  const now = Date.now();
  const days = time === "day" ? 1 : time === "week" ? 7 : time === "month" ? 31 : 365;
  return {
    after: new Date(now - days * 24 * 60 * 60 * 1000),
    before: null,
  };
}

function urlHostMatches(url: string | null | undefined, site: string) {
  if (!url) return false;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    return host === site || host.endsWith(`.${site}`);
  } catch {
    return normalizeText(url).includes(site);
  }
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
