import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BuilderKind, BuilderScope, DigestFrequency, FeedItemKind } from "@prisma/client";
import { isAdminEmail } from "../src/lib/admin";
import {
  builderLibraryKey,
  canonicalBuilderKey,
  canonicalBuilderValueForInput,
  normalizeHandle,
} from "../src/lib/builder-keys";
import { subscriptionBuilderIdsInPool } from "../src/lib/digest-library";
import { DIGEST_PROMPTS } from "../src/lib/digest-prompts";
import {
  digestFallbackSince,
  digestFrequencyDays,
  digestMaxAgeCutoff,
  digestMaxPostAgeDays,
} from "../src/lib/feed-preferences";
import {
  buildRecommendationSignals,
  scoreRecommendation,
  type RecommendationCandidate,
} from "../src/lib/recommendations";
import {
  parseSkillBuilderSyncPayload,
  parseSkillDigestPayload,
} from "../src/lib/skill-contracts";
import { resolvePersonalBuilderInput } from "../src/lib/personal-builder-input";
import {
  candidateSearchTerms,
  didYouMeanSearch,
  mergeSearchSuggestions,
  normalizeRecentSearches,
  parseSearchQuery,
  relatedSearchSuggestions,
  rankSearchDocuments,
  searchSiteFromUrl,
  searchHighlightTerms,
  shouldUseCorrectedSearch,
  stripNegativeSearchQueryOperators,
  stripSearchQueryOperators,
  withSiteSearchOperator,
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

test("manual builder input derives canonical fields from one handle or URL", () => {
  assert.deepEqual(resolvePersonalBuilderInput({
    displayName: "DeepMind",
    sourceType: "x",
    sourceValue: "https://x.com/GoogleDeepMind",
  }), {
    kind: BuilderKind.X,
    sourceType: "x",
    name: "DeepMind",
    handle: "googledeepmind",
    sourceUrl: "https://x.com/googledeepmind",
    crawlUrl: null,
  });

  assert.deepEqual(resolvePersonalBuilderInput({
    displayName: "",
    sourceType: "youtube",
    sourceValue: "@googledeepmind",
  }), {
    kind: BuilderKind.PODCAST,
    sourceType: "youtube",
    name: "googledeepmind",
    handle: null,
    sourceUrl: "https://www.youtube.com/@googledeepmind",
    crawlUrl: null,
  });

  assert.deepEqual(resolvePersonalBuilderInput({
    displayName: "",
    sourceType: "podcast",
    sourceValue: "feeds.example.com/show.xml",
  }), {
    kind: BuilderKind.PODCAST,
    sourceType: "podcast",
    name: "feeds.example.com",
    handle: null,
    sourceUrl: "https://feeds.example.com/show.xml",
    crawlUrl: null,
  });
});

test("personal YouTube sync cannot create a duplicate builder through handle metadata", () => {
  const sourceUrl = "https://www.youtube.com/@googledeepmind";

  assert.equal(
    canonicalBuilderKey(
      BuilderKind.PODCAST,
      canonicalBuilderValueForInput({
        kind: BuilderKind.PODCAST,
        name: "googledeepmind",
        handle: "googledeepmind",
        sourceUrl,
      }),
    ),
    `PODCAST:${sourceUrl}`,
  );
  assert.equal(
    canonicalBuilderKey(
      BuilderKind.PODCAST,
      canonicalBuilderValueForInput({
        kind: BuilderKind.PODCAST,
        name: "googledeepmind",
        handle: null,
        sourceUrl,
      }),
    ),
    `PODCAST:${sourceUrl}`,
  );
  assert.equal(
    canonicalBuilderValueForInput({
      kind: BuilderKind.X,
      name: "Google DeepMind",
      handle: "@GoogleDeepMind",
      sourceUrl: "https://x.com/googledeepmind",
    }),
    "googledeepmind",
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

test("personal builder removal deletes its crawled feed items instead of preserving crawl state", () => {
  const libraryRoute = readFileSync("src/app/api/builders/[builderId]/library/route.ts", "utf8");

  assert.match(libraryRoute, /BuilderScope\.PERSONAL/);
  assert.match(libraryRoute, /ownerUserId === session\.user\.id/);
  assert.match(libraryRoute, /prisma\.feedItem\.deleteMany/);
  assert.match(libraryRoute, /prisma\.builder\.delete/);
  assert.match(libraryRoute, /deletedFeedItems/);
  assert.match(libraryRoute, /BuilderPoolOrigin\.HUB_IMPORT/);
});

test("skill sync user path accepts personal YouTube builders with synced feed items", () => {
  const parsed = parseSkillBuilderSyncPayload({
    force: true,
    builders: [
      {
        builderId: "builder_youtube_1",
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
            summary:
              "这条 YouTube 更新概述 Workspace agents 的能力和用途。来源：https://www.youtube.com/watch?v=video123",
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
  assert.equal(parsed.data.builders[0].builderId, "builder_youtube_1");
  assert.equal(parsed.data.builders[0].sourceType, "YOUTUBE");
  assert.equal(parsed.data.builders[0].subscribe, true);
  assert.equal(parsed.data.builders[0].items[0].kind, FeedItemKind.PODCAST_EPISODE);
  assert.match(parsed.data.builders[0].items[0].summary ?? "", /Workspace agents/);
  assert.equal(parsed.data.crawlingTool, "Agent skill sync");
  assert.equal(parsed.data.builders[0].items[0].crawlingTool, undefined);
});

test("skill sync route binds agent task items to referenced personal builders", () => {
  const route = readFileSync("src/app/api/skill/builders/route.ts", "utf8");

  assert.match(route, /findExistingPersonalBuilderForSync/);
  assert.match(route, /builderIdFromItems/);
  assert.match(route, /ownerUserId: userId/);
  assert.match(route, /scope: BuilderScope\.PERSONAL/);
  assert.match(route, /Referenced personal builder was not found/);
});

test("web app serves the agent skill and setup command", () => {
  const settingsPanel = readFileSync("src/components/AgentTokenPanel.tsx", "utf8");
  const skillPromptActions = readFileSync("src/components/SkillPromptActions.tsx", "utf8");
  const buildersPage = readFileSync("src/app/(workspace)/builders/page.tsx", "utf8");
  const dashboardPage = readFileSync("src/app/(workspace)/dashboard/page.tsx", "utf8");
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");
  const runner = readFileSync("scripts/builder-agent-runner.sh", "utf8");
  const skillFileRoute = readFileSync("src/app/api/skill/files/[file]/route.ts", "utf8");
  const skillJobRoute = readFileSync("src/app/api/skill/jobs/[job]/skill.md/route.ts", "utf8");
  const skillJobAliasRoute = readFileSync("src/app/api/skill/jobs/[job]/route.ts", "utf8");
  const skillJobFiles = readFileSync("src/lib/skill-job-files.ts", "utf8");
  const bootstrapRoute = readFileSync("src/app/api/skill/bootstrap/route.ts", "utf8");
  const skill = readFileSync("skills/builder-blog-digest/SKILL.md", "utf8");
  const libraryOncePrompt = readFileSync("skills/builder-blog-digest/jobs/library-once.md", "utf8");
  const digestOncePrompt = readFileSync("skills/builder-blog-digest/jobs/digest-once.md", "utf8");
  const libraryCronSetupPrompt = readFileSync("skills/builder-blog-digest/jobs/library-cron-setup.md", "utf8");
  const digestCronSetupPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron-setup.md", "utf8");
  const libraryCronPrompt = readFileSync("skills/builder-blog-digest/jobs/library-cron.md", "utf8");
  const digestCronPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron.md", "utf8");

  assert.doesNotMatch(settingsPanel, /Copy setup command/);
  assert.doesNotMatch(settingsPanel, /\/api\/skill\/bootstrap/);
  assert.match(buildersPage, /<SkillPromptActions context="library"/);
  assert.match(dashboardPage, /<SkillPromptActions context="digest"/);
  assert.match(skillPromptActions, /Build library/);
  assert.match(skillPromptActions, /Build digest feed/);
  assert.match(skillPromptActions, /Copy once prompt/);
  assert.match(skillPromptActions, /Copy cron prompt/);
  assert.match(skillPromptActions, /Read \$\{promptUrl\} and follow the instructions/);
  assert.match(skillPromptActions, /\/api\/skill\/jobs\/\$\{job\}\/skill\.md/);
  assert.doesNotMatch(skillPromptActions, /\/api\/skill\/bootstrap/);
  assert.doesNotMatch(skillPromptActions, /BUILDER_BLOG_PROMPT_URL/);
  assert.doesNotMatch(skillPromptActions, /builder-agent-runner\.sh \$\{job\}/);
  assert.doesNotMatch(skillPromptActions, /Run the commands exactly in order/);
  assert.match(libraryOncePrompt, /crawl-personal --days 30 --limit 3/);
  assert.match(libraryOncePrompt, /validate-agent-sync/);
  assert.match(libraryOncePrompt, /rawJson\.agentExecutionProof/);
  assert.match(libraryOncePrompt, /Complete exactly the task IDs\s+returned by the CLI/);
  assert.match(libraryOncePrompt, /crawlTasks/);
  assert.match(libraryOncePrompt, /single-post summary/);
  assert.match(libraryOncePrompt, /summaryInstructions\.prompt/);
  assert.match(libraryOncePrompt, /do not read prompt files/);
  assert.match(libraryOncePrompt, /do not fetch `context\.prompts`/);
  assert.match(libraryOncePrompt, /Crawl task boundary/);
  assert.match(libraryOncePrompt, /both `body` and `summary`/);
  assert.match(libraryOncePrompt, /task\.builderSync/);
  assert.doesNotMatch(libraryOncePrompt, /agentTasks/);
  assert.doesNotMatch(libraryOncePrompt, /summaryTasks/);
  assert.doesNotMatch(libraryOncePrompt, /summarize-tweets\.md/);
  assert.doesNotMatch(libraryOncePrompt, /summarize-podcast\.md/);
  assert.doesNotMatch(libraryOncePrompt, /summarize-blogs\.md/);
  assert.match(libraryOncePrompt, /Do not add new sources, URLs, or feed items/);
  assert.match(libraryOncePrompt, /Do not use `--force`/);
  assert.match(libraryOncePrompt, /execution\s+contract, not as user-facing documentation/);
  assert.match(libraryOncePrompt, /Environment contract/);
  assert.match(libraryOncePrompt, /Node\.js 20 or newer/);
  assert.match(libraryOncePrompt, /first try to make it available/);
  assert.match(libraryOncePrompt, /Report the tried repair methods and the concrete\s+blocker/);
  assert.match(libraryOncePrompt, /bootstrap needs explicit user approval/);
  assert.match(libraryOncePrompt, /Do\s+not invent alternate install URLs such as `\/install\.sh`/);
  assert.match(digestOncePrompt, /prepare --days 1/);
  assert.match(digestOncePrompt, /Use agent judgment only for the digest-writing step/);
  assert.match(digestOncePrompt, /execution\s+contract, not as user-facing documentation/);
  assert.match(digestOncePrompt, /Environment contract/);
  assert.match(digestOncePrompt, /Do not assume a local repo checkout, local database, or source API key/);
  assert.match(digestOncePrompt, /first try to make it available/);
  assert.match(digestOncePrompt, /Report the tried repair methods and the concrete\s+blocker/);
  assert.match(digestOncePrompt, /bootstrap needs explicit user approval/);
  assert.match(digestOncePrompt, /Do\s+not invent alternate install URLs such as `\/install\.sh`/);
  assert.match(digestOncePrompt, /summarize-tweets\.md/);
  assert.match(digestOncePrompt, /summarize-podcast\.md/);
  assert.match(digestOncePrompt, /summarize-blogs\.md/);
  assert.match(digestOncePrompt, /digest-intro\.md/);
  assert.match(digestOncePrompt, /translate\.md/);
  assert.match(libraryCronSetupPrompt, /builder-agent-runner\.sh library-cron/);
  assert.match(libraryCronSetupPrompt, /BUILDER_BLOG_AGENT_COMMAND/);
  assert.match(libraryCronSetupPrompt, /First attempt the exact crontab install/);
  assert.match(libraryCronSetupPrompt, /crontab/);
  assert.match(libraryCronSetupPrompt, /Do not use `--force`/);
  assert.match(libraryCronSetupPrompt, /crawlTasks/);
  assert.match(libraryCronSetupPrompt, /single-post summary/);
  assert.match(libraryCronSetupPrompt, /task\.summaryInstructions\.prompt/);
  assert.match(digestCronSetupPrompt, /builder-agent-runner\.sh digest-cron/);
  assert.match(digestCronSetupPrompt, /First attempt the exact crontab install/);
  assert.match(digestCronSetupPrompt, /crontab/);
  assert.doesNotMatch(skillPromptActions, /crawl-personal[^\n`]*--force/);
  assert.match(cli, /realpathSync\(fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(cli, /existsSync\(process\.argv\[1\]\)/);
  assert.match(cli, /validate-agent-sync/);
  assert.match(cli, /No normal crawled items were synced yet/);
  assert.match(cli, /pendingReadyCrawlTasks/);
  assert.match(runner, /BUILDER_BLOG_AGENT_COMMAND/);
  assert.match(runner, /BUILDER_BLOG_PROMPT_URL/);
  assert.match(runner, /library-once\|digest-once\|library-cron-setup\|digest-cron-setup\|library-cron\|digest-cron/);
  assert.match(runner, /codex exec --skip-git-repo-check/);
  assert.match(runner, /claude -p/);
  assert.match(runner, /openclaw agent --local --message/);
  assert.match(runner, /gemini -p/);
  assert.match(runner, /No local agent runtime found/);
  assert.match(runner, /crawlTasks/);
  assert.match(runner, /process\.exit\(78\)/);
  assert.match(runner, /refresh_skill_files/);
  assert.match(runner, /api\/skill\/files\/builder-digest\.mjs/);
  assert.match(skillFileRoute, /builder-blog-digest\.md/);
  assert.match(skillFileRoute, /builder-blog-library-once\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-once\.md/);
  assert.match(skillFileRoute, /builder-blog-library-cron-setup\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-cron-setup\.md/);
  assert.match(skillFileRoute, /builder-blog-library-cron\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-cron\.md/);
  assert.match(skillFileRoute, /builder-agent-runner\.sh/);
  assert.match(skillFileRoute, /builder-digest\.mjs/);
  assert.match(skillJobFiles, /library-once/);
  assert.match(skillJobFiles, /digest-once/);
  assert.match(skillJobRoute, /jobSkillFiles/);
  assert.match(skillJobRoute, /text\/markdown/);
  assert.match(skillJobAliasRoute, /jobSkillFiles/);
  assert.match(skillJobAliasRoute, /rel="canonical"/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-blog-digest\.md/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-digest\.mjs/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-agent-runner\.sh/);
  assert.match(bootstrapRoute, /command -v node/);
  assert.match(bootstrapRoute, /FollowBrief requires Node\.js 20 or newer/);
  assert.match(bootstrapRoute, /command -v curl/);
  assert.match(bootstrapRoute, /jobs\/library-once\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-once\.md/);
  assert.match(bootstrapRoute, /jobs\/library-cron-setup\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-cron-setup\.md/);
  assert.match(bootstrapRoute, /jobs\/library-cron\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-cron\.md/);
  assert.match(bootstrapRoute, /login already configured/);
  assert.match(bootstrapRoute, /config\.json/);
  assert.match(skill, /Install From Web App/);
  assert.match(skill, /Scheduled Jobs/);
  assert.match(skill, /builder-agent-runner\.sh digest-cron/);
  assert.match(skill, /OpenClaw CLI/);
  assert.match(skill, /validate-agent-sync/);
  assert.match(skill, /failed extraction attempts are not command-contract\s+failures/);
  assert.match(skill, /~\/\.builder-blog\/builder-digest\.mjs/);
  assert.match(libraryCronPrompt, /crawl-personal --days 30 --limit 3/);
  assert.match(libraryCronPrompt, /validate-agent-sync/);
  assert.match(libraryCronPrompt, /rawJson\.crawlTaskId/);
  assert.match(libraryCronPrompt, /crawlTasks/);
  assert.match(libraryCronPrompt, /single-post summary/);
  assert.match(libraryCronPrompt, /summaryInstructions\.prompt/);
  assert.match(libraryCronPrompt, /Crawl task boundary/);
  assert.match(libraryCronPrompt, /both `body` and `summary`/);
  assert.match(libraryCronPrompt, /task\.builderSync/);
  assert.doesNotMatch(libraryCronPrompt, /agentTasks/);
  assert.doesNotMatch(libraryCronPrompt, /summaryTasks/);
  assert.doesNotMatch(libraryCronPrompt, /summarize-tweets\.md/);
  assert.doesNotMatch(libraryCronPrompt, /summarize-podcast\.md/);
  assert.doesNotMatch(libraryCronPrompt, /summarize-blogs\.md/);
  assert.match(libraryCronPrompt, /Run these steps exactly/);
  assert.match(libraryCronPrompt, /Only use agent judgment/);
  assert.match(libraryCronPrompt, /Agent discretion boundary/);
  assert.match(libraryCronPrompt, /Complete exactly the task IDs returned by the CLI/);
  assert.match(libraryCronPrompt, /Do not add new sources, URLs, or feed items/);
  assert.match(libraryCronPrompt, /do not stop just\s+because one extraction method fails/);
  assert.match(digestCronPrompt, /prepare --days 1/);
  assert.match(digestCronPrompt, /builder-blog-digest\.md/);
  assert.match(digestCronPrompt, /Only use agent judgment to write the digest body/);
  assert.match(digestCronPrompt, /Agent discretion boundary/);
  assert.match(digestCronPrompt, /The only creative step is writing/);
  assert.match(digestCronPrompt, /summarize-tweets\.md/);
  assert.match(digestCronPrompt, /summarize-podcast\.md/);
  assert.match(digestCronPrompt, /summarize-blogs\.md/);
  assert.match(digestCronPrompt, /digest-intro\.md/);
  assert.match(digestCronPrompt, /translate\.md/);
  assert.equal(skill.includes("/Users/jie/code/builder_blog"), false);
  assert.equal(skill.includes("node scripts/builder-digest.mjs"), false);
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

test("digest feed user path derives context window from user frequency and max post age", () => {
  const now = new Date("2026-05-23T12:00:00.000Z");
  const preference = {
    digestFrequency: DigestFrequency.CUSTOM,
    digestCustomFrequencyDays: 3,
    digestMaxPostAgeDays: 45,
  };

  assert.equal(digestFrequencyDays(preference), 3);
  assert.equal(digestMaxPostAgeDays(preference), 45);
  assert.equal(digestFallbackSince(now, preference).toISOString(), "2026-05-20T12:00:00.000Z");
  assert.equal(digestMaxAgeCutoff(now, preference).toISOString(), "2026-04-08T12:00:00.000Z");

  const contextRoute = readFileSync("src/app/api/skill/context/route.ts", "utf8");
  assert.match(contextRoute, /createdAt:\s*\{\s*gt: since/);
  assert.match(contextRoute, /publishedAt:\s*\{\s*gte: maxAgeCutoff/);
  assert.match(contextRoute, /newly crawled items created after the last digest/);
  assert.match(contextRoute, /includePrompts/);
  assert.match(contextRoute, /\.\.\.\(includePrompts \? \{ prompts: DIGEST_PROMPTS \} : \{\}\)/);
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");
  assert.match(cli, /api\/skill\/context\?includePrompts=1/);
  assert.match(cli, /api\/skill\/context\?days=/);
  assert.doesNotMatch(cli, /postSummaryTasksForBuilders\(builders,\s*context\.prompts\)/);
  assert.doesNotMatch(cli, /withSummaryInstructions\(task,\s*context\.prompts\)/);
});

test("recommendation feed user path scores unread crawled posts from profile, subscriptions, and read log", () => {
  const now = new Date("2026-05-23T12:00:00.000Z");
  const subscribedBuilder = {
    id: "builder_memory",
    name: "Memory Labs",
    handle: null,
    kind: BuilderKind.BLOG,
    sourceType: "blog",
    sourceUrl: "https://example.com",
    crawlUrl: "https://example.com/blog",
    bio: "Agent memory and retrieval systems.",
  };
  const signals = buildRecommendationSignals({
    profileText: "I care about agent memory, retrieval, and product launches.",
    subscriptions: [subscribedBuilder],
    reads: [
      recommendationCandidate({
        id: "read_1",
        builder: subscribedBuilder,
        body: "Vector retrieval for durable agent memory.",
        publishedAt: "2026-05-21T12:00:00.000Z",
      }),
    ],
  });
  const relevant = scoreRecommendation({
    item: recommendationCandidate({
      id: "candidate_1",
      builder: subscribedBuilder,
      title: "Agent memory launch notes",
      body: "A retrieval architecture for long-running agents.",
      publishedAt: "2026-05-22T12:00:00.000Z",
    }),
    signals,
    now,
  });
  const unrelated = scoreRecommendation({
    item: recommendationCandidate({
      id: "candidate_2",
      builder: null,
      title: "Pricing update",
      body: "A billing change for a design tool.",
      publishedAt: "2026-04-01T12:00:00.000Z",
    }),
    signals,
    now,
  });

  assert.ok(relevant.score > unrelated.score);
  assert.ok(relevant.reasons.includes("from a subscribed builder"));
  assert.ok(relevant.reasons.includes("matches your profile and reading topics"));
});

test("digest generation user path exposes source-specific prompt instructions", () => {
  assert.deepEqual(
    Object.keys(DIGEST_PROMPTS).sort(),
    ["digest", "digestIntro", "summarizeBlogs", "summarizePodcast", "summarizeTweets", "translate"].sort(),
  );
  assert.match(DIGEST_PROMPTS.summarizePodcast, /podcast transcript/i);
  assert.match(DIGEST_PROMPTS.summarizeTweets, /X\/Twitter Summary Prompt/);
  assert.match(DIGEST_PROMPTS.summarizeBlogs, /Blog Post Summary Prompt/);
  assert.match(DIGEST_PROMPTS.digestIntro, /Digest Intro Prompt/);
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

test("search user path supports wildcard terms inside quoted phrases", () => {
  const parsed = parseSearchQuery('"agent * memory"');

  assert.equal(parsed.cleanQuery, "agent * memory");
  assert.deepEqual(parsed.phrases, ["agent * memory"]);

  const results = rankSearchDocuments({
    query: '"agent * memory"',
    mode: "exact",
    documents: [
      {
        id: "one-gap",
        type: "feed",
        title: "Launch notes",
        body: "The team shipped agent workflow memory.",
      },
      {
        id: "no-gap",
        type: "feed",
        title: "Agent memory",
        body: "The exact phrase has no wildcard term.",
      },
      {
        id: "two-gap",
        type: "feed",
        title: "Launch notes",
        body: "The team shipped agent workflow durable memory.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["one-gap"]);
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

test("hybrid search reserves top four slots for exact and semantic leaders", () => {
  const results = rankSearchDocuments({
    query: "agent memory",
    mode: "hybrid",
    documents: [
      {
        id: "exact-1",
        type: "feed",
        title: "Agent memory",
        body: "A literal title match.",
      },
      {
        id: "exact-2",
        type: "feed",
        title: "Agent memory roadmap",
        body: "Another literal title match.",
      },
      {
        id: "semantic-1",
        type: "feed",
        title: "AI assistant workflow",
        body: "Recall systems for agents.",
      },
      {
        id: "semantic-2",
        type: "feed",
        title: "Assistant workflow",
        body: "AI agent recall and saved library context.",
      },
      {
        id: "hybrid-strong",
        type: "feed",
        title: "Agent workflow",
        body: "Agent memory assistant recall workflow.",
      },
      {
        id: "body-literal",
        type: "feed",
        title: "Launch note",
        body: "Agent memory appears in the body.",
      },
    ],
  });

  const topFour = results.slice(0, 4).map((result) => result.id);

  assert.equal(topFour.includes("exact-1"), true);
  assert.equal(topFour.includes("exact-2"), true);
  assert.equal(topFour.includes("hybrid-strong"), true);
  assert.equal(topFour.includes("semantic-1"), true);
  assert.equal(topFour.includes("body-literal"), false);
  assert.deepEqual(
    results.slice(0, 4).map((result) => result.score),
    results
      .slice(0, 4)
      .map((result) => result.score)
      .toSorted((a, b) => b - a),
  );
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
  const parsed = parseSearchQuery('"agent memory" site:example.com intitle:launch inurl:release agent OR embedding type:feed -pricing after:2026-01-01 before:2026-02-01');

  assert.equal(parsed.cleanQuery, "agent memory launch release agent embedding");
  assert.deepEqual(parsed.phrases, ["agent memory"]);
  assert.deepEqual(parsed.excludedTerms, ["pricing"]);
  assert.deepEqual(parsed.orTerms, ["agent", "embedding"]);
  assert.deepEqual(parsed.titleTerms, ["launch"]);
  assert.deepEqual(parsed.urlTerms, ["release"]);
  assert.equal(parsed.site, "example.com");
  assert.equal(parsed.type, "feed");
  assert.equal(parsed.after?.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(parsed.before?.toISOString().slice(0, 10), "2026-02-01");
});

test("search result highlighting ignores operators and excluded terms", () => {
  const terms = searchHighlightTerms(
    'agent -intitle:pricing site:example.com allintext:memory launch -"sponsored segment"',
  );

  assert.deepEqual(terms, ["memory", "launch", "agent"]);
});

test("search result refinement builds source-limited queries", () => {
  assert.equal(
    searchSiteFromUrl("https://www.example.com/articles/agent-memory?ref=builder"),
    "example.com",
  );
  assert.equal(searchSiteFromUrl("/history#digest_1"), null);
  assert.equal(
    withSiteSearchOperator("agent memory site:old.example.com -site:spam.example.com", "example.com"),
    "agent memory -site:spam.example.com site:example.com",
  );
});

test("search tool clearing removes whole all-in operator groups", () => {
  assert.equal(
    stripSearchQueryOperators("allintitle:agent memory site:example.com", [
      "title",
      "intitle",
      "allintitle",
    ]),
    "site:example.com",
  );
  assert.equal(
    stripSearchQueryOperators("agent allintext:retrieval quality after:2026-01-01", [
      "text",
      "intext",
      "allintext",
    ]),
    "agent after:2026-01-01",
  );
  assert.equal(
    stripNegativeSearchQueryOperators("agent -allintitle:pricing launch site:example.com", [
      "title",
      "intitle",
      "allintitle",
    ]),
    "agent site:example.com",
  );
});

test("search user path parses filetype as a google-style type operator", () => {
  const parsed = parseSearchQuery("agent memory filetype:digests");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.equal(parsed.type, "digest");
  assert.equal(parsed.typeOperator, "filetype");
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

test("search user path excludes sites with negative site operator", () => {
  const parsed = parseSearchQuery("agent memory -site:example.com");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.excludedSites, ["example.com"]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: "agent memory -site:example.com",
    mode: "hybrid",
    documents: [
      {
        id: "excluded-root",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/posts/agent-memory",
      },
      {
        id: "excluded-subdomain",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://blog.example.com/posts/agent-memory",
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://other.example/posts/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path supports site operators with URL paths", () => {
  const parsed = parseSearchQuery("agent memory site:example.com/articles");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.equal(parsed.site, "example.com/articles");

  const results = rankSearchDocuments({
    query: "agent memory site:example.com/articles",
    mode: "hybrid",
    documents: [
      {
        id: "article",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/articles/agent-memory",
      },
      {
        id: "root",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/agent-memory",
      },
      {
        id: "other-path",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/posts/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["article"]);
});

test("search user path excludes site operator paths without excluding the whole host", () => {
  const parsed = parseSearchQuery("agent memory -site:example.com/articles");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.excludedSites, ["example.com/articles"]);

  const results = rankSearchDocuments({
    query: "agent memory -site:example.com/articles",
    mode: "hybrid",
    documents: [
      {
        id: "excluded-path",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/articles/agent-memory",
      },
      {
        id: "kept-host",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/posts/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept-host"]);
});

test("search user path supports operator-only result sets", () => {
  const results = rankSearchDocuments({
    query: "site:example.com",
    mode: "hybrid",
    documents: [
      {
        id: "source",
        type: "feed",
        title: "Agent memory launch",
        body: "A launch note from the source site.",
        url: "https://example.com/agent-memory",
      },
      {
        id: "other",
        type: "feed",
        title: "Agent memory launch",
        body: "A launch note from a different site.",
        url: "https://other.test/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["source"]);
});

test("search user path excludes quoted phrases with negative phrase operator", () => {
  const parsed = parseSearchQuery('agent -"memory leak"');

  assert.equal(parsed.cleanQuery, "agent");
  assert.deepEqual(parsed.phrases, []);
  assert.deepEqual(parsed.excludedPhrases, ["memory leak"]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: 'agent -"memory leak"',
    mode: "exact",
    documents: [
      {
        id: "excluded",
        type: "feed",
        title: "Agent incident",
        body: "The memory leak affected the launch agent.",
        url: "https://example.com/incidents/memory-leak",
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent memory guide",
        body: "Memory tuning avoids leak reports in the release notes.",
        url: "https://example.com/guides/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path filters by filetype operator", () => {
  const results = rankSearchDocuments({
    query: "agent memory filetype:digest",
    mode: "hybrid",
    documents: [
      {
        id: "digest-match",
        type: "digest",
        title: "Agent memory",
        body: "Agent memory digest.",
      },
      {
        id: "feed-match",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory feed item.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["digest-match"]);
});

test("search user path excludes filetypes with negative type operators", () => {
  const parsed = parseSearchQuery("agent memory -filetype:digest -type:builder");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.excludedTypes, ["digest", "builder"]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: "agent memory -filetype:digest -type:builder",
    mode: "hybrid",
    documents: [
      {
        id: "digest-match",
        type: "digest",
        title: "Agent memory",
        body: "Agent memory digest.",
      },
      {
        id: "builder-match",
        type: "builder",
        title: "Agent memory",
        body: "Agent memory builder.",
      },
      {
        id: "feed-match",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory feed item.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["feed-match"]);
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

test("search user path excludes scoped title text and URL operators", () => {
  const parsed = parseSearchQuery("agent -intitle:pricing -intext:sponsored -inurl:archive");

  assert.equal(parsed.cleanQuery, "agent");
  assert.deepEqual(parsed.excludedTitleTerms, ["pricing"]);
  assert.deepEqual(parsed.excludedBodyTerms, ["sponsored"]);
  assert.deepEqual(parsed.excludedUrlTerms, ["archive"]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: "agent -intitle:pricing -intext:sponsored -inurl:archive",
    mode: "hybrid",
    documents: [
      {
        id: "title-excluded",
        type: "feed",
        title: "Agent pricing notes",
        body: "A launch writeup.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "body-excluded",
        type: "feed",
        title: "Agent launch notes",
        body: "Sponsored coverage of the agent launch.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "url-excluded",
        type: "feed",
        title: "Agent launch notes",
        body: "A launch writeup.",
        url: "https://example.com/archive/agent",
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent launch notes",
        body: "A launch writeup.",
        url: "https://example.com/releases/agent",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path supports allintitle operator", () => {
  const parsed = parseSearchQuery("allintitle:agent memory site:example.com");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.titleTerms, ["agent", "memory"]);
  assert.equal(parsed.site, "example.com");

  const results = rankSearchDocuments({
    query: "allintitle:agent memory",
    mode: "exact",
    documents: [
      {
        id: "title-match",
        type: "feed",
        title: "Agent memory launch",
        body: "A short note.",
      },
      {
        id: "split-match",
        type: "feed",
        title: "Agent launch",
        body: "Memory appears only in the body.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["title-match"]);
});

test("search user path excludes all-in scoped title text and URL operators", () => {
  const parsed = parseSearchQuery(
    "agent -allintitle:pricing launch -allintext:sponsored transcript -allinurl:archive agent",
  );

  assert.equal(parsed.cleanQuery, "agent");
  assert.deepEqual(parsed.excludedTitleTerms, []);
  assert.deepEqual(parsed.excludedBodyTerms, []);
  assert.deepEqual(parsed.excludedUrlTerms, []);
  assert.deepEqual(parsed.excludedAllTitleTermGroups, [["pricing", "launch"]]);
  assert.deepEqual(parsed.excludedAllBodyTermGroups, [["sponsored", "transcript"]]);
  assert.deepEqual(parsed.excludedAllUrlTermGroups, [["archive", "agent"]]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: "agent -allintitle:pricing launch -allintext:sponsored transcript -allinurl:archive agent",
    mode: "hybrid",
    documents: [
      {
        id: "title-excluded",
        type: "feed",
        title: "Agent launch pricing",
        body: "A release note.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "body-excluded",
        type: "feed",
        title: "Agent launch",
        body: "Sponsored transcript from the demo.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "url-excluded",
        type: "feed",
        title: "Agent launch",
        body: "A release note.",
        url: "https://example.com/archive/agent",
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent launch",
        body: "A release note.",
        url: "https://example.com/releases/workflow",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path filters by text operator", () => {
  const results = rankSearchDocuments({
    query: "agent memory intext:transcript",
    mode: "hybrid",
    documents: [
      {
        id: "body-match",
        type: "feed",
        title: "Agent memory notes",
        body: "Transcript details from the builder session.",
      },
      {
        id: "title-only",
        type: "feed",
        title: "Agent memory transcript",
        body: "A short note.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["body-match"]);
});

test("search user path supports allintext operator", () => {
  const parsed = parseSearchQuery("allintext:agent memory site:example.com");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.bodyTerms, ["agent", "memory"]);
  assert.equal(parsed.site, "example.com");

  const results = rankSearchDocuments({
    query: "allintext:agent memory",
    mode: "exact",
    documents: [
      {
        id: "body-match",
        type: "feed",
        title: "Session notes",
        body: "Agent memory launch details.",
      },
      {
        id: "title-match",
        type: "feed",
        title: "Agent memory launch",
        body: "A short note.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["body-match"]);
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

test("search user path supports allinurl operator", () => {
  const parsed = parseSearchQuery("allinurl:release agent type:feed");

  assert.equal(parsed.cleanQuery, "release agent");
  assert.deepEqual(parsed.urlTerms, ["release", "agent"]);
  assert.equal(parsed.type, "feed");

  const results = rankSearchDocuments({
    query: "allinurl:release agent",
    mode: "hybrid",
    documents: [
      {
        id: "url-match",
        type: "feed",
        title: "Release agent",
        body: "A short writeup.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "split-match",
        type: "feed",
        title: "Release agent",
        body: "A short writeup.",
        url: "https://example.com/releases/workflow",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["url-match"]);
});

test("search user path supports explicit OR alternatives in exact mode", () => {
  assert.deepEqual(candidateSearchTerms("agent OR embedding", "exact"), ["agent", "embedding"]);

  const results = rankSearchDocuments({
    query: "agent OR embedding",
    mode: "exact",
    documents: [
      {
        id: "agent",
        type: "feed",
        title: "Agent launch",
        body: "A short note.",
      },
      {
        id: "embedding",
        type: "feed",
        title: "Vector release",
        body: "Embedding search details.",
      },
      {
        id: "miss",
        type: "feed",
        title: "Digest archive",
        body: "A short note.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["agent", "embedding"]);
});

test("search user path supports quoted phrase OR alternatives", () => {
  const parsed = parseSearchQuery('"agent memory" OR "retrieval quality"');

  assert.equal(parsed.cleanQuery, "agent memory retrieval quality");
  assert.deepEqual(parsed.phrases, []);
  assert.deepEqual(parsed.orPhrases, ["agent memory", "retrieval quality"]);
  assert.deepEqual(parsed.orTerms, []);
  assert.deepEqual(candidateSearchTerms('"agent memory" OR "retrieval quality"', "exact"), [
    "agent memory",
    "retrieval quality",
  ]);

  const results = rankSearchDocuments({
    query: '"agent memory" OR "retrieval quality"',
    mode: "exact",
    documents: [
      {
        id: "agent-memory",
        type: "feed",
        title: "Launch note",
        body: "The article explains agent memory for long-running work.",
      },
      {
        id: "retrieval-quality",
        type: "feed",
        title: "Evaluation note",
        body: "The article explains retrieval quality for search systems.",
      },
      {
        id: "split-token",
        type: "feed",
        title: "Partial note",
        body: "The article says memory and retrieval but never either requested phrase.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), [
    "retrieval-quality",
    "agent-memory",
  ]);
  assert.match(results[0].snippet, /retrieval quality/i);
});

test("search user path supports parenthesized quoted OR groups", () => {
  const parsed = parseSearchQuery('("agent memory" OR "retrieval quality") launch');

  assert.equal(parsed.cleanQuery, "agent memory retrieval quality launch");
  assert.deepEqual(parsed.phrases, []);
  assert.deepEqual(parsed.orPhrases, ["agent memory", "retrieval quality"]);
  assert.deepEqual(parsed.requiredTerms, [
    "agent",
    "memory",
    "retrieval",
    "quality",
    "launch",
  ]);
  assert.deepEqual(
    candidateSearchTerms('("agent memory" OR "retrieval quality") launch', "exact"),
    ["agent memory", "retrieval quality"],
  );

  const results = rankSearchDocuments({
    query: '("agent memory" OR "retrieval quality") launch',
    mode: "exact",
    documents: [
      {
        id: "agent-launch",
        type: "feed",
        title: "Launch note",
        body: "The launch article explains agent memory for long-running work.",
      },
      {
        id: "retrieval-launch",
        type: "feed",
        title: "Launch note",
        body: "The launch article explains retrieval quality for search systems.",
      },
      {
        id: "no-launch",
        type: "feed",
        title: "Old note",
        body: "The article explains agent memory but does not mention the required topic.",
      },
      {
        id: "split-launch",
        type: "feed",
        title: "Launch note",
        body: "The launch article says memory and retrieval but neither requested phrase.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), [
    "agent-launch",
    "retrieval-launch",
  ]);
});

test("search user path supports AROUND proximity operator in exact mode", () => {
  const parsed = parseSearchQuery("agent AROUND(2) memory");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.proximityPairs, [{ left: "agent", right: "memory", distance: 2 }]);

  const results = rankSearchDocuments({
    query: "agent AROUND(2) memory",
    mode: "exact",
    documents: [
      {
        id: "close",
        type: "feed",
        title: "Agent workflow memory",
        body: "A short note.",
      },
      {
        id: "far",
        type: "feed",
        title: "Agent teams capture logs traces and memory",
        body: "A short note.",
      },
      {
        id: "missing",
        type: "feed",
        title: "Agent workflow",
        body: "A short note.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["close"]);
});

test("search user path suggests simple spelling corrections and normalizes tools", () => {
  assert.equal(didYouMeanSearch("agnet memroy serach"), "agent memory search");
  assert.equal(normalizeSearchSort("newest"), "newest");
  assert.equal(normalizeSearchSort("bad"), "relevance");
  assert.equal(normalizeSearchTime("week"), "week");
  assert.equal(normalizeSearchTime("bad"), "any");
});

test("search user path merges autocomplete predictions before matching history", () => {
  const suggestions = mergeSearchSuggestions({
    query: "agent",
    recentSearches: ["agent memory", "digest archive"],
    liveSuggestions: ["Agent Memory", "agent workflows", "builder launch"],
    serverSuggestions: ["agent memory", "assistant memory", "agent"],
    limit: 5,
  });

  assert.deepEqual(suggestions, [
    "Agent Memory",
    "agent workflows",
    "builder launch",
    "assistant memory",
  ]);
});

test("search suggestions prioritize current query predictions over unrelated history", () => {
  const suggestions = mergeSearchSuggestions({
    query: "claude",
    recentSearches: ["Transformer", "Ter", "Sam", "Andrew", '"agent memory"'],
    liveSuggestions: ["claude code", "claude ai", "anthropic releases"],
    serverSuggestions: ["claude docs"],
    limit: 5,
  });

  assert.deepEqual(suggestions, [
    "claude code",
    "claude ai",
    "anthropic releases",
    "claude docs",
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
  const dashboardPage = readFileSync("src/app/(workspace)/dashboard/page.tsx", "utf8");
  const buildersPage = readFileSync("src/app/(workspace)/builders/page.tsx", "utf8");
  const builderLibraryList = readFileSync("src/components/BuilderLibraryList.tsx", "utf8");
  const builderFeedItems = readFileSync("src/components/BuilderFeedItems.tsx", "utf8");

  assert.equal(dashboardPage.includes("prisma.feedItem.findMany"), false);
  assert.equal(dashboardPage.includes("Latest digest inputs"), false);
  assert.equal(buildersPage.includes("prisma.feedItem.findMany"), false);
  assert.equal(buildersPage.includes("Recent crawled content"), false);
  assert.equal(buildersPage.includes("BuilderLibraryList"), true);
  assert.equal(builderLibraryList.includes("BuilderFeedItems"), true);
  assert.equal(buildersPage.includes("Technical details"), false);
  assert.equal(builderLibraryList.includes("Open source"), true);
  assert.equal(builderFeedItems.includes("Crawled posts"), true);
  assert.equal(builderFeedItems.includes("CrawledPostCard"), true);
  assert.equal(readFileSync("src/components/CrawledPostCard.tsx", "utf8").includes("Raw crawled content"), true);
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
    })?.id,
    "podcast",
  );
  assert.equal(
    personalCrawlerSourceForBuilder({
      kind: BuilderKind.X,
      sourceUrl: "https://x.com/example",
      crawlUrl: null,
    })?.id,
    "x",
  );
  assert.equal(
    personalCrawlerSourceForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: "website",
      sourceUrl: "https://example.com",
      crawlUrl: null,
    })?.id,
    "website",
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

function recommendationCandidate({
  id,
  title = "Post",
  body,
  builder,
  publishedAt,
}: {
  id: string;
  title?: string;
  body: string;
  builder: RecommendationCandidate["builder"];
  publishedAt: string;
}): RecommendationCandidate {
  return {
    id,
    kind: FeedItemKind.BLOG_POST,
    title,
    body,
    url: `https://example.com/${id}`,
    publishedAt: new Date(publishedAt),
    createdAt: new Date("2026-05-23T10:00:00.000Z"),
    sourceName: builder?.name ?? "External",
    crawlingTool: "test",
    builder,
  };
}
