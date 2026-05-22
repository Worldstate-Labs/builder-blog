import { BuilderKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { crawlBlogBuilders } from "./blogs";
import { crawlPodcastBuilders } from "./podcasts";
import type { CrawlerBuilder, CrawlOptions, CrawlSourceResult } from "./types";
import { crawlXBuilders } from "./x";

export type CrawlBuilderPoolOptions = CrawlOptions & {
  xBearerToken?: string | null;
  pod2txtApiKey?: string | null;
  openAiApiKey?: string | null;
  maxTranscriptAudioBytes?: number;
  maxTranscriptAttempts?: number;
  transcriptPollIntervalMs?: number;
};

export async function crawlBuilders(
  builders: CrawlerBuilder[],
  options: CrawlBuilderPoolOptions = {},
) {
  const xBuilders = builders.filter((builder) => builder.kind === BuilderKind.X);
  const podcastBuilders = builders.filter((builder) => builder.kind === BuilderKind.PODCAST);
  const blogBuilders = builders.filter((builder) => builder.kind === BuilderKind.BLOG);

  const sources = await Promise.all([
    crawlXBuilders(xBuilders, {
      fetcher: options.fetcher,
      now: options.now,
      bearerToken: options.xBearerToken,
    }),
    crawlPodcastBuilders(podcastBuilders, {
      fetcher: options.fetcher,
      now: options.now,
      pod2txtApiKey: options.pod2txtApiKey,
      openAiApiKey: options.openAiApiKey,
      maxTranscriptAudioBytes: options.maxTranscriptAudioBytes,
      maxTranscriptAttempts: options.maxTranscriptAttempts,
      transcriptPollIntervalMs: options.transcriptPollIntervalMs,
    }),
    crawlBlogBuilders(blogBuilders, {
      fetcher: options.fetcher,
      now: options.now,
    }),
  ]);

  return summarizeSources(sources);
}

export async function crawlBuilderPool(options: CrawlBuilderPoolOptions = {}) {
  const builders = await prisma.builder.findMany({
    where: {
      kind: { in: [BuilderKind.X, BuilderKind.PODCAST, BuilderKind.BLOG] },
    },
  });
  const result = await crawlBuilders(builders, {
    ...options,
    xBearerToken: options.xBearerToken ?? process.env.X_BEARER_TOKEN,
    pod2txtApiKey: options.pod2txtApiKey ?? process.env.POD2TXT_API_KEY,
    openAiApiKey: options.openAiApiKey ?? process.env.OPENAI_API_KEY,
  });

  for (const update of result.builderUpdates) {
    await prisma.builder.update({
      where: { id: update.id },
      data: { bio: update.bio },
    });
  }

  let feedItems = 0;
  for (const item of result.items) {
    await prisma.feedItem.upsert({
      where: {
        kind_externalId: {
          kind: item.kind,
          externalId: item.externalId,
        },
      },
      update: {
        builderId: item.builderId,
        title: item.title,
        body: item.body,
        url: item.url,
        publishedAt: item.publishedAt,
        sourceName: item.sourceName,
        rawJson: item.rawJson ? JSON.stringify(item.rawJson) : undefined,
      },
      create: {
        builderId: item.builderId,
        kind: item.kind,
        externalId: item.externalId,
        title: item.title,
        body: item.body,
        url: item.url,
        publishedAt: item.publishedAt,
        sourceName: item.sourceName,
        rawJson: item.rawJson ? JSON.stringify(item.rawJson) : undefined,
      },
    });
    feedItems += 1;
  }

  return {
    ...result,
    feedItems,
    generatedAt: new Date().toISOString(),
  };
}

function summarizeSources(sources: CrawlSourceResult[]) {
  const builderUpdates = sources.flatMap((source) => source.builderUpdates ?? []);
  const items = sources.flatMap((source) => source.items);
  const errors = sources.flatMap((source) => source.errors);
  return {
    builders: sources.reduce((total, source) => total + source.builders, 0),
    items,
    builderUpdates,
    errors,
    sources: Object.fromEntries(
      sources.map((source) => [
        source.source,
        {
          builders: source.builders,
          feedItems: source.items.length,
          errors: source.errors,
        },
      ]),
    ) as Record<CrawlSourceResult["source"], { builders: number; feedItems: number; errors: string[] }>,
  };
}
