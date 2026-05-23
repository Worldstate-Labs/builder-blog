import type { BuilderKind, FeedItemKind } from "@prisma/client";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type CrawlerBuilder = {
  id: string;
  kind: BuilderKind;
  sourceType?: string | null;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  crawlUrl: string | null;
  bio: string | null;
};

export type CrawledFeedItem = {
  builderId: string;
  kind: FeedItemKind;
  externalId: string;
  title?: string | null;
  body: string;
  url: string;
  publishedAt?: Date | null;
  sourceName?: string | null;
  rawJson?: unknown;
};

export type BuilderUpdate = {
  id: string;
  bio?: string | null;
};

export type SourceName = "x" | "podcasts" | "blogs";

export type CrawlSourceResult = {
  source: SourceName;
  builders: number;
  items: CrawledFeedItem[];
  errors: string[];
  builderUpdates?: BuilderUpdate[];
};

export type CrawlOptions = {
  fetcher?: Fetcher;
  now?: Date;
};

export function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function decodeXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function stripHtml(html: string) {
  return decodeXmlText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
}
