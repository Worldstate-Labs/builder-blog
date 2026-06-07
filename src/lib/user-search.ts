import type { Prisma } from "@prisma/client";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import {
  displayDigestPipelineTitleForOwner,
  ensureDefaultCommunityDigestImport,
} from "@/lib/library-hub";
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
  const hasCandidateTerms = terms.length > 0;
  const typeFilter = parsedQuery.type;
  const poolBuilderIds = await activePoolBuilderIds(userId);
  await ensureDefaultCommunityDigestImport(userId);
  const importedDigestPipelines =
    typeFilter && typeFilter !== "digest"
      ? []
      : await prisma.digestPipelineImport.findMany({
          where: { userId, pipeline: { isPublic: true } },
          include: {
            pipeline: {
              select: {
                id: true,
                title: true,
                ownerUserId: true,
                owner: { select: { name: true, email: true } },
              },
            },
          },
        });
  const digestOwnerToPipeline = new Map(
    importedDigestPipelines.map(({ pipeline }) => [pipeline.ownerUserId, pipeline]),
  );
  const digestOwnerIds = [userId, ...importedDigestPipelines.map(({ pipeline }) => pipeline.ownerUserId)];

  const [builders, feedItems, digests] = await Promise.all([
    typeFilter && typeFilter !== "builder" ? Promise.resolve([]) : prisma.builder.findMany({
      where: {
        id: { in: poolBuilderIds },
        ...(hasCandidateTerms ? { OR: builderSearchConditions(terms) } : {}),
      },
      select: {
        id: true,
        entityId: true,
        name: true,
        handle: true,
        kind: true,
        sourceType: true,
        sourceUrl: true,
        fetchUrl: true,
        avatarUrl: true,
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
        ...(hasCandidateTerms ? { OR: feedSearchConditions(terms) } : {}),
      },
      include: {
        builder: {
          select: {
            name: true,
            sourceType: true,
            sourceUrl: true,
            fetchUrl: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: searchLimits.feed,
    }),
    typeFilter && typeFilter !== "digest" ? Promise.resolve([]) : prisma.digest.findMany({
      where: {
        userId: { in: digestOwnerIds },
        ...(hasCandidateTerms ? { OR: digestSearchConditions(terms) } : {}),
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
          builder.fetchUrl ?? "",
          builder.canonicalKey,
        ].join(" "),
        externalUrl: builder.sourceUrl ?? builder.fetchUrl,
        avatarUrl: builder.avatarUrl,
        fetchUrl: builder.fetchUrl,
        sourceUrl: builder.sourceUrl,
        url: builder.entityId ? `/builder/${builder.entityId}` : `/builders#${builder.id}`,
        sourceName: sourceLabel,
        sourceType: builder.sourceType,
        date: builder.updatedAt,
      };
    }),
    ...feedItems.map<SearchDocument>((item) => ({
      id: item.id,
      type: "feed",
      title: item.title ?? item.builder?.name ?? item.sourceName ?? "Untitled post",
      body: [item.body, item.sourceName ?? "", item.url].join(" "),
      externalUrl: item.url,
      url: `/posts/${item.id}`,
      avatarUrl: item.builder?.avatarUrl ?? null,
      fetchUrl: item.builder?.fetchUrl ?? null,
      sourceName: item.builder?.name ?? item.sourceName,
      sourceType: item.builder?.sourceType ?? null,
      sourceUrl: item.builder?.sourceUrl ?? item.url,
      date: item.publishedAt ?? item.createdAt,
    })),
    ...digests.map<SearchDocument>((digest) => {
      const pipeline =
        digest.userId === userId ? null : digestOwnerToPipeline.get(digest.userId);
      return {
        id: digest.id,
        type: "digest",
        title: digest.title,
        body: digest.content,
        url: pipeline
          ? `/dashboard?tab=ai-digest&pipeline=${pipeline.id}&digest=${digest.id}`
          : `/dashboard?tab=ai-digest&digest=${digest.id}`,
        sourceName: pipeline
          ? `${displayDigestPipelineTitleForOwner(
              pipeline.title,
              pipeline.owner,
            )} · ${digest.itemCount} ${digest.itemCount === 1 ? "post" : "posts"} · ${digest.language}`
          : `${digest.itemCount} ${digest.itemCount === 1 ? "post" : "posts"} · ${digest.language}`,
        date: digest.createdAt,
      };
    }),
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
    { fetchUrl: textContains(term) },
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
