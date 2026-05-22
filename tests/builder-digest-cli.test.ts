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
    candidates.map((candidate) => candidate.url),
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
