type CrawlFallbackSource = {
  builders?: number;
  feedItems: number;
  errors: string[];
};

type CrawlFallbackInput = {
  sources?: Partial<Record<"x" | "podcasts" | "blogs", CrawlFallbackSource>>;
};

const FALLBACK_ERROR_PATTERNS = [
  "X_BEARER_TOKEN is not configured",
  "HTTP 401",
  "HTTP 402",
  "CreditsDepleted",
  "POD2TXT_API_KEY is not configured",
  "Invalid API key",
];

export function shouldImportFollowBuildersFallback(crawled: CrawlFallbackInput) {
  const blockedSources = [crawled.sources?.x, crawled.sources?.podcasts];
  return blockedSources.some(
    (source) =>
      source &&
      source.feedItems === 0 &&
      source.errors.some((error) =>
        FALLBACK_ERROR_PATTERNS.some((pattern) => error.includes(pattern)),
      ),
  );
}
