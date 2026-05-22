import assert from "node:assert/strict";
import test from "node:test";
import { BuilderKind, FeedItemKind } from "@prisma/client";
import { canonicalBuilderKey, normalizeHandle } from "../src/lib/builder-keys";
import { isCronAuthorized } from "../src/lib/cron-auth";
import { crawlBlogBuilders } from "../src/lib/crawler/blogs";
import { crawlPodcastBuilders } from "../src/lib/crawler/podcasts";
import { crawlXBuilders } from "../src/lib/crawler/x";
import type { CrawlerBuilder, Fetcher } from "../src/lib/crawler/types";

const baseBuilder = {
  id: "builder_1",
  name: "Example Builder",
  bio: null,
  sourceUrl: null,
  crawlUrl: null,
};

test("builder dedupe keys normalize handles before canonicalization", () => {
  assert.equal(normalizeHandle(" @Thesephist "), "thesephist");
  assert.equal(canonicalBuilderKey(BuilderKind.X, normalizeHandle("@Thesephist")), "X:thesephist");
});

test("X crawler maps API tweets into FeedItem records", async () => {
  const builder: CrawlerBuilder = {
    ...baseBuilder,
    kind: BuilderKind.X,
    handle: "ada",
    sourceUrl: "https://x.com/ada",
  };
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    if (url.includes("/users/by")) {
      return Response.json({
        data: [{ id: "user_1", username: "ada", name: "Ada", description: "builder bio" }],
      });
    }
    if (url.includes("/tweets")) {
      return Response.json({
        data: [
          {
            id: "tweet_1",
            text: "short text",
            note_tweet: { text: "full long text" },
            created_at: "2026-05-22T12:00:00.000Z",
            public_metrics: { like_count: 4, retweet_count: 2, reply_count: 1 },
          },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await crawlXBuilders([builder], {
    bearerToken: "token",
    fetcher,
    now: new Date("2026-05-22T13:00:00.000Z"),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, FeedItemKind.TWEET);
  assert.equal(result.items[0].externalId, "tweet_1");
  assert.equal(result.items[0].body, "full long text");
  assert.equal(result.items[0].url, "https://x.com/ada/status/tweet_1");
  assert.deepEqual(result.builderUpdates, [{ id: "builder_1", bio: "builder bio" }]);
});

test("podcast crawler maps RSS plus pod2txt transcript into FeedItem records", async () => {
  const builder: CrawlerBuilder = {
    ...baseBuilder,
    kind: BuilderKind.PODCAST,
    handle: null,
    sourceUrl: "https://www.youtube.com/playlist?list=PL123",
    crawlUrl: "https://feeds.example.com/podcast.xml",
  };
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    if (url === "https://feeds.example.com/podcast.xml") {
      return new Response(`
        <rss><channel><item>
          <title><![CDATA[New Agents Episode]]></title>
          <guid>episode-guid</guid>
          <pubDate>Fri, 22 May 2026 10:00:00 GMT</pubDate>
          <link>https://podcast.example.com/episode</link>
        </item></channel></rss>
      `);
    }
    if (url === "https://pod2txt.vercel.app/api/transcript") {
      return Response.json({ status: "ready", url: "https://transcripts.example.com/episode.txt" });
    }
    if (url === "https://transcripts.example.com/episode.txt") {
      return new Response("Transcript body");
    }
    if (url === "https://www.youtube.com/feeds/videos.xml?playlist_id=PL123") {
      return new Response(`
        <feed><entry><title>New Agents Episode</title><yt:videoId>abc123</yt:videoId></entry></feed>
      `);
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await crawlPodcastBuilders([builder], {
    pod2txtApiKey: "pod-key",
    fetcher,
    now: new Date("2026-05-22T13:00:00.000Z"),
    maxTranscriptAttempts: 1,
    transcriptPollIntervalMs: 1,
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, FeedItemKind.PODCAST_EPISODE);
  assert.equal(result.items[0].externalId, "episode-guid");
  assert.equal(result.items[0].body, "Transcript body");
  assert.equal(result.items[0].url, "https://www.youtube.com/watch?v=abc123");
});

test("podcast crawler resolves YouTube handle pages to episode video URLs", async () => {
  const builder: CrawlerBuilder = {
    ...baseBuilder,
    kind: BuilderKind.PODCAST,
    handle: null,
    sourceUrl: "https://www.youtube.com/@ExamplePod",
    crawlUrl: "https://feeds.example.com/handle-podcast.xml",
  };
  const channelId = "UCabcdefghijklmnopqrstuvwx";
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    if (url === "https://feeds.example.com/handle-podcast.xml") {
      return new Response(`
        <rss><channel><item>
          <title>Handle Episode</title>
          <guid>handle-episode-guid</guid>
          <pubDate>Fri, 22 May 2026 10:00:00 GMT</pubDate>
        </item></channel></rss>
      `);
    }
    if (url === "https://pod2txt.vercel.app/api/transcript") {
      return Response.json({ status: "ready", url: "https://transcripts.example.com/handle.txt" });
    }
    if (url === "https://transcripts.example.com/handle.txt") {
      return new Response("Handle transcript body");
    }
    if (url === "https://www.youtube.com/@ExamplePod") {
      return new Response(`{"channelId":"${channelId}"}`);
    }
    if (url === `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`) {
      return new Response(`
        <feed><entry><title>Handle Episode</title><yt:videoId>handle123</yt:videoId></entry></feed>
      `);
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await crawlPodcastBuilders([builder], {
    pod2txtApiKey: "pod-key",
    fetcher,
    now: new Date("2026-05-22T13:00:00.000Z"),
    maxTranscriptAttempts: 1,
    transcriptPollIntervalMs: 1,
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.items[0].url, "https://www.youtube.com/watch?v=handle123");
});

test("blog crawler maps discovered articles into FeedItem records", async () => {
  const builder: CrawlerBuilder = {
    ...baseBuilder,
    kind: BuilderKind.BLOG,
    handle: null,
    sourceUrl: "https://claude.com/blog",
    crawlUrl: "https://claude.com/blog",
  };
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    if (url === "https://claude.com/blog") {
      return new Response('<a href="/blog/shipping-agents">Shipping Agents</a>');
    }
    if (url === "https://claude.com/blog/shipping-agents") {
      return new Response(`
        <script type="application/ld+json">{"@type":"BlogPosting","headline":"Shipping Agents","datePublished":"2026-05-22T09:00:00.000Z","author":{"name":"Claude"}}</script>
        <article><h1>Shipping Agents</h1><p>Article body for builders.</p></article>
      `);
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await crawlBlogBuilders([builder], {
    fetcher,
    now: new Date("2026-05-22T13:00:00.000Z"),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, FeedItemKind.BLOG_POST);
  assert.equal(result.items[0].externalId, "https://claude.com/blog/shipping-agents");
  assert.equal(result.items[0].title, "Shipping Agents");
  assert.match(result.items[0].body, /Article body for builders/);
});

test("cron route authorization requires the configured bearer token", () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "secret";
  try {
    assert.equal(
      isCronAuthorized(new Request("http://localhost/api/cron/crawl", {
        headers: { authorization: "Bearer secret" },
      })),
      true,
    );
    assert.equal(
      isCronAuthorized(new Request("http://localhost/api/cron/crawl", {
        headers: { authorization: "Bearer wrong" },
      })),
      false,
    );
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});
