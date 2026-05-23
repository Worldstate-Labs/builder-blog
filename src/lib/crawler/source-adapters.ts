import { sourceTypeIdForBuilder } from "@/lib/source-registry";
import { crawlBlogBuilders } from "./blogs";
import { crawlPodcastBuilders } from "./podcasts";
import type { CrawlerBuilder, CrawlSourceResult } from "./types";
import { crawlXBuilders } from "./x";
import type { CrawlBuilderPoolOptions } from ".";

export type CrawlerSourceAdapter = {
  id: string;
  resultSource: string;
  matches: (builder: CrawlerBuilder) => boolean;
  crawl: (
    builders: CrawlerBuilder[],
    options: CrawlBuilderPoolOptions,
  ) => Promise<CrawlSourceResult>;
};

const ADAPTERS: CrawlerSourceAdapter[] = [
  {
    id: "x",
    resultSource: "x",
    matches: (builder) => sourceTypeIdForBuilder(builder) === "x",
    crawl: (builders, options) =>
      crawlXBuilders(builders, {
        fetcher: options.fetcher,
        now: options.now,
        bearerToken: options.xBearerToken,
      }),
  },
  {
    id: "podcast",
    resultSource: "podcasts",
    matches: (builder) => sourceTypeIdForBuilder(builder) === "podcast",
    crawl: (builders, options) =>
      crawlPodcastBuilders(builders, {
        fetcher: options.fetcher,
        now: options.now,
        pod2txtApiKey: options.pod2txtApiKey,
        openAiApiKey: options.openAiApiKey,
        maxTranscriptAudioBytes: options.maxTranscriptAudioBytes,
        maxTranscriptAttempts: options.maxTranscriptAttempts,
        transcriptPollIntervalMs: options.transcriptPollIntervalMs,
      }),
  },
  {
    id: "blog",
    resultSource: "blogs",
    matches: (builder) => sourceTypeIdForBuilder(builder) === "blog",
    crawl: (builders, options) =>
      crawlBlogBuilders(builders, {
        fetcher: options.fetcher,
        now: options.now,
      }),
  },
];

export function centralCrawlerSourceAdapters() {
  return ADAPTERS;
}
