import type { FeedItemKind, Prisma } from "@prisma/client";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import {
  displayDigestPipelineTitleForOwner,
  ensureDefaultCommunityDigestImport,
} from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";
import { builderSourceLabel } from "@/lib/source-registry";
import { cleanStructuredDigestItems, digestItemsSearchText } from "@/lib/structured-digest";
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
        avatarDataUrl: true,
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
            id: true,
            entityId: true,
            kind: true,
            name: true,
            sourceType: true,
            sourceUrl: true,
            fetchUrl: true,
            avatarUrl: true,
            avatarDataUrl: true,
          },
        },
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: searchLimits.feed,
    }),
    typeFilter && typeFilter !== "digest" ? Promise.resolve([]) : prisma.digest.findMany({
      where: {
        userId: { in: digestOwnerIds },
      },
      orderBy: { createdAt: "desc" },
      take: searchLimits.digest,
    }),
  ]);
  const [favoriteByContentKey, readByContentKey] = await Promise.all([
    loadFavoriteContentKeys({
      feedItems,
      userId,
    }),
    loadReadContentKeys({
      feedItems,
      userId,
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
        avatarDataUrl: builder.avatarDataUrl,
        builderEntityId: builder.entityId,
        builderId: builder.id,
        builderKind: builder.kind,
        fetchUrl: builder.fetchUrl,
        sourceUrl: builder.sourceUrl,
        url: builder.entityId ? `/builder/${builder.entityId}` : `/builders#${builder.id}`,
        sourceName: sourceLabel,
        sourceType: builder.sourceType,
        date: builder.updatedAt,
      };
    }),
    ...feedItems.map<SearchDocument>((item) => {
      const favoriteKey = item.builder?.entityId
        ? contentKey(item.builder.entityId, item.kind, item.externalId)
        : null;
      const readKey = favoriteKey;
      return {
        id: item.id,
        type: "feed",
        title: item.title ?? item.builder?.name ?? item.sourceName ?? "Untitled post",
        body: [item.body, item.sourceName ?? "", item.url].join(" "),
        postBody: item.body,
        postSummary: item.summary,
        externalUrl: item.url,
        url: `/posts/${item.id}`,
        avatarUrl: item.builder?.avatarUrl ?? null,
        avatarDataUrl: item.builder?.avatarDataUrl ?? null,
        builderEntityId: item.builder?.entityId ?? null,
        builderId: item.builder?.id ?? null,
        builderKind: item.builder?.kind ?? null,
        fetchUrl: item.builder?.fetchUrl ?? null,
        sourceName: item.builder?.name ?? item.sourceName,
        sourceType: item.builder?.sourceType ?? null,
        sourceUrl: item.builder?.sourceUrl ?? item.url,
        date: item.publishedAt ?? item.createdAt,
        favoritedAt: favoriteKey ? favoriteByContentKey.get(favoriteKey) ?? null : null,
        readAt: readKey ? readByContentKey.get(readKey) ?? null : null,
      };
    }),
    ...digests.map<SearchDocument>((digest) => {
      const pipeline =
        digest.userId === userId ? null : digestOwnerToPipeline.get(digest.userId);
      return {
        id: digest.id,
        type: "digest",
        title: digest.title,
        body: digestItemsSearchText(cleanStructuredDigestItems(digest.items)),
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

async function loadFavoriteContentKeys({
  feedItems,
  userId,
}: {
  feedItems: Array<{
    kind: FeedItemKind;
    externalId: string;
    builder: { entityId: string | null } | null;
  }>;
  userId: string;
}) {
  const contentKeys = contentKeyRowsForFeedItems(feedItems);
  if (contentKeys.size === 0) return new Map<string, Date>();

  const favorites = await prisma.feedFavorite.findMany({
    where: {
      userId,
      OR: [...contentKeys.values()].map((item) => ({
        entityId: item.entityId,
        kind: item.kind,
        externalId: item.externalId,
      })),
    },
    select: {
      entityId: true,
      kind: true,
      externalId: true,
      favoritedAt: true,
    },
  });

  return new Map(
    favorites.map((favorite) => [
      contentKey(favorite.entityId, favorite.kind, favorite.externalId),
      favorite.favoritedAt,
    ]),
  );
}

async function loadReadContentKeys({
  feedItems,
  userId,
}: {
  feedItems: Array<{
    kind: FeedItemKind;
    externalId: string;
    builder: { entityId: string | null } | null;
  }>;
  userId: string;
}) {
  const contentKeys = contentKeyRowsForFeedItems(feedItems);
  if (contentKeys.size === 0) return new Map<string, Date>();

  const reads = await prisma.feedRead.findMany({
    where: {
      userId,
      OR: [...contentKeys.values()].map((item) => ({
        entityId: item.entityId,
        kind: item.kind,
        externalId: item.externalId,
      })),
    },
    select: {
      entityId: true,
      kind: true,
      externalId: true,
      readAt: true,
    },
  });

  return new Map(
    reads.map((read) => [
      contentKey(read.entityId, read.kind, read.externalId),
      read.readAt,
    ]),
  );
}

function contentKeyRowsForFeedItems(
  feedItems: Array<{
    kind: FeedItemKind;
    externalId: string;
    builder: { entityId: string | null } | null;
  }>,
) {
  const contentKeys = new Map<string, { entityId: string; kind: FeedItemKind; externalId: string }>();
  for (const item of feedItems) {
    const entityId = item.builder?.entityId;
    if (!entityId) continue;
    const key = contentKey(entityId, item.kind, item.externalId);
    contentKeys.set(key, { entityId, kind: item.kind, externalId: item.externalId });
  }
  return contentKeys;
}

function contentKey(entityId: string, kind: FeedItemKind, externalId: string) {
  return `${entityId}:${kind}:${externalId}`;
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

function textContains(term: string) {
  return { contains: term, mode: "insensitive" as const };
}
