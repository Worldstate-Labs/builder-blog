import { BuilderKind, FeedItemKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const FOLLOW_BUILDERS_BASE =
  "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main";

type RemoteXFeed = {
  generatedAt?: string;
  x?: Array<{
    name: string;
    handle: string;
    bio?: string;
    tweets: Array<{
      id: string;
      text: string;
      createdAt?: string;
      url: string;
      likes?: number;
      retweets?: number;
      replies?: number;
      isQuote?: boolean;
      quotedTweetId?: string | null;
    }>;
  }>;
};

type RemotePodcastFeed = {
  podcasts?: Array<{
    source: "podcast";
    name: string;
    title: string;
    guid?: string;
    url: string;
    publishedAt?: string | null;
    transcript: string;
  }>;
};

type RemoteBlogFeed = {
  blogs?: Array<{
    source: "blog";
    name: string;
    title: string;
    url: string;
    publishedAt?: string | null;
    author?: string;
    description?: string;
    content: string;
  }>;
};

type DefaultSources = {
  x_accounts?: Array<{ name: string; handle: string }>;
  blogs?: Array<{ name: string; indexUrl: string }>;
  podcasts?: Array<{ name: string; url: string }>;
};

export function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function canonicalBuilderKey(kind: BuilderKind, value: string) {
  return `${kind}:${value.trim().toLowerCase()}`;
}

export function inferBuilderKind(sourceUrl: string | null, handle: string | null) {
  if (handle) return BuilderKind.X;
  if (!sourceUrl) return BuilderKind.WEBSITE;
  if (sourceUrl.includes("youtube.com") || sourceUrl.includes("podcast")) {
    return BuilderKind.PODCAST;
  }
  if (sourceUrl.includes("blog") || sourceUrl.includes("engineering")) {
    return BuilderKind.BLOG;
  }
  return BuilderKind.WEBSITE;
}

export async function upsertBuilder(params: {
  kind: BuilderKind;
  name: string;
  handle?: string | null;
  sourceUrl?: string | null;
  bio?: string | null;
  addedByUserId?: string | null;
}) {
  const handle = params.handle ? normalizeHandle(params.handle) : null;
  const uniqueValue = handle ?? params.sourceUrl ?? params.name;
  return prisma.builder.upsert({
    where: { canonicalKey: canonicalBuilderKey(params.kind, uniqueValue) },
    update: {
      name: params.name,
      handle,
      sourceUrl: params.sourceUrl ?? undefined,
      bio: params.bio ?? undefined,
    },
    create: {
      kind: params.kind,
      name: params.name,
      handle,
      sourceUrl: params.sourceUrl,
      bio: params.bio,
      addedByUserId: params.addedByUserId,
      canonicalKey: canonicalBuilderKey(params.kind, uniqueValue),
    },
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function seedDefaultBuilderPool() {
  const sources = await fetchJson<DefaultSources>(
    `${FOLLOW_BUILDERS_BASE}/config/default-sources.json`,
  );
  let builders = 0;

  for (const account of sources.x_accounts ?? []) {
    await upsertBuilder({
      kind: BuilderKind.X,
      name: account.name,
      handle: account.handle,
      sourceUrl: `https://x.com/${normalizeHandle(account.handle)}`,
    });
    builders += 1;
  }

  for (const blog of sources.blogs ?? []) {
    await upsertBuilder({
      kind: BuilderKind.BLOG,
      name: blog.name,
      sourceUrl: blog.indexUrl,
    });
    builders += 1;
  }

  for (const podcast of sources.podcasts ?? []) {
    await upsertBuilder({
      kind: BuilderKind.PODCAST,
      name: podcast.name,
      sourceUrl: podcast.url,
    });
    builders += 1;
  }

  return { builders };
}

export async function crawlCentralFeeds() {
  const [xFeed, podcastFeed, blogFeed] = await Promise.all([
    fetchJson<RemoteXFeed>(`${FOLLOW_BUILDERS_BASE}/feed-x.json`),
    fetchJson<RemotePodcastFeed>(`${FOLLOW_BUILDERS_BASE}/feed-podcasts.json`),
    fetchJson<RemoteBlogFeed>(`${FOLLOW_BUILDERS_BASE}/feed-blogs.json`),
  ]);

  let builders = 0;
  let feedItems = 0;

  for (const account of xFeed.x ?? []) {
    const builder = await upsertBuilder({
      kind: BuilderKind.X,
      name: account.name,
      handle: account.handle,
      sourceUrl: `https://x.com/${normalizeHandle(account.handle)}`,
      bio: account.bio,
    });
    builders += 1;

    for (const tweet of account.tweets ?? []) {
      await prisma.feedItem.upsert({
        where: {
          kind_externalId: {
            kind: FeedItemKind.TWEET,
            externalId: tweet.id,
          },
        },
        update: {
          body: tweet.text,
          url: tweet.url,
          publishedAt: tweet.createdAt ? new Date(tweet.createdAt) : null,
          rawJson: JSON.stringify(tweet),
        },
        create: {
          builderId: builder.id,
          kind: FeedItemKind.TWEET,
          externalId: tweet.id,
          body: tweet.text,
          url: tweet.url,
          publishedAt: tweet.createdAt ? new Date(tweet.createdAt) : null,
          sourceName: account.name,
          rawJson: JSON.stringify(tweet),
        },
      });
      feedItems += 1;
    }
  }

  for (const episode of podcastFeed.podcasts ?? []) {
    const builder = await upsertBuilder({
      kind: BuilderKind.PODCAST,
      name: episode.name,
      sourceUrl: episode.url,
    });
    builders += 1;
    await prisma.feedItem.upsert({
      where: {
        kind_externalId: {
          kind: FeedItemKind.PODCAST_EPISODE,
          externalId: episode.guid ?? episode.url,
        },
      },
      update: {
        title: episode.title,
        body: episode.transcript,
        url: episode.url,
        publishedAt: episode.publishedAt ? new Date(episode.publishedAt) : null,
        rawJson: JSON.stringify(episode),
      },
      create: {
        builderId: builder.id,
        kind: FeedItemKind.PODCAST_EPISODE,
        externalId: episode.guid ?? episode.url,
        title: episode.title,
        body: episode.transcript,
        url: episode.url,
        publishedAt: episode.publishedAt ? new Date(episode.publishedAt) : null,
        sourceName: episode.name,
        rawJson: JSON.stringify(episode),
      },
    });
    feedItems += 1;
  }

  for (const post of blogFeed.blogs ?? []) {
    const builder = await upsertBuilder({
      kind: BuilderKind.BLOG,
      name: post.name,
      sourceUrl: post.url,
    });
    builders += 1;
    await prisma.feedItem.upsert({
      where: {
        kind_externalId: {
          kind: FeedItemKind.BLOG_POST,
          externalId: post.url,
        },
      },
      update: {
        title: post.title,
        body: post.content,
        url: post.url,
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        rawJson: JSON.stringify(post),
      },
      create: {
        builderId: builder.id,
        kind: FeedItemKind.BLOG_POST,
        externalId: post.url,
        title: post.title,
        body: post.content,
        url: post.url,
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        sourceName: post.name,
        rawJson: JSON.stringify(post),
      },
    });
    feedItems += 1;
  }

  return {
    builders,
    feedItems,
    generatedAt: xFeed.generatedAt ?? new Date().toISOString(),
  };
}
