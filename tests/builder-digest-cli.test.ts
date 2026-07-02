import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const missingCommandRunner = async () => ({
  ok: false,
  code: null,
  stdout: "",
  stderr: "command_not_found",
  timedOut: false,
});

test("personal blog fetcher discovers RSS feed articles", async () => {
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

test("personal blog fetcher keeps only article-like same-origin HTML links", async () => {
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

test("personal blog fetcher extracts article text", async () => {
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

test("final personal fetch cutoff rejects old dated items from any source", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const cutoff = new Date("2026-03-25T00:00:00.000Z");

  assert.equal(
    cli.itemIsWithinFetchCutoff({ publishedAt: "2025-03-20T00:00:00.000Z" }, cutoff),
    false,
  );
  assert.equal(
    cli.itemIsWithinFetchCutoff({ publishedAt: "2026-05-20T00:00:00.000Z" }, cutoff),
    true,
  );
  assert.equal(cli.itemIsWithinFetchCutoff({ publishedAt: null }, cutoff), true);
});

test("personal blog fetcher extracts Mintlify-style docs paragraphs", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const article = cli.extractBlogArticle(`
    <html>
      <head>
        <meta property="og:title" content="Best practices for Claude Code - Claude Code Docs">
      </head>
      <body>
        <main>
          <div id="content">
            <span data-as="p">Claude Code is an agentic coding environment that can read files, run commands, make changes, and autonomously work through problems.</span>
            <span data-as="p">Most best practices are based on one constraint: Claude's context window fills up fast, and performance degrades as it fills.</span>
          </div>
        </main>
      </body>
    </html>
  `);

  assert.equal(article.title, "Best practices for Claude Code - Claude Code Docs");
  assert.match(article.body, /agentic coding environment/);
  assert.match(article.body, /context window fills up fast/);
});

test("personal blog fetcher sends short description-only reads to the agent", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const builder = {
    id: "builder_anthropic",
    name: "anthropic.com",
    kind: "BLOG",
    sourceUrl: "https://www.anthropic.com/engineering",
    fetchUrl: "https://www.anthropic.com/engineering",
  };
  const result = await cli.fetchPersonalBlogBuilderForTest(builder, {
    cutoff: new Date("2026-05-01T00:00:00.000Z"),
    limit: 1,
    agentModel: "test-model",
    fetchedItemKeys: new Set(),
    sources: {
      blog: {
        contentQuality: { minChars: 200, minContentUnits: 35 },
      },
    },
    fetcher: async (url: string) => {
      if (url === "https://www.anthropic.com/engineering") {
        return new Response(`
          <rss><channel>
            <item>
              <title>Best practices for Claude Code - Claude Code Docs</title>
              <link>https://www.anthropic.com/engineering/claude-code-best-practices</link>
              <pubDate>Sun, 31 May 2026 14:05:09 GMT</pubDate>
              <description>Tips and patterns for getting the most out of Claude Code, from configuring your environment to scaling across parallel sessions.</description>
            </item>
          </channel></rss>
        `);
      }
      return new Response(`
        <html>
          <head><meta property="og:title" content="Best practices for Claude Code - Claude Code Docs"></head>
          <body><main><p>Tips and patterns for getting the most out of Claude Code, from configuring your environment to scaling across parallel sessions.</p></main></body>
        </html>
      `);
    },
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.agentTasks.length, 1);
  assert.equal(result.agentTasks[0].type, "blog_article_fetch");
  assert.equal(result.agentTasks[0].item.url, "https://www.anthropic.com/engineering/claude-code-best-practices");
  assert.equal(result.agentTasks[0].item.rawJson.fallbackReason, "content_too_short");
});

test("GitHub Trending parser extracts daily repo candidates sorted by stars", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const candidates = cli.parseGithubTrendingCandidates(
    `
    <article class="Box-row">
      <h2><a href="/beta-org/beta-tool"> beta-org / beta-tool </a></h2>
      <p>Beta repo description</p>
      <span itemprop="programmingLanguage">TypeScript</span>
      <span>1,204 stars today</span>
    </article>
    <article class="Box-row">
      <h2><a href="/alpha/alpha-lib"> alpha / alpha-lib </a></h2>
      <p>Alpha repo description</p>
      <span itemprop="programmingLanguage">Python</span>
      <span>89 stars today</span>
    </article>
    `,
    "https://github.com/trending?since=daily",
    "2026-06-04",
  );

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].repo, "beta-org/beta-tool");
  assert.equal(candidates[0].starsToday, 1204);
  assert.equal(candidates[0].language, "TypeScript");
  assert.equal(candidates[0].url, "https://github.com/beta-org/beta-tool");
  assert.equal(candidates[0].externalId, "github-trending:beta-org/beta-tool");
});

test("GitHub Trending fetcher emits per-repository agent tasks, not ready items", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const result = await cli.fetchPersonalGithubTrendingBuilderForTest(
    {
      id: "builder_github_trending",
      name: "GitHub Trending",
      sourceType: "github_trending",
      sourceUrl: "https://github.com/trending?since=daily",
      fetchUrl: "https://github.com/trending?since=daily",
    },
    {
      limit: 1,
      fetchedItemKeys: new Set(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      sources: {
        github_trending: {
          contentQuality: { minChars: 500, minContentUnits: 60 },
        },
      },
      fetcher: async () =>
        new Response(`
          <article class="Box-row">
            <h2><a href="/owner/repo"> owner / repo </a></h2>
            <p>Repo description</p>
            <span itemprop="programmingLanguage">Go</span>
            <span>777 stars today</span>
          </article>
        `),
    },
  );

  assert.deepEqual(result.items, []);
  assert.equal(result.agentTasks.length, 1);
  assert.equal(result.agentTasks[0].type, "github_trending_repo_report");
  assert.equal(result.agentTasks[0].sourceType, "github_trending");
  assert.equal(result.agentTasks[0].item.kind, "BLOG_POST");
  assert.equal(result.agentTasks[0].item.url, "https://github.com/owner/repo");
  assert.equal(result.agentTasks[0].item.rawJson.starsToday, 777);
  assert.equal(result.agentTasks[0].item.rawJson.date, "2026-06-04");
});

test("GitHub Trending fetcher skips repos fetched on earlier trending days", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const builderId = "builder_github_trending";
  const result = await cli.fetchPersonalGithubTrendingBuilderForTest(
    {
      id: builderId,
      name: "GitHub Trending",
      sourceType: "github_trending",
      sourceUrl: "https://github.com/trending?since=daily",
      fetchUrl: "https://github.com/trending?since=daily",
    },
    {
      limit: 10,
      fetchedItemKeys: new Set([
        cli.personalItemKey(builderId, "BLOG_POST", "github-trending:2026-06-01:owner/repo"),
        cli.personalItemKey(builderId, "BLOG_POST", "github-trending:other/thing"),
      ]),
      now: new Date("2026-06-04T12:00:00.000Z"),
      fetcher: async () =>
        new Response(`
          <article class="Box-row">
            <h2><a href="/owner/repo"> owner / repo </a></h2>
            <p>Repo description</p>
            <span>777 stars today</span>
          </article>
          <article class="Box-row">
            <h2><a href="/other/thing"> other / thing </a></h2>
            <p>Other repo description</p>
            <span>555 stars today</span>
          </article>
        `),
    },
  );

  assert.deepEqual(result.items, []);
  assert.equal(result.agentTasks.length, 0);
});

test("Product Hunt parser extracts daily product candidates in page order", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const candidates = cli.parseProductHuntTopProductCandidates(
    `
    <a href="/products/mailwarm">Mailwarm 2.0</a>
    <span>Warm up your email and improve deliverability</span>
    <span>82 comments</span>
    <span>1,154 upvotes</span>
    <a href="/products/astra-security">Astra Autonomous Pentest</a>
    <span>AI pentesting agent that validates vulnerabilities</span>
    <span>24 comments</span>
    <span>930 upvotes</span>
    `,
    "https://www.producthunt.com/",
    "2026-06-04",
  );

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].name, "Mailwarm 2.0");
  assert.equal(candidates[0].rank, 1);
  assert.equal(candidates[0].url, "https://www.producthunt.com/products/mailwarm");
  assert.equal(candidates[0].externalId, "product-hunt-top-products:mailwarm");
  assert.equal(candidates[0].date, "2026-06-04");
  assert.equal(candidates[1].name, "Astra Autonomous Pentest");
  assert.equal(candidates[1].rank, 2);
});

test("Product Hunt fetcher emits per-product agent tasks, not ready items", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const result = await cli.fetchPersonalProductHuntTopProductsBuilderForTest(
    {
      id: "builder_product_hunt_top_products",
      name: "Product Hunt Top Products",
      sourceType: "product_hunt_top_products",
      sourceUrl: "https://www.producthunt.com/",
      fetchUrl: "https://www.producthunt.com/",
    },
    {
      limit: 1,
      fetchedItemKeys: new Set(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      sources: {
        product_hunt_top_products: {
          label: "Product Hunt Top Products",
          summaryPrompt: {
            body: "Summarize one Product Hunt product.",
            style: "blog_or_document",
            language: "source",
          },
          fetchPrompt: { body: "Investigate the Product Hunt product page." },
          contentQuality: { minChars: 500, minContentUnits: 60 },
        },
      },
      fetcher: async () =>
        new Response(`
          <a href="/products/mailwarm">Mailwarm 2.0</a>
          <span>Warm up your email and improve deliverability</span>
          <span>82 comments</span>
          <span>1,154 upvotes</span>
        `),
    },
  );

  assert.deepEqual(result.items, []);
  assert.equal(result.agentTasks.length, 1);
  assert.equal(result.agentTasks[0].type, "product_hunt_top_product_report");
  assert.equal(result.agentTasks[0].sourceType, "product_hunt_top_products");
  assert.equal(result.agentTasks[0].item.kind, "BLOG_POST");
  assert.equal(result.agentTasks[0].item.url, "https://www.producthunt.com/products/mailwarm");
  assert.equal(result.agentTasks[0].item.rawJson.rank, 1);
  assert.equal(result.agentTasks[0].item.rawJson.date, "2026-06-04");
});

test("Product Hunt deterministic discovery failure becomes a candidate discovery task", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const builder = {
    id: "builder_product_hunt_top_products",
    kind: "WEBSITE",
    name: "Product Hunt Top Products",
    sourceType: "product_hunt_top_products",
    sourceUrl: "https://www.producthunt.com/",
    fetchUrl: "https://www.producthunt.com/",
  };
  const task = cli.buildPersonalFetchErrorTaskForTest(builder, {
    builderSync: {
      builderId: builder.id,
      kind: "WEBSITE",
      sourceType: "product_hunt_top_products",
      name: builder.name,
      sourceUrl: builder.sourceUrl,
      fetchUrl: builder.fetchUrl,
      subscribe: true,
    },
    error: new Error("Failed to fetch Product Hunt Top Products https://www.producthunt.com/: HTTP 403"),
    limit: 3,
    now: new Date("2026-06-04T12:00:00.000Z"),
    sources: {
      product_hunt_top_products: {
        contentQuality: { minChars: 500, minContentUnits: 60 },
      },
    },
  });

  assert.equal(task.type, "candidate_discovery");
  assert.equal(task.agentWorkType, "candidate_discovery_fallback");
  assert.equal(task.sourceType, "product_hunt_top_products");
  const discoveryTask = task as {
    discovery: { limit: number; date: string; failureEvidence: { status: number } };
    discoveryInstructions: { prompt: string };
  };
  assert.equal(discoveryTask.discovery.limit, 3);
  assert.equal(discoveryTask.discovery.date, "2026-06-04");
  assert.equal(discoveryTask.discovery.failureEvidence.status, 403);
  assert.match(discoveryTask.discoveryInstructions.prompt, /Return strict JSON/);
});

test("candidate discovery results expand into Product Hunt per-product fetch tasks", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const builderSync = {
    builderId: "builder_product_hunt_top_products",
    kind: "WEBSITE",
    sourceType: "product_hunt_top_products",
    name: "Product Hunt Top Products",
    sourceUrl: "https://www.producthunt.com/",
    fetchUrl: "https://www.producthunt.com/",
    subscribe: true,
  };
  const discoveryTask = {
    type: "candidate_discovery",
    id: "candidate_discovery:builder_product_hunt_top_products:product_hunt_top_products",
    agentWorkType: "candidate_discovery_fallback",
    contentStatus: "requires_agent",
    builder: "Product Hunt Top Products",
    builderId: "builder_product_hunt_top_products",
    sourceType: "product_hunt_top_products",
    builderSync,
    discovery: {
      sourceUrl: "https://www.producthunt.com/",
      limit: 3,
      date: "2026-06-04",
    },
  };

  const expanded = cli.expandCandidateDiscoveryFetchResult(
    { status: "ok", localErrors: [], fetchTasks: [discoveryTask] },
    {
      candidateDiscoveries: [
        {
          fetchTaskId: discoveryTask.id,
          status: "ok",
          candidates: [
            {
              rank: 1,
              productName: "Mailwarm 2.0",
              productUrl: "https://www.producthunt.com/products/mailwarm",
              tagline: "Warm up your email and improve deliverability",
              date: "2026-06-04",
              evidenceUrls: ["https://www.producthunt.com/"],
            },
          ],
        },
      ],
    },
    {
      sources: {
        product_hunt_top_products: {
          label: "Product Hunt Top Products",
          summaryPrompt: {
            body: "Summarize one Product Hunt product.",
            style: "blog_or_document",
            language: "source",
          },
          fetchPrompt: { body: "Investigate the Product Hunt product page." },
          contentQuality: { minChars: 500, minContentUnits: 60 },
        },
      },
    },
  );

  assert.equal(expanded.fetchTasks.length, 1);
  assert.equal(expanded.fetchTasks[0].type, "fetch_post");
  assert.equal(expanded.fetchTasks[0].agentWorkType, "product_hunt_top_product_report");
  assert.equal(expanded.fetchTasks[0].item.url, "https://www.producthunt.com/products/mailwarm");
  assert.equal(expanded.fetchTasks[0].item.rawJson.rank, 1);
  assert.equal(expanded.fetchTasks[0].item.rawJson.discoveryFetchTaskId, discoveryTask.id);
});

test("expanded fetch results expose canonical planned post tasks for fetch logs", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const planned = cli.fetchRunPlannedTaskPatches({
    status: "ok",
    fetchTasks: [
      {
        id: "candidate_discovery:product-hunt",
        type: "candidate_discovery",
        agentWorkType: "candidate_discovery_fallback",
        sourceType: "product_hunt_top_products",
        builderId: "builder_product_hunt_top_products",
      },
      {
        id: "fetch_post:product-hunt:workclaw",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        builder: "Product Hunt Top Products",
        builderId: "builder_product_hunt_top_products",
        sourceType: "product_hunt_top_products",
        item: { title: "#1 WorkClaw", url: "https://www.producthunt.com/products/workclaw" },
      },
      {
        id: "fetch_post:blog:ready",
        agentWorkType: "fetch_post",
        contentStatus: "ready",
        builder: "Engineering",
        builderId: "builder_blog",
        sourceType: "blog",
        item: { title: "Ready post", url: "https://example.com/ready", body: "Already fetched." },
      },
      {
        id: "fetch_post:x:token",
        agentWorkType: "x_token_missing",
        contentStatus: "requires_agent",
        builder: "X",
        builderId: "builder_x",
        sourceType: "x",
        item: { title: "Needs token", url: "https://x.com/example/status/1" },
      },
    ],
  });

  assert.deepEqual(
    planned.map((task: { id: string; status: string }) => [task.id, task.status]),
    [
      ["fetch_post:product-hunt:workclaw", "pending"],
      ["fetch_post:blog:ready", "fetched"],
      ["fetch_post:x:token", "action_needed"],
    ],
  );
  assert.equal(
    planned.some((task: { id: string }) => task.id.startsWith("candidate_discovery:")),
    false,
  );
});

test("planned fetch log patches include shard worker ids after fan-out planning", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      {
        id: "fetch_post:podcast:a",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        builder: "Podcast",
        builderId: "builder_podcast",
        sourceType: "youtube",
        item: { title: "Episode A", url: "https://example.com/a" },
      },
      {
        id: "fetch_post:podcast:b",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        builder: "Podcast",
        builderId: "builder_podcast",
        sourceType: "youtube",
        item: { title: "Episode B", url: "https://example.com/b" },
      },
    ],
  };

  const planned = cli.fetchRunPlannedTaskPatches(fetchResult, {
    shardPlans: [
      { shard: "shard-0", tasks: [fetchResult.fetchTasks[0]] },
      { shard: "shard-1", tasks: [fetchResult.fetchTasks[1]] },
    ],
  });

  assert.deepEqual(
    planned.map((task: { id: string; workerId: string | null }) => [task.id, task.workerId]),
    [
      ["fetch_post:podcast:a", "shard-0"],
      ["fetch_post:podcast:b", "shard-1"],
    ],
  );
});

test("sync payload can carry a durable fetch-run plan patch", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchRun = cli.buildFetchRunSyncPatch("fetch_run_1", [
    {
      id: "candidate_discovery:product-hunt",
      agentWorkType: "candidate_discovery_fallback",
      builderId: "builder_product_hunt_top_products",
    },
    {
      id: "fetch_post:product-hunt:workclaw",
      agentWorkType: "fetch_post",
      contentStatus: "ready",
      builder: "Product Hunt Top Products",
      builderId: "builder_product_hunt_top_products",
      sourceType: "product_hunt_top_products",
      item: { title: "#1 WorkClaw", url: "https://www.producthunt.com/products/workclaw" },
    },
  ]);

  assert.ok(fetchRun);
  assert.equal(fetchRun.id, "fetch_run_1");
  assert.equal(fetchRun.plannedTasks.length, 1);
  assert.deepEqual(
    Object.fromEntries(
      [
        "id",
        "builder",
        "builderId",
        "sourceType",
        "title",
        "url",
        "status",
        "contentStatus",
        "agentWorkType",
      ].map((key) => [key, fetchRun.plannedTasks[0][key]]),
    ),
    {
      id: "fetch_post:product-hunt:workclaw",
      builder: "Product Hunt Top Products",
      builderId: "builder_product_hunt_top_products",
      sourceType: "product_hunt_top_products",
      title: "#1 WorkClaw",
      url: "https://www.producthunt.com/products/workclaw",
      status: "fetched",
      contentStatus: "ready",
      agentWorkType: "fetch_post",
    },
  );
});

test("blocked candidate discovery becomes an outcome, not an expanded fetch task", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const discoveryTask = {
    type: "candidate_discovery",
    id: "candidate_discovery:builder_product_hunt_top_products:product_hunt_top_products",
    agentWorkType: "candidate_discovery_fallback",
    contentStatus: "requires_agent",
    builder: "Product Hunt Top Products",
    builderId: "builder_product_hunt_top_products",
    sourceType: "product_hunt_top_products",
    builderSync: {
      builderId: "builder_product_hunt_top_products",
      kind: "WEBSITE",
      sourceType: "product_hunt_top_products",
      name: "Product Hunt Top Products",
      sourceUrl: "https://www.producthunt.com/",
      fetchUrl: "https://www.producthunt.com/",
      subscribe: true,
    },
    discovery: {
      sourceUrl: "https://www.producthunt.com/",
      limit: 3,
      date: "2026-06-04",
    },
  };

  const expanded = cli.expandCandidateDiscoveryFetchResult(
    { status: "ok", localErrors: [], fetchTasks: [discoveryTask] },
    {
      candidateDiscoveries: [
        {
          fetchTaskId: discoveryTask.id,
          status: "blocked",
          reason: "product_hunt_discovery_blocked",
          evidence: { blocker: "Cloudflare challenge" },
        },
      ],
    },
  );

  assert.equal(expanded.fetchTasks.length, 0);
  assert.equal(expanded.taskOutcomes.length, 1);
  assert.equal(expanded.taskOutcomes[0].fetchTaskId, discoveryTask.id);
  assert.equal(expanded.taskOutcomes[0].status, "blocked");
  assert.equal(expanded.taskOutcomes[0].reason, "product_hunt_discovery_blocked");
  assert.equal(expanded.taskOutcomes[0].plannedTask.agentWorkType, "candidate_discovery_fallback");
});

test("Product Hunt fetcher skips products fetched on earlier leaderboard days", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const builderId = "builder_product_hunt_top_products";
  const result = await cli.fetchPersonalProductHuntTopProductsBuilderForTest(
    {
      id: builderId,
      name: "Product Hunt Top Products",
      sourceType: "product_hunt_top_products",
      sourceUrl: "https://www.producthunt.com/",
      fetchUrl: "https://www.producthunt.com/",
    },
    {
      limit: 10,
      fetchedItemKeys: new Set([
        cli.personalItemKey(builderId, "BLOG_POST", "product-hunt-top-products:2026-06-01:mailwarm"),
        cli.personalItemKey(builderId, "BLOG_POST", "product-hunt-top-products:astra-security"),
      ]),
      now: new Date("2026-06-04T12:00:00.000Z"),
      fetcher: async () =>
        new Response(`
          <a href="/products/mailwarm">Mailwarm 2.0</a>
          <span>Warm up your email and improve deliverability</span>
          <span>82 comments</span>
          <span>1,154 upvotes</span>
          <a href="/products/astra-security">Astra Autonomous Pentest</a>
          <span>AI pentesting agent that validates vulnerabilities</span>
          <span>24 comments</span>
          <span>930 upvotes</span>
        `),
    },
  );

  assert.deepEqual(result.items, []);
  assert.equal(result.agentTasks.length, 0);
});

test("personal blog fetcher uses Anthropic Next data when available", async () => {
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

test("personal blog fetcher reads Anthropic rendered card dates", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const candidates = cli.parseBlogCandidates(
    `
    <article class="ArticleList-module__article">
      <a class="ArticleList-module__cardLink" href="/engineering/claude-think-tool">
        <div class="ArticleList-module__content">
          <h3 class="headline-4">The &quot;think&quot; tool: Enabling Claude to stop and think in complex tool use situations</h3>
          <div class="body-2 ArticleList-module__date">Mar 20, 2025</div>
        </div>
      </a>
    </article>
    `,
    "https://www.anthropic.com/engineering",
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://www.anthropic.com/engineering/claude-think-tool");
  assert.equal(
    candidates[0].title,
    'The "think" tool: Enabling Claude to stop and think in complex tool use situations',
  );
  assert.match(candidates[0].publishedAt ?? "", /^2025-03-20T/);
});

test("personal blog fetcher drops articles older than cutoff after article extraction", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const builder = {
    id: "builder_anthropic",
    name: "anthropic.com",
    kind: "BLOG",
    sourceUrl: "https://www.anthropic.com/engineering",
    fetchUrl: "https://www.anthropic.com/engineering",
  };
  const result = await cli.fetchPersonalBlogBuilderForTest(builder, {
    cutoff: new Date("2026-03-25T00:00:00.000Z"),
    limit: 1,
    agentModel: "test-model",
    fetchedItemKeys: new Set(),
    sources: {},
    fetcher: async (url: string) => {
      if (url === "https://www.anthropic.com/engineering") {
        return new Response(`
          <a href="/engineering/claude-think-tool">The &quot;think&quot; tool</a>
        `);
      }
      return new Response(`
        <html>
          <head><meta property="og:title" content="The &quot;think&quot; tool: Enabling Claude to stop and think"></head>
          <body>
            <main>
              <p class="date">Published <!-- -->Mar 20, 2025</p>
              <p>This article body is long enough to satisfy the deterministic content extractor and should be rejected only by the final published date cutoff after article extraction.</p>
            </main>
          </body>
        </html>
      `);
    },
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.agentTasks.length, 0);
});

test("personal blog fetcher uses Claude JSON-LD and rich text body when available", async () => {
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

test("personal YouTube fetcher resolves channel pages to RSS feeds", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const feedUrl = await cli.youtubeFeedUrl("https://www.youtube.com/@ExampleBuilder", async () =>
    new Response('<html>{"externalId":"UCabcdefghijklmnopqrstuvwx"}</html>'),
  );

  assert.equal(
    feedUrl,
    "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuvwx",
  );
});

test("personal YouTube fetcher maps feed entries into syncable episodes", async () => {
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

test("personal YouTube fetcher retries transient feed failures", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const calls: string[] = [];
  const result = await cli.fetchYouTubeVideos(
    "https://www.youtube.com/@ExampleBuilder",
    async (url: string) => {
      calls.push(url);
      if (url === "https://www.youtube.com/@ExampleBuilder") {
        return new Response('<html>{"externalId":"UCabcdefghijklmnopqrstuvwx"}</html>');
      }
      if (calls.filter((call) => call.includes("/feeds/videos.xml")).length === 1) {
        return new Response("not ready", { status: 404 });
      }
      return new Response(`
        <feed>
          <entry>
            <yt:videoId>video456</yt:videoId>
            <title>Retryable YouTube Feed</title>
            <link rel="alternate" href="https://www.youtube.com/watch?v=video456" />
          </entry>
        </feed>
      `);
    },
    { retryDelays: [0] },
  );

  assert.equal(result.sourceDetail, "YouTube RSS");
  assert.equal(result.videos[0].videoId, "video456");
  assert.equal(calls.filter((call) => call.includes("/feeds/videos.xml")).length, 2);
});

test("personal YouTube fetcher falls back to channel videos page when RSS fails", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const result = await cli.fetchYouTubeVideos(
    "https://www.youtube.com/@ExampleBuilder",
    async (url: string) => {
      if (url === "https://www.youtube.com/@ExampleBuilder") {
        return new Response('<html>{"externalId":"UCabcdefghijklmnopqrstuvwx"}</html>');
      }
      if (url.includes("/feeds/videos.xml")) {
        return new Response("unavailable", { status: 500 });
      }
      if (url === "https://www.youtube.com/@ExampleBuilder/videos") {
        return new Response(`
          <html>
            "videoId":"pageVideo123","title":{"runs":[{"text":"Fallback video title"}]}
          </html>
        `);
      }
      return new Response("missing", { status: 404 });
    },
    { retryDelays: [0] },
  );

  assert.equal(result.sourceDetail, "YouTube channel page");
  assert.deepEqual(result.videos[0], {
    videoId: "pageVideo123",
    title: "Fallback video title",
    url: "https://www.youtube.com/watch?v=pageVideo123",
    publishedAt: null,
    description: "",
  });
});

test("personal YouTube fetcher parses modern channel lockup view models", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const videos = cli.parseYouTubePageData(`
    <script>
      var ytInitialData = {
        "contents": {
          "richGridRenderer": {
            "contents": [
              {
                "richItemRenderer": {
                  "content": {
                    "lockupViewModel": {
                      "contentImage": {
                        "thumbnailViewModel": {
                          "image": {
                            "sources": [
                              { "url": "https://i.ytimg.com/vi/HaaKUFAOi84/hqdefault.jpg" }
                            ]
                          }
                        }
                      },
                      "metadata": {
                        "lockupMetadataViewModel": {
                          "title": { "content": "Workspace agents in ChatGPT: Admin and builder controls" },
                          "metadata": {
                            "contentMetadataViewModel": {
                              "metadataRows": [
                                {
                                  "metadataParts": [
                                    { "text": { "content": "8.3K views" } },
                                    { "text": { "content": "1 day ago" } }
                                  ]
                                }
                              ]
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      };
    </script>
  `);

  assert.deepEqual(videos[0], {
    videoId: "HaaKUFAOi84",
    title: "Workspace agents in ChatGPT: Admin and builder controls",
    url: "https://www.youtube.com/watch?v=HaaKUFAOi84",
    publishedAt: null,
    description: "8.3K views · 1 day ago",
  });
});

test("personal YouTube content quality rejects title and description as primary content", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const result = cli.youtubeContentQuality("A product launch description with a link.", {
    source: "youtube-feed-description",
    title: "Launch video",
    description: "A product launch description with a link.",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "description_or_title_is_not_primary_content");
});

test("personal YouTube content quality requires useful transcript substance", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  assert.equal(
    cli.youtubeContentQuality("hello hello hello", {
      source: "youtube-captions",
      title: "Short caption",
      description: "",
    }).ok,
    false,
  );
  assert.equal(
    cli.youtubeContentQuality(
      "We introduce the new agent runtime and show how it plans, executes, checks results, and reports useful evidence to the user.",
      { source: "youtube-captions", title: "Agent runtime", description: "" },
    ).ok,
    true,
  );
  assert.equal(
    cli.youtubeContentQuality("谢谢观看".repeat(20), {
      source: "youtube-captions",
      title: "中文重复字幕",
      description: "",
    }).reason,
    "transcript_too_repetitive",
  );
  assert.equal(
    cli.youtubeContentQuality(
      [
        "00:00",
        "00:04",
        "00:08",
        "00:12",
        "00:16",
        "00:20",
        "这是 一段 有 足够 内容 单元 的 transcript 但是 时间戳 密度 明显 太 高",
      ].join("\n"),
      { source: "youtube-captions", title: "Timestamp noise", description: "" },
    ).reason,
    "transcript_is_timestamp_heavy",
  );
});

test("personal YouTube fetcher returns agent tasks instead of syncing description-only content", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const result = await cli.fetchPersonalYouTubeBuilderForTest(
    {
      id: "builder_youtube_needs_agent",
      name: "Needs Agent YouTube",
      sourceUrl: "https://www.youtube.com/@NeedsAgent",
      fetchUrl: "https://www.youtube.com/@NeedsAgent",
    },
    {
      cutoff: null,
      limit: 1,
      agentModel: "gpt-test",
      fetchedItemKeys: new Set(),
      sources: {
        youtube: {
          contentQuality: {
            minChars: 80,
            minContentUnits: 24,
            minLocalDiversity: 0.25,
            maxTimestampDensity: 0.1,
          },
        },
      },
      commandRunner: missingCommandRunner,
      fetcher: async (url: string) => {
        if (url === "https://www.youtube.com/@NeedsAgent") {
          return new Response('<html>{"externalId":"UCneedsagent00000000000000"}</html>');
        }
        if (url.includes("/feeds/videos.xml")) {
          return new Response(`
            <feed>
              <entry>
                <yt:videoId>needsagent1</yt:videoId>
                <title>Needs agent transcription</title>
                <link rel="alternate" href="https://www.youtube.com/watch?v=needsagent1" />
                <published>2026-05-22T10:00:00Z</published>
                <media:description>Launch overview and links.</media:description>
              </entry>
            </feed>
          `);
        }
        if (url === "https://www.youtube.com/watch?v=needsagent1") {
          return new Response("<html>var ytInitialPlayerResponse = {};</html>");
        }
        return new Response("missing", { status: 404 });
      },
    },
  );

  assert.equal(result.items.length, 0);
  assert.equal(result.agentTasks.length, 1);
  assert.match(result.agentTasks[0].id, /^youtube_transcription:/);
  const minimumContentQuality = result.agentTasks[0].minimumContentQuality as { minContentUnits: number };
  const agentTask = result.agentTasks[0] as {
    youtubeExtractionAttempts?: { reason?: string }[];
  };
  assert.equal(minimumContentQuality.minContentUnits, 24);
  assert.equal("reason" in result.agentTasks[0], false);
  assert.equal("sourceDetail" in result.agentTasks[0], false);
  assert.ok(Array.isArray(agentTask.youtubeExtractionAttempts));
  assert.match(
    agentTask.youtubeExtractionAttempts.map((attempt) => attempt.reason).join(" "),
    /yt-dlp_missing/,
  );
});

test("personal YouTube fetcher chooses Chinese captions when metadata strongly indicates Chinese", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const zhTranscript =
    "何小鹏 讨论 人形机器人 技术 组织 产品 战略 赌注 汽车 智能 驾驶 未来 市场 竞争 " +
    "团队 决策 风险 机会 产业 变化 ".repeat(6);
  const enTranscript =
    "He Xiaopeng discusses robots and strategy in an English translation. ".repeat(8);

  const result = await cli.fetchPersonalYouTubeBuilderForTest(
    {
      id: "builder_youtube_chinese",
      name: "Zhang Xiaojun Podcast",
      sourceUrl: "https://www.youtube.com/@xiaojunpodcast",
      fetchUrl: "https://www.youtube.com/@xiaojunpodcast",
    },
    {
      cutoff: null,
      limit: 1,
      agentModel: "gpt-test",
      fetchedItemKeys: new Set(),
      sources: {
        youtube: {
          contentQuality: {
            minChars: 80,
            minContentUnits: 24,
            minLocalDiversity: 0.25,
            maxTimestampDensity: 0.1,
          },
        },
      },
      commandRunner: missingCommandRunner,
      fetcher: async (url: string) => {
        const href = String(url);
        if (href === "https://www.youtube.com/@xiaojunpodcast") {
          return new Response('<html>{"externalId":"UCxiaojun0000000000000000"}</html>');
        }
        if (href.includes("/feeds/videos.xml")) {
          return new Response(`
            <feed>
              <entry>
                <yt:videoId>zhvideo1</yt:videoId>
                <title>He Xiaopeng: Robot IRON's Birth</title>
                <link rel="alternate" href="https://www.youtube.com/watch?v=zhvideo1" />
                <published>2026-05-22T10:00:00Z</published>
                <media:description>本集是小鹏汽车董事长兼CEO何小鹏的访谈，讨论人形机器人、AI、汽车产业和技术剧变。</media:description>
              </entry>
            </feed>
          `);
        }
        if (href === "https://www.youtube.com/watch?v=zhvideo1") {
          return new Response(`
            <html><script>
            var ytInitialPlayerResponse = ${JSON.stringify({
              captions: {
                playerCaptionsTracklistRenderer: {
                  captionTracks: [
                    { languageCode: "en-US", baseUrl: "https://captions.example/en" },
                    { languageCode: "zh-Hans", baseUrl: "https://captions.example/zh", kind: "asr" },
                  ],
                },
              },
            })};
            </script></html>
          `);
        }
        if (href.startsWith("https://captions.example/zh")) {
          return new Response(JSON.stringify({ events: [{ segs: [{ utf8: zhTranscript }] }] }));
        }
        if (href.startsWith("https://captions.example/en")) {
          return new Response(JSON.stringify({ events: [{ segs: [{ utf8: enTranscript }] }] }));
        }
        return new Response("missing", { status: 404 });
      },
    },
  );

  assert.equal(result.agentTasks.length, 0);
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].body, /何小鹏/);
  assert.equal(result.items[0].rawJson.captionLanguageCode, "zh-Hans");
  assert.equal(result.items[0].rawJson.inferredSourceLanguage, "zh");
});

test("personal YouTube fetcher uses yt-dlp metadata captions before agent fallback", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const zhLine =
    "何小鹏 讨论 人形机器人 技术 组织 产品 战略 赌注 汽车 智能 驾驶 未来 市场 竞争 团队 决策 风险 机会 产业 变化";
  const vtt = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:04.000",
    zhLine,
    "",
    "00:00:04.000 --> 00:00:07.000",
    zhLine,
    "",
    "00:00:07.000 --> 00:00:10.000",
    `${zhLine} 机器人 软件 硬件 供应链 商业化 节奏 判断`,
  ].join("\n");

  const result = await cli.fetchPersonalYouTubeBuilderForTest(
    {
      id: "builder_youtube_ytdlp",
      name: "Zhang Xiaojun Podcast",
      sourceUrl: "https://www.youtube.com/@xiaojunpodcast",
      fetchUrl: "https://www.youtube.com/@xiaojunpodcast",
    },
    {
      cutoff: null,
      limit: 1,
      agentModel: "gpt-test",
      fetchedItemKeys: new Set(),
      sources: {
        youtube: {
          contentQuality: {
            minChars: 80,
            minContentUnits: 24,
            minLocalDiversity: 0.2,
            maxTimestampDensity: 0.1,
          },
        },
      },
      commandRunner: async (command: string, args: string[]) => {
        if (command === "yt-dlp" && args[0] === "--version") {
          return { ok: true, code: 0, stdout: "2026.01.01", stderr: "", timedOut: false };
        }
        if (command === "yt-dlp" && args.includes("-J")) {
          return {
            ok: true,
            code: 0,
            stdout: JSON.stringify({
              title: "He Xiaopeng: Robot IRON's Birth",
              subtitles: {
                "en-US": [{ ext: "vtt", url: "https://captions.example/en.vtt" }],
                "zh-Hans": [{ ext: "vtt", url: "https://captions.example/zh.vtt" }],
              },
              automatic_captions: {},
            }),
            stderr: "",
            timedOut: false,
          };
        }
        return missingCommandRunner();
      },
      fetcher: async (url: string) => {
        const href = String(url);
        if (href === "https://www.youtube.com/@xiaojunpodcast") {
          return new Response('<html>{"externalId":"UCxiaojun0000000000000000"}</html>');
        }
        if (href.includes("/feeds/videos.xml")) {
          return new Response(`
            <feed>
              <entry>
                <yt:videoId>zhvideo2</yt:videoId>
                <title>He Xiaopeng: Robot IRON's Birth</title>
                <link rel="alternate" href="https://www.youtube.com/watch?v=zhvideo2" />
                <published>2026-05-22T10:00:00Z</published>
                <media:description>本集是何小鹏的中文访谈，讨论人形机器人、AI、汽车产业和技术剧变。</media:description>
              </entry>
            </feed>
          `);
        }
        if (href === "https://captions.example/zh.vtt") return new Response(vtt);
        if (href === "https://captions.example/en.vtt") {
          return new Response("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nEnglish translation");
        }
        return new Response("missing", { status: 404 });
      },
    },
  );

  assert.equal(result.agentTasks.length, 0);
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].body, /何小鹏/);
  assert.doesNotMatch(result.items[0].body, /00:00/);
  assert.equal(result.items[0].rawJson.captionLanguageCode, "zh-Hans");
  assert.equal(result.items[0].rawJson.youtubeExtractionAttempts[0].method, "yt-dlp-captions");
  assert.equal(result.items[0].rawJson.youtubeExtractionAttempts[0].status, "ok");
});

test("personal YouTube fetcher falls back to agent when caption language is ambiguous", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const result = await cli.fetchPersonalYouTubeBuilderForTest(
    {
      id: "builder_youtube_ambiguous",
      name: "Ambiguous YouTube",
      sourceUrl: "https://www.youtube.com/@ambiguous",
      fetchUrl: "https://www.youtube.com/@ambiguous",
    },
    {
      cutoff: null,
      limit: 1,
      agentModel: "gpt-test",
      fetchedItemKeys: new Set(),
      sources: {
        youtube: {
          contentQuality: {
            minChars: 80,
            minContentUnits: 24,
            minLocalDiversity: 0.25,
            maxTimestampDensity: 0.1,
          },
        },
      },
      commandRunner: missingCommandRunner,
      fetcher: async (url: string) => {
        const href = String(url);
        if (href === "https://www.youtube.com/@ambiguous") {
          return new Response('<html>{"externalId":"UCambiguous0000000000000"}</html>');
        }
        if (href.includes("/feeds/videos.xml")) {
          return new Response(`
            <feed>
              <entry>
                <yt:videoId>ambiguous1</yt:videoId>
                <title>AI interview highlights</title>
                <link rel="alternate" href="https://www.youtube.com/watch?v=ambiguous1" />
                <published>2026-05-22T10:00:00Z</published>
                <media:description>Conversation notes and links.</media:description>
              </entry>
            </feed>
          `);
        }
        if (href === "https://www.youtube.com/watch?v=ambiguous1") {
          return new Response(`
            <html><script>
            var ytInitialPlayerResponse = ${JSON.stringify({
              captions: {
                playerCaptionsTracklistRenderer: {
                  captionTracks: [
                    { languageCode: "en-US", baseUrl: "https://captions.example/en" },
                    { languageCode: "zh-Hans", baseUrl: "https://captions.example/zh" },
                  ],
                },
              },
            })};
            </script></html>
          `);
        }
        return new Response("missing", { status: 404 });
      },
    },
  );

  assert.equal(result.items.length, 0);
  assert.equal(result.agentTasks.length, 1);
  assert.equal(result.agentTasks[0].type, "youtube_transcription");
});

test("agent sync validation accepts fetch task YouTube transcript with execution proof", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = {
    type: "fetch_post",
    agentWorkType: "youtube_transcription",
    contentStatus: "requires_agent",
    builder: "Anthropic YouTube",
    builderId: "builder_anthropic_youtube",
    sourceType: "youtube",
    item: {
      kind: "PODCAST_EPISODE",
      externalId: "dPn3GBI8lII",
      title: "Introducing Claude Opus 4.6",
      url: "https://www.youtube.com/watch?v=dPn3GBI8lII",
      description: "A short launch description.",
    },
  };
  const taskId = cli.fetchTaskId(task);
  const result = cli.validateAgentSyncPayload(
    { fetchTasks: [{ ...task, id: taskId }] },
    {
      builders: [
        {
          kind: "PODCAST",
          sourceType: "youtube",
          name: "Anthropic YouTube",
          sourceUrl: "https://www.youtube.com/@anthropic-ai",
          items: [
            {
              kind: "PODCAST_EPISODE",
              externalId: "dPn3GBI8lII",
              title: "Introducing Claude Opus 4.6",
              body:
                "In this video the speaker introduces Claude Opus 4.6, explains the model improvements, describes practical coding workflows, and compares how the system behaves on realistic agent tasks.",
              summary:
                "这条视频介绍 Claude Opus 4.6 的模型改进和实际 coding agent 工作流，重点是更贴近真实任务的表现。来源：https://www.youtube.com/watch?v=dPn3GBI8lII",
              url: "https://www.youtube.com/watch?v=dPn3GBI8lII",
              rawJson: {
                builderId: "builder_anthropic_youtube",
                fetchTaskId: taskId,
                agentRuntime: "Codex",
                agentModel: "gpt-test",
                agentCompletedAt: "2026-05-24T10:00:00.000Z",
                agentExecutionProof: "Codex watched/transcribed the video through local tooling.",
                transcriptSource: "agent-transcript",
              },
            },
          ],
        },
      ],
    },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.validatedFetchTasks, 1);
  assert.equal("validatedFetchTaskItems" in result, false);
});

test("agent sync validation accepts ready fetch task summaries", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = {
    type: "fetch_post",
    contentStatus: "ready",
    builder: "Example Blog",
    builderId: "builder_blog",
    sourceType: "blog",
    item: {
      kind: "BLOG_POST",
      externalId: "https://example.com/post",
      title: "Shipping durable agents",
      url: "https://example.com/post",
      body: "The post explains how the team shipped durable agents with explicit state, replayable event logs, and source-linked summaries for every fetched item.",
    },
  };
  const taskId = cli.fetchTaskId(task);
  const result = cli.validateAgentSyncPayload(
    {
      fetchTasks: [{ ...task, id: taskId }],
    },
    {
      builders: [
        {
          builderId: "builder_blog",
          kind: "BLOG",
          sourceType: "blog",
          name: "Example Blog",
          sourceUrl: "https://example.com",
          items: [
            {
              kind: "BLOG_POST",
              externalId: "https://example.com/post",
              title: "Shipping durable agents",
              body: "The post explains how the team shipped durable agents with explicit state, replayable event logs, and source-linked summaries for every fetched item.",
              summary:
                "这篇文章讲 durable agents 的实现：显式 state、可重放事件日志，以及为每个 fetched item 生成带来源的 summary。来源：https://example.com/post",
              url: "https://example.com/post",
              rawJson: {
                builderId: "builder_blog",
                fetchTaskId: taskId,
              },
            },
          ],
        },
      ],
    },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.validatedFetchTasks, 1);
  assert.equal("validatedFetchTaskItems" in result, false);
});

test("agent sync validation disambiguates duplicate external ids by builder id", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const englishTask = {
    type: "fetch_post",
    agentWorkType: "translate_summary_only",
    contentStatus: "ready",
    builder: "Andrej Karpathy",
    builderId: "builder_english",
    sourceType: "x",
    item: {
      kind: "TWEET",
      externalId: "2069547676849557725",
      title: "Claude workflow",
      url: "https://x.com/karpathy/status/2069547676849557725",
      body: "",
    },
  };
  const chineseTask = {
    ...englishTask,
    builderId: "builder_chinese",
  };
  const englishTaskId = cli.fetchTaskId(englishTask);
  const chineseTaskId = cli.fetchTaskId(chineseTask);

  const result = cli.validateAgentSyncPayload(
    {
      fetchTasks: [
        { ...englishTask, id: englishTaskId },
        { ...chineseTask, id: chineseTaskId },
      ],
    },
    {
      builders: [
        {
          builderId: "builder_chinese",
          kind: "X",
          sourceType: "x",
          name: "Andrej Karpathy",
          items: [
            {
              kind: "TWEET",
              externalId: "2069547676849557725",
              title: "Claude workflow",
              url: "https://x.com/karpathy/status/2069547676849557725",
              summary:
                "Andrej Karpathy 用中文总结 Claude 工作流的关键经验，强调长上下文和可验证输出的重要性。",
              rawJson: {
                builderId: "builder_chinese",
                fetchTaskId: chineseTaskId,
              },
            },
          ],
        },
        {
          builderId: "builder_english",
          kind: "X",
          sourceType: "x",
          name: "Andrej Karpathy",
          items: [
            {
              kind: "TWEET",
              externalId: "2069547676849557725",
              title: "Claude workflow",
              url: "https://x.com/karpathy/status/2069547676849557725",
              summary:
                "Andrej Karpathy says Claude workflows benefit from long context, careful verification, and source-linked outputs.",
              rawJson: {
                builderId: "builder_english",
                fetchTaskId: englishTaskId,
              },
            },
          ],
        },
      ],
    },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.validatedFetchTasks, 2);
});

test("sync upload payload keeps YouTube transcript temporary without storing summary as body", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const payload = cli.prepareSyncPayloadForUpload({
    builders: [
      {
        builderId: "builder_yt",
        kind: "PODCAST",
        sourceType: "youtube",
        name: "Example YouTube",
        items: [
          {
            kind: "PODCAST_EPISODE",
            externalId: "video1",
            title: "Video",
            body: "Transcript body. ".repeat(200),
            summary: "YouTube summary with the important details.",
            url: "https://www.youtube.com/watch?v=video1",
            rawJson: {
              fetchTaskId: "task-yt",
              transcriptSource: "youtube-captions",
              transcript: "Transcript body. ".repeat(200),
            },
          },
        ],
      },
    ],
  });

  const item = payload.builders[0].items[0];
  assert.equal(item.body, "");
  assert.equal(item.rawJson.transcript, "[removed raw content]");
  assert.equal(item.rawJson.rawContentPolicy.durableRawMode, "none");
  assert.equal(item.rawJson.rawContentPolicy.bodyStored, false);
  assert.equal(item.rawJson.acquisition.provider, "youtube");
});

test("sync upload payload strips raw tweet API objects", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const payload = cli.prepareSyncPayloadForUpload({
    builders: [
      {
        builderId: "builder_x",
        kind: "X",
        sourceType: "x",
        name: "Example X",
        items: [
          {
            kind: "TWEET",
            externalId: "tweet1",
            title: null,
            body: "A short tweet.",
            summary: "Tweet summary with context.",
            url: "https://x.com/example/status/tweet1",
            rawJson: {
              fetchTaskId: "task-x",
              tweet: { id: "tweet1", text: "A short tweet." },
            },
          },
        ],
      },
    ],
  });

  const item = payload.builders[0].items[0];
  assert.equal(item.body, "A short tweet.");
  assert.equal(item.rawJson.tweet, "[removed raw content]");
  assert.equal(item.rawJson.rawContentPolicy.durableRawMode, "full");
  assert.equal(item.rawJson.acquisition.method, "x-api-v2");
});

test("sync upload payload keeps Product Hunt durable facts body instead of summary fallback", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const payload = cli.prepareSyncPayloadForUpload({
    builders: [
      {
        builderId: "builder_ph",
        kind: "PRODUCT",
        sourceType: "product_hunt_top_products",
        name: "Product Hunt",
        items: [
          {
            kind: "POST",
            externalId: "product1",
            title: "Product",
            body: "Product: Acme Launch\nTagline: Helps teams review launches.\nRank: #3\nMaker note: Built for workflow-heavy teams.",
            summary: "Structured product facts and summary.",
            url: "https://www.producthunt.com/posts/product1",
            rawJson: {
              fetchTaskId: "task-ph",
              html: "<main>raw product page</main>",
              comments: ["raw user comment"],
            },
          },
        ],
      },
    ],
  });

  const item = payload.builders[0].items[0];
  assert.match(item.body, /^Product: Acme Launch/);
  assert.equal(item.rawJson.html, "[removed raw content]");
  assert.equal(item.rawJson.comments, "[removed raw content]");
  assert.equal(item.rawJson.rawContentPolicy.durableRawMode, "facts_only");
  assert.equal(item.rawJson.rawContentPolicy.bodyStored, true);
});

test("sync upload payload never stores summary as durable body when item body is absent", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const payload = cli.prepareSyncPayloadForUpload({
    builders: [
      {
        builderId: "builder_yt",
        kind: "PODCAST",
        sourceType: "youtube",
        name: "Example YouTube",
        items: [
          {
            kind: "PODCAST_EPISODE",
            externalId: "video1",
            title: "Video",
            body: "",
            summary: "YouTube summary with the important details.",
            url: "https://www.youtube.com/watch?v=video1",
            rawJson: {
              fetchTaskId: "task-yt-empty",
              transcriptSource: "youtube-captions",
            },
          },
        ],
      },
    ],
  });

  const item = payload.builders[0].items[0];
  assert.equal(item.body, "");
  assert.equal(item.rawJson.rawContentPolicy.bodyStored, false);
});

test("sync payload converts items older than the planned fetch cutoff to skipped outcomes", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const filtered = cli.filterStaleSyncItemsByFetchCutoff(
    {
      builders: [
        {
          builderId: "builder_blog",
          name: "Engineering",
          items: [
            {
              kind: "BLOG_POST",
              externalId: "https://www.anthropic.com/engineering/claude-think-tool",
              title: 'The "think" tool',
              body: "Fetched body",
              summary: "A valid summary for this fetched body that is long enough.",
              url: "https://www.anthropic.com/engineering/claude-think-tool",
              publishedAt: "2025-03-20T00:00:00.000Z",
              rawJson: { fetchTaskId: "fetch_post:blog:think" },
            },
          ],
        },
      ],
    },
    [
      {
        id: "fetch_post:blog:think",
        fetchCutoff: "2026-03-25T00:00:00.000Z",
        item: {
          title: 'The "think" tool',
          url: "https://www.anthropic.com/engineering/claude-think-tool",
        },
      },
    ],
  );

  assert.deepEqual(filtered.builders, []);
  assert.equal(filtered.taskOutcomes.length, 1);
  assert.equal(filtered.taskOutcomes[0].fetchTaskId, "fetch_post:blog:think");
  assert.equal(filtered.taskOutcomes[0].status, "skipped");
  assert.equal(filtered.taskOutcomes[0].reason, "published_before_fetch_cutoff");
  assert.equal(filtered.taskOutcomes[0].evidence.publishedAt, "2025-03-20T00:00:00.000Z");
  assert.equal(filtered.taskOutcomes[0].evidence.fetchCutoff, "2026-03-25T00:00:00.000Z");
});

test("sync payload keeps items newer than the planned fetch cutoff when dates are ISO strings", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const filtered = cli.filterStaleSyncItemsByFetchCutoff(
    {
      builders: [
        {
          builderId: "builder_blog",
          name: "Engineering",
          items: [
            {
              kind: "BLOG_POST",
              externalId: "https://example.com/new-post",
              title: "New post",
              body: "Fetched body",
              summary: "A valid summary for this fetched body that is long enough.",
              url: "https://example.com/new-post",
              publishedAt: "2026-06-23T22:42:38.000Z",
              rawJson: { fetchTaskId: "fetch_post:blog:new-post" },
            },
          ],
        },
      ],
    },
    [
      {
        id: "fetch_post:blog:new-post",
        fetchCutoff: "2026-05-25T11:21:18.769Z",
        item: {
          title: "New post",
          url: "https://example.com/new-post",
        },
      },
    ],
  );

  assert.equal(filtered.builders.length, 1);
  assert.equal(filtered.builders[0].items.length, 1);
  assert.equal(filtered.builders[0].items[0].title, "New post");
  assert.deepEqual(filtered.taskOutcomes, []);
});

test("ready fetch tasks carry embedded source-specific single-post prompts", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const sources = {
    x: {
      id: "x",
      label: "X/Twitter",
      summaryPrompt: {
        body: "tweet prompt body",
        style: "x_twitter",
        language: "zh",
      },
    },
    youtube: {
      id: "youtube",
      label: "YouTube",
      summaryPrompt: {
        body: "podcast prompt body",
        style: "podcast_or_video",
        language: "zh",
      },
    },
    blog: {
      id: "blog",
      label: "Blog",
      summaryPrompt: {
        body: "blog prompt body",
        style: "blog_or_document",
        language: "zh",
      },
    },
  };
  const commonSummaryRules = [
    "This task is self-contained; do not read external prompt files.",
    "",
    "- Summarize exactly one supplied task item.",
    "- Use task.item.body as the primary content.",
    "- Apply the quality bar and no-fabrication, direct-quote-only, source-link rules stated in the source-specific prompt below.",
  ].join("\n");
  const tasks = cli.fetchTasksForReadyBuilders(
    [
      {
        builderId: "builder_x",
        kind: "X",
        name: "Example X Builder",
        sourceType: "x",
        items: [
          {
            kind: "TWEET",
            externalId: "tweet_1",
            title: null,
            body: "A substantive product launch tweet.",
            url: "https://x.com/example/status/1",
          },
        ],
      },
      {
        builderId: "builder_yt",
        kind: "PODCAST",
        name: "Example YouTube Builder",
        sourceType: "youtube",
        items: [
          {
            kind: "PODCAST_EPISODE",
            externalId: "video_1",
            title: "Launch video",
            body: "Transcript text with real primary content.",
            url: "https://www.youtube.com/watch?v=video_1",
          },
        ],
      },
      {
        builderId: "builder_blog",
        kind: "BLOG",
        name: "Example Blog Builder",
        sourceType: "blog",
        fetchCutoff: "2026-03-25T00:00:00.000Z",
        items: [
          {
            kind: "BLOG_POST",
            externalId: "https://example.com/blog/post",
            title: "Launch notes",
            body: "Article text with implementation details.",
            url: "https://example.com/blog/post",
          },
        ],
      },
    ],
    sources,
    commonSummaryRules,
  );

  assert.deepEqual(
    tasks.map((task: { type: string; contentStatus: string }) => ({
      type: task.type,
      contentStatus: task.contentStatus,
    })),
    [
      { type: "fetch_post", contentStatus: "ready" },
      { type: "fetch_post", contentStatus: "ready" },
      { type: "fetch_post", contentStatus: "ready" },
    ],
  );
  for (const task of tasks) {
    assert.equal("reason" in task, false);
    assert.equal("normalFetcher" in task, false);
    assert.equal("suggestedAction" in task, false);
  }
  assert.deepEqual(
    tasks.map((task: { summaryInstructions: { summaryStyle: string } }) => task.summaryInstructions.summaryStyle),
    ["x_twitter", "podcast_or_video", "blog_or_document"],
  );
  assert.deepEqual(
    tasks.map((task: { builderSync: { builderId: string; kind: string; sourceType: string; name: string; subscribe: boolean } }) => ({
      builderId: task.builderSync.builderId,
      kind: task.builderSync.kind,
      sourceType: task.builderSync.sourceType,
      name: task.builderSync.name,
      subscribe: task.builderSync.subscribe,
    })),
    [
      { builderId: "builder_x", kind: "X", sourceType: "x", name: "Example X Builder", subscribe: false },
      { builderId: "builder_yt", kind: "PODCAST", sourceType: "youtube", name: "Example YouTube Builder", subscribe: false },
      { builderId: "builder_blog", kind: "BLOG", sourceType: "blog", name: "Example Blog Builder", subscribe: false },
    ],
  );
  assert.equal(tasks[2].fetchCutoff, "2026-03-25T00:00:00.000Z");
  for (const task of tasks) {
    assert.match(task.summaryInstructions.prompt, /Write one concise FollowBrief single-post summary in zh\./);
    assert.match(task.summaryInstructions.prompt, /do not read external prompt files/i);
    assert.match(task.summaryInstructions.prompt, /Summarize exactly one supplied task item/);
    assert.match(task.summaryInstructions.prompt, /Use task\.item\.body as the primary content/);
    assert.match(task.summaryInstructions.prompt, /Ready-task output rule/);
    assert.match(task.summaryInstructions.prompt, /do not fetch task\.item\.url/);
    assert.match(task.summaryInstructions.prompt, /omit `item\.body` from your shard result/);
    assert.match(task.summaryInstructions.prompt, /runner restores the original body before sync/);
    assert.match(task.summaryInstructions.prompt, /Keep `summary` between 40 and 1200 characters/);
    assert.match(task.summaryInstructions.prompt, /summary_too_long/);
    assert.match(task.summaryInstructions.prompt, /summary_duplicates_title/);
    assert.match(task.summaryInstructions.prompt, /summary_copies_body_prefix/);
    assert.match(task.summaryInstructions.prompt, /Source-specific rules \(/);
  }
  assert.match(tasks[0].summaryInstructions.prompt, /Source-specific rules \(X\/Twitter\):/);
  assert.match(tasks[0].summaryInstructions.prompt, /tweet prompt body/);
  assert.match(tasks[1].summaryInstructions.prompt, /Source-specific rules \(YouTube\):/);
  assert.match(tasks[1].summaryInstructions.prompt, /podcast prompt body/);
  assert.match(tasks[2].summaryInstructions.prompt, /Source-specific rules \(Blog\):/);
  assert.match(tasks[2].summaryInstructions.prompt, /blog prompt body/);
  assert.equal(tasks[0].summaryInstructions.sourcePrompt, undefined);
});

test("singlePostSummaryInstructions throws when source is missing from context.sources", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  assert.throws(
    () => cli.singlePostSummaryInstructions("youtube", {}),
    /Missing summary prompt for sourceId="youtube"/,
  );
  assert.throws(
    () =>
      cli.singlePostSummaryInstructions("blog", {
        blog: { id: "blog", label: "Blog", summaryPrompt: { body: "", style: "blog_or_document" } },
      }),
    /Missing summary prompt for sourceId="blog"/,
  );
});

test("singlePostSummaryInstructions supports original content language mode", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const instructions = cli.singlePostSummaryInstructions("blog", {
    blog: {
      id: "blog",
      label: "Blog",
      summaryPrompt: {
        body: "blog prompt body",
        style: "blog_or_document",
        language: "source",
      },
    },
  });
  assert.match(
    instructions.prompt,
    /summary in the same language as the task's final raw body/,
  );
  assert.match(instructions.prompt, /For ready tasks, use task\.item\.body's language/);
  assert.doesNotMatch(instructions.prompt, /summary in source\./);
});

test("singlePostFetchInstructions prepends common fetching rules", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const sources = {
    youtube: {
      id: "youtube",
      label: "YouTube",
      fetchPrompt: { body: "Use captions first, then transcribe audio." },
    },
    blog: {
      id: "blog",
      label: "Blog",
      fetchPrompt: { body: null },
    },
  };
  const commonFetchRules = "Try available extraction methods until primary content is found.";

  const youtube = cli.singlePostFetchInstructions("youtube", sources, commonFetchRules);
  assert.equal(youtube.isDefault, false);
  assert.match(youtube.prompt, /Common fetching rules:/);
  assert.match(youtube.prompt, /Try available extraction methods/);
  assert.match(youtube.prompt, /Source-specific fetching rules \(YouTube\):/);
  assert.match(youtube.prompt, /Use captions first, then transcribe audio/);

  const blog = cli.singlePostFetchInstructions("blog", sources, commonFetchRules);
  assert.equal(blog.isDefault, true);
  assert.match(blog.prompt, /Common fetching rules:/);
  assert.match(blog.prompt, /Try available extraction methods/);
  assert.doesNotMatch(blog.prompt, /Source-specific fetching rules/);
});

test("agent sync validation rejects legacy task result shapes", async () => {
  const cli = await import("../scripts/builder-digest.mjs");

  assert.throws(
    () =>
      cli.validateAgentSyncPayload(
        {
          agentTasks: [
            {
              type: "youtube_transcription",
              builder: "Legacy YouTube",
              item: {
                kind: "PODCAST_EPISODE",
                externalId: "legacy",
                url: "https://www.youtube.com/watch?v=legacy",
              },
            },
          ],
        },
        { builders: [] },
      ),
    /legacy agentTasks\/summaryTasks are unsupported/,
  );
});

test("fetch task validation rejects YouTube metadata masquerading as content", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = {
    type: "fetch_post",
    agentWorkType: "youtube_transcription",
    contentStatus: "requires_agent",
    builder: "Anthropic YouTube",
    builderId: "builder_anthropic_youtube",
    sourceType: "youtube",
    item: {
      kind: "PODCAST_EPISODE",
      externalId: "dPn3GBI8lII",
      title: "Introducing Claude Opus 4.6",
      url: "https://www.youtube.com/watch?v=dPn3GBI8lII",
      description: "A short launch description.",
    },
  };
  const taskId = cli.fetchTaskId(task);

  assert.throws(
    () =>
      cli.validateAgentSyncPayload(
        { fetchTasks: [{ ...task, id: taskId }] },
        {
          builders: [
            {
              kind: "PODCAST",
              sourceType: "youtube",
              name: "Anthropic YouTube",
              items: [
                {
                  kind: "PODCAST_EPISODE",
                  externalId: "dPn3GBI8lII",
                  title: "Introducing Claude Opus 4.6",
                  body: "A short launch description.",
                  url: "https://www.youtube.com/watch?v=dPn3GBI8lII",
                  rawJson: {
                    builderId: "builder_anthropic_youtube",
                    fetchTaskId: taskId,
                    agentRuntime: "Codex",
                    agentCompletedAt: "2026-05-24T10:00:00.000Z",
                    agentExecutionProof: "metadata only",
                    transcriptSource: "youtube-feed-description",
                  },
                },
              ],
            },
          ],
        },
      ),
    /Agent sync validation failed/,
  );
});

test("personal podcast fetcher parses RSS episodes as podcast items", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const items = cli.parsePodcastFeedItems(
    `
    <rss><channel>
      <item>
        <title>Agent Systems Weekly</title>
        <guid>episode-42</guid>
        <link>https://pod.example.com/42</link>
        <pubDate>Fri, 22 May 2026 10:00:00 GMT</pubDate>
        <description><![CDATA[The hosts discuss durable agents, evaluation loops, and deployment lessons.]]></description>
      </item>
    </channel></rss>
    `,
    "https://pod.example.com/feed.xml",
  );

  assert.equal(items[0].kind, "PODCAST_EPISODE");
  assert.equal(items[0].externalId, "episode-42");
  assert.equal(items[0].url, "https://pod.example.com/42");
});

test("personal fetcher reports concrete fetching tool identity", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  assert.match(
    cli.skillFetchTool("YouTube RSS + captions", "gpt-5.5"),
    /\(model gpt-5\.5\) FollowBrief skill fetcher \(YouTube RSS \+ captions\)/,
  );
});

test("personal fetcher keeps fetched builders eligible and tracks fetched post keys", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const context = {
    libraryBuilders: [
      {
        id: "builder_blog_1",
        scope: "PERSONAL",
        kind: "BLOG",
        sourceType: "auto",
        name: "Already Fetched Blog",
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
        kind: "BLOG",
        name: "Central Blog",
        sourceUrl: "https://example.com/central",
      },
    ],
    personalFetchStates: [
      {
        builderId: "builder_blog_1",
        lastFetchedAt: "2026-05-22T10:00:00.000Z",
      },
    ],
    personalFetchedItems: [
      {
        builderId: "builder_blog_1",
        kind: "BLOG_POST",
        externalId: "https://example.com/blog/launch-notes",
        publishedAt: "2026-05-22T10:00:00.000Z",
        createdAt: "2026-05-22T10:05:00.000Z",
      },
    ],
    latestPersonalFetchedItems: [
      {
        builderId: "builder_blog_1",
        latestPostAt: "2026-05-22T10:00:00.000Z",
      },
    ],
  };

  assert.deepEqual(
    cli.personalBuildersForFetch(context).map((builder: { id: string }) => builder.id),
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
      .fetchedItemKeysForBuilder(context, "builder_blog_1")
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

test("personal fetcher uses the server-computed real-time library fetch candidates", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const context = {
    libraryBuilders: [
      {
        id: "personal_followed",
        scope: "PERSONAL",
        kind: "BLOG",
        name: "Personal followed source",
        sourceUrl: "https://example.com/personal",
      },
    ],
    libraryFetchBuilders: [
      {
        id: "imported_followed_empty",
        scope: "IMPORTED",
        fetchScope: "followed_imported_empty",
        kind: "BLOG",
        name: "Imported followed empty source",
        sourceUrl: "https://example.com/imported",
      },
    ],
  };

  assert.deepEqual(
    cli.personalBuildersForFetch(context).map((builder: { id: string }) => builder.id),
    ["imported_followed_empty"],
  );
});

test("library fetch reconciliation defaults to the job-specific tmp directory", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const previousJobTmp = process.env.BUILDER_BLOG_JOB_TMP_DIR;
  const previousAgentDir = process.env.BUILDER_BLOG_AGENT_DIR;
  const previousAccount = process.env.BUILDER_BLOG_ACCOUNT;
  const previousAccountSlug = process.env.BUILDER_BLOG_ACCOUNT_SLUG;
  try {
    process.env.BUILDER_BLOG_JOB_TMP_DIR = "/tmp/followbrief-job-specific";
    process.env.BUILDER_BLOG_AGENT_DIR = "/tmp/followbrief-agent-global";
    process.env.BUILDER_BLOG_ACCOUNT = "jie@example.com";
    delete process.env.BUILDER_BLOG_ACCOUNT_SLUG;
    assert.equal(
      cli.defaultLibraryFetchResultFileForTest(),
      "/tmp/followbrief-job-specific/library-fetch-result.json",
    );
    assert.equal(
      cli.libraryFetchRunIdFileForTest(),
      "/tmp/followbrief-job-specific/library-fetch-run-id",
    );

    delete process.env.BUILDER_BLOG_JOB_TMP_DIR;
    assert.equal(
      cli.defaultLibraryFetchResultFileForTest(),
      "/tmp/followbrief-agent-global/tmp/accounts/jie_example_com_efbd0c2b/library-once/library-fetch-result.json",
    );
    assert.equal(
      cli.libraryFetchRunIdFileForTest(),
      "/tmp/followbrief-agent-global/tmp/accounts/jie_example_com_efbd0c2b/library-once/library-fetch-run-id",
    );
    assert.equal(
      cli.defaultDigestContextFileForTest(),
      "/tmp/followbrief-agent-global/tmp/accounts/jie_example_com_efbd0c2b/digest-once/builder-blog-context.json",
    );

    process.env.BUILDER_BLOG_ACCOUNT = "a-b@example.com";
    const dashAccountPath = cli.defaultLibraryFetchResultFileForTest();
    process.env.BUILDER_BLOG_ACCOUNT = "a_b@example.com";
    assert.notEqual(cli.defaultLibraryFetchResultFileForTest(), dashAccountPath);

    process.env.BUILDER_BLOG_ACCOUNT_SLUG = "custom_slug";
    assert.equal(
      cli.defaultLibraryFetchResultFileForTest(),
      "/tmp/followbrief-agent-global/tmp/accounts/custom_slug/library-once/library-fetch-result.json",
    );
  } finally {
    if (previousJobTmp === undefined) delete process.env.BUILDER_BLOG_JOB_TMP_DIR;
    else process.env.BUILDER_BLOG_JOB_TMP_DIR = previousJobTmp;
    if (previousAgentDir === undefined) delete process.env.BUILDER_BLOG_AGENT_DIR;
    else process.env.BUILDER_BLOG_AGENT_DIR = previousAgentDir;
    if (previousAccount === undefined) delete process.env.BUILDER_BLOG_ACCOUNT;
    else process.env.BUILDER_BLOG_ACCOUNT = previousAccount;
    if (previousAccountSlug === undefined) delete process.env.BUILDER_BLOG_ACCOUNT_SLUG;
    else process.env.BUILDER_BLOG_ACCOUNT_SLUG = previousAccountSlug;
  }
});

test("YouTube local ASR work directory stays inside the job tmp tree", async () => {
  const cli = await readFile("scripts/builder-digest.mjs", "utf8");
  assert.match(cli, /const asrRoot = join\(jobTmpDir\("library-cron"\), "youtube-asr"\)/);
  assert.match(cli, /await mkdir\(asrRoot, \{ recursive: true \}\)/);
  assert.match(cli, /const workDir = await mkdtemp\(join\(asrRoot, "run-"\)\)/);
  assert.doesNotMatch(cli, /mkdtemp\(join\(tmpdir\(\), "followbrief-youtube-asr-"\)\)/);
});

test("library worker prompt treats ready tasks as summary-only", async () => {
  const prompt = await readFile("skills/builder-blog-digest/jobs/library-worker.md", "utf8");
  assert.match(prompt, /contentStatus: "ready"/);
  assert.match(prompt, /do NOT fetch the URL, download media/);
  assert.match(prompt, /rewrite `item\.body`/);
  assert.match(prompt, /omit `item\.body` from the ready-task sync item/);
  assert.match(prompt, /runner restores[\s\S]*original body/);
});

// --- Per-task terminal-state accountability (taskOutcomes) ---

function youtubePlannedTask(cli: typeof import("../scripts/builder-digest.mjs"), externalId: string) {
  const task = {
    type: "fetch_post",
    agentWorkType: "youtube_transcription",
    contentStatus: "requires_agent",
    builder: "Anthropic YouTube",
    builderId: "builder_yt",
    sourceType: "youtube",
    item: {
      kind: "PODCAST_EPISODE",
      externalId,
      url: `https://www.youtube.com/watch?v=${externalId}`,
    },
  };
  return { ...task, id: cli.fetchTaskId(task) };
}

test("a planned task neither synced nor in taskOutcomes is unaccounted (throws)", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = youtubePlannedTask(cli, "vid_unaccounted");
  assert.throws(
    () => cli.validateAgentSyncPayload({ fetchTasks: [task] }, { builders: [] }),
    /Agent sync validation failed/,
  );
});

test("a skipped task without per-task evidence is rejected (anti bulk-skip)", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = youtubePlannedTask(cli, "vid_skip_noevidence");
  assert.throws(
    () =>
      cli.validateAgentSyncPayload(
        { fetchTasks: [task] },
        {
          builders: [],
          taskOutcomes: [
            { fetchTaskId: task.id, status: "skipped", reason: "lacked audible speech" },
          ],
        },
      ),
    /Agent sync validation failed/,
  );
});

test("a skipped task WITH per-task evidence is accounted for", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = youtubePlannedTask(cli, "vid_skip_evidence");
  const result = cli.validateAgentSyncPayload(
    { fetchTasks: [task] },
    {
      builders: [],
      taskOutcomes: [
        {
          fetchTaskId: task.id,
          status: "skipped",
          reason: "no captions and silent audio",
          evidence: { meanVolumeDb: -91, hasCaptions: false },
        },
      ],
    },
  );
  assert.equal(result.status, "ok");
  assert.equal(result.accountedOutcomes, 1);
  assert.equal(result.validatedFetchTasks, 0);
});

test("candidate discovery tasks do not require synced post items", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const discoveryTask = {
    id: "candidate_discovery:builder_product_hunt:product_hunt_top_products",
    type: "candidate_discovery",
    agentWorkType: "candidate_discovery_fallback",
    builder: "Product Hunt Top Products",
    builderId: "builder_product_hunt",
    sourceType: "product_hunt_top_products",
  };

  const result = cli.validateAgentSyncPayload(
    { fetchTasks: [discoveryTask] },
    { builders: [], taskOutcomes: [] },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.validatedFetchTasks, 0);
  assert.equal(result.accountedOutcomes, 0);
});

test("failed / blocked outcomes require a reason", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const failTask = youtubePlannedTask(cli, "vid_failed_noreason");
  assert.throws(
    () =>
      cli.validateAgentSyncPayload(
        { fetchTasks: [failTask] },
        { builders: [], taskOutcomes: [{ fetchTaskId: failTask.id, status: "failed", reason: "" }] },
      ),
    /Agent sync validation failed/,
  );

  const okTask = youtubePlannedTask(cli, "vid_failed_reason");
  const result = cli.validateAgentSyncPayload(
    { fetchTasks: [okTask] },
    {
      builders: [],
      taskOutcomes: [{ fetchTaskId: okTask.id, status: "failed", reason: "fetch_error: 403" }],
    },
  );
  assert.equal(result.status, "ok");
  assert.equal(result.accountedOutcomes, 1);
});

test("sync-builders treats explicit empty builders payload as a successful no-op", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-empty-builder-sync-"));
  const payloadFile = join(tmp, "library-agent-sync.json");
  const tasksFile = join(tmp, "library-fetch-result.json");
  await writeFile(payloadFile, `${JSON.stringify({ builders: [], taskOutcomes: [] })}\n`, "utf8");
  await writeFile(tasksFile, `${JSON.stringify({ status: "ok", localErrors: [], fetchTasks: [] })}\n`, "utf8");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "sync-builders",
      "--file",
      payloadFile,
      "--tasks",
      tasksFile,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BUILDER_BLOG_AGENT_DIR: tmp,
        BUILDER_BLOG_ACCOUNT_SLUG: "empty_sync",
        BUILDER_BLOG_TOKEN: "test-token",
        BUILDER_BLOG_URL: "http://127.0.0.1:9",
      },
    },
  );
  const result = JSON.parse(stdout);

  assert.equal(result.status, "ok");
  assert.equal(result.builders, 0);
  assert.equal(result.feedItems, 0);
  assert.equal(result.taskOutcomes, 0);
});

test("cloud sync upload payload reuses builder sync sanitization and carries cloud task results", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const payload = cli.prepareCloudSyncPayloadForUpload(
    {
      builders: [
        {
          kind: "YOUTUBE",
          sourceType: "youtube",
          name: "Video Source",
          sourceUrl: "https://www.youtube.com/@example",
          items: [
            {
              kind: "VIDEO",
              externalId: "video_1",
              title: "Video",
              body: "transcript should not be durably stored",
              summary: "Summary",
              url: "https://www.youtube.com/watch?v=video_1",
              rawJson: { fetchTaskId: "task_post_1", transcriptText: "raw transcript" },
            },
          ],
        },
      ],
      taskResults: [
        {
          cloudSourceTaskId: "cloud_task_1",
          status: "succeeded",
          plannedPosts: 1,
          syncedPosts: 1,
          failedPosts: 0,
        },
      ],
    },
    "cloud_run_1",
  );

  assert.equal(payload.cloudRunId, "cloud_run_1");
  assert.equal(payload.taskResults[0].cloudSourceTaskId, "cloud_task_1");
  assert.equal(payload.builders[0].items[0].body, "");
  assert.equal(payload.builders[0].items[0].rawJson.rawContentPolicy.durableRawMode, "none");
});

test("cloud sync task results are derived from planned cloud fetch tasks", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const plannedTasks = [
    {
      id: "task_synced",
      type: "fetch_post",
      cloudRunId: "cloud_run_1",
      cloudSourceTaskId: "cloud_task_1",
      summaryLanguage: "zh",
      builder: "OpenAI News",
      builderId: "cloud_builder_1",
      sourceType: "blog",
      title: "Post 1",
      url: "https://openai.com/news/1",
      fetchTool: "fetch_builder_fallback",
      agentModel: "codex",
      agentRuntime: "codex",
      bodyChars: 1200,
      bodyWords: 180,
      summaryChars: 300,
      summaryWords: 45,
      readMethod: "Copied body from a Hub-shared post with the same URL",
      summaryMethod: "Copied matching-language summary from a Hub-shared post",
      item: { kind: "BLOG_POST", externalId: "post_1", url: "https://openai.com/news/1" },
    },
    {
      id: "task_failed",
      type: "fetch_post",
      cloudRunId: "cloud_run_1",
      cloudSourceTaskId: "cloud_task_2",
      summaryLanguage: "en",
      builder: "OpenAI News EN",
      builderId: "cloud_builder_2",
      sourceType: "blog",
      item: { kind: "BLOG_POST", externalId: "post_2", url: "https://openai.com/news/2" },
    },
  ];
  const payload = cli.prepareCloudSyncPayloadForUpload(
    {
      builders: [
        {
          builderId: "cloud_builder_1",
          kind: "BLOG",
          sourceType: "blog",
          name: "OpenAI News",
          items: [
            {
              kind: "BLOG_POST",
              externalId: "post_1",
              title: "Post 1",
              body: "Long enough source body for a normal synced article item.",
              summary: "This is a synced summary with enough text to pass the shape test.",
              url: "https://openai.com/news/1",
              rawJson: {
                fetchTaskId: "task_synced",
                workerId: "worker-0",
                agentRuntime: "codex",
                agentExecutionProof: "read article",
                agentCompletedAt: "2026-06-27T10:00:00.000Z",
              },
            },
          ],
        },
      ],
      taskOutcomes: [
        {
          fetchTaskId: "task_failed",
          status: "failed",
          reason: "worker_missing_result",
          evidence: { failureKind: "missing_worker_result_file" },
        },
      ],
      workerUsages: [
        {
          workerId: "worker-0",
          usage: { totalTokens: 1234, inputTokens: 1000, outputTokens: 234, costUsd: 0.05, currency: "USD" },
          taskCount: 1,
          taskIds: ["task_synced"],
        },
      ],
    },
    "cloud_run_1",
    plannedTasks,
  );

  assert.equal(payload.taskResults.length, 2);
  assert.deepEqual(
    payload.taskResults.map((result: { cloudSourceTaskId: string; status: string; plannedPosts: number; syncedPosts: number; failedPosts: number }) => ({
      cloudSourceTaskId: result.cloudSourceTaskId,
      status: result.status,
      plannedPosts: result.plannedPosts,
      syncedPosts: result.syncedPosts,
      failedPosts: result.failedPosts,
    })),
    [
      { cloudSourceTaskId: "cloud_task_1", status: "succeeded", plannedPosts: 1, syncedPosts: 1, failedPosts: 0 },
      { cloudSourceTaskId: "cloud_task_2", status: "failed", plannedPosts: 1, syncedPosts: 0, failedPosts: 1 },
    ],
  );
  assert.equal(payload.taskResults[1].failureReason, "worker_missing_result");
  assert.equal(payload.taskResults[0].usageTokens, 1234);
  assert.equal(payload.taskResults[0].usageCostUsd, 0.05);
  assert.equal(payload.taskResults[1].usageTokens, undefined);
  assert.equal(payload.taskResults[1].usageCostUsd, undefined);

  // Each cloud task carries per-post outcomes so the cloud fetch log can render
  // the same staged (read → summarize → sync) + debug rows as the personal log.
  assert.deepEqual(payload.taskResults[0].details.posts, [
    {
      id: "task_synced",
      title: "Post 1",
      url: "https://openai.com/news/1",
      contentStatus: null,
      agentWorkType: null,
      status: "synced",
      failureReason: null,
      fetchTool: "fetch_builder_fallback",
      agentRuntime: "codex",
      agentModel: "codex",
      bodyChars: 1200,
      bodyWords: 180,
      summaryChars: 300,
      summaryWords: 45,
      readMethod: "Copied body from a Hub-shared post with the same URL",
      summaryMethod: "Copied matching-language summary from a Hub-shared post",
      hubSharedReuse: null,
      workerId: "worker-0",
    },
  ]);
  assert.deepEqual(payload.taskResults[0].details.workerUsages, [
    {
      workerId: "worker-0",
      usage: { totalTokens: 1234, inputTokens: 1000, outputTokens: 234, costUsd: 0.05, currency: "USD" },
      taskCount: 1,
      taskIds: ["task_synced"],
    },
  ]);
  assert.equal(payload.taskResults[1].details.posts.length, 1);
  assert.equal(payload.taskResults[1].details.workerUsages, undefined);
  assert.equal(payload.taskResults[1].details.posts[0].status, "failed");
  assert.equal(payload.taskResults[1].details.posts[0].failureReason, "worker_missing_result");
  assert.equal(payload.taskResults[1].details.posts[0].url, "https://openai.com/news/2");
});

test("cloud sync task results include leased sources that generated no post tasks", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const payload = cli.prepareCloudSyncPayloadForUpload(
    {
      builders: [
        {
          builderId: "cloud_builder_1",
          kind: "BLOG",
          sourceType: "blog",
          name: "OpenAI News",
          items: [
            {
              kind: "BLOG_POST",
              externalId: "post_1",
              title: "Post 1",
              body: "Long enough source body for a normal synced article item.",
              summary: "This is a synced summary with enough text to pass the shape test.",
              url: "https://openai.com/news/1",
              rawJson: { fetchTaskId: "task_synced" },
            },
          ],
        },
      ],
    },
    "cloud_run_1",
    [
      {
        id: "task_synced",
        type: "fetch_post",
        cloudRunId: "cloud_run_1",
        cloudSourceTaskId: "cloud_task_1",
        builder: "OpenAI News",
        builderId: "cloud_builder_1",
        sourceType: "blog",
        item: { kind: "BLOG_POST", externalId: "post_1", url: "https://openai.com/news/1" },
      },
    ],
    [
      {
        cloudRunId: "cloud_run_1",
        cloudSourceTaskId: "cloud_task_1",
        builderId: "cloud_builder_1",
        name: "OpenAI News",
        sourceType: "blog",
        summaryLanguage: "zh",
      },
      {
        cloudRunId: "cloud_run_1",
        cloudSourceTaskId: "cloud_task_2",
        builderId: "cloud_builder_2",
        name: "No New Posts",
        sourceType: "blog",
        summaryLanguage: "zh",
      },
    ],
  );

  assert.deepEqual(
    payload.taskResults.map((result: { cloudSourceTaskId: string; status: string; plannedPosts: number; syncedPosts: number; failedPosts: number }) => ({
      cloudSourceTaskId: result.cloudSourceTaskId,
      status: result.status,
      plannedPosts: result.plannedPosts,
      syncedPosts: result.syncedPosts,
      failedPosts: result.failedPosts,
    })),
    [
      { cloudSourceTaskId: "cloud_task_1", status: "succeeded", plannedPosts: 1, syncedPosts: 1, failedPosts: 0 },
      { cloudSourceTaskId: "cloud_task_2", status: "succeeded", plannedPosts: 0, syncedPosts: 0, failedPosts: 0 },
    ],
  );
  assert.deepEqual(payload.taskResults[1].details.fetchTaskIds, []);
  assert.deepEqual(payload.taskResults[1].details.posts, []);
  assert.equal(payload.taskResults[1].details.noGeneratedFetchTasks, true);
});

test("cloud sync task results mark mixed synced and failed posts partial", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const plannedTasks = [
    {
      id: "task_synced",
      type: "fetch_post",
      cloudRunId: "cloud_run_1",
      cloudSourceTaskId: "cloud_task_1",
      builder: "Blog | Claude",
      builderId: "cloud_builder_1",
      sourceType: "blog",
      item: { kind: "BLOG_POST", externalId: "post_1", url: "https://claude.com/blog/1" },
    },
    {
      id: "task_failed",
      type: "fetch_post",
      cloudRunId: "cloud_run_1",
      cloudSourceTaskId: "cloud_task_1",
      builder: "Blog | Claude",
      builderId: "cloud_builder_1",
      sourceType: "blog",
      item: { kind: "BLOG_POST", externalId: "post_2", url: "https://claude.com/blog/2" },
    },
  ];
  const payload = cli.prepareCloudSyncPayloadForUpload(
    {
      builders: [
        {
          builderId: "cloud_builder_1",
          kind: "BLOG",
          sourceType: "blog",
          name: "Blog | Claude",
          items: [
            {
              kind: "BLOG_POST",
              externalId: "post_1",
              title: "Post 1",
              body: "Long enough source body for a normal synced article item.",
              summary: "This is a synced summary with enough text to pass the shape test.",
              url: "https://claude.com/blog/1",
              rawJson: { fetchTaskId: "task_synced" },
            },
          ],
        },
      ],
      taskOutcomes: [
        {
          fetchTaskId: "task_failed",
          status: "failed",
          reason: "worker_missing_result",
          evidence: { failureKind: "worker_omitted_task" },
        },
      ],
    },
    "cloud_run_1",
    plannedTasks,
  );

  assert.equal(payload.taskResults.length, 1);
  assert.equal(payload.taskResults[0].status, "partial");
  assert.equal(payload.taskResults[0].plannedPosts, 2);
  assert.equal(payload.taskResults[0].syncedPosts, 1);
  assert.equal(payload.taskResults[0].failedPosts, 1);
  assert.equal(payload.taskResults[0].failureReason, "worker_missing_result");
});

test("cloud sync keeps shared worker usage for lane aggregation without source double counting", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const plannedTasks = [
    {
      id: "task_a",
      type: "fetch_post",
      cloudRunId: "cloud_run_1",
      cloudSourceTaskId: "cloud_task_a",
      builder: "Source A",
      builderId: "cloud_builder_a",
      sourceType: "blog",
      item: { kind: "BLOG_POST", externalId: "a", url: "https://example.com/a" },
    },
    {
      id: "task_b",
      type: "fetch_post",
      cloudRunId: "cloud_run_1",
      cloudSourceTaskId: "cloud_task_b",
      builder: "Source B",
      builderId: "cloud_builder_b",
      sourceType: "blog",
      item: { kind: "BLOG_POST", externalId: "b", url: "https://example.com/b" },
    },
  ];
  const payload = cli.prepareCloudSyncPayloadForUpload(
    {
      builders: [
        {
          builderId: "cloud_builder_a",
          kind: "BLOG",
          sourceType: "blog",
          name: "Source A",
          items: [{ kind: "BLOG_POST", externalId: "a", body: "A body", summary: "A summary with enough words.", url: "https://example.com/a", rawJson: { fetchTaskId: "task_a", workerId: "worker-0" } }],
        },
        {
          builderId: "cloud_builder_b",
          kind: "BLOG",
          sourceType: "blog",
          name: "Source B",
          items: [{ kind: "BLOG_POST", externalId: "b", body: "B body", summary: "B summary with enough words.", url: "https://example.com/b", rawJson: { fetchTaskId: "task_b", workerId: "worker-0" } }],
        },
      ],
      workerUsages: [
        {
          workerId: "worker-0",
          usage: { totalTokens: 2000, costUsd: 0.2, currency: "USD" },
          taskCount: 2,
          taskIds: ["task_a", "task_b"],
        },
      ],
    },
    "cloud_run_1",
    plannedTasks,
  );

  assert.equal(payload.taskResults.length, 2);
  assert.equal(payload.taskResults[0].usageTokens, undefined);
  assert.equal(payload.taskResults[1].usageTokens, undefined);
  assert.equal(payload.taskResults[0].details.workerUsages.length, 1);
  assert.equal(payload.taskResults[1].details.workerUsages.length, 1);
});

test("cloud sync payload can split by cloud run id", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      {
        id: "task_run_1",
        cloudRunId: "run_1",
        cloudSourceTaskId: "cloud_task_1",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        builderSync: { builderId: "builder_1" },
        item: { url: "https://a.example/post" },
      },
      {
        id: "task_run_2",
        cloudRunId: "run_2",
        cloudSourceTaskId: "cloud_task_2",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        builderSync: { builderId: "builder_2" },
        item: { url: "https://b.example/post" },
      },
    ],
  };
  const payload = {
    builders: [
      {
        builderId: "builder_1",
        items: [{ title: "A", rawJson: { fetchTaskId: "task_run_1" } }],
      },
      {
        builderId: "builder_2",
        items: [{ title: "B", rawJson: { fetchTaskId: "task_run_2" } }],
      },
    ],
    taskOutcomes: [
      { fetchTaskId: "task_run_1", status: "synced" },
      { fetchTaskId: "task_run_2", status: "failed", reason: "blocked" },
    ],
  };

  const slices = cli.splitCloudSyncPayloadByRunId(fetchResult, payload)
    .sort((a: { cloudRunId: string }, b: { cloudRunId: string }) =>
      a.cloudRunId.localeCompare(b.cloudRunId),
    );

  assert.deepEqual(slices.map((slice: { cloudRunId: string }) => slice.cloudRunId), ["run_1", "run_2"]);
  assert.deepEqual(slices[0].tasks.fetchTasks.map((task: { id: string }) => task.id), ["task_run_1"]);
  assert.deepEqual(slices[0].payload.builders[0].items.map((item: { title: string }) => item.title), ["A"]);
  assert.deepEqual(slices[0].payload.taskOutcomes.map((outcome: { fetchTaskId: string }) => outcome.fetchTaskId), ["task_run_1"]);
  assert.deepEqual(slices[1].tasks.fetchTasks.map((task: { id: string }) => task.id), ["task_run_2"]);
  assert.deepEqual(slices[1].payload.builders[0].items.map((item: { title: string }) => item.title), ["B"]);
  assert.deepEqual(slices[1].payload.taskOutcomes.map((outcome: { fetchTaskId: string }) => outcome.fetchTaskId), ["task_run_2"]);
});

test("cloud sync payload keeps zero-post source metadata in cloud-run slices", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const slices = cli.splitCloudSyncPayloadByRunId(
    {
      status: "ok",
      fetchTasks: [],
      cloudSourceTasks: [
        {
          cloudRunId: "run_1",
          cloudSourceTaskId: "cloud_task_1",
          builderId: "builder_1",
          name: "No New Posts",
          sourceType: "blog",
        },
      ],
    },
    { builders: [], taskOutcomes: [] },
  );

  assert.equal(slices.length, 1);
  assert.equal(slices[0].cloudRunId, "run_1");
  assert.deepEqual(slices[0].tasks.cloudSourceTasks, [
    {
      cloudRunId: "run_1",
      cloudSourceTaskId: "cloud_task_1",
      builderId: "builder_1",
      name: "No New Posts",
      sourceType: "blog",
    },
  ]);
});

test("split-sync-slices can write cloud-run slices with per-slice run ids", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-cloud-run-slices-"));
  const tasksFile = join(tmp, "fetch-result.json");
  const payloadFile = join(tmp, "library-agent-sync.json");
  const outDir = join(tmp, "sync-slices");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        {
          id: "task_run_1",
          cloudRunId: "run_1",
          cloudSourceTaskId: "cloud_task_1",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          builderSync: { builderId: "builder_1" },
          item: { url: "https://a.example/post" },
        },
        {
          id: "task_run_2",
          cloudRunId: "run_2",
          cloudSourceTaskId: "cloud_task_2",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          builderSync: { builderId: "builder_2" },
          item: { url: "https://b.example/post" },
        },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(
    payloadFile,
    `${JSON.stringify({
      builders: [
        {
          builderId: "builder_1",
          items: [{ title: "A", rawJson: { fetchTaskId: "task_run_1" } }],
        },
        {
          builderId: "builder_2",
          items: [{ title: "B", rawJson: { fetchTaskId: "task_run_2" } }],
        },
      ],
      taskOutcomes: [],
    })}\n`,
    "utf8",
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "split-sync-slices",
      "--tasks",
      tasksFile,
      "--file",
      payloadFile,
      "--out-dir",
      outDir,
      "--granularity",
      "cloud-run",
    ],
    { cwd: process.cwd() },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.granularity, "cloud-run");
  assert.deepEqual(result.slices.map((slice: { key: string }) => slice.key), [
    "cloudRun:run_1",
    "cloudRun:run_2",
  ]);

  const firstPayload = JSON.parse(await readFile(join(outDir, "slice-000-payload.json"), "utf8"));
  const secondPayload = JSON.parse(await readFile(join(outDir, "slice-001-payload.json"), "utf8"));
  assert.equal(firstPayload.cloudRunId, "run_1");
  assert.equal(secondPayload.cloudRunId, "run_2");
});

test("merge-fetch-results appends repeated cloud leases into one local queue", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const merged = cli.mergeFetchResultsForQueue(
    {
      status: "ok",
      cloudRunId: "run_1",
      leasedTasks: 1,
      localErrors: [{ message: "first warning" }],
      fetchTasks: [{ id: "task_1" }],
      cloudSourceTasks: [{ cloudRunId: "run_1", cloudSourceTaskId: "cloud_task_1" }],
    },
    {
      status: "ok",
      cloudRunId: "run_2",
      leasedTasks: 2,
      localErrors: [],
      fetchTasks: [{ id: "task_2" }, { id: "task_3" }],
      cloudSourceTasks: [
        { cloudRunId: "run_2", cloudSourceTaskId: "cloud_task_2" },
        { cloudRunId: "run_2", cloudSourceTaskId: "cloud_task_3" },
      ],
    },
  );

  assert.deepEqual(merged.cloudRunIds, ["run_1", "run_2"]);
  assert.equal(merged.cloudRunId, "run_1");
  assert.equal(merged.leasedTasks, 3);
  assert.deepEqual(merged.fetchTasks.map((task: { id: string }) => task.id), ["task_1", "task_2", "task_3"]);
  assert.deepEqual(merged.cloudSourceTasks.map((task: { cloudSourceTaskId: string }) => task.cloudSourceTaskId), [
    "cloud_task_1",
    "cloud_task_2",
    "cloud_task_3",
  ]);
  assert.deepEqual(merged.localErrors, [{ message: "first warning" }]);
});

test("builder digest CLI exposes sync-cloud-builders command", () => {
  const script = readFileSync(join(process.cwd(), "scripts/builder-digest.mjs"), "utf8");

  assert.match(script, /async function syncCloudBuilders/);
  assert.match(script, /command === "sync-cloud-builders"/);
  assert.match(script, /\/api\/admin\/cloud-fetch\/sync/);
});

test("builder digest CLI exposes lease-cloud-builders command", () => {
  const script = readFileSync(join(process.cwd(), "scripts/builder-digest.mjs"), "utf8");

  assert.match(script, /async function leaseCloudBuilders/);
  assert.match(script, /command === "lease-cloud-builders"/);
  assert.match(script, /\/api\/admin\/cloud-fetch\/lease/);
  assert.match(script, /--lease-owner/);
});

test("schedule-spec emits anchor-aligned cron, launchd, and server schedule values", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-schedule-spec-"));
  const anchorFile = join(tmp, "schedule-anchor-library-cron-user");
  const cronOut = join(tmp, "cron.txt");
  const launchdOut = join(tmp, "launchd.xml");
  const statusOut = join(tmp, "status.txt");
  await writeFile(anchorFile, "2026-06-21T13:15:22Z\n", "utf8");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "schedule-spec",
      "--freq",
      "12h",
      "--anchor-file",
      anchorFile,
      "--cron-out",
      cronOut,
      "--launchd-out",
      launchdOut,
      "--status-out",
      statusOut,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, TZ: "UTC" },
    },
  );

  const result = JSON.parse(stdout);
  const cron = (await readFile(cronOut, "utf8")).trim();
  const launchd = await readFile(launchdOut, "utf8");
  const status = (await readFile(statusOut, "utf8")).trim();

  assert.equal(cron, "15 1,13 * * *");
  assert.equal(status, "anchor:15 1,13 * * *");
  assert.equal(result.anchorAt, "2026-06-21T13:15:22Z");
  assert.equal(result.cron, cron);
  assert.equal(result.statusSchedule, status);
  assert.match(launchd, /<key>StartCalendarInterval<\/key>/);
  assert.match(launchd, /<key>Hour<\/key>\s*<integer>1<\/integer>/);
  assert.match(launchd, /<key>Hour<\/key>\s*<integer>13<\/integer>/);
  assert.match(launchd, /<key>Minute<\/key>\s*<integer>15<\/integer>/);
  assert.doesNotMatch(launchd, /StartInterval/);
});

test("sync-builders rejects empty builders when planned tasks are unaccounted", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-unaccounted-empty-sync-"));
  const payloadFile = join(tmp, "library-agent-sync.json");
  const tasksFile = join(tmp, "library-fetch-result.json");
  const cli = await import("../scripts/builder-digest.mjs");
  const task = youtubePlannedTask(cli, "vid_unaccounted_sync");
  await writeFile(payloadFile, `${JSON.stringify({ builders: [], taskOutcomes: [] })}\n`, "utf8");
  await writeFile(
    tasksFile,
    `${JSON.stringify({ status: "ok", localErrors: [], fetchTasks: [task] })}\n`,
    "utf8",
  );

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        "scripts/builder-digest.mjs",
        "sync-builders",
        "--file",
        payloadFile,
        "--tasks",
        tasksFile,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BUILDER_BLOG_AGENT_DIR: tmp,
          BUILDER_BLOG_ACCOUNT_SLUG: "unaccounted_empty_sync",
          BUILDER_BLOG_TOKEN: "test-token",
          BUILDER_BLOG_URL: "http://127.0.0.1:9",
        },
      },
    ),
    /Agent sync validation failed/,
  );
});

test("render-digest requires an existing summary on every context item", async () => {
  const cli = await import("../scripts/builder-digest.mjs");

  const contextWithoutSummary = digestRenderContext();
  contextWithoutSummary.items[0].summary = "";
  assert.throws(
    () =>
      cli.renderStructuredDigest(contextWithoutSummary, {
        headlineSummary: "A short headline in the selected language.",
        sourceSummaries: [],
      }),
    /context item feed_1 has no existing summary to copy/,
  );

  assert.throws(
    () =>
      cli.renderStructuredDigest(digestRenderContext(), {
        headlineSummary: "A short headline in the selected language.",
        sourceSummaries: [{ entityId: "unknown_entity", summary: "Unknown source note." }],
      }),
    /source summary has unknown entityId: unknown_entity/,
  );
});

test("render-digest enforces sync payload size limits before upload", async () => {
  const cli = await import("../scripts/builder-digest.mjs");

  assert.throws(
    () =>
      cli.renderStructuredDigest(digestRenderContext(), {
        headlineSummary: "x".repeat(1201),
        sourceSummaries: [],
      }),
    /headlineSummary must be 1200 characters or fewer/,
  );

  // Post summaries are copied from the context item, so an oversized payload is
  // driven by the stored item summary, not the agent output.
  const oversizedContext = digestRenderContext();
  oversizedContext.items[0].summary = "x".repeat(201_000);
  assert.throws(
    () =>
      cli.renderStructuredDigest(oversizedContext, {
        headlineSummary: "A short headline.",
        sourceSummaries: [],
      }),
    /Rendered digest exceeds sync limit: structured items must be 200000 characters or fewer/,
  );
});

test("render-digest returns structured digest items instead of markdown", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const rendered = cli.renderStructuredDigest(digestRenderContext(), {
    headlineSummary: "A short headline in the selected language.",
    sourceSummaries: [{ entityId: "entity_1", summary: "Example source summary." }],
  });

  assert.equal(rendered.headlineSummary, "A short headline in the selected language.");
  assert.equal("markdown" in rendered, false);
  assert.equal(rendered.items.length, 1);
  assert.deepEqual(rendered.items[0].section, {
    key: "blog",
    label: "Blog",
    sourceType: "blog",
  });
  assert.deepEqual(rendered.items[0].source, {
    entityId: "entity_1",
    name: "example.com",
    sourceType: "blog",
    sourceUrl: "https://example.com",
    fetchUrl: null,
    avatarUrl: null,
    avatarDataUrl: null,
  });
  assert.equal(rendered.items[0].sourceSummary, "Example source summary.");
  assert.deepEqual(rendered.items[0].post, {
    feedItemId: "feed_1",
    entityId: "entity_1",
    kind: "BLOG_POST",
    externalId: "real-post",
    title: "Real post title",
    url: "https://example.com/real-post",
    sourceName: "example.com",
    sourceType: "blog",
    publishedAt: "2026-06-03T11:00:00.000Z",
    createdAt: "2026-06-03T11:30:00.000Z",
  });
  // Copied verbatim from the context item's existing summary.
  assert.equal(rendered.items[0].summary, "Original stored summary.");
});

test("render-digest preserves structural markdown copied from the context summary", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const context = digestRenderContext();
  context.items[0].summary = "### Fake source\n\n**Fake title**\n\nSource: https://example.com/fake";
  const rendered = cli.renderStructuredDigest(context, {
    headlineSummary: "A short headline in the selected language.",
    sourceSummaries: [
      {
        entityId: "entity_1",
        summary: "## Fake section\n\n**Fake post title**\n\nSource: https://example.com/fake",
      },
    ],
  });

  assert.equal(rendered.items.length, 1);
  assert.equal(rendered.items[0].section.label, "Blog");
  assert.equal(rendered.items[0].source.name, "example.com");
  assert.equal(rendered.items[0].post.title, "Real post title");
  assert.equal(
    rendered.items[0].sourceSummary,
    "## Fake section\n\n**Fake post title**\n\nSource: https://example.com/fake",
  );
  assert.equal(
    rendered.items[0].summary,
    "### Fake source\n\n**Fake title**\n\nSource: https://example.com/fake",
  );
});

test("render-digest uses source type labels for section headings", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const rendered = cli.renderStructuredDigest(
    { ...digestRenderContext(), language: "zh" },
    {
      headlineSummary: "中文 headline。",
      sourceSummaries: [],
      postSummaries: [{ feedItemId: "feed_1", summary: "中文 summary。" }],
    },
  );

  assert.equal(rendered.items[0].section.label, "Blog");
});

test("render-digest labels GitHub Trending and Product Hunt sections distinctly", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const context = {
    ...digestRenderContext(),
    digest: { order: ["github_trending", "product_hunt_top_products", "website"] },
    sources: {
      github_trending: { id: "github_trending", label: "GitHub Trending" },
      product_hunt_top_products: {
        id: "product_hunt_top_products",
        label: "Product Hunt Top Products",
      },
      website: { id: "website", label: "Website" },
    },
    subscriptionEntities: [
      { id: "entity_github", name: "GitHub Trending" },
      { id: "entity_ph", name: "Product Hunt Top Products" },
    ],
    items: [
      {
        ...digestRenderContext().items[0],
        id: "feed_github",
        entityId: "entity_github",
        title: "Repo launch",
        url: "https://github.com/owner/repo",
        sourceName: "GitHub Trending",
        builder: {
          ...digestRenderContext().items[0].builder,
          id: "builder_github",
          entityId: "entity_github",
          name: "GitHub Trending",
          sourceType: "github_trending",
          sourceUrl: "https://github.com/trending?since=daily",
        },
      },
      {
        ...digestRenderContext().items[0],
        id: "feed_ph",
        entityId: "entity_ph",
        title: "Product launch",
        url: "https://www.producthunt.com/products/lightfield",
        sourceName: "Product Hunt Top Products",
        builder: {
          ...digestRenderContext().items[0].builder,
          id: "builder_ph",
          entityId: "entity_ph",
          name: "Product Hunt Top Products",
          sourceType: "product_hunt_top_products",
          sourceUrl: "https://www.producthunt.com/",
        },
      },
    ],
  };
  const rendered = cli.renderStructuredDigest(context, {
    headlineSummary: "A short headline.",
    sourceSummaries: [],
    postSummaries: [
      { feedItemId: "feed_github", summary: "GitHub summary." },
      { feedItemId: "feed_ph", summary: "Product Hunt summary." },
    ],
  });

  assert.deepEqual(rendered.items.map((item) => item.section.label), [
    "GitHub Trending",
    "Product Hunt Top Products",
  ]);
});

test("render-digest applies default source order to digest sections and headlines", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const base = digestRenderContext().items[0];
  const item = (
    id: string,
    entityId: string,
    sourceName: string,
    sourceType: string,
    title: string,
  ) => ({
    ...base,
    id,
    entityId,
    title,
    sourceName,
    builder: {
      ...base.builder,
      id: `builder_${id}`,
      entityId,
      name: sourceName,
      sourceType,
    },
  });
  const context = {
    ...digestRenderContext(),
    digest: {},
    sources: {
      podcast: { id: "podcast", label: "Podcast / Audio Feed" },
      youtube: { id: "youtube", label: "YouTube" },
      blog: { id: "blog", label: "Blog / Article Feed" },
      x: { id: "x", label: "X/Twitter" },
      github_trending: { id: "github_trending", label: "GitHub Trending" },
      product_hunt_top_products: {
        id: "product_hunt_top_products",
        label: "Product Hunt Top Products",
      },
      website: { id: "website", label: "Website" },
    },
    subscriptionEntities: [
      { id: "entity_podcast_z", name: "Zeta Podcast" },
      { id: "entity_podcast_a", name: "Alpha Podcast" },
      { id: "entity_youtube", name: "Video Source" },
      { id: "entity_blog", name: "Blog Source" },
      { id: "entity_x", name: "X Source" },
      { id: "entity_github", name: "GitHub Trending" },
      { id: "entity_ph", name: "Product Hunt Top Products" },
      { id: "entity_site", name: "Website Source" },
    ],
    items: [
      item("feed_site", "entity_site", "Website Source", "website", "Website update"),
      item("feed_ph", "entity_ph", "Product Hunt Top Products", "product_hunt_top_products", "Product update"),
      item("feed_github", "entity_github", "GitHub Trending", "github_trending", "Repo update"),
      item("feed_x", "entity_x", "X Source", "x", "X update"),
      item("feed_blog", "entity_blog", "Blog Source", "blog", "Blog update"),
      item("feed_youtube", "entity_youtube", "Video Source", "youtube", "Video update"),
      item("feed_podcast_z", "entity_podcast_z", "Zeta Podcast", "podcast", "Zeta episode"),
      item("feed_podcast_a", "entity_podcast_a", "Alpha Podcast", "podcast", "Alpha episode"),
    ],
  };
  const rendered = cli.renderStructuredDigest(context, {
    headlineSummary: [
      "- Website Source: website headline",
      "- Product Hunt Top Products and GitHub Trending: market headline",
      "- X Source: x headline",
      "- Blog Source: blog headline",
      "- Video Source: youtube headline",
      "- Zeta Podcast: zeta headline",
      "- Alpha Podcast: alpha headline",
    ].join("\n"),
    sourceSummaries: [],
    postSummaries: context.items.map((candidate) => ({
      feedItemId: candidate.id,
      summary: `${candidate.sourceName} summary.`,
    })),
  });

  const headings = [...new Set(rendered.items.map((item) => item.section.label))];
  assert.deepEqual(headings, [
    "Podcast / Audio Feed",
    "YouTube",
    "Blog / Article Feed",
    "X/Twitter",
    "GitHub Trending",
    "Product Hunt Top Products",
    "Website",
  ]);
  assert.deepEqual(rendered.headlineSummary.split("\n"), [
    "- Alpha Podcast: alpha headline",
    "- Zeta Podcast: zeta headline",
    "- Video Source: youtube headline",
    "- Blog Source: blog headline",
    "- X Source: x headline",
    "- Product Hunt Top Products and GitHub Trending: market headline",
    "- Website Source: website headline",
  ]);
});

function digestRenderContext() {
  return {
    generatedAt: "2026-06-03T12:00:00.000Z",
    language: "English",
    digest: { order: ["blog"] },
    sources: {
      blog: { id: "blog", label: "Blog" },
    },
    subscriptionEntities: [{ id: "entity_1", name: "Example Source" }],
    items: [
      {
        id: "feed_1",
        entityId: "entity_1",
        kind: "BLOG_POST",
        externalId: "real-post",
        title: "Real post title",
        summary: "Original stored summary.",
        body: "Original body.",
        url: "https://example.com/real-post",
        publishedAt: "2026-06-03T11:00:00.000Z",
        createdAt: "2026-06-03T11:30:00.000Z",
        sourceName: "example.com",
        builder: {
          id: "builder_1",
          entityId: "entity_1",
          name: "example.com",
          sourceType: "blog",
          sourceUrl: "https://example.com",
          fetchUrl: null,
        },
      },
    ],
  };
}

test("shard-tasks groups by URL domain, balances by weight, excludes non-work tasks", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      {
        id: "t1",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b1", sourceUrl: "https://example.com/feed.xml" },
        item: { url: "https://example.com/posts/a" },
      },
      {
        id: "t2",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b2", sourceUrl: "https://www.example.com/news.xml" },
        item: { url: "https://www.example.com/posts/b" },
      },
      {
        id: "t3",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b3", sourceUrl: "https://other.example/feed.xml" },
        item: { url: "https://other.example/posts/c" },
      },
      {
        id: "t4",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "website",
        builderSync: { builderId: "b4", sourceUrl: "https://third.example" },
      },
      { id: "t5", agentWorkType: "x_token_missing", builderSync: { builderId: "b4" }, agentMessage: "needs token" },
      { id: "t6", agentWorkType: "candidate_discovery_fallback", builderSync: { builderId: "b5" } },
    ],
  };
  const { shards, userActionTasks, discoveryTasks } = cli.shardFetchTasksForWorkers(fetchResult, 3);

  // One domain's tasks never split across shards (per-domain serialization),
  // but the same source type can still fan out when domains differ.
  const shardOfTask = new Map<string, number>();
  shards.forEach((shard: { tasks: { id: string }[] }, index: number) => {
    for (const task of shard.tasks) shardOfTask.set(task.id, index);
  });
  assert.equal(shardOfTask.get("t1"), shardOfTask.get("t2"));
  assert.notEqual(shardOfTask.get("t1"), shardOfTask.get("t3"));
  // All work tasks are covered exactly once; non-work tasks are excluded.
  assert.deepEqual([...shardOfTask.keys()].sort(), ["t1", "t2", "t3", "t4"]);
  assert.deepEqual(userActionTasks.map((t: { id: string }) => t.id), ["t5"]);
  assert.deepEqual(discoveryTasks.map((t: { id: string }) => t.id), ["t6"]);
  // maxWorkers caps shard count; URL domain count caps it too.
  assert.ok(shards.length <= 3);
  assert.equal(cli.shardFetchTasksForWorkers(fetchResult, 8).shards.length, 3);
});

test("fetch queue assignments honor active domain locks", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      {
        id: "locked-a",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b1", sourceUrl: "https://example.com/feed.xml" },
        item: { url: "https://example.com/posts/a" },
      },
      {
        id: "locked-b",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b2", sourceUrl: "https://www.example.com/news.xml" },
        item: { url: "https://www.example.com/posts/b" },
      },
      {
        id: "runnable",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b3", sourceUrl: "https://other.example/feed.xml" },
        item: { url: "https://other.example/posts/c" },
      },
    ],
  };

  const plan = cli.planFetchQueueAssignments(fetchResult, {
    maxWorkers: 3,
    activeGroupKeys: new Set(["domain:example.com"]),
  });

  assert.deepEqual(plan.blockedGroupKeys, ["domain:example.com"]);
  assert.deepEqual(plan.blockedTasks.map((task: { id: string }) => task.id).sort(), ["locked-a", "locked-b"]);
  assert.deepEqual(
    plan.assignments.flatMap((assignment: { tasks: { id: string }[] }) =>
      assignment.tasks.map((task) => task.id),
    ),
    ["runnable"],
  );
});

test("fetch queue assignments can leave runnable work pending for later workers", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      {
        id: "example-a",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b1", sourceUrl: "https://example.com/feed.xml" },
        item: { url: "https://example.com/posts/a" },
      },
      {
        id: "example-b",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b2", sourceUrl: "https://www.example.com/news.xml" },
        item: { url: "https://www.example.com/posts/b" },
      },
      {
        id: "other",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b3", sourceUrl: "https://other.example/feed.xml" },
        item: { url: "https://other.example/posts/c" },
      },
      {
        id: "third",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "website",
        builderSync: { builderId: "b4", sourceUrl: "https://third.example" },
      },
    ],
  };

  const plan = cli.planFetchQueueAssignments(fetchResult, {
    maxWorkers: 1,
    maxGroupsPerAssignment: 1,
  });

  assert.equal(plan.assignments.length, 1);
  assert.deepEqual(plan.assignments[0].groupKeys, ["domain:example.com"]);
  assert.deepEqual(plan.assignments[0].tasks.map((task: { id: string }) => task.id), [
    "example-a",
    "example-b",
  ]);
  assert.deepEqual(plan.pendingGroupKeys.sort(), ["domain:other.example", "domain:third.example"].sort());
  assert.deepEqual(plan.pendingTasks.map((task: { id: string }) => task.id).sort(), ["other", "third"]);
});

test("fetch queue assignment exclusions are scoped by cloud run id", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      {
        id: "shared-post",
        cloudRunId: "run_1",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b1", sourceUrl: "https://example.com/feed.xml" },
        item: { url: "https://example.com/posts/shared" },
      },
      {
        id: "shared-post",
        cloudRunId: "run_2",
        agentWorkType: "fetch_post",
        contentStatus: "requires_agent",
        sourceType: "blog",
        builderSync: { builderId: "b1", sourceUrl: "https://example.com/feed.xml" },
        item: { url: "https://example.com/posts/shared" },
      },
    ],
  };

  const plan = cli.planFetchQueueAssignments(fetchResult, {
    maxWorkers: 1,
    excludeTaskIds: new Set(["run_1\tshared-post"]),
  });

  assert.deepEqual(
    plan.assignments.flatMap((assignment: { tasks: { cloudRunId: string }[] }) =>
      assignment.tasks.map((task) => task.cloudRunId),
    ),
    ["run_2"],
  );
});

test("assign-fetch-tasks writes dynamic shards and skips already assigned task ids", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-assign-fetch-tasks-"));
  const tasksFile = join(tmp, "fetch-result.json");
  const outDir = join(tmp, "shards");
  const assignedIdsFile = join(tmp, "assigned-task-ids.txt");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        {
          id: "example-a",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          sourceType: "blog",
          builderSync: { builderId: "b1", sourceUrl: "https://example.com/feed.xml" },
          item: { url: "https://example.com/posts/a" },
        },
        {
          id: "example-b",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          sourceType: "blog",
          builderSync: { builderId: "b2", sourceUrl: "https://www.example.com/news.xml" },
          item: { url: "https://www.example.com/posts/b" },
        },
        {
          id: "other",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          sourceType: "blog",
          builderSync: { builderId: "b3", sourceUrl: "https://other.example/feed.xml" },
          item: { url: "https://other.example/posts/c" },
        },
        {
          id: "third",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          sourceType: "website",
          builderSync: { builderId: "b4", sourceUrl: "https://third.example" },
        },
      ],
    })}\n`,
    "utf8",
  );

  const first = await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "assign-fetch-tasks",
      "--tasks",
      tasksFile,
      "--out-dir",
      outDir,
      "--max-workers",
      "2",
      "--assigned-task-ids-file",
      assignedIdsFile,
    ],
    { cwd: process.cwd() },
  );
  const firstResult = JSON.parse(first.stdout);
  assert.equal(firstResult.shards.length, 2);
  assert.deepEqual(
    firstResult.shards.map((shard: { shard: string; groupKeys: string[] }) => [shard.shard, shard.groupKeys]),
    [
      ["shard-0", ["domain:example.com"]],
      ["shard-1", ["domain:other.example"]],
    ],
  );
  assert.deepEqual(firstResult.pendingGroupKeys, ["domain:third.example"]);

  const shard0 = JSON.parse(await readFile(join(outDir, "shard-0.json"), "utf8"));
  assert.equal(shard0.dynamicAssignment, true);
  assert.equal(shard0.shardCount, null);
  assert.equal(shard0.workerId, "worker-0");
  assert.deepEqual(shard0.groupKeys, ["domain:example.com"]);
  assert.equal(shard0.fetchTasks[0].workerId, "worker-0");

  const assignedAfterFirst = (await readFile(assignedIdsFile, "utf8")).trim().split(/\r?\n/).sort();
  assert.deepEqual(assignedAfterFirst, ["example-a", "example-b", "other"]);

  const second = await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "assign-fetch-tasks",
      "--tasks",
      tasksFile,
      "--out-dir",
      outDir,
      "--max-workers",
      "2",
      "--assigned-task-ids-file",
      assignedIdsFile,
    ],
    { cwd: process.cwd() },
  );
  const secondResult = JSON.parse(second.stdout);
  assert.deepEqual(
    secondResult.shards.map((shard: { shard: string; taskIds: string[] }) => [shard.shard, shard.taskIds]),
    [["shard-2", ["third"]]],
  );
  assert.deepEqual(secondResult.pendingGroupKeys, []);
});

test("assign-fetch-tasks binds dynamic assignments to stable worker lanes", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-stable-worker-lanes-"));
  const tasksFile = join(tmp, "fetch-result.json");
  const outDir = join(tmp, "shards");
  const workerIdsFile = join(tmp, "worker-ids.txt");
  await writeFile(workerIdsFile, "worker-3\nworker-5\n", "utf8");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        {
          id: "example-a",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          sourceType: "blog",
          builderSync: { builderId: "b1" },
          item: { url: "https://example.com/a" },
        },
        {
          id: "other-a",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          sourceType: "blog",
          builderSync: { builderId: "b2" },
          item: { url: "https://other.example/a" },
        },
      ],
    })}\n`,
    "utf8",
  );

  const result = await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "assign-fetch-tasks",
      "--tasks",
      tasksFile,
      "--out-dir",
      outDir,
      "--max-workers",
      "2",
      "--worker-ids-file",
      workerIdsFile,
    ],
    { cwd: process.cwd() },
  );
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(
    parsed.shards.map((shard: { shard: string; workerId: string }) => [shard.shard, shard.workerId]),
    [
      ["shard-0", "worker-3"],
      ["shard-1", "worker-5"],
    ],
  );

  const shard0 = JSON.parse(await readFile(join(outDir, "shard-0.json"), "utf8"));
  const shard1 = JSON.parse(await readFile(join(outDir, "shard-1.json"), "utf8"));
  assert.equal(shard0.workerId, "worker-3");
  assert.equal(shard0.fetchTasks[0].workerId, "worker-3");
  assert.equal(shard1.workerId, "worker-5");
  assert.equal(shard1.fetchTasks[0].workerId, "worker-5");
});

test("shard-tasks writes shard worker ids onto planned post tasks", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-shard-worker-id-"));
  const tasksFile = join(tmp, "fetch-result.json");
  const outDir = join(tmp, "shards");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        {
          id: "fetch_post:podcast:a",
          agentWorkType: "fetch_post",
          contentStatus: "requires_agent",
          sourceType: "youtube",
          builderSync: { builderId: "podcast" },
          item: { title: "Episode A" },
        },
      ],
    })}\n`,
    "utf8",
  );

  await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "shard-tasks",
      "--tasks",
      tasksFile,
      "--out-dir",
      outDir,
      "--max-workers",
      "3",
    ],
    { cwd: process.cwd() },
  );

  const shard = JSON.parse(await readFile(join(outDir, "shard-0.json"), "utf8"));
  assert.equal(shard.fetchTasks[0].workerId, "shard-0");
});

test("x token action tasks are logged and sharded as user actions", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      { id: "missing", agentWorkType: "x_token_missing", builderSync: { builderId: "x1" }, agentMessage: "missing token" },
      { id: "invalid", agentWorkType: "x_token_invalid", builderSync: { builderId: "x2" }, agentMessage: "invalid token" },
      { id: "work", agentWorkType: "fetch_post", contentStatus: "requires_agent", sourceType: "youtube", builderSync: { builderId: "y1" } },
    ],
  };

  const { slimFetchTasks } = cli.summarizeFetchTasksForLog(fetchResult.fetchTasks);
  assert.deepEqual(
    slimFetchTasks.map((task: { id: string; status: string }) => [task.id, task.status]),
    [
      ["missing", "action_needed"],
      ["invalid", "action_needed"],
      ["work", "pending"],
    ],
  );

  const { shards, userActionTasks } = cli.shardFetchTasksForWorkers(fetchResult, 2);
  assert.deepEqual(userActionTasks.map((task: { id: string }) => task.id), ["missing", "invalid"]);
  assert.deepEqual(shards.flatMap((shard: { tasks: { id: string }[] }) => shard.tasks.map((task) => task.id)), ["work"]);
});

test("candidate discovery tasks stay out of fetch log post task details", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      {
        id: "candidate_discovery:product-hunt",
        type: "candidate_discovery",
        agentWorkType: "candidate_discovery_fallback",
        sourceType: "product_hunt_top_products",
        builderSync: { builderId: "product-hunt" },
      },
      {
        id: "fetch_post:product-hunt:1",
        type: "fetch_post",
        agentWorkType: "product_hunt_top_product_report",
        sourceType: "product_hunt_top_products",
        contentStatus: "requires_agent",
        item: { title: "#1 WorkClaw", url: "https://www.producthunt.com/posts/workclaw" },
      },
      {
        id: "fetch_post:product-hunt:2",
        type: "fetch_post",
        agentWorkType: "product_hunt_top_product_report",
        sourceType: "product_hunt_top_products",
        contentStatus: "requires_agent",
        item: { title: "#2 Reframe", url: "https://www.producthunt.com/posts/reframe" },
      },
    ],
  };

  const { slimFetchTasks } = cli.summarizeFetchTasksForLog(fetchResult.fetchTasks);

  assert.deepEqual(
    slimFetchTasks.map((task: { id: string }) => task.id),
    ["fetch_post:product-hunt:1", "fetch_post:product-hunt:2"],
  );
  assert.equal(
    slimFetchTasks.some((task: { agentWorkType: string }) => task.agentWorkType === "candidate_discovery_fallback"),
    false,
  );
});

test("candidate discovery outcomes do not count as post task progress", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const progress = {
    version: 1,
    stage: "syncing",
    counters: {
      sourcesTotal: 6,
      sourcesChecked: 6,
      tasksPlanned: 0,
      tasksDone: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      actionNeeded: 0,
    },
    tasks: [],
    recentEvents: [],
    completedTaskIds: [],
  };
  const taskIds = [
    "candidate_discovery:product-hunt",
    "fetch_post:product-hunt:1",
    "fetch_post:product-hunt:2",
    "fetch_post:product-hunt:3",
  ];
  const taskOutcomes = taskIds.map((fetchTaskId) => ({
    fetchTaskId,
    status: "synced",
  }));

  cli.applyFetchProgressTaskOutcomes(progress, taskOutcomes, taskIds);

  assert.deepEqual(progress.counters, {
    sourcesTotal: 6,
    sourcesChecked: 6,
    tasksPlanned: 3,
    tasksDone: 3,
    synced: 3,
    skipped: 0,
    failed: 0,
    actionNeeded: 0,
  });
  assert.deepEqual(
    progress.tasks.map((task: { id: string }) => task.id),
    ["fetch_post:product-hunt:1", "fetch_post:product-hunt:2", "fetch_post:product-hunt:3"],
  );
  assert.deepEqual(
    progress.completedTaskIds,
    ["fetch_post:product-hunt:1", "fetch_post:product-hunt:2", "fetch_post:product-hunt:3"],
  );
});

test("partial task outcome progress does not shrink the canonical planned count", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const progress = {
    version: 1,
    stage: "workers_running",
    counters: {
      sourcesTotal: 6,
      sourcesChecked: 6,
      tasksPlanned: 3,
      tasksDone: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      actionNeeded: 0,
    },
    current: {},
    sources: [],
    tasks: [],
    recentEvents: [],
    completedTaskIds: [],
  };

  cli.applyFetchProgressTaskOutcomes(
    progress,
    [{ fetchTaskId: "fetch_post:product-hunt:workclaw", status: "synced" }],
    ["fetch_post:product-hunt:workclaw"],
  );

  assert.equal(progress.counters.tasksPlanned, 3);
  assert.equal(progress.counters.tasksDone, 1);
  assert.equal(progress.counters.synced, 1);
});

test("split-sync-slices isolates synced items and outcomes by source", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      { id: "a1", agentWorkType: "fetch_post", builderSync: { builderId: "source-a" } },
      { id: "b1", agentWorkType: "fetch_post", builderSync: { builderId: "source-b" } },
      { id: "x1", agentWorkType: "x_token_missing", builderSync: { builderId: "source-x" } },
    ],
  };
  const payload = {
    fetchTool: "test fetcher",
    force: true,
    builders: [
      {
        builderId: "source-a",
        name: "Source A",
        items: [{ externalId: "post-a", rawJson: { fetchTaskId: "a1" } }],
      },
      {
        builderId: "source-b",
        name: "Source B",
        items: [],
      },
    ],
    taskOutcomes: [{ fetchTaskId: "b1", status: "failed", reason: "worker_missing_result" }],
  };

  const slices = cli.splitSyncPayloadBySource(fetchResult, payload);
  const byKey = new Map(slices.map((slice: { key: string }) => [slice.key, slice]));

  const sourceA = byKey.get("source-a") as unknown as {
    tasks: { fetchTasks: { id: string }[] };
    payload: { fetchTool: string; force: boolean; builders: { items: { externalId: string }[] }[]; taskOutcomes: unknown[] };
  };
  assert.deepEqual(sourceA.tasks.fetchTasks.map((task) => task.id), ["a1"]);
  assert.deepEqual(sourceA.payload.builders[0].items.map((item) => item.externalId), ["post-a"]);
  assert.equal(sourceA.payload.fetchTool, "test fetcher");
  assert.equal(sourceA.payload.force, true);
  assert.equal(sourceA.payload.taskOutcomes.length, 0);

  const sourceB = byKey.get("source-b") as unknown as {
    tasks: { fetchTasks: { id: string }[] };
    payload: { builders: unknown[]; taskOutcomes: { fetchTaskId: string }[] };
  };
  assert.deepEqual(sourceB.tasks.fetchTasks.map((task) => task.id), ["b1"]);
  assert.equal(sourceB.payload.builders.length, 0);
  assert.deepEqual(sourceB.payload.taskOutcomes.map((outcome) => outcome.fetchTaskId), ["b1"]);

  const sourceX = byKey.get("source-x") as unknown as {
    tasks: { fetchTasks: { id: string }[] };
    payload: { builders: unknown[]; taskOutcomes: unknown[] };
  };
  assert.deepEqual(sourceX.tasks.fetchTasks.map((task) => task.id), ["x1"]);
  assert.equal(sourceX.payload.builders.length, 0);
  assert.equal(sourceX.payload.taskOutcomes.length, 0);
});

test("split-sync-slices can isolate synced items and outcomes by task", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      { id: "a1", agentWorkType: "fetch_post", builderSync: { builderId: "source-a" } },
      { id: "a2", agentWorkType: "fetch_post", builderSync: { builderId: "source-a" } },
      { id: "fallback", agentWorkType: "fetch_builder_fallback", builderSync: { builderId: "source-a" } },
    ],
  };
  const payload = {
    builders: [
      {
        builderId: "source-a",
        name: "Source A",
        items: [
          { externalId: "post-a1", rawJson: { fetchTaskId: "a1" } },
          { externalId: "fallback-1", rawJson: { fetchTaskId: "fallback" } },
          { externalId: "fallback-2", rawJson: { fetchTaskId: "fallback" } },
        ],
      },
    ],
    taskOutcomes: [{ fetchTaskId: "a2", status: "failed", reason: "summary_error" }],
  };

  const slices = cli.splitSyncPayloadByTask(fetchResult, payload);
  const byKey = new Map(slices.map((slice: { key: string }) => [slice.key, slice]));

  const a1 = byKey.get("task:a1") as unknown as {
    tasks: { fetchTasks: { id: string }[] };
    payload: { builders: { items: { externalId: string }[] }[]; taskOutcomes: unknown[] };
  };
  assert.deepEqual(a1.tasks.fetchTasks.map((task) => task.id), ["a1"]);
  assert.deepEqual(a1.payload.builders[0].items.map((item) => item.externalId), ["post-a1"]);
  assert.equal(a1.payload.taskOutcomes.length, 0);

  const a2 = byKey.get("task:a2") as unknown as {
    tasks: { fetchTasks: { id: string }[] };
    payload: { builders: unknown[]; taskOutcomes: { fetchTaskId: string }[] };
  };
  assert.deepEqual(a2.tasks.fetchTasks.map((task) => task.id), ["a2"]);
  assert.equal(a2.payload.builders.length, 0);
  assert.deepEqual(a2.payload.taskOutcomes.map((outcome) => outcome.fetchTaskId), ["a2"]);

  const fallback = byKey.get("task:fallback") as unknown as {
    payload: { builders: { items: { externalId: string }[] }[] };
  };
  assert.deepEqual(
    fallback.payload.builders[0].items.map((item) => item.externalId),
    ["fallback-1", "fallback-2"],
  );
});

test("fail-sync-slice marks only non-user-action tasks failed", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-fail-sync-slice-"));
  const tasksFile = join(tmp, "slice-tasks.json");
  const outFile = join(tmp, "failed-payload.json");
  const tasksOutFile = join(tmp, "failed-tasks.json");
  const excludeFile = join(tmp, "synced-task-ids.txt");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        { id: "already_synced", agentWorkType: "fetch_post", builderSync: { builderId: "b0" } },
        { id: "work", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
        { id: "token", agentWorkType: "x_token_missing", builderSync: { builderId: "b2" } },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(excludeFile, "already_synced\n", "utf8");

  await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "fail-sync-slice",
      "--tasks",
      tasksFile,
      "--out",
      outFile,
      "--tasks-out",
      tasksOutFile,
      "--exclude-task-ids-file",
      excludeFile,
      "--reason",
      "slice_sync_failed",
      "--message",
      "slice upload failed",
    ],
    { cwd: process.cwd() },
  );
  const payload = JSON.parse(await readFile(outFile, "utf8"));
  const failedTasks = JSON.parse(await readFile(tasksOutFile, "utf8"));

  assert.deepEqual(payload.builders, []);
  assert.deepEqual(
    payload.taskOutcomes.map((outcome: { fetchTaskId: string; reason: string; evidence: { message: string } }) => [
      outcome.fetchTaskId,
      outcome.reason,
      outcome.evidence.message,
    ]),
    [["work", "slice_sync_failed", "slice upload failed"]],
  );
  assert.deepEqual(
    failedTasks.fetchTasks.map((task: { id: string }) => task.id),
    ["work", "token"],
  );
});

test("x fetch returns action-needed task when the bearer token is rejected", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const previousToken = process.env.X_BEARER_TOKEN;
  try {
    process.env.X_BEARER_TOKEN = "bad-token";
    const result = await cli.fetchPersonalXBuilderForTest(
      {
        id: "builder_x",
        kind: "X",
        name: "Bad Token Source",
        handle: "badtoken",
        sourceUrl: "https://x.com/badtoken",
      },
      {
        cutoff: null,
        limit: 3,
        agentModel: "test-model",
        fetchedItemKeys: new Set(),
        fetcher: async () => ({ ok: false, status: 401 }),
        sources: {},
      },
    );

    assert.equal(result.items.length, 0);
    assert.equal(result.agentTasks.length, 1);
    assert.equal(result.agentTasks[0].type, "x_token_invalid");
    assert.match(result.agentTasks[0].agentMessage, /HTTP 401/);
  } finally {
    if (previousToken === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = previousToken;
  }
});

test("source fetch timeout aborts stalled external requests", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const previousTimeout = process.env.BUILDER_BLOG_SOURCE_FETCH_TIMEOUT_MS;
  try {
    process.env.BUILDER_BLOG_SOURCE_FETCH_TIMEOUT_MS = "5";
    await assert.rejects(
      () =>
        cli.timedSourceFetchForTest(
          "https://example.com/slow",
          {},
          (_url: RequestInfo | URL, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              });
            }),
        ),
      /Source fetch timed out after/,
    );
  } finally {
    if (previousTimeout === undefined) delete process.env.BUILDER_BLOG_SOURCE_FETCH_TIMEOUT_MS;
    else process.env.BUILDER_BLOG_SOURCE_FETCH_TIMEOUT_MS = previousTimeout;
  }
});

test("merge-task-results merges shard payloads and backfills missing tasks as failed", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      { id: "t1", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
      { id: "t2", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
      { id: "t3", agentWorkType: "fetch_post", builderSync: { builderId: "b2" } },
      { id: "t4", agentWorkType: "x_token_missing", builderSync: { builderId: "b3" } },
    ],
  };
  const shardResults = [
    {
      name: "shard-0-result.json",
      payload: {
        builders: [
          { builderId: "b1", items: [{ externalId: "v1", rawJson: { fetchTaskId: "t1" } }] },
        ],
        taskOutcomes: [
          { fetchTaskId: "t2", status: "skipped", reason: "no_audio", evidence: { meanVolumeDb: -91 } },
        ],
      },
    },
    { name: "shard-1-result.json", error: "worker timed out" },
  ];
  const merged = cli.mergeShardSyncPayloads(fetchResult, shardResults, {
    shardTimeoutSeconds: 1440,
    shardPlans: [
      {
        shard: "shard-0",
        resultFile: "shard-0-result.json",
        tasks: fetchResult.fetchTasks.slice(0, 2),
      },
      {
        shard: "shard-1",
        resultFile: "shard-1-result.json",
        workerLogFile: "shard-1-worker.log",
        workerLogTail: "Worker shard-1 exceeded 1440s; terminating it.",
        tasks: [fetchResult.fetchTasks[2]],
      },
    ],
  });

  // t1 synced, t2 outcome preserved, t3 backfilled, t4 (user action) untouched.
  assert.equal(merged.payload.builders.length, 1);
  assert.equal(merged.payload.builders[0].items.length, 1);
  assert.equal(merged.payload.builders[0].items[0].rawJson.workerId, "shard-0");
  const outcomes = merged.payload.taskOutcomes as {
    fetchTaskId: string;
    status: string;
    reason: string;
    workerId?: string;
    evidence?: Record<string, unknown>;
  }[];
  const outcomesById = new Map(outcomes.map((o) => [o.fetchTaskId, o]));
  assert.deepEqual([...outcomesById.keys()].sort(), ["t2", "t3"]);
  assert.equal(outcomesById.get("t2")?.workerId, "shard-0");
  assert.equal(outcomesById.get("t3")?.workerId, "shard-1");
  assert.equal(outcomesById.get("t3")?.status, "failed");
  assert.equal(outcomesById.get("t3")?.reason, "worker_missing_result");
  const t3Evidence = outcomesById.get("t3")?.evidence as {
    runShardSummary?: string[];
    missingShard?: {
      shard?: string;
      resultFile?: string;
      workerLogTail?: string;
      taskIds?: string[];
    };
    shardTimeoutSeconds?: number;
  };
  assert.equal(t3Evidence.missingShard?.shard, "shard-1");
  assert.equal(t3Evidence.missingShard?.resultFile, "shard-1-result.json");
  assert.deepEqual(t3Evidence.missingShard?.taskIds, ["t3"]);
  assert.deepEqual(t3Evidence.runShardSummary, ["shard-0-result.json:ok", "shard-1-result.json:missing"]);
  assert.match(t3Evidence.missingShard?.workerLogTail ?? "", /exceeded 1440s/);
  assert.equal(t3Evidence.shardTimeoutSeconds, 1440);
  assert.equal(merged.backfilledOutcomes, 1);
  // Duplicate item for an already-synced normal task is dropped on merge.
  const withDuplicate = cli.mergeShardSyncPayloads(fetchResult, [
    ...shardResults,
    {
      name: "shard-2-result.json",
      payload: {
        builders: [
          { builderId: "b1", items: [{ externalId: "v1-dup", rawJson: { fetchTaskId: "t1" } }] },
        ],
        taskOutcomes: [],
      },
    },
  ]);
  assert.equal(
    withDuplicate.payload.builders.flatMap((b: { items: unknown[] }) => b.items).length,
    1,
  );
});

test("merge-task-results restores ready task body when worker omits or rewrites it", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const omittedBodyTask = {
    id: "ready-podcast-task",
    type: "fetch_post",
    contentStatus: "ready",
    builder: "No Priors",
    builderId: "podcast_builder",
    sourceType: "podcast",
    item: {
      kind: "PODCAST_EPISODE",
      externalId: "episode-1",
      title: "Benchmarks and test-time compute",
      url: "https://traffic.example/episode-1.mp3",
      publishedAt: "2026-06-26T10:13:00.000Z",
      sourceName: "No Priors",
      body:
        "Original RSS body with the full episode description. It explains why static AI benchmarks miss test-time compute, how model capability changes with longer reasoning budgets, and why evaluation design matters for agentic systems.",
    },
  };
  const rewrittenBodyTask = {
    ...omittedBodyTask,
    id: "ready-blog-task",
    builder: "Example Blog",
    builderId: "blog_builder",
    sourceType: "blog",
    item: {
      kind: "BLOG_POST",
      externalId: "https://example.com/post",
      title: "Durable agent logs",
      url: "https://example.com/post",
      publishedAt: "2026-06-26T11:00:00.000Z",
      sourceName: "Example Blog",
      body:
        "Original blog body explaining durable agent logs, source-linked summaries, replayable task state, and why sync payloads must preserve fetched evidence.",
    },
  };
  const fetchResult = { status: "ok", fetchTasks: [omittedBodyTask, rewrittenBodyTask] };
  const merged = cli.mergeShardSyncPayloads(fetchResult, [
    {
      name: "shard-0-result.json",
      payload: {
        builders: [
          {
            builderId: "podcast_builder",
            kind: "PODCAST",
            sourceType: "podcast",
            name: "No Priors",
            items: [
              {
                kind: "PODCAST_EPISODE",
                externalId: "episode-1",
                title: "Benchmarks and test-time compute",
                url: "https://traffic.example/episode-1.mp3",
                summary:
                  "这期播客总结 test-time compute 如何改变 AI benchmark 的解读，并强调评估设计对 agentic systems 的重要性。来源：https://traffic.example/episode-1.mp3",
                rawJson: { fetchTaskId: "ready-podcast-task" },
              },
            ],
          },
          {
            builderId: "blog_builder",
            kind: "BLOG",
            sourceType: "blog",
            name: "Example Blog",
            items: [
              {
                kind: "BLOG_POST",
                externalId: "https://example.com/post",
                title: "Durable agent logs",
                url: "https://example.com/post",
                body: "Agent rewrote this into a short pseudo-body.",
                summary:
                  "这篇文章总结 durable agent logs 如何帮助回放任务状态、保留来源证据，并让 sync payload 更可靠。来源：https://example.com/post",
                rawJson: { fetchTaskId: "ready-blog-task" },
              },
            ],
          },
        ],
        taskOutcomes: [],
      },
    },
  ]);

  const itemsByTaskId = new Map(
    merged.payload.builders.flatMap((builder: { items: Array<{ body: string; summary: string; rawJson: { fetchTaskId?: string; workerId?: string } }> }) =>
      builder.items.map((item) => [item.rawJson?.fetchTaskId, item]),
    ),
  );
  const omittedBodyItem = itemsByTaskId.get("ready-podcast-task");
  assert.equal(omittedBodyItem?.body, omittedBodyTask.item.body);
  assert.equal(omittedBodyItem?.summary.includes("test-time compute"), true);
  assert.equal(omittedBodyItem?.rawJson.workerId, "shard-0");

  const rewrittenBodyItem = itemsByTaskId.get("ready-blog-task");
  assert.equal(rewrittenBodyItem?.body, rewrittenBodyTask.item.body);
  assert.equal(rewrittenBodyItem?.summary.includes("durable agent logs"), true);
  assert.equal(rewrittenBodyItem?.rawJson.workerId, "shard-0");

  const validation = cli.validateAgentSyncPayload(fetchResult, merged.payload);
  assert.equal(validation.status, "ok");
  assert.equal(validation.validatedFetchTasks, 2);
});

test("merge-task-results canonicalizes stale ready item fetch task ids", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = {
    id: "current-cloud-task",
    type: "fetch_post",
    contentStatus: "ready",
    builder: "Blog | Claude",
    builderId: "current_builder",
    sourceType: "blog",
    item: {
      kind: "BLOG_POST",
      externalId: "https://claude.com/blog/foundation-models",
      title: "Foundation Models",
      url: "https://claude.com/blog/foundation-models",
      publishedAt: "2026-06-26T11:00:00.000Z",
      sourceName: "Blog | Claude",
      body: "Original ready body from a hub-shared source that should be preserved for this cloud task.",
    },
  };
  const fetchResult = { status: "ok", fetchTasks: [task] };
  const merged = cli.mergeShardSyncPayloads(fetchResult, [
    {
      name: "shard-0-result.json",
      payload: {
        builders: [
          {
            builderId: "current_builder",
            kind: "BLOG",
            sourceType: "blog",
            name: "Blog | Claude",
            items: [
              {
                kind: "BLOG_POST",
                externalId: "https://claude.com/blog/foundation-models",
                title: "Foundation Models",
                url: "https://claude.com/blog/foundation-models",
                summary: "A valid translated summary for the current cloud task.",
                rawJson: {
                  fetchTaskId: "stale-hub-task",
                  hubSharedReuse: { source: "hub_shared_post" },
                },
              },
            ],
          },
        ],
        taskOutcomes: [],
      },
    },
  ]);

  assert.equal(merged.backfilledOutcomes, 0);
  assert.deepEqual(merged.payload.taskOutcomes, []);
  const item = merged.payload.builders[0].items[0] as {
    body?: string;
    rawJson?: { fetchTaskId?: string; hubSharedReuse?: { source?: string } };
  };
  assert.equal(item.rawJson?.fetchTaskId, "current-cloud-task");
  assert.equal(item.rawJson?.hubSharedReuse?.source, "hub_shared_post");
  assert.equal(item.body, task.item.body);

  const validation = cli.validateAgentSyncPayload(fetchResult, merged.payload);
  assert.equal(validation.status, "ok");
  assert.equal(validation.validatedFetchTasks, 1);
});

test("merge-task-results preserves task checkpoints when a shard result is missing", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      { id: "done", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
      { id: "lost", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
    ],
  };

  const merged = cli.mergeShardSyncPayloads(fetchResult, [
    { name: "shard-0-result.json", error: "no result file" },
    {
      name: "shard-0-checkpoints/done.json",
      payload: {
        builders: [
          { builderId: "b1", items: [{ externalId: "done-item", rawJson: { fetchTaskId: "done" } }] },
        ],
        taskOutcomes: [],
      },
    },
  ], {
    shardPlans: [
      {
        shard: "shard-0",
        resultFile: "shard-0-result.json",
        workerLogFile: "shard-0-worker.log",
        tasks: fetchResult.fetchTasks,
      },
    ],
  });

  assert.deepEqual(
    merged.payload.builders.flatMap((b: { items: { externalId: string }[] }) =>
      b.items.map((item) => item.externalId),
    ),
    ["done-item"],
  );
  const outcomes = merged.payload.taskOutcomes as { fetchTaskId: string; reason: string }[];
  assert.deepEqual(outcomes.map((outcome) => [outcome.fetchTaskId, outcome.reason]), [
    ["lost", "worker_missing_result"],
  ]);
});

test("merge-task-results can exclude checkpoint-synced task ids from final sync output", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-merge-exclude-"));
  const resultsDir = join(tmp, "results");
  const tasksFile = join(tmp, "fetch-result.json");
  const payloadFile = join(tmp, "remaining-payload.json");
  const tasksOutFile = join(tmp, "remaining-tasks.json");
  const excludeFile = join(tmp, "synced-ids.txt");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        { id: "already", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
        { id: "remaining", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(excludeFile, "already\n", "utf8");
  await mkdir(resultsDir);
  await writeFile(
    join(resultsDir, "shard-0-result.json"),
    `${JSON.stringify({
      builders: [
        {
          builderId: "b1",
          items: [
            { externalId: "already-item", rawJson: { fetchTaskId: "already" } },
            { externalId: "remaining-item", rawJson: { fetchTaskId: "remaining" } },
          ],
        },
      ],
      taskOutcomes: [],
    })}\n`,
    "utf8",
  );

  await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "merge-task-results",
      "--tasks",
      tasksFile,
      "--results-dir",
      resultsDir,
      "--exclude-task-ids-file",
      excludeFile,
      "--tasks-out",
      tasksOutFile,
      "--out",
      payloadFile,
    ],
    { cwd: process.cwd() },
  );

  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const remainingTasks = JSON.parse(await readFile(tasksOutFile, "utf8"));
  assert.deepEqual(
    payload.builders.flatMap((builder: { items: { externalId: string }[] }) =>
      builder.items.map((item) => item.externalId),
    ),
    ["remaining-item"],
  );
  assert.deepEqual(
    remainingTasks.fetchTasks.map((task: { id: string }) => task.id),
    ["remaining"],
  );
});

test("merge-task-results completed-only waits for full source coverage", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-merge-complete-source-"));
  const resultsDir = join(tmp, "results");
  const tasksFile = join(tmp, "fetch-result.json");
  const payloadFile = join(tmp, "checkpoint-payload.json");
  const tasksOutFile = join(tmp, "checkpoint-tasks.json");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        {
          id: "source_a_done",
          agentWorkType: "fetch_post",
          cloudRunId: "run_1",
          cloudSourceTaskId: "source_a",
          builderSync: { builderId: "builder_a", cloudSourceTaskId: "source_a" },
        },
        {
          id: "source_a_pending",
          agentWorkType: "fetch_post",
          cloudRunId: "run_1",
          cloudSourceTaskId: "source_a",
          builderSync: { builderId: "builder_a", cloudSourceTaskId: "source_a" },
        },
        {
          id: "source_b_done",
          agentWorkType: "fetch_post",
          cloudRunId: "run_1",
          cloudSourceTaskId: "source_b",
          builderSync: { builderId: "builder_b", cloudSourceTaskId: "source_b" },
        },
      ],
    })}\n`,
    "utf8",
  );
  await mkdir(resultsDir);
  await writeFile(
    join(resultsDir, "shard-0-result.json"),
    `${JSON.stringify({
      builders: [
        {
          builderId: "builder_a",
          items: [{ externalId: "a-done", rawJson: { fetchTaskId: "source_a_done" } }],
        },
        {
          builderId: "builder_b",
          items: [{ externalId: "b-done", rawJson: { fetchTaskId: "source_b_done" } }],
        },
      ],
      taskOutcomes: [],
    })}\n`,
    "utf8",
  );

  await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "merge-task-results",
      "--tasks",
      tasksFile,
      "--results-dir",
      resultsDir,
      "--completed-only",
      "--tasks-out",
      tasksOutFile,
      "--out",
      payloadFile,
    ],
    { cwd: process.cwd() },
  );

  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const checkpointTasks = JSON.parse(await readFile(tasksOutFile, "utf8"));
  assert.deepEqual(
    payload.builders.flatMap((builder: { items: { externalId: string }[] }) =>
      builder.items.map((item) => item.externalId),
    ),
    ["b-done"],
  );
  assert.deepEqual(
    checkpointTasks.fetchTasks.map((task: { id: string }) => task.id),
    ["source_b_done"],
  );
});

test("merge-task-results keeps zero-post cloud sources in final remaining tasks", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-merge-zero-source-"));
  const resultsDir = join(tmp, "results");
  const tasksFile = join(tmp, "fetch-result.json");
  const payloadFile = join(tmp, "remaining-payload.json");
  const tasksOutFile = join(tmp, "remaining-tasks.json");
  const excludeFile = join(tmp, "synced-ids.txt");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        {
          id: "already",
          agentWorkType: "fetch_post",
          cloudRunId: "run_1",
          cloudSourceTaskId: "source_with_posts",
          builderSync: { builderId: "b1", cloudSourceTaskId: "source_with_posts" },
        },
        {
          id: "candidate_discovery:b2:product_hunt_top_products",
          type: "candidate_discovery",
          agentWorkType: "candidate_discovery_fallback",
          cloudRunId: "run_1",
          cloudSourceTaskId: "source_without_posts",
          builderSync: { builderId: "b2", cloudSourceTaskId: "source_without_posts" },
        },
      ],
      cloudSourceTasks: [
        {
          cloudRunId: "run_1",
          cloudSourceTaskId: "source_with_posts",
          builderId: "b1",
          name: "Source With Posts",
          sourceType: "blog",
        },
        {
          cloudRunId: "run_1",
          cloudSourceTaskId: "source_without_posts",
          builderId: "b2",
          name: "Source Without Posts",
          sourceType: "product_hunt_top_products",
        },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(excludeFile, "run_1\talready\n", "utf8");
  await mkdir(resultsDir);
  await writeFile(
    join(resultsDir, "shard-0-result.json"),
    `${JSON.stringify({
      builders: [
        {
          builderId: "b1",
          items: [{ externalId: "already-item", rawJson: { fetchTaskId: "already" } }],
        },
      ],
      taskOutcomes: [],
    })}\n`,
    "utf8",
  );

  await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "merge-task-results",
      "--tasks",
      tasksFile,
      "--results-dir",
      resultsDir,
      "--exclude-task-ids-file",
      excludeFile,
      "--tasks-out",
      tasksOutFile,
      "--out",
      payloadFile,
    ],
    { cwd: process.cwd() },
  );

  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const remainingTasks = JSON.parse(await readFile(tasksOutFile, "utf8"));
  assert.deepEqual(payload.builders, []);
  assert.deepEqual(
    remainingTasks.fetchTasks.map((task: { id: string }) => task.id),
    [],
  );
  assert.deepEqual(
    remainingTasks.cloudSourceTasks.map((task: { cloudSourceTaskId: string }) => task.cloudSourceTaskId),
    ["source_without_posts"],
  );
});

test("merge-task-results checkpoint exclusions keep repeated cloud task ids run-scoped", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-merge-cloud-exclude-"));
  const resultsDir = join(tmp, "results");
  const tasksFile = join(tmp, "fetch-result.json");
  const payloadFile = join(tmp, "remaining-payload.json");
  const tasksOutFile = join(tmp, "remaining-tasks.json");
  const idsOutFile = join(tmp, "remaining-ids.txt");
  const excludeFile = join(tmp, "synced-ids.txt");
  await writeFile(
    tasksFile,
    `${JSON.stringify({
      status: "ok",
      fetchTasks: [
        {
          id: "shared-post",
          cloudRunId: "run_1",
          cloudSourceTaskId: "source_task_1",
          agentWorkType: "fetch_post",
          builderSync: { builderId: "b1" },
        },
        {
          id: "shared-post",
          cloudRunId: "run_2",
          cloudSourceTaskId: "source_task_2",
          agentWorkType: "fetch_post",
          builderSync: { builderId: "b1" },
        },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(excludeFile, "run_1\tshared-post\n", "utf8");
  await mkdir(resultsDir);
  await writeFile(
    join(resultsDir, "shard-0-result.json"),
    `${JSON.stringify({
      builders: [
        {
          builderId: "b1",
          items: [{ externalId: "shared-item", rawJson: { fetchTaskId: "shared-post" } }],
        },
      ],
      taskOutcomes: [],
    })}\n`,
    "utf8",
  );

  await execFileAsync(
    process.execPath,
    [
      "scripts/builder-digest.mjs",
      "merge-task-results",
      "--tasks",
      tasksFile,
      "--results-dir",
      resultsDir,
      "--exclude-task-ids-file",
      excludeFile,
      "--tasks-out",
      tasksOutFile,
      "--ids-out",
      idsOutFile,
      "--out",
      payloadFile,
    ],
    { cwd: process.cwd() },
  );

  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const remainingTasks = JSON.parse(await readFile(tasksOutFile, "utf8"));
  const remainingIds = (await readFile(idsOutFile, "utf8")).trim().split(/\r?\n/);
  assert.deepEqual(
    payload.builders.flatMap((builder: { items: { externalId: string }[] }) =>
      builder.items.map((item) => item.externalId),
    ),
    ["shared-item"],
  );
  assert.deepEqual(
    remainingTasks.fetchTasks.map((task: { cloudRunId: string }) => task.cloudRunId),
    ["run_2"],
  );
  assert.deepEqual(remainingIds, ["run_2\tshared-post"]);
});

test("merge-task-results classifies missing OpenClaw auth-failed shards", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      { id: "auth-lost", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
    ],
  };

  const merged = cli.mergeShardSyncPayloads(fetchResult, [
    { name: "shard-0-result.json", error: "no result file" },
  ], {
    shardPlans: [
      {
        shard: "shard-0",
        resultFile: "shard-0-result.json",
        workerLogFile: "shard-0-worker.log",
        workerLogTail:
          "OAuth token refresh failed for openai-codex. fetch failed. Please try again or re-authenticate.",
        tasks: fetchResult.fetchTasks,
      },
    ],
  });

  const outcomes = merged.payload.taskOutcomes as {
    fetchTaskId: string;
    reason: string;
    evidence?: {
      failureKind?: string;
      missingShard?: {
        workerLogTail?: string;
      };
    };
  }[];
  assert.deepEqual(outcomes.map((outcome) => [outcome.fetchTaskId, outcome.reason]), [
    ["auth-lost", "runtime_auth_failed"],
  ]);
  assert.equal(outcomes[0]?.evidence?.failureKind, "runtime_auth_failed");
  assert.match(outcomes[0]?.evidence?.missingShard?.workerLogTail ?? "", /OAuth token refresh failed/);
});

test("merge-task-results prefers final shard results over stale task checkpoints", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const fetchResult = {
    status: "ok",
    fetchTasks: [
      { id: "task", agentWorkType: "fetch_post", builderSync: { builderId: "b1" } },
    ],
  };

  const merged = cli.mergeShardSyncPayloads(fetchResult, [
    {
      name: "shard-0-result.json",
      payload: {
        builders: [
          { builderId: "b1", items: [{ externalId: "fresh", rawJson: { fetchTaskId: "task" } }] },
        ],
        taskOutcomes: [],
      },
    },
    {
      name: "shard-0-checkpoints/task.json",
      payload: {
        builders: [],
        taskOutcomes: [{ fetchTaskId: "task", status: "failed", reason: "stale_checkpoint" }],
      },
    },
  ]);

  assert.deepEqual(
    merged.payload.builders.flatMap((b: { items: { externalId: string }[] }) =>
      b.items.map((item) => item.externalId),
    ),
    ["fresh"],
  );
  assert.equal(merged.payload.taskOutcomes.length, 0);
});
