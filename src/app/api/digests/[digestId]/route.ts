import { NextResponse } from "next/server";
import type { FeedItemKind } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { digestPostKey, parseDigest } from "@/lib/digest-markdown";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ digestId: string }> };
type DigestFavoriteState = { feedItemId: string; favoritedAt: string | null };
type DigestPostEntry = { key: string; source: string | null; title: string | null; url: string };
type DigestFeedItem = {
  id: string;
  title: string | null;
  url: string;
  summary: string | null;
  kind: FeedItemKind;
  externalId: string;
  sourceName: string | null;
  builder: { entityId: string | null; name: string } | null;
  createdAt: Date;
};
type DigestSourceIdentity = {
  entityId: string;
  externalId: string;
  kind: FeedItemKind;
  sourceName: string | null;
  title: string | null;
  url: string | null;
  builderName: string | null;
  entityName: string | null;
};

export async function GET(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { digestId } = await params;
  const digest = await prisma.digest.findUnique({
    where: { id: digestId },
    select: {
      id: true,
      content: true,
      headlineSummary: true,
      userId: true,
    },
  });

  if (!digest) {
    return NextResponse.json({ error: "Digest not found" }, { status: 404 });
  }

  if (digest.userId !== session.user.id) {
    const importedPipeline = await prisma.digestPipelineImport.findFirst({
      where: {
        userId: session.user.id,
        pipeline: {
          isPublic: true,
          ownerUserId: digest.userId,
        },
      },
      select: { pipelineId: true },
    });

    if (!importedPipeline) {
      return NextResponse.json({ error: "Digest not found" }, { status: 404 });
    }
  }

  const digestPosts = digestPostEntries(digest.content);
  const feedItems = await feedItemsForDigestPosts({
    digestId: digest.id,
    posts: digestPosts,
    userId: session.user.id,
  });
  const matchedFeedItems = matchDigestPostsToFeedItems(digestPosts, feedItems);
  const sourceIdentities = await sourceIdentitiesForDigestPosts(digest.id);
  const matchedSourceIdentities = matchDigestPostsToSourceIdentities(digestPosts, sourceIdentities);
  const favoriteState = await favoriteStateForDigestPosts({
    matches: matchedFeedItems,
    posts: digestPosts,
    userId: session.user.id,
  });
  const originalSummaries = originalSummariesForDigestPosts({
    matches: matchedFeedItems,
    posts: digestPosts,
  });
  const sourceEntityIdsByPostKey = sourceEntityIdsForDigestPosts({
    matches: matchedSourceIdentities,
    posts: digestPosts,
  });

  return NextResponse.json({
    id: digest.id,
    content: digest.content,
    headlineSummary: digest.headlineSummary,
    favoriteStateByPostKey: favoriteState.byPostKey,
    favoriteStateByUrl: favoriteState.byUrl,
    originalSummariesByPostKey: originalSummaries.byPostKey,
    originalSummariesByUrl: originalSummaries.byUrl,
    sourceEntityIdsByPostKey,
  });
}

async function sourceIdentitiesForDigestPosts(digestId: string) {
  const items = await prisma.digestedItem.findMany({
    where: { digestId },
    select: {
      entityId: true,
      externalId: true,
      kind: true,
      entity: { select: { name: true } },
      feedItem: {
        select: {
          sourceName: true,
          title: true,
          url: true,
          builder: { select: { name: true } },
        },
      },
    },
    orderBy: { digestedAt: "asc" },
  });

  return items
    .map((item): DigestSourceIdentity | null => {
      const entityId = item.entityId.trim();
      const externalId = item.externalId.trim();
      if (!entityId || !externalId) return null;
      return {
        builderName: item.feedItem?.builder?.name ?? null,
        entityId,
        entityName: item.entity.name,
        externalId,
        kind: item.kind,
        sourceName: item.feedItem?.sourceName ?? null,
        title: item.feedItem?.title ?? null,
        url: item.feedItem?.url ?? null,
      };
    })
    .filter((item): item is DigestSourceIdentity => Boolean(item));
}

async function feedItemsForDigestPosts({
  digestId,
  posts,
  userId,
}: {
  digestId: string;
  posts: DigestPostEntry[];
  userId: string;
}) {
  const urls = [...new Set(posts.map((post) => post.url))];
  if (urls.length === 0) return [];

  const poolBuilderIds = await activePoolBuilderIds(userId);
  const feedItems = new Map<string, DigestFeedItem>();

  const digestedItems = await prisma.digestedItem.findMany({
    where: {
      digestId,
      feedItemId: { not: null },
      feedItem: {
        is: {
          builder: { is: { entityId: { not: "" } } },
        },
      },
    },
    select: {
      feedItem: {
        select: {
          id: true,
          title: true,
          url: true,
          summary: true,
          kind: true,
          externalId: true,
          sourceName: true,
          builder: { select: { entityId: true, name: true } },
          createdAt: true,
        },
      },
    },
  });
  for (const item of digestedItems) {
    const feedItem = item.feedItem;
    if (feedItem) feedItems.set(feedItem.id, feedItem);
  }

  if (poolBuilderIds.length > 0) {
    const poolItems = await prisma.feedItem.findMany({
      where: {
        url: { in: urls },
        builderId: { in: poolBuilderIds },
        builder: { is: { entityId: { not: "" } } },
      },
      select: {
        id: true,
        title: true,
        url: true,
        summary: true,
        kind: true,
        externalId: true,
        sourceName: true,
        builder: { select: { entityId: true, name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    for (const item of poolItems) {
      feedItems.set(item.id, item);
    }
  }

  return [...feedItems.values()];
}

async function favoriteStateForDigestPosts({
  matches,
  posts,
  userId,
}: {
  matches: Map<string, DigestFeedItem>;
  posts: DigestPostEntry[];
  userId: string;
}) {
  if (posts.length === 0 || matches.size === 0) return { byPostKey: {}, byUrl: {} };
  const feedItemRows = [...matches.values()];

  const identities = new Map<string, { entityId: string; kind: FeedItemKind; externalId: string }>();
  for (const item of feedItemRows) {
    const entityId = item.builder?.entityId;
    if (!entityId) continue;
    const key = favoriteKey(entityId, item.kind, item.externalId);
    identities.set(key, { entityId, kind: item.kind, externalId: item.externalId });
  }

  const favorites = identities.size
    ? await prisma.feedFavorite.findMany({
        where: {
          userId,
          OR: [...identities.values()].map((identity) => ({
            entityId: identity.entityId,
            kind: identity.kind,
            externalId: identity.externalId,
          })),
        },
        select: {
          entityId: true,
          externalId: true,
          favoritedAt: true,
          kind: true,
        },
      })
    : [];
  const favoriteByKey = new Map(
    favorites.map((favorite) => [
      favoriteKey(favorite.entityId, favorite.kind, favorite.externalId),
      favorite.favoritedAt.toISOString(),
    ]),
  );

  const byPostKey = new Map<string, DigestFavoriteState>();
  const byUrl = new Map<string, DigestFavoriteState>();
  for (const post of posts) {
    const item = matches.get(post.key);
    if (!item) continue;
    const entityId = item.builder?.entityId;
    if (!entityId) continue;
    const favoritedAt = favoriteByKey.get(favoriteKey(entityId, item.kind, item.externalId)) ?? null;
    const state = { feedItemId: item.id, favoritedAt };
    byPostKey.set(post.key, state);
    setPreferredState(byUrl, post.url, state);
    setPreferredState(byUrl, item.url, state);
  }

  return {
    byPostKey: Object.fromEntries(byPostKey),
    byUrl: Object.fromEntries(byUrl),
  };
}

function originalSummariesForDigestPosts({
  matches,
  posts,
}: {
  matches: Map<string, DigestFeedItem>;
  posts: DigestPostEntry[];
}) {
  const byPostKey = new Map<string, string>();
  const byUrl = new Map<string, string>();
  for (const post of posts) {
    const item = matches.get(post.key);
    const summary = item?.summary?.trim();
    if (!item || !summary) continue;
    byPostKey.set(post.key, summary);
    if (!byUrl.has(post.url)) byUrl.set(post.url, summary);
    if (!byUrl.has(item.url)) byUrl.set(item.url, summary);
  }

  return {
    byPostKey: Object.fromEntries(byPostKey),
    byUrl: Object.fromEntries(byUrl),
  };
}

function sourceEntityIdsForDigestPosts({
  matches,
  posts,
}: {
  matches: Map<string, DigestSourceIdentity>;
  posts: DigestPostEntry[];
}) {
  const byPostKey = new Map<string, string>();
  for (const post of posts) {
    const entityId = matches.get(post.key)?.entityId.trim();
    if (entityId) byPostKey.set(post.key, entityId);
  }
  return Object.fromEntries(byPostKey);
}

function matchDigestPostsToSourceIdentities(posts: DigestPostEntry[], identities: DigestSourceIdentity[]) {
  const byExternalId = new Map<string, DigestSourceIdentity[]>();
  const byUrl = new Map<string, DigestSourceIdentity>();
  const byTitle = new Map<string, DigestSourceIdentity[]>();
  const byTitleAndSource = new Map<string, DigestSourceIdentity[]>();

  for (const identity of identities) {
    appendIdentityMatch(byExternalId, identity.externalId, identity);
    if (identity.url && !byUrl.has(identity.url)) byUrl.set(identity.url, identity);

    const title = digestMatchKey(identity.title);
    if (!title) continue;
    appendIdentityMatch(byTitle, title, identity);
    for (const source of digestSourceIdentitySources(identity)) {
      appendIdentityMatch(byTitleAndSource, `${title}:${source}`, identity);
    }
  }

  const matches = new Map<string, DigestSourceIdentity>();
  for (const post of posts) {
    const urlMatch = byUrl.get(post.url);
    if (urlMatch) {
      matches.set(post.key, urlMatch);
      continue;
    }

    const externalIdMatch = uniqueSourceIdentity(
      digestPostExternalIdCandidates(post).flatMap((candidate) => byExternalId.get(candidate) ?? []),
    );
    if (externalIdMatch) {
      matches.set(post.key, externalIdMatch);
      continue;
    }

    const title = digestMatchKey(post.title);
    if (!title) continue;

    const source = digestMatchKey(post.source);
    const sourceMatches = source ? byTitleAndSource.get(`${title}:${source}`) ?? [] : [];
    const sourceMatch = uniqueSourceIdentity(sourceMatches);
    if (sourceMatch) {
      matches.set(post.key, sourceMatch);
      continue;
    }

    const titleMatch = uniqueSourceIdentity(byTitle.get(title) ?? []);
    if (titleMatch) matches.set(post.key, titleMatch);
  }

  return matches;
}

function matchDigestPostsToFeedItems(posts: DigestPostEntry[], feedItems: DigestFeedItem[]) {
  const byUrl = new Map<string, DigestFeedItem>();
  const byTitle = new Map<string, DigestFeedItem[]>();
  const byTitleAndSource = new Map<string, DigestFeedItem[]>();

  for (const item of feedItems) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, item);

    const title = digestMatchKey(item.title);
    if (!title) continue;
    appendMatch(byTitle, title, item);
    for (const source of digestFeedItemSources(item)) {
      appendMatch(byTitleAndSource, `${title}:${source}`, item);
    }
  }

  const matches = new Map<string, DigestFeedItem>();
  for (const post of posts) {
    const urlMatch = byUrl.get(post.url);
    if (urlMatch) {
      matches.set(post.key, urlMatch);
      continue;
    }

    const title = digestMatchKey(post.title);
    if (!title) continue;

    const source = digestMatchKey(post.source);
    const sourceMatches = source ? byTitleAndSource.get(`${title}:${source}`) ?? [] : [];
    const sourceMatch = uniqueFeedItem(sourceMatches);
    if (sourceMatch) {
      matches.set(post.key, sourceMatch);
      continue;
    }

    const titleMatch = uniqueFeedItem(byTitle.get(title) ?? []);
    if (titleMatch) matches.set(post.key, titleMatch);
  }

  return matches;
}

function digestPostEntries(content: string) {
  const posts: DigestPostEntry[] = [];
  const doc = parseDigest(content);
  for (const section of doc.sections) {
    for (const group of section.groups) {
      for (const post of group.posts) {
        const url = post.media[0]?.url;
        if (!url) continue;
        posts.push({
          key: digestPostKey(section, group, post),
          source: group.source,
          title: post.title,
          url,
        });
      }
    }
  }
  return posts;
}

function digestFeedItemSources(item: DigestFeedItem) {
  return [item.sourceName, item.builder?.name]
    .map(digestMatchKey)
    .filter((value): value is string => Boolean(value));
}

function digestSourceIdentitySources(item: DigestSourceIdentity) {
  return [item.sourceName, item.builderName, item.entityName]
    .map(digestMatchKey)
    .filter((value): value is string => Boolean(value));
}

function digestPostExternalIdCandidates(post: DigestPostEntry) {
  const candidates = new Set<string>();
  const url = post.url.trim();
  if (url) candidates.add(url);
  const youtubeId = youtubeVideoId(url);
  if (youtubeId) candidates.add(youtubeId);
  return [...candidates];
}

function youtubeVideoId(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return parsed.pathname.slice(1).split("/")[0] || null;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
      const match = parsed.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
      return match?.[2] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function digestMatchKey(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function appendMatch(matches: Map<string, DigestFeedItem[]>, key: string, item: DigestFeedItem) {
  matches.set(key, [...(matches.get(key) ?? []), item]);
}

function appendIdentityMatch(matches: Map<string, DigestSourceIdentity[]>, key: string, item: DigestSourceIdentity) {
  const matchKey = key.trim();
  if (!matchKey) return;
  matches.set(matchKey, [...(matches.get(matchKey) ?? []), item]);
}

function uniqueFeedItem(items: DigestFeedItem[]) {
  const unique = new Map(items.map((item) => [item.id, item]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

function uniqueSourceIdentity(items: DigestSourceIdentity[]) {
  const unique = new Map(items.map((item) => [`${item.entityId}:${item.kind}:${item.externalId}`, item]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

function setPreferredState(
  states: Map<string, DigestFavoriteState>,
  key: string,
  state: DigestFavoriteState,
) {
  const existing = states.get(key);
  if (!existing || (!existing.favoritedAt && state.favoritedAt)) states.set(key, state);
}

function favoriteKey(entityId: string, kind: string, externalId: string) {
  return `${entityId}:${kind}:${externalId}`;
}
