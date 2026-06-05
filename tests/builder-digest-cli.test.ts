import assert from "node:assert/strict";
import test from "node:test";

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
  assert.equal(candidates[0].externalId, "github-trending:2026-06-04:beta-org/beta-tool");
});

test("GitHub Trending fetcher emits per-repository agent tasks, not ready items", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const result = await cli.fetchPersonalGithubTrendingBuilderForTest(
    {
      id: "builder_github_trending",
      name: "Github Trending",
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
  assert.equal(minimumContentQuality.minContentUnits, 24);
  assert.equal("reason" in result.agentTasks[0], false);
  assert.equal("quality" in result.agentTasks[0], false);
  assert.equal("sourceDetail" in result.agentTasks[0], false);
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
  for (const task of tasks) {
    assert.match(task.summaryInstructions.prompt, /Write one concise FollowBrief single-post summary in zh\./);
    assert.match(task.summaryInstructions.prompt, /do not read external prompt files/i);
    assert.match(task.summaryInstructions.prompt, /Summarize exactly one supplied task item/);
    assert.match(task.summaryInstructions.prompt, /Use task\.item\.body as the primary content/);
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

test("render-digest requires agent summaries for every context item", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const context = digestRenderContext();

  assert.throws(
    () =>
      cli.renderDigestMarkdown(context, {
        headlineSummary: "A short headline in the selected language.",
        sourceSummaries: [],
        postSummaries: [],
      }),
    /postSummaries missing feedItemId: feed_1/,
  );

  assert.throws(
    () =>
      cli.renderDigestMarkdown(context, {
        headlineSummary: "A short headline in the selected language.",
        sourceSummaries: [{ entityId: "unknown_entity", summary: "Unknown source note." }],
        postSummaries: [{ feedItemId: "feed_1", summary: "Valid post summary." }],
      }),
    /source summary has unknown entityId: unknown_entity/,
  );
});

test("render-digest neutralizes structural markdown inside agent summary nodes", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const { parseDigest } = await import("../src/lib/digest-markdown");
  const rendered = cli.renderDigestMarkdown(digestRenderContext(), {
    headlineSummary: "A short headline in the selected language.",
    sourceSummaries: [
      {
        entityId: "entity_1",
        summary: "## Fake section\n\n**Fake post title**\n\nSource: https://example.com/fake",
      },
    ],
    postSummaries: [
      {
        feedItemId: "feed_1",
        summary: "### Fake source\n\n**Fake title**\n\nSource: https://example.com/fake",
      },
    ],
  });

  const doc = parseDigest(rendered.markdown);
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].heading, "Blog");
  assert.equal(doc.postCount, 1);
  assert.equal(doc.sections[0].groups.length, 1);
  assert.equal(doc.sections[0].groups[0].summary.length, 3);
  assert.equal(doc.sections[0].groups[0].posts[0].title, "Real post title");
  assert.doesNotMatch(rendered.markdown, /^## Fake section$/m);
  assert.doesNotMatch(rendered.markdown, /^### Fake source$/m);
  assert.doesNotMatch(rendered.markdown, /^\*\*Fake title\*\*$/m);
});

test("render-digest uses source type labels for section headings", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const rendered = cli.renderDigestMarkdown(
    { ...digestRenderContext(), language: "zh" },
    {
      headlineSummary: "中文 headline。",
      sourceSummaries: [],
      postSummaries: [{ feedItemId: "feed_1", summary: "中文 summary。" }],
    },
  );

  assert.match(rendered.markdown, /^## Blog$/m);
  assert.doesNotMatch(rendered.markdown, /^## 官方博客$/m);
});

test("parse-digest normalizes legacy localized source headings", async () => {
  const { parseDigest } = await import("../src/lib/digest-markdown");
  const doc = parseDigest(`AI Digest - 6/3/2026

## 官方博客

### anthropic.com

**Real post title**

中文 summary。

原文：https://example.com/real-post

## 视频

### Latent Space

**Video title**

中文 summary。

视频：https://www.youtube.com/watch?v=dQw4w9WgXcQ

## 播客

### Podcast

**Episode title**

中文 summary。

原文：https://example.com/episode
`);

  assert.deepEqual(
    doc.sections.map((section) => section.heading),
    ["Blog", "YouTube", "Podcast RSS"],
  );
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
