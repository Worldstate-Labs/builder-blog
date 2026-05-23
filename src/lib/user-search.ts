import type { Prisma } from "@prisma/client";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";
import { builderSourceLabel } from "@/lib/source-registry";
import {
  candidateSearchTerms,
  normalizeSearchMode,
  normalizeSearchSort,
  normalizeSearchTime,
  parseSearchQuery,
  rankSearchDocuments,
  type SearchDocument,
  type SearchMode,
  type SearchSort,
  type SearchTimeRange,
  type SearchResult,
} from "@/lib/search";

const searchLimits = {
  builder: 200,
  feed: 800,
  digest: 350,
};

export async function searchUserLibrary({
  userId,
  query,
  mode,
  sort,
  time,
}: {
  userId: string;
  query: string;
  mode?: string | null | undefined;
  sort?: string | null | undefined;
  time?: string | null | undefined;
}): Promise<{
  mode: SearchMode;
  sort: SearchSort;
  time: SearchTimeRange;
  results: SearchResult[];
  candidateCount: number;
  strategy: "database-memory";
}> {
  const normalizedMode = normalizeSearchMode(mode);
  const normalizedSort = normalizeSearchSort(sort);
  const normalizedTime = normalizeSearchTime(time);
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      mode: normalizedMode,
      sort: normalizedSort,
      time: normalizedTime,
      results: [],
      candidateCount: 0,
      strategy: "database-memory",
    };
  }

  const parsedQuery = parseSearchQuery(trimmedQuery);
  const terms = candidateSearchTerms(trimmedQuery, normalizedMode);
  const typeFilter = parsedQuery.type;
  const poolBuilderIds = await activePoolBuilderIds(userId);
  const [builders, feedItems, digests] = await Promise.all([
    typeFilter && typeFilter !== "builder" ? Promise.resolve([]) : prisma.builder.findMany({
      where: {
        id: { in: poolBuilderIds },
        OR: builderSearchConditions(terms),
      },
      select: {
        id: true,
        name: true,
        handle: true,
        kind: true,
        sourceType: true,
        scope: true,
        sourceUrl: true,
        crawlUrl: true,
        bio: true,
        canonicalKey: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: searchLimits.builder,
    }),
    typeFilter && typeFilter !== "feed" ? Promise.resolve([]) : prisma.feedItem.findMany({
      where: {
        builderId: { in: poolBuilderIds },
        OR: feedSearchConditions(terms),
      },
      include: { builder: { select: { name: true } } },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: searchLimits.feed,
    }),
    typeFilter && typeFilter !== "digest" ? Promise.resolve([]) : prisma.digest.findMany({
      where: {
        userId,
        OR: digestSearchConditions(terms),
      },
      orderBy: { createdAt: "desc" },
      take: searchLimits.digest,
    }),
  ]);

  const documents = [
    ...builders.map<SearchDocument>((builder) => {
      const sourceLabel = builderSourceLabel(builder);
      return {
        id: builder.id,
        type: "builder",
        title: builder.name,
        body: [
          builder.handle ? `@${builder.handle}` : "",
          sourceLabel,
          builder.bio ?? "",
          builder.sourceUrl ?? "",
          builder.crawlUrl ?? "",
          builder.canonicalKey,
        ].join(" "),
        url: `/builders#${builder.id}`,
        sourceName: sourceLabel,
        date: builder.updatedAt,
      };
    }),
    ...feedItems.map<SearchDocument>((item) => ({
      id: item.id,
      type: "feed",
      title: item.title ?? item.builder?.name ?? item.sourceName ?? "Untitled feed item",
      body: [item.body, item.sourceName ?? "", item.url].join(" "),
      url: item.url,
      sourceName: item.builder?.name ?? item.sourceName,
      date: item.publishedAt ?? item.createdAt,
    })),
    ...digests.map<SearchDocument>((digest) => ({
      id: digest.id,
      type: "digest",
      title: digest.title,
      body: digest.content,
      url: `/history#${digest.id}`,
      sourceName: `${digest.itemCount} items · ${digest.language}`,
      date: digest.createdAt,
    })),
  ];

  return {
    mode: normalizedMode,
    sort: normalizedSort,
    time: normalizedTime,
    candidateCount: documents.length,
    strategy: "database-memory",
    results: rankSearchDocuments({
      query: trimmedQuery,
      mode: normalizedMode,
      sort: normalizedSort,
      time: normalizedTime,
      documents,
      limit: 40,
    }),
  };
}

function builderSearchConditions(terms: string[]): Prisma.BuilderWhereInput[] {
  return terms.flatMap((term) => [
    { name: textContains(term) },
    { handle: textContains(term) },
    { sourceType: textContains(term) },
    { sourceUrl: textContains(term) },
    { crawlUrl: textContains(term) },
    { bio: textContains(term) },
    { canonicalKey: textContains(term) },
  ]);
}

function feedSearchConditions(terms: string[]): Prisma.FeedItemWhereInput[] {
  return terms.flatMap((term) => [
    { title: textContains(term) },
    { body: textContains(term) },
    { sourceName: textContains(term) },
    { url: textContains(term) },
  ]);
}

function digestSearchConditions(terms: string[]): Prisma.DigestWhereInput[] {
  return terms.flatMap((term) => [
    { title: textContains(term) },
    { content: textContains(term) },
    { language: textContains(term) },
    { source: textContains(term) },
  ]);
}

function textContains(term: string) {
  return { contains: term, mode: "insensitive" as const };
}
