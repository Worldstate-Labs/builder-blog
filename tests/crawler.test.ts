import assert from "node:assert/strict";
import test from "node:test";
import { BuilderKind, FeedItemKind } from "@prisma/client";
import { builderLibraryKey, canonicalBuilderKey, normalizeHandle } from "../src/lib/builder-keys";
import { isCronAuthorized } from "../src/lib/cron-auth";
import { shouldImportFollowBuildersFallback } from "../src/lib/crawl-fallback";
import { crawlBuilders } from "../src/lib/crawler";
import { crawlBlogBuilders } from "../src/lib/crawler/blogs";
import { centralCrawlerSourceAdapters } from "../src/lib/crawler/source-adapters";
import { crawlPodcastBuilders } from "../src/lib/crawler/podcasts";
import { crawlXBuilders } from "../src/lib/crawler/x";
import type { CrawlerBuilder, Fetcher } from "../src/lib/crawler/types";
import { subscriptionBuilderIdsInPool } from "../src/lib/digest-library";

const baseBuilder = {
  id: "builder_1",
  name: "Example Builder",
  bio: null,
  sourceUrl: null,
  crawlUrl: null,
};

function rawJsonTranscriptSource(rawJson: unknown) {
  if (
    rawJson &&
    typeof rawJson === "object" &&
    "transcriptSource" in rawJson &&
    typeof rawJson.transcriptSource === "string"
  ) {
    return rawJson.transcriptSource;
  }
  return undefined;
}

test("builder dedupe keys normalize handles before canonicalization", () => {
  assert.equal(normalizeHandle(" @Thesephist "), "thesephist");
  assert.equal(canonicalBuilderKey(BuilderKind.X, normalizeHandle("@Thesephist")), "X:thesephist");
  // libraryKey is always per-owner now — no central facet.
  assert.equal(
    builderLibraryKey({
      ownerUserId: "user_1",
      canonicalKey: "X:thesephist",
    }),
    "user:user_1:X:thesephist",
  );
});

test("digest builder ids are the subscribed subset of the user library", () => {
  assert.deepEqual(
    subscriptionBuilderIdsInPool(["central_1", "personal_1"], ["central_1", "outside_1"]),
    ["central_1"],
  );
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

test("podcast crawler uses RSS transcript URLs without pod2txt credentials", async () => {
  const builder: CrawlerBuilder = {
    ...baseBuilder,
    kind: BuilderKind.PODCAST,
    handle: null,
    sourceUrl: "https://podcast.example.com",
    crawlUrl: "https://feeds.example.com/transcript-podcast.xml",
  };
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    if (url === "https://feeds.example.com/transcript-podcast.xml") {
      return new Response(`
        <rss><channel><item>
          <title>Transcript Episode</title>
          <guid>transcript-episode-guid</guid>
          <pubDate>Fri, 22 May 2026 10:00:00 GMT</pubDate>
          <link>https://podcast.example.com/transcript-episode</link>
          <podcast:transcript url="https://transcripts.example.com/rss-transcript.txt" type="text/plain" />
        </item></channel></rss>
      `);
    }
    if (url === "https://transcripts.example.com/rss-transcript.txt") {
      return new Response("RSS supplied transcript body");
    }
    if (url === "https://pod2txt.vercel.app/api/transcript") {
      throw new Error("pod2txt should not be called when the RSS item has a transcript URL");
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await crawlPodcastBuilders([builder], {
    pod2txtApiKey: null,
    fetcher,
    now: new Date("2026-05-22T13:00:00.000Z"),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, FeedItemKind.PODCAST_EPISODE);
  assert.equal(result.items[0].externalId, "transcript-episode-guid");
  assert.equal(result.items[0].body, "RSS supplied transcript body");
  assert.equal(result.items[0].url, "https://podcast.example.com/transcript-episode");
  assert.equal(rawJsonTranscriptSource(result.items[0].rawJson), "rss-transcript");
});

test("podcast crawler uses YouTube captions before private transcript services", async () => {
  const builder: CrawlerBuilder = {
    ...baseBuilder,
    kind: BuilderKind.PODCAST,
    handle: null,
    sourceUrl: "https://www.youtube.com/playlist?list=PLCAPTIONS",
    crawlUrl: "https://feeds.example.com/caption-podcast.xml",
  };
  const captionBaseUrl = "https://www.youtube.com/api/timedtext?v=caption123&lang=en";
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    if (url === "https://feeds.example.com/caption-podcast.xml") {
      return new Response(`
        <rss><channel><item>
          <title>Caption Episode</title>
          <guid>caption-episode-guid</guid>
          <pubDate>Fri, 22 May 2026 10:00:00 GMT</pubDate>
          <link>https://podcast.example.com/caption-episode</link>
        </item></channel></rss>
      `);
    }
    if (url === "https://www.youtube.com/feeds/videos.xml?playlist_id=PLCAPTIONS") {
      return new Response(`
        <feed><entry><title>Caption Episode</title><yt:videoId>caption123</yt:videoId></entry></feed>
      `);
    }
    if (url === "https://www.youtube.com/watch?v=caption123") {
      return new Response(`
        <script>
          var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"${captionBaseUrl.replace(/&/g, "\\u0026")}","languageCode":"en"}]}}};
        </script>
      `);
    }
    if (url === `${captionBaseUrl}&fmt=json3`) {
      return Response.json({
        events: [
          { segs: [{ utf8: "YouTube " }, { utf8: "caption transcript" }] },
        ],
      });
    }
    if (url === "https://pod2txt.vercel.app/api/transcript") {
      throw new Error("pod2txt should not be called when YouTube captions are available");
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await crawlPodcastBuilders([builder], {
    pod2txtApiKey: null,
    fetcher,
    now: new Date("2026-05-22T13:00:00.000Z"),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].body, "YouTube caption transcript");
  assert.equal(rawJsonTranscriptSource(result.items[0].rawJson), "youtube-captions");
  assert.equal(result.items[0].url, "https://www.youtube.com/watch?v=caption123");
});

test("podcast crawler can transcribe RSS audio with OpenAI when no transcript exists", async () => {
  const builder: CrawlerBuilder = {
    ...baseBuilder,
    kind: BuilderKind.PODCAST,
    handle: null,
    sourceUrl: "https://podcast.example.com",
    crawlUrl: "https://feeds.example.com/audio-podcast.xml",
  };
  const fetcher: Fetcher = async (input, init) => {
    const url = String(input);
    if (url === "https://feeds.example.com/audio-podcast.xml") {
      return new Response(`
        <rss><channel><item>
          <title>Audio Episode</title>
          <guid>audio-episode-guid</guid>
          <pubDate>Fri, 22 May 2026 10:00:00 GMT</pubDate>
          <link>https://podcast.example.com/audio-episode</link>
          <enclosure url="https://audio.example.com/episode.mp3" type="audio/mpeg" length="1024" />
        </item></channel></rss>
      `);
    }
    if (url === "https://audio.example.com/episode.mp3" && init?.method === "HEAD") {
      return new Response(null, { headers: { "content-length": "1024" } });
    }
    if (url === "https://audio.example.com/episode.mp3") {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/mpeg" },
      });
    }
    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers && "Authorization" in init.headers, true);
      assert.equal(init?.body instanceof FormData, true);
      return Response.json({ text: "OpenAI transcript body" });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await crawlPodcastBuilders([builder], {
    openAiApiKey: "openai-key",
    pod2txtApiKey: null,
    fetcher,
    now: new Date("2026-05-22T13:00:00.000Z"),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].externalId, "audio-episode-guid");
  assert.equal(result.items[0].body, "OpenAI transcript body");
  assert.equal(rawJsonTranscriptSource(result.items[0].rawJson), "openai-audio-transcription");
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
      return new Response(`{"externalId":"${channelId}"}`);
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

test("central crawler source adapters dispatch RSS podcasts separately from YouTube", async () => {
  assert.deepEqual(
    centralCrawlerSourceAdapters().map((adapter) => adapter.id),
    ["x", "podcast", "blog"],
  );

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
          <title>RSS Episode</title>
          <guid>rss-episode-guid</guid>
          <pubDate>Fri, 22 May 2026 10:00:00 GMT</pubDate>
          <link>https://podcast.example.com/rss-episode</link>
        </item></channel></rss>
      `);
    }
    if (url === "https://pod2txt.vercel.app/api/transcript") {
      return Response.json({ status: "ready", url: "https://transcripts.example.com/rss.txt" });
    }
    if (url === "https://transcripts.example.com/rss.txt") {
      return new Response("RSS transcript body");
    }
    if (url === "https://www.youtube.com/feeds/videos.xml?playlist_id=PL123") {
      return new Response(`
        <feed><entry><title>RSS Episode</title><yt:videoId>rss123</yt:videoId></entry></feed>
      `);
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await crawlBuilders([builder], {
    pod2txtApiKey: "pod-key",
    fetcher,
    now: new Date("2026-05-22T13:00:00.000Z"),
    maxTranscriptAttempts: 1,
    transcriptPollIntervalMs: 1,
  });

  assert.equal(result.sources.podcasts.builders, 1);
  assert.equal(result.sources.podcasts.feedItems, 1);
  assert.equal(result.items[0].externalId, "rss-episode-guid");
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

test("cron fallback is enabled only for blocked X or podcast sources with no items", () => {
  assert.equal(
    shouldImportFollowBuildersFallback({
      sources: {
        x: { builders: 25, feedItems: 0, errors: ["X API: User lookup failed: HTTP 402"] },
        podcasts: { builders: 6, feedItems: 0, errors: [] },
      },
    }),
    true,
  );
  assert.equal(
    shouldImportFollowBuildersFallback({
      sources: {
        x: { builders: 25, feedItems: 1, errors: ["X API: User lookup failed: HTTP 402"] },
        podcasts: { builders: 6, feedItems: 0, errors: ["Podcast: POD2TXT_API_KEY is not configured"] },
      },
    }),
    true,
  );
  assert.equal(
    shouldImportFollowBuildersFallback({
      sources: {
        x: { builders: 25, feedItems: 1, errors: [] },
        podcasts: { builders: 6, feedItems: 1, errors: [] },
      },
    }),
    false,
  );
});
