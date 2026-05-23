import { BuilderScope } from "@prisma/client";
import { centralCrawlerBuilderKinds, sourceDefinitionForBuilder } from "@/lib/source-registry";
import { centralCrawlerSourceAdapters } from "./source-adapters";
import type { CrawlerBuilder, CrawlOptions, CrawlSourceResult } from "./types";

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
  const sources = await Promise.all(
    centralCrawlerSourceAdapters().map((adapter) =>
      adapter.crawl(builders.filter(adapter.matches), options),
    ),
  );

  return summarizeSources(sources);
}

export async function crawlBuilderPool(options: CrawlBuilderPoolOptions = {}) {
  const { prisma } = await import("@/lib/prisma");
  const builders = (
    await prisma.builder.findMany({
      where: {
        scope: BuilderScope.CENTRAL,
        kind: { in: centralCrawlerBuilderKinds() },
      },
    })
  ).filter((builder) => sourceDefinitionForBuilder(builder)?.centralCrawler);
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
        builderId_kind_externalId: {
          builderId: item.builderId,
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
        crawlingTool: item.crawlingTool ?? "Builder Blog web crawler",
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
        crawlingTool: item.crawlingTool ?? "Builder Blog web crawler",
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
