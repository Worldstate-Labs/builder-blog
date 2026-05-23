import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BuilderKind, BuilderScope, FeedItemKind } from "@prisma/client";
import { isAdminEmail } from "../src/lib/admin";
import { builderLibraryKey, canonicalBuilderKey, normalizeHandle } from "../src/lib/builder-keys";
import { subscriptionBuilderIdsInPool } from "../src/lib/digest-library";
import { DIGEST_PROMPTS } from "../src/lib/digest-prompts";
import {
  parseSkillBuilderSyncPayload,
  parseSkillDigestPayload,
} from "../src/lib/skill-contracts";
import {
  candidateSearchTerms,
  didYouMeanSearch,
  mergeSearchSuggestions,
  normalizeRecentSearches,
  parseSearchQuery,
  relatedSearchSuggestions,
  rankSearchDocuments,
  shouldUseCorrectedSearch,
  normalizeSearchSort,
  normalizeSearchTime,
  normalizeSearchMode,
} from "../src/lib/search";
import {
  builderSourceLabel,
  builderKindForSourceType,
  centralCrawlerBuilderKinds,
  feedItemKindLabel,
  personalCrawlerSourceForBuilder,
  sourceDefinitionForType,
  sourceDefinitionForBuilder,
  sourceTypeIdForBuilder,
} from "../src/lib/source-registry";
import { hashToken, newAgentToken, newDeviceCode } from "../src/lib/tokens";

test("terminal login user path uses short device codes and opaque bearer tokens", () => {
  const code = newDeviceCode();
  const token = newAgentToken();

  assert.match(code, /^[A-Z0-9]{1,8}$/);
  assert.match(token, /^bb_[A-Za-z0-9_-]{40,}$/);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), token);
});

test("admin user path is restricted to configured admin emails", () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "admin@example.com, jie@worldstatelabs.com";
  try {
    assert.equal(isAdminEmail("admin@example.com"), true);
    assert.equal(isAdminEmail("JIE@WORLDSTATELABS.COM"), true);
    assert.equal(isAdminEmail("user@example.com"), false);
    assert.equal(isAdminEmail(null), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});

test("builder library user path keeps central and per-user builders distinct while deduping within each library", () => {
  const canonicalKey = canonicalBuilderKey(BuilderKind.X, normalizeHandle(" @OpenAI "));

  assert.equal(canonicalKey, "X:openai");
  assert.equal(
    builderLibraryKey({ scope: BuilderScope.CENTRAL, canonicalKey }),
    "central:X:openai",
  );
  assert.equal(
    builderLibraryKey({ scope: BuilderScope.PERSONAL, ownerUserId: "user_a", canonicalKey }),
    "user:user_a:X:openai",
  );
  assert.equal(
    builderLibraryKey({ scope: BuilderScope.PERSONAL, ownerUserId: "user_b", canonicalKey }),
    "user:user_b:X:openai",
  );
});

test("subscription user path is a digest subset of the active builder pool", () => {
  assert.deepEqual(
    subscriptionBuilderIdsInPool(
      ["central_openai", "personal_youtube"],
      ["personal_youtube", "removed_builder", "central_openai"],
    ),
    ["personal_youtube", "central_openai"],
  );
});

test("skill sync user path accepts personal YouTube builders with synced feed items", () => {
  const parsed = parseSkillBuilderSyncPayload({
    force: true,
    builders: [
      {
        kind: "PODCAST",
        sourceType: "YOUTUBE",
        name: "OpenAI YouTube",
        sourceUrl: "https://www.youtube.com/@OpenAI",
        crawlUrl: "https://www.youtube.com/@OpenAI",
        subscribe: true,
        items: [
          {
            kind: "PODCAST_EPISODE",
            externalId: "video123",
            title: "Workspace agents in ChatGPT",
            body: "Transcript or feed description",
            url: "https://www.youtube.com/watch?v=video123",
            publishedAt: "2026-05-22T10:00:00.000Z",
            rawJson: { source: "personal-youtube" },
          },
        ],
      },
    ],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.force, true);
  assert.equal(parsed.data.builders[0].kind, BuilderKind.PODCAST);
  assert.equal(parsed.data.builders[0].sourceType, "YOUTUBE");
  assert.equal(parsed.data.builders[0].subscribe, true);
  assert.equal(parsed.data.builders[0].items[0].kind, FeedItemKind.PODCAST_EPISODE);
  assert.equal(parsed.data.crawlingTool, "Agent skill sync");
  assert.equal(parsed.data.builders[0].items[0].crawlingTool, undefined);
});

test("digest sync user path defaults optional fields and rejects empty content", () => {
  const parsed = parseSkillDigestPayload({
    title: "Personal YouTube Builder Digest",
    content: "Digest body",
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.language, "zh");
  assert.equal(parsed.data.itemCount, 0);

  const empty = parseSkillDigestPayload({ title: "Bad", content: "" });
  assert.equal(empty.success, false);
});

test("digest generation user path exposes source-specific prompt instructions", () => {
  assert.deepEqual(
    Object.keys(DIGEST_PROMPTS).sort(),
    ["digest", "digestIntro", "summarizeBlogs", "summarizePodcast", "summarizeTweets", "translate"].sort(),
  );
  assert.match(DIGEST_PROMPTS.summarizePodcast, /podcast transcript/i);
  assert.match(DIGEST_PROMPTS.translate, /simplified Chinese/i);
});

test("search user path exact mode matches literal text across builders, feeds, and digests", () => {
  const results = rankSearchDocuments({
    query: "agent memory",
    mode: "exact",
    documents: [
      {
        id: "builder_1",
        type: "builder",
        title: "Memory Labs",
        body: "Builder working on agent memory systems.",
      },
      {
        id: "feed_1",
        type: "feed",
        title: "Launch notes",
        body: "A retrieval workflow without the literal phrase.",
      },
      {
        id: "digest_1",
        type: "digest",
        title: "Daily Digest",
        body: "Today covered AGENT MEMORY and terminal workflows.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["digest_1", "builder_1"]);
  assert.equal(results[0].type, "digest");
  assert.match(results[0].snippet, /AGENT MEMORY/);
});

test("search user path semantic mode finds related language without a literal phrase", () => {
  const results = rankSearchDocuments({
    query: "embedding search",
    mode: "semantic",
    documents: [
      {
        id: "feed_1",
        type: "feed",
        title: "Archive retrieval",
        body: "Vector recall over crawled posts and saved digest history.",
      },
      {
        id: "builder_1",
        type: "builder",
        title: "Unrelated Builder",
        body: "A frontend design feed with launch screenshots.",
      },
      {
        id: "digest_1",
        type: "digest",
        title: "Semantic lookup",
        body: "The digest explains vector search for personal knowledge bases.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["digest_1", "feed_1"]);
  assert.ok(results[0].score > results[1].score);
});

test("search user path normalizes modes and ignores empty queries", () => {
  assert.equal(normalizeSearchMode("exact"), "exact");
  assert.equal(normalizeSearchMode("bad"), "hybrid");
  assert.deepEqual(
    rankSearchDocuments({
      query: "   ",
      mode: "hybrid",
      documents: [
        { id: "builder_1", type: "builder", title: "OpenAI", body: "AI builder" },
      ],
    }),
    [],
  );
});

test("hybrid search blends literal and semantic matching", () => {
  const results = rankSearchDocuments({
    query: "agent memory",
    mode: "hybrid",
    documents: [
      {
        id: "literal",
        type: "feed",
        title: "Agent memory systems",
        body: "A launch note with the exact phrase.",
      },
      {
        id: "related",
        type: "digest",
        title: "Retrieval workflow",
        body: "Assistant recall patterns for saved library history.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["literal", "related"]);
});

test("hybrid search uses expanded database recall terms by default", () => {
  assert.deepEqual(candidateSearchTerms("agent memory", "exact"), ["agent memory"]);

  const semanticTerms = candidateSearchTerms("embedding search", "hybrid");

  assert.ok(semanticTerms.includes("embedding"));
  assert.ok(semanticTerms.includes("search"));
  assert.ok(semanticTerms.includes("vector"));
  assert.ok(semanticTerms.includes("retrieval"));
  assert.equal(new Set(semanticTerms).size, semanticTerms.length);
  assert.ok(semanticTerms.length <= 12);
});

test("search user path offers related search rewrites from semantic terms", () => {
  const suggestions = relatedSearchSuggestions("agent memory");

  assert.ok(suggestions.includes("ai memory"));
  assert.ok(suggestions.includes("assistant memory"));
  assert.ok(suggestions.includes("workflow memory"));
  assert.equal(new Set(suggestions).size, suggestions.length);
  assert.ok(suggestions.length <= 6);
});

test("search user path parses google-style operators", () => {
  const parsed = parseSearchQuery('"agent memory" site:example.com intitle:launch inurl:release type:feed -pricing after:2026-01-01 before:2026-02-01');

  assert.equal(parsed.cleanQuery, "agent memory launch release");
  assert.deepEqual(parsed.phrases, ["agent memory"]);
  assert.deepEqual(parsed.excludedTerms, ["pricing"]);
  assert.deepEqual(parsed.titleTerms, ["launch"]);
  assert.deepEqual(parsed.urlTerms, ["release"]);
  assert.equal(parsed.site, "example.com");
  assert.equal(parsed.type, "feed");
  assert.equal(parsed.after?.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(parsed.before?.toISOString().slice(0, 10), "2026-02-01");
});

test("search user path applies operator filters and newest sorting", () => {
  const oldDate = new Date("2026-01-10T00:00:00.000Z");
  const newDate = new Date("2026-01-20T00:00:00.000Z");
  const results = rankSearchDocuments({
    query: 'agent memory site:example.com -pricing after:2026-01-15 type:feed',
    mode: "hybrid",
    sort: "newest",
    documents: [
      {
        id: "old",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory without excluded language.",
        url: "https://example.com/old",
        date: oldDate,
      },
      {
        id: "excluded",
        type: "feed",
        title: "Agent memory pricing",
        body: "Agent memory pricing details.",
        url: "https://example.com/pricing",
        date: newDate,
      },
      {
        id: "wrong-site",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://other.example/memory",
        date: newDate,
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent memory release",
        body: "Agent memory note.",
        url: "https://example.com/new",
        date: newDate,
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path filters by title operator", () => {
  const results = rankSearchDocuments({
    query: "agent memory intitle:launch",
    mode: "hybrid",
    documents: [
      {
        id: "title-match",
        type: "feed",
        title: "Agent memory launch notes",
        body: "A short release writeup.",
      },
      {
        id: "body-only",
        type: "feed",
        title: "Agent memory notes",
        body: "Launch details in the body should not satisfy intitle.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["title-match"]);
});

test("search user path filters by URL operator", () => {
  const results = rankSearchDocuments({
    query: "agent memory inurl:release",
    mode: "hybrid",
    documents: [
      {
        id: "url-match",
        type: "feed",
        title: "Agent memory launch",
        body: "A short writeup.",
        url: "https://example.com/releases/agent-memory",
      },
      {
        id: "body-only",
        type: "feed",
        title: "Agent memory notes",
        body: "Release details in the body should not satisfy inurl.",
        url: "https://example.com/notes/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["url-match"]);
});

test("search user path suggests simple spelling corrections and normalizes tools", () => {
  assert.equal(didYouMeanSearch("agnet memroy serach"), "agent memory search");
  assert.equal(normalizeSearchSort("newest"), "newest");
  assert.equal(normalizeSearchSort("bad"), "relevance");
  assert.equal(normalizeSearchTime("week"), "week");
  assert.equal(normalizeSearchTime("bad"), "any");
});

test("search user path merges live autocomplete suggestions by recency and relevance", () => {
  const suggestions = mergeSearchSuggestions({
    query: "agent",
    recentSearches: ["agent memory", "digest archive"],
    liveSuggestions: ["Agent Memory", "agent workflows", "builder launch"],
    serverSuggestions: ["agent memory", "assistant memory", "agent"],
    limit: 5,
  });

  assert.deepEqual(suggestions, [
    "agent memory",
    "digest archive",
    "agent workflows",
    "builder launch",
    "assistant memory",
  ]);
});

test("search user path normalizes persisted recent searches", () => {
  assert.deepEqual(
    normalizeRecentSearches([
      " agent memory ",
      "",
      "Agent Memory",
      "digest archive",
      "builder launch",
      "semantic search",
      "podcast transcript",
      "extra query",
      42,
      null,
    ]),
    [
      "agent memory",
      "digest archive",
      "builder launch",
      "semantic search",
      "podcast transcript",
    ],
  );
  assert.deepEqual(normalizeRecentSearches("not an array"), []);
});

test("search user path only auto-searches corrected spellings when the original has no results", () => {
  assert.equal(
    shouldUseCorrectedSearch({
      correctedQuery: "agent memory search",
      originalResultCount: 0,
    }),
    true,
  );
  assert.equal(
    shouldUseCorrectedSearch({
      correctedQuery: "agent memory search",
      originalResultCount: 1,
    }),
    false,
  );
  assert.equal(
    shouldUseCorrectedSearch({
      correctedQuery: null,
      originalResultCount: 0,
    }),
    false,
  );
});

test("web display boundaries keep raw crawled content in the builders tab", () => {
  const dashboardPage = readFileSync("src/app/dashboard/page.tsx", "utf8");
  const buildersPage = readFileSync("src/app/builders/page.tsx", "utf8");

  assert.equal(dashboardPage.includes("prisma.feedItem.findMany"), false);
  assert.equal(dashboardPage.includes("Latest digest inputs"), false);
  assert.equal(buildersPage.includes("prisma.feedItem.findMany"), true);
  assert.equal(buildersPage.includes("Recent crawled content"), true);
});

test("source registry centralizes current source categories and crawl eligibility", () => {
  assert.deepEqual(
    centralCrawlerBuilderKinds().sort(),
    [BuilderKind.BLOG, BuilderKind.PODCAST, BuilderKind.X].sort(),
  );
  assert.equal(feedItemKindLabel(FeedItemKind.PODCAST_EPISODE), "Podcast episode");
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.PODCAST,
      sourceType: "youtube",
      sourceUrl: "https://www.youtube.com/@OpenAI",
      crawlUrl: null,
    })?.centralCrawler,
    false,
  );
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.PODCAST,
      sourceUrl: "https://www.youtube.com/@OpenAI",
      crawlUrl: null,
    })?.id,
    "youtube",
  );
  assert.equal(
    personalCrawlerSourceForBuilder({
      kind: BuilderKind.PODCAST,
      sourceUrl: "https://www.youtube.com/@OpenAI",
      crawlUrl: null,
    })?.id,
    "youtube",
  );
  assert.equal(
    personalCrawlerSourceForBuilder({
      kind: BuilderKind.PODCAST,
      sourceType: "youtube",
      sourceUrl: "https://video.example.com/openai",
      crawlUrl: null,
    })?.id,
    "youtube",
  );
  assert.equal(
    personalCrawlerSourceForBuilder({
      kind: BuilderKind.PODCAST,
      sourceUrl: "https://feeds.example.com/show.xml",
      crawlUrl: null,
    }),
    null,
  );
  assert.equal(
    builderSourceLabel({
      kind: BuilderKind.BLOG,
      sourceUrl: "https://example.com/blog",
      crawlUrl: null,
    }),
    "Blog",
  );
});

test("source registry supports future source types without new BuilderKind enum values", () => {
  assert.equal(
    sourceTypeIdForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: null,
      sourceUrl: "https://example.com/research.pdf",
      crawlUrl: null,
    }),
    "pdf",
  );
  assert.equal(sourceDefinitionForType("pdf")?.label, "PDF");
  assert.equal(builderKindForSourceType("pdf"), BuilderKind.WEBSITE);
  assert.equal(
    sourceTypeIdForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: "CUSTOM_MEDIA",
      sourceUrl: "https://example.com/media",
      crawlUrl: null,
    }),
    "custom_media",
  );
  assert.equal(sourceDefinitionForType("CUSTOM_MEDIA")?.label, "Custom media");
  assert.equal(builderKindForSourceType("CUSTOM_MEDIA"), BuilderKind.WEBSITE);
});
