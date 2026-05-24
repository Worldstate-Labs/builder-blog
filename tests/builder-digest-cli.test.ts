import assert from "node:assert/strict";
import test from "node:test";

test("personal blog crawler discovers RSS feed articles", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const candidates = cli.parseBlogCandidates(
    `
    <rss><channel>
      <item>
        <title>Launch Notes</title>
        <link>https://example.com/blog/launch-notes</link>
        <pubDate>Fri, 22 May 2026 10:00:00 GMT</pubDate>
        <description>Useful update</description>
      </item>
    </channel></rss>
    `,
    "https://example.com/feed.xml",
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://example.com/blog/launch-notes");
  assert.equal(candidates[0].publishedAt, "2026-05-22T10:00:00.000Z");
});

test("personal blog crawler keeps only article-like same-origin HTML links", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const candidates = cli.parseBlogCandidates(
    `
    <a href="/blog/building-agents">Building Agents</a>
    <a href="/pricing">Pricing</a>
    <a href="https://elsewhere.com/blog/nope">External</a>
    `,
    "https://example.com",
  );

  assert.deepEqual(
    candidates.map((candidate: { url: string }) => candidate.url),
    ["https://example.com/blog/building-agents"],
  );
});

test("personal blog crawler extracts article text", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const article = cli.extractBlogArticle(`
    <html>
      <head>
        <meta property="og:title" content="Agent Architecture">
        <meta property="article:published_time" content="2026-05-22T12:00:00Z">
      </head>
      <body>
        <article>
          <p>This paragraph is long enough to be included in the extracted article body for digest generation.</p>
        </article>
      </body>
    </html>
  `);

  assert.equal(article.title, "Agent Architecture");
  assert.equal(article.publishedAt, "2026-05-22T12:00:00.000Z");
  assert.match(article.body, /long enough/);
});

test("personal blog crawler uses Anthropic Next data when available", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const candidates = cli.parseBlogCandidates(
    `
    <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"posts":[{"title":"Scaling Agents","slug":{"current":"scaling-agents"},"publishedOn":"2026-05-20T12:00:00Z","summary":"Agent lessons"}]}}}
    </script>
    `,
    "https://www.anthropic.com/engineering",
  );
  const article = cli.extractBlogArticle(
    `
    <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"post":{"title":"Scaling Agents","publishedOn":"2026-05-20T12:00:00Z","body":[{"_type":"block","children":[{"text":"First structured paragraph."}]},{"_type":"block","children":[{"text":"Second structured paragraph."}]}]}}}}
    </script>
    `,
    "https://www.anthropic.com/engineering/scaling-agents",
  );

  assert.equal(candidates[0].url, "https://www.anthropic.com/engineering/scaling-agents");
  assert.equal(candidates[0].publishedAt, "2026-05-20T12:00:00.000Z");
  assert.equal(article.title, "Scaling Agents");
  assert.equal(article.publishedAt, "2026-05-20T12:00:00.000Z");
  assert.equal(article.body, "First structured paragraph.\n\nSecond structured paragraph.");
});

test("personal blog crawler uses Claude JSON-LD and rich text body when available", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const candidates = cli.parseBlogCandidates(
    `
    <a href="/blog/tool-use">Tool use</a>
    <a href="/blog/tool-use">Duplicate</a>
    `,
    "https://claude.com/blog",
  );
  const article = cli.extractBlogArticle(
    `
    <script type="application/ld+json">{"@type":"BlogPosting","headline":"Tool use","datePublished":"2026-05-21T09:00:00Z"}</script>
    <div class="u-rich-text-blog"><p>This is the rich text body from Claude Blog.</p></div></div>
    `,
    "https://claude.com/blog/tool-use",
  );

  assert.deepEqual(
    candidates.map((candidate: { url: string }) => candidate.url),
    ["https://claude.com/blog/tool-use"],
  );
  assert.equal(article.title, "Tool use");
  assert.equal(article.publishedAt, "2026-05-21T09:00:00.000Z");
  assert.equal(article.body, "This is the rich text body from Claude Blog.");
});

test("personal YouTube crawler resolves channel pages to RSS feeds", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const feedUrl = await cli.youtubeFeedUrl("https://www.youtube.com/@ExampleBuilder", async () =>
    new Response('<html>{"externalId":"UCabcdefghijklmnopqrstuvwx"}</html>'),
  );

  assert.equal(
    feedUrl,
    "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuvwx",
  );
});

test("personal YouTube crawler maps feed entries into syncable episodes", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const videos = cli.parseYouTubeFeed(
    `
    <feed>
      <entry>
        <yt:videoId>video123</yt:videoId>
        <title>Building Useful Agents</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=video123" />
        <published>2026-05-22T10:00:00+00:00</published>
        <media:description>Practical agent lessons.</media:description>
      </entry>
    </feed>
    `,
    "https://www.youtube.com/feeds/videos.xml?channel_id=UC123",
  );

  assert.equal(videos.length, 1);
  assert.equal(videos[0].videoId, "video123");
  assert.equal(videos[0].url, "https://www.youtube.com/watch?v=video123");
  assert.equal(videos[0].publishedAt, "2026-05-22T10:00:00.000Z");
  assert.equal(videos[0].description, "Practical agent lessons.");
});

test("personal crawler reports concrete crawling tool identity", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  assert.match(
    cli.skillCrawlingTool("YouTube RSS + captions", "gpt-5.5"),
    /\(model gpt-5\.5\) Builder Blog skill crawler \(YouTube RSS \+ captions\)/,
  );
});

test("personal crawler keeps crawled builders eligible and tracks seen post keys", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const context = {
    libraryBuilders: [
      {
        id: "builder_blog_1",
        scope: "PERSONAL",
        kind: "BLOG",
        sourceType: "auto",
        name: "Already Crawled Blog",
        sourceUrl: "https://example.com/blog",
      },
      {
        id: "builder_blog_2",
        scope: "PERSONAL",
        kind: "BLOG",
        sourceType: "auto",
        name: "Fresh Blog",
        sourceUrl: "https://example.com/fresh",
      },
      {
        id: "builder_youtube_1",
        scope: "PERSONAL",
        kind: "PODCAST",
        sourceType: "auto",
        name: "Auto YouTube",
        sourceUrl: "https://www.youtube.com/@example",
      },
      {
        id: "builder_website_1",
        scope: "PERSONAL",
        kind: "WEBSITE",
        sourceType: "website",
        name: "Personal Website",
        sourceUrl: "https://example.com",
      },
      {
        id: "builder_podcast_1",
        scope: "PERSONAL",
        kind: "PODCAST",
        sourceType: "podcast",
        name: "Private Podcast",
        sourceUrl: "https://feeds.example.com/show.xml",
      },
      {
        id: "builder_central_1",
        scope: "CENTRAL",
        kind: "BLOG",
        name: "Central Blog",
        sourceUrl: "https://example.com/central",
      },
    ],
    personalCrawlStates: [
      {
        builderId: "builder_blog_1",
        lastCrawledAt: "2026-05-22T10:00:00.000Z",
      },
    ],
    personalSeenItems: [
      {
        builderId: "builder_blog_1",
        kind: "BLOG_POST",
        externalId: "https://example.com/blog/launch-notes",
        publishedAt: "2026-05-22T10:00:00.000Z",
        createdAt: "2026-05-22T10:05:00.000Z",
      },
    ],
    latestPersonalFeedItems: [
      {
        builderId: "builder_blog_1",
        latestPostAt: "2026-05-22T10:00:00.000Z",
      },
    ],
  };

  assert.deepEqual(
    cli.personalBuildersForCrawl(context).map((builder: { id: string }) => builder.id),
    [
      "builder_blog_1",
      "builder_blog_2",
      "builder_youtube_1",
      "builder_website_1",
      "builder_podcast_1",
    ],
  );
  assert.equal(
    cli
      .seenItemKeysForBuilder(context, "builder_blog_1")
      .has(cli.personalItemKey("builder_blog_1", "BLOG_POST", "https://example.com/blog/launch-notes")),
    true,
  );
  assert.equal(
    cli.cutoffForBuilder(
      context,
      "builder_blog_1",
      new Date("2026-04-22T00:00:00.000Z"),
    ).toISOString(),
    "2026-05-22T10:00:00.000Z",
  );
});
