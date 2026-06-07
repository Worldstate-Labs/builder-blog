export type SearchMode = "exact" | "semantic" | "hybrid";
export type SearchSort = "relevance" | "newest";
export type SearchTimeRange = "any" | "day" | "week" | "month" | "year";

export type SearchDocumentType = "builder" | "feed" | "digest";

export function searchDocumentTypeParamValue(type: SearchDocumentType): string {
  if (type === "builder") return "source";
  if (type === "feed") return "post";
  return "ai-digest";
}

export type SearchDocument = {
  id: string;
  type: SearchDocumentType;
  title: string;
  body: string;
  avatarUrl?: string | null;
  externalUrl?: string | null;
  fetchUrl?: string | null;
  sourceUrl?: string | null;
  url?: string | null;
  sourceName?: string | null;
  sourceType?: string | null;
  date?: Date | null;
};

export type SearchResult = SearchDocument & {
  score: number;
  snippet: string;
};

type SearchRankCandidate = SearchResult & {
  exactLaneScore: number;
  semanticLaneScore: number;
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
  requiredPhrases: string[];
  excludedPhrases: string[];
  requiredTerms: string[];
  requiredOperatorTerms: string[];
  excludedTerms: string[];
  orPhrases: string[];
  orContextTerms: string[];
  orTerms: string[];
  proximityPairs: SearchProximityPair[];
  bodyTerms: string[];
  titleTerms: string[];
  urlTerms: string[];
  excludedBodyTerms: string[];
  excludedTitleTerms: string[];
  excludedUrlTerms: string[];
  excludedAllBodyTermGroups: string[][];
  excludedAllTitleTermGroups: string[][];
  excludedAllUrlTermGroups: string[][];
  site: string | null;
  excludedSites: string[];
  excludedTypes: SearchDocumentType[];
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
  const orPhrases = collectOrPhrases(rawQuery);
  const orContextTerms = collectParenthesizedOrContextTerms(rawQuery);
  const orPhraseSet = new Set(orPhrases);
  const phrases: string[] = [];
  const requiredPhrases: string[] = [];
  const excludedPhrases: string[] = [];
  const withoutExcludedPhrases = rawQuery.replace(
    /(^|\s)-"([^"]+)"/g,
    (_, prefix: string, phrase: string) => {
      const normalizedPhrase = normalizeText(phrase);
      if (normalizedPhrase) excludedPhrases.push(normalizedPhrase);
      return `${prefix} `;
    },
  );
  const withoutRequiredPhrases = withoutExcludedPhrases.replace(
    /(^|\s)\+"([^"]+)"/g,
    (_, prefix: string, phrase: string) => {
      const normalizedPhrase = normalizeText(phrase);
      if (normalizedPhrase) requiredPhrases.push(normalizedPhrase);
      return `${prefix} ${normalizedPhrase} `;
    },
  );
  const working = withoutRequiredPhrases.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const normalizedPhrase = normalizeText(phrase);
    if (normalizedPhrase && !orPhraseSet.has(normalizedPhrase)) phrases.push(normalizedPhrase);
    return ` ${normalizedPhrase} `;
  });
  const excludedTerms: string[] = [];
  const requiredOperatorTerms: string[] = [];
  const bodyTerms: string[] = [];
  const titleTerms: string[] = [];
  const urlTerms: string[] = [];
  const excludedBodyTerms: string[] = [];
  const excludedTitleTerms: string[] = [];
  const excludedUrlTerms: string[] = [];
  const excludedAllBodyTermGroups: string[][] = [];
  const excludedAllTitleTermGroups: string[][] = [];
  const excludedAllUrlTermGroups: string[][] = [];
  const excludedSites: string[] = [];
  const excludedTypes: SearchDocumentType[] = [];
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
    if (lower.startsWith("-type:") || lower.startsWith("-filetype:")) {
      const isFiletype = lower.startsWith("-filetype:");
      const candidate = normalizeTypeOperatorValue(lower.slice(isFiletype ? 10 : 6));
      if (candidate) excludedTypes.push(candidate);
      continue;
    }
    if (
      lower.startsWith("-allintext:") ||
      lower.startsWith("-allintitle:") ||
      lower.startsWith("-allinurl:")
    ) {
      const isTitleScope = lower.startsWith("-allintitle:");
      const isTextScope = lower.startsWith("-allintext:");
      const scope = collectScopedOperatorTerms(
        parts,
        index,
        token.slice(isTextScope ? 11 : isTitleScope ? 12 : 10),
      );
      const targetGroups = isTextScope
        ? excludedAllBodyTermGroups
        : isTitleScope
          ? excludedAllTitleTermGroups
          : excludedAllUrlTermGroups;
      if (scope.terms.length > 0) targetGroups.push(scope.terms);
      index = scope.nextIndex;
      continue;
    }
    if (lower.startsWith("-text:") || lower.startsWith("-intext:")) {
      const bodyTerm = normalizeText(lower.startsWith("-text:") ? token.slice(6) : token.slice(8));
      if (bodyTerm) excludedBodyTerms.push(bodyTerm);
      continue;
    }
    if (lower.startsWith("-title:") || lower.startsWith("-intitle:")) {
      const titleTerm = normalizeText(
        lower.startsWith("-title:") ? token.slice(7) : token.slice(9),
      );
      if (titleTerm) excludedTitleTerms.push(titleTerm);
      continue;
    }
    if (lower.startsWith("-url:") || lower.startsWith("-inurl:")) {
      const urlTerm = normalizeText(lower.startsWith("-url:") ? token.slice(5) : token.slice(7));
      if (urlTerm) excludedUrlTerms.push(urlTerm);
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
    if (lower.startsWith("+") && lower.length > 1) {
      const requiredTerm = normalizeText(token.slice(1));
      if (requiredTerm) {
        requiredOperatorTerms.push(stemToken(requiredTerm));
        cleanParts.push(requiredTerm);
      }
      continue;
    }
    if (lower.startsWith("-") && lower.length > 1) {
      excludedTerms.push(stemToken(lower.slice(1)));
      continue;
    }
    cleanParts.push(token);
  }

  const orPhraseTokens = new Set(orPhrases.flatMap(tokenize));
  const orTerms = extractOrTerms(cleanParts).filter((term) => !orPhraseTokens.has(term));
  const proximityPairs = extractProximityPairs(cleanParts);
  const cleanQuery = normalizeText(
    cleanParts
      .filter((part) => part.toLowerCase() !== "or" && !parseAroundOperator(part))
      .join(" ")
      .replace(/[()]/g, " "),
  );
  return {
    rawQuery,
    cleanQuery,
    phrases,
    requiredPhrases,
    excludedPhrases,
    requiredTerms: tokenize(cleanQuery),
    requiredOperatorTerms,
    excludedTerms,
    orPhrases,
    orContextTerms,
    orTerms,
    proximityPairs,
    bodyTerms,
    titleTerms,
    urlTerms,
    excludedBodyTerms,
    excludedTitleTerms,
    excludedUrlTerms,
    excludedAllBodyTermGroups,
    excludedAllTitleTermGroups,
    excludedAllUrlTermGroups,
    site,
    excludedSites,
    excludedTypes,
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
  const exactAlternatives = [...parsed.orPhrases, ...parsed.orTerms];
  if (mode === "exact" && exactAlternatives.length > 0) {
    return exactAlternatives.slice(0, limit);
  }
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

export function searchHighlightTerms(query: string, limit = 8) {
  const parsed = parseSearchQuery(query);
  const terms = new Set<string>();
  const phraseTerms = [
    ...parsed.phrases.filter((phrase) => !phrase.includes("*")),
    ...parsed.requiredPhrases.filter((phrase) => !phrase.includes("*")),
    ...parsed.orPhrases.filter((phrase) => !phrase.includes("*")),
  ];

  for (const term of [
    ...phraseTerms,
    ...parsed.titleTerms,
    ...parsed.bodyTerms,
    ...parsed.urlTerms,
    ...parsed.orTerms,
    ...parsed.requiredOperatorTerms,
    ...parsed.requiredTerms.filter(
      (term) => !phraseTerms.some((phrase) => phrase.split(" ").includes(term)),
    ),
  ]) {
    const normalizedTerm = term.trim();
    if (normalizedTerm.length > 1) terms.add(normalizedTerm);
  }

  return [...terms].sort((a, b) => b.length - a.length).slice(0, limit);
}

export function searchSiteFromUrl(url: string | null | undefined) {
  if (!url || url.startsWith("/")) return null;

  try {
    return normalizeSiteOperatorValue(new URL(url).hostname);
  } catch {
    return null;
  }
}

export function withSiteSearchOperator(query: string, site: string) {
  const normalizedSite = normalizeSiteOperatorValue(site);
  if (!normalizedSite) return query.trim();

  const withoutPositiveSite = query
    .replace(/(^|\s)site:\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [withoutPositiveSite, `site:${normalizedSite}`].filter(Boolean).join(" ");
}

export function withDateSearchOperators(
  query: string,
  {
    after,
    before,
  }: {
    after?: string | null | undefined;
    before?: string | null | undefined;
  },
) {
  const cleanQuery = query
    .replace(/(^|\s)(after|before):\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const afterDate = normalizeDateOperatorInput(after);
  const beforeDate = normalizeDateOperatorInput(before);

  return [
    cleanQuery,
    afterDate ? `after:${afterDate}` : "",
    beforeDate ? `before:${beforeDate}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function stripSearchQueryOperators(query: string, operators: string[]) {
  const prefixes = new Set(operators.map((operator) => `${operator.toLowerCase()}:`));
  return stripOperatorTokens(query, prefixes, "allin");
}

export function stripNegativeSearchQueryOperators(query: string, operators: string[]) {
  const prefixes = new Set(operators.map((operator) => `-${operator.toLowerCase()}:`));
  return stripOperatorTokens(query, prefixes, "-allin");
}

function stripOperatorTokens(query: string, prefixes: Set<string>, allInPrefix: string) {
  const tokens = query.split(/\s+/);
  const kept: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const prefix = token.toLowerCase().split(":")[0] + ":";
    if (!prefixes.has(prefix)) {
      kept.push(token);
      continue;
    }

    if (prefix.startsWith(allInPrefix)) {
      while (index + 1 < tokens.length && !isOperatorBoundaryToken(tokens[index + 1])) {
        index += 1;
      }
    }
  }

  return kept.join(" ").trim();
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
  const hasQuery = normalizedQuery.length > 0;
  const matchingRecentSearches = recentSearches.filter((suggestion) => {
    if (!hasQuery) return true;
    return normalizeText(suggestion).includes(normalizedQuery);
  });
  const addSuggestion = (suggestion: string) => {
    const trimmed = suggestion.trim();
    const normalized = normalizeText(trimmed);
    if (!trimmed || normalized === normalizedQuery || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(trimmed);
  };

  if (!hasQuery) {
    for (const suggestion of matchingRecentSearches) addSuggestion(suggestion);
  }
  for (const suggestion of liveSuggestions) addSuggestion(suggestion);
  for (const suggestion of serverSuggestions) addSuggestion(suggestion);
  if (hasQuery) {
    for (const suggestion of matchingRecentSearches) addSuggestion(suggestion);
  }

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
  const isFilterOnlyQuery = !normalizedQuery && hasSearchFilters(parsedQuery);
  if (!normalizedQuery && !isFilterOnlyQuery) return [];

  const queryTokens = tokenize(normalizedQuery);
  const weightedTerms =
    mode === "exact" ? new Map<string, number>() : buildWeightedTerms(queryTokens);
  const timeBounds = searchTimeBounds(time);

  const candidates = documents
    .filter((document) => documentMatchesFilters(document, parsedQuery, timeBounds))
    .map((document) => {
      const title = normalizeText(document.title);
      const body = normalizeText(document.body);
      const exactScore = exactMatchScore(normalizedQuery, title, body, [
        ...parsedQuery.orPhrases,
        ...parsedQuery.orTerms,
      ]);
      const phraseScore = phraseMatchScore(parsedQuery.phrases, title, body);
      const proximityScore = proximityMatchScore(parsedQuery.proximityPairs, title, body);
      const semanticScore =
        mode === "exact" ? 0 : semanticMatchScore(weightedTerms, title, body);
      const exactLaneScore = Math.max(exactScore, phraseScore, proximityScore);
      const score = isFilterOnlyQuery
        ? 1
        : mode === "exact"
          ? exactLaneScore
          : mode === "hybrid"
            ? 0
            : Math.max(exactLaneScore, semanticScore);

      return {
        ...document,
        score,
        exactLaneScore,
        semanticLaneScore: semanticScore,
        snippet: buildSnippet(document, normalizedQuery, queryTokens, [
          ...parsedQuery.phrases,
          ...parsedQuery.requiredPhrases,
          ...parsedQuery.orPhrases,
        ]),
      };
    });

  const rankedCandidates =
    mode === "hybrid" && !isFilterOnlyQuery
      ? rankHybridCandidates(
          applyHybridScores(candidates).filter((candidate) => candidate.score > 0),
          sort,
        )
      : candidates
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => compareRankCandidates(a, b, sort));

  return rankedCandidates.slice(0, limit).map(stripRankCandidateScores);
}

function applyHybridScores(candidates: SearchRankCandidate[]) {
  const maxExactScore = Math.max(0, ...candidates.map((candidate) => candidate.exactLaneScore));
  const maxSemanticScore = Math.max(0, ...candidates.map((candidate) => candidate.semanticLaneScore));

  return candidates.map((candidate) => ({
    ...candidate,
    score:
      normalizedLaneScore(candidate.exactLaneScore, maxExactScore) * 50 +
      normalizedLaneScore(candidate.semanticLaneScore, maxSemanticScore) * 50,
  }));
}

function normalizedLaneScore(score: number, maxScore: number) {
  if (score <= 0 || maxScore <= 0) return 0;
  return score / maxScore;
}

function rankHybridCandidates(candidates: SearchRankCandidate[], sort: SearchSort) {
  if (sort === "newest") return [...candidates].sort((a, b) => compareRankCandidates(a, b, sort));

  const rankedByHybrid = [...candidates].sort((a, b) => compareRankCandidates(a, b, "relevance"));
  const exactLeaders = [...candidates]
    .filter((candidate) => candidate.exactLaneScore > 0)
    .sort((a, b) => compareLaneCandidates(a, b, "exact"))
    .slice(0, 2);
  const exactLeaderIds = new Set(exactLeaders.map((candidate) => candidate.id));
  const semanticLeaders = [...candidates]
    .filter((candidate) => candidate.semanticLaneScore > 0 && !exactLeaderIds.has(candidate.id))
    .sort((a, b) => compareLaneCandidates(a, b, "semantic"))
    .slice(0, 2);
  const topFour = uniqueCandidates([...exactLeaders, ...semanticLeaders]);

  for (const candidate of rankedByHybrid) {
    if (topFour.length >= 4) break;
    if (!topFour.some((leader) => leader.id === candidate.id)) topFour.push(candidate);
  }

  const topFourIds = new Set(topFour.map((candidate) => candidate.id));
  const sortedTopFour = [...topFour].sort((a, b) => compareRankCandidates(a, b, "relevance"));
  const rest = rankedByHybrid.filter((candidate) => !topFourIds.has(candidate.id));
  return [...sortedTopFour, ...rest];
}

function uniqueCandidates(candidates: SearchRankCandidate[]) {
  const seen = new Set<string>();
  const unique: SearchRankCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    unique.push(candidate);
  }
  return unique;
}

function compareLaneCandidates(
  a: SearchRankCandidate,
  b: SearchRankCandidate,
  lane: "exact" | "semantic",
) {
  const laneKey = lane === "exact" ? "exactLaneScore" : "semanticLaneScore";
  if (b[laneKey] !== a[laneKey]) return b[laneKey] - a[laneKey];
  return compareRankCandidates(a, b, "relevance");
}

function compareRankCandidates(a: SearchRankCandidate, b: SearchRankCandidate, sort: SearchSort) {
  if (sort === "newest") {
    const dateDiff = (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
    if (dateDiff !== 0) return dateDiff;
  }
  if (b.score !== a.score) return b.score - a.score;
  if (typePriority[a.type] !== typePriority[b.type]) {
    return typePriority[a.type] - typePriority[b.type];
  }
  return a.title.localeCompare(b.title);
}

function stripRankCandidateScores(candidate: SearchRankCandidate): SearchResult {
  return {
    id: candidate.id,
    type: candidate.type,
    title: candidate.title,
    body: candidate.body,
    externalUrl: candidate.externalUrl,
    url: candidate.url,
    sourceName: candidate.sourceName,
    date: candidate.date,
    score: candidate.score,
    snippet: candidate.snippet,
  };
}

function hasSearchFilters(parsedQuery: ParsedSearchQuery) {
  return Boolean(
    parsedQuery.requiredPhrases.length ||
      parsedQuery.excludedPhrases.length ||
      parsedQuery.requiredOperatorTerms.length ||
      parsedQuery.excludedTerms.length ||
      parsedQuery.orPhrases.length ||
      parsedQuery.orContextTerms.length ||
      parsedQuery.orTerms.length ||
      parsedQuery.proximityPairs.length ||
      parsedQuery.bodyTerms.length ||
      parsedQuery.titleTerms.length ||
      parsedQuery.urlTerms.length ||
      parsedQuery.excludedBodyTerms.length ||
      parsedQuery.excludedTitleTerms.length ||
      parsedQuery.excludedUrlTerms.length ||
      parsedQuery.excludedAllBodyTermGroups.length ||
      parsedQuery.excludedAllTitleTermGroups.length ||
      parsedQuery.excludedAllUrlTermGroups.length ||
      parsedQuery.site ||
      parsedQuery.excludedSites.length ||
      parsedQuery.excludedTypes.length ||
      parsedQuery.type ||
      parsedQuery.after ||
      parsedQuery.before,
  );
}

function documentMatchesFilters(
  document: SearchDocument,
  parsedQuery: ParsedSearchQuery,
  timeBounds: { after: Date | null; before: Date | null },
) {
  const title = normalizeText(document.title);
  const body = normalizeText(document.body);
  const url = normalizeText([document.url ?? "", document.externalUrl ?? ""].join(" "));
  const source = normalizeText(document.sourceName ?? "");
  const haystack = `${title} ${body} ${url} ${source}`;

  if (parsedQuery.type && document.type !== parsedQuery.type) return false;
  if (parsedQuery.excludedTypes.includes(document.type)) return false;
  if (parsedQuery.site && !documentSiteMatches(document, parsedQuery.site)) return false;
  if (parsedQuery.excludedSites.some((site) => documentSiteMatches(document, site))) return false;
  if (parsedQuery.bodyTerms.some((term) => !body.includes(term))) return false;
  if (parsedQuery.titleTerms.some((term) => !title.includes(term))) return false;
  if (parsedQuery.urlTerms.some((term) => !url.includes(term))) return false;
  if (parsedQuery.excludedBodyTerms.some((term) => body.includes(term))) return false;
  if (parsedQuery.excludedTitleTerms.some((term) => title.includes(term))) return false;
  if (parsedQuery.excludedUrlTerms.some((term) => url.includes(term))) return false;
  if (parsedQuery.excludedAllBodyTermGroups.some((terms) => terms.every((term) => body.includes(term)))) {
    return false;
  }
  if (parsedQuery.excludedAllTitleTermGroups.some((terms) => terms.every((term) => title.includes(term)))) {
    return false;
  }
  if (parsedQuery.excludedAllUrlTermGroups.some((terms) => terms.every((term) => url.includes(term)))) {
    return false;
  }
  if (
    (parsedQuery.orTerms.length > 0 || parsedQuery.orPhrases.length > 0) &&
    parsedQuery.orTerms.every((term) => !haystack.includes(term)) &&
    parsedQuery.orPhrases.every((phrase) => !phraseMatches(haystack, phrase))
  ) {
    return false;
  }
  if (parsedQuery.orContextTerms.some((term) => !haystack.includes(term))) return false;
  if (parsedQuery.proximityPairs.some((pair) => !proximityMatches(haystack, pair))) {
    return false;
  }
  if (parsedQuery.phrases.some((phrase) => !phraseMatches(haystack, phrase))) return false;
  if (parsedQuery.requiredPhrases.some((phrase) => !phraseMatches(haystack, phrase))) return false;
  if (parsedQuery.excludedPhrases.some((phrase) => phraseMatches(haystack, phrase))) return false;
  if (parsedQuery.requiredOperatorTerms.some((term) => !haystack.includes(term))) return false;
  if (parsedQuery.excludedTerms.some((term) => haystack.includes(term))) return false;

  const date = document.date ?? null;
  const after = parsedQuery.after ?? timeBounds.after;
  const before = parsedQuery.before ?? timeBounds.before;
  if (after && (!date || date < after)) return false;
  if (before && (!date || date > before)) return false;

  return true;
}

function documentSiteMatches(document: SearchDocument, site: string) {
  return urlSiteMatches(document.url, site) || urlSiteMatches(document.externalUrl, site);
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
  const singular = value
    .trim()
    .toLowerCase()
    .replace(/^ai[-_\s]?/, "")
    .replace(/[-_\s]+/g, "-")
    .replace(/s$/, "");
  if (singular === "builder" || singular === "source") return "builder";
  if (singular === "feed" || singular === "post" || singular === "item") return "feed";
  if (singular === "digest" || singular === "brief") return "digest";
  return null;
}

function normalizeSiteOperatorValue(value: string) {
  const withoutProtocol = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .toLowerCase();
  if (!withoutProtocol) return "";

  const [host = "", ...pathParts] = withoutProtocol.split("/");
  const normalizedHost = host.trim();
  if (!normalizedHost) return "";

  const normalizedPath = pathParts
    .join("/")
    .split(/[?#]/)[0]
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");

  return [normalizedHost, normalizedPath].filter(Boolean).join("/");
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

function collectOrPhrases(query: string) {
  const phrases = new Set<string>();
  const patterns = [
    /(^|[\s(])"([^"]+)"\s+OR\s+"([^"]+)"/gi,
    /(^|[\s(])"([^"]+)"\s+OR\s+\S+/gi,
    /(^|[\s(])\S+\s+OR\s+"([^"]+)"/gi,
  ];

  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      for (const candidate of match.slice(2)) {
        const normalizedPhrase = normalizeText(candidate ?? "");
        if (normalizedPhrase) phrases.add(normalizedPhrase);
      }
    }
  }

  return [...phrases];
}

function collectParenthesizedOrContextTerms(query: string) {
  if (!/\([^)]*\bOR\b[^)]*\)/i.test(query)) return [];

  return tokenize(
    query
      .replace(/\([^)]*\bOR\b[^)]*\)/gi, " ")
      .replace(/"[^"]+"/g, " ")
      .replace(/[()]/g, " "),
  );
}

function isOperatorBoundaryToken(token: string) {
  const lower = token.toLowerCase();
  return (
    lower === "or" ||
    lower.startsWith("-") ||
    lower.startsWith("+") ||
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

function normalizeDateOperatorInput(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  const date = parseDateOperator(trimmed);
  if (!date) return "";
  return date.toISOString().slice(0, 10) === trimmed ? trimmed : "";
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

function urlSiteMatches(url: string | null | undefined, site: string) {
  if (!url) return false;
  const [siteHost, ...sitePathParts] = site.split("/");
  const sitePath = sitePathParts.join("/").replace(/^\/+|\/+$/g, "");

  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== siteHost && !host.endsWith(`.${siteHost}`)) return false;
    if (!sitePath) return true;

    const urlPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
    return urlPath === sitePath || urlPath.startsWith(`${sitePath}/`);
  } catch {
    return normalizeText(url).includes(site);
  }
}

function buildSnippet(
  document: SearchDocument,
  normalizedQuery: string,
  queryTokens: string[],
  exactTargets: string[] = [],
) {
  const source = document.body || document.title;
  const normalizedBody = normalizeText(document.body);
  const exactMatches = [...exactTargets, normalizedQuery]
    .filter((target) => target && !target.includes("*"))
    .map((target) => ({
      index: normalizedBody.indexOf(target),
      length: target.length,
    }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => a.index - b.index);
  if (exactMatches[0]) {
    return trimSnippet(source, exactMatches[0].index, exactMatches[0].length);
  }

  const tokenIndex = queryTokens
    .map((token) => normalizedBody.indexOf(token))
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
