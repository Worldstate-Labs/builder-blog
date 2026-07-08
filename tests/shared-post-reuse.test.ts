import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { canonicalPostUrl, postUrlLookupVariants } from "../src/lib/canonical-url";
import { summaryLanguagesMatch } from "../src/lib/language-preference";

test("canonicalPostUrl normalizes tracking params, hash, host case, and trailing slash", () => {
  assert.equal(
    canonicalPostUrl("https://Example.com/posts/launch/?utm_source=x&b=2&a=1#section"),
    "https://example.com/posts/launch?a=1&b=2",
  );
  assert.deepEqual(
    new Set(postUrlLookupVariants("https://Example.com/posts/launch/?utm_source=x#section")).has(
      "https://example.com/posts/launch",
    ),
    true,
  );
});

test("shared post reuse resolver is scoped to Hub-shared feed items", () => {
  const route = readFileSync("src/app/api/skill/shared-post-reuse/route.ts", "utf8");
  assert.match(route, /builder:\s*\{\s*is:\s*\{\s*hubItems:\s*\{\s*some:\s*\{\s*\}/);
  assert.doesNotMatch(route, /ownerUserId:\s*user\.id/);
  assert.doesNotMatch(route, /ownerUserId:\s*\{\s*in:/);
  assert.match(route, /checkBodyContentQuality/);
  assert.match(route, /summaryLanguageMatches/);
  assert.match(route, /title:\s*z\.string\(\)\.max\(500\)\.nullable\(\)\.optional\(\)/);
  assert.match(route, /function reusableSourceSummaryIsValid/);
  assert.match(route, /function finalReusableSummaryIsValid/);
  assert.match(route, /function reusableHeadlineIsValid/);
  assert.match(route, /rowSummaryCanBeReused/);
});

test("shared post reuse skips stored bodies when raw content was not retained", () => {
  const route = readFileSync("src/app/api/skill/shared-post-reuse/route.ts", "utf8");
  assert.match(route, /function storedBodyCanBeReused/);
  assert.match(route, /rawJsonRecord\(rawJson\.rawContentPolicy\)/);
  assert.match(route, /policy\.rawRetained === false/);
  assert.match(route, /durableRawMode\)\.toLowerCase\(\) === "none"/);
  assert.doesNotMatch(route, /if \(!storedBodyCanBeReused\(rawJson\)\) continue/);
  assert.match(route, /summaryMatchesTarget/);
  assert.match(route, /bodyReused/);
});

test("shared post reuse uses a persisted canonical post identity", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const route = readFileSync("src/app/api/skill/shared-post-reuse/route.ts", "utf8");
  const builderSync = readFileSync("src/lib/builder-feed-sync.ts", "utf8");

  assert.match(schema, /model CanonicalPost \{/);
  assert.match(schema, /canonicalUrl\s+String\s+@unique/);
  assert.match(schema, /canonicalPostId\s+String\?/);
  assert.match(schema, /canonicalPost\s+CanonicalPost\?/);
  assert.match(schema, /@@index\(\[canonicalPostId\]\)/);

  assert.match(route, /canonicalPost:\s*\{\s*is:\s*\{\s*canonicalUrl:\s*\{\s*in:/);
  assert.match(route, /OR:\s*\[\s*\{\s*canonicalPost:/);
  assert.match(builderSync, /ensureCanonicalPostId\(prisma, item\.url\)/);
  assert.match(builderSync, /canonicalPostUrl\(url\)/);
  assert.match(builderSync, /prisma\.canonicalPost\.upsert/);
  assert.match(builderSync, /canonicalPostId/);
});

test("canonical post migration creates a unique URL identity without making feed items unique by URL", () => {
  const migration = readFileSync("prisma/migrations/000078_canonical_posts/migration.sql", "utf8");

  assert.match(migration, /CREATE TABLE "CanonicalPost"/);
  assert.match(migration, /CREATE UNIQUE INDEX "CanonicalPost_canonicalUrl_key"/);
  assert.match(migration, /ALTER TABLE "FeedItem" ADD COLUMN "canonicalPostId" TEXT/);
  assert.match(migration, /CREATE INDEX "FeedItem_canonicalPostId_idx"/);
  assert.match(migration, /FOREIGN KEY \("canonicalPostId"\) REFERENCES "CanonicalPost"\("id"\) ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX .*FeedItem.*url/);
});

test("builder sync records summaryLanguage for future same-language reuse", () => {
  const route = readFileSync("src/app/api/skill/builders/route.ts", "utf8");
  const feedSync = readFileSync("src/lib/builder-feed-sync.ts", "utf8");
  assert.match(feedSync, /rawJsonWithSummaryLanguage/);
  assert.match(route, /normalizeSummaryLanguagePreference/);
  assert.match(feedSync, /summaryLanguage/);
});

test("summary language matching treats original as its own language", () => {
  assert.equal(summaryLanguagesMatch("original", "source"), true);
  assert.equal(summaryLanguagesMatch("source", "original"), true);
  assert.equal(summaryLanguagesMatch("original", "English"), false);
  assert.equal(summaryLanguagesMatch("source", "zh"), false);
  assert.equal(summaryLanguagesMatch("English", "english"), true);
});

test("fetch log treats summary translation as summarize work without claiming a source read", () => {
  const panel = readFileSync("src/components/FetchLogPanel.tsx", "utf8");
  assert.match(panel, /function isSummaryTranslationTask/);
  assert.match(panel, /function hasSummarizeInputSignal/);
  assert.match(panel, /if \(isSummaryTranslationTask\(task\)\) return false/);
  assert.match(panel, /return isSummaryTranslationTask\(task\) \|\| hasReadSignal\(task, liveTask\)/);
  assert.match(panel, /return \{ label: "summarizing", tone: "idle" \}/);
  assert.match(panel, /if \(isSummaryTranslationTask\(task\) && isSummarized\(task\)\) return \{ label: "Summarized", tone: "ok" \}/);
  assert.match(panel, /label: isDiscovery \? "Discover" : "Read"/);
  assert.match(panel, /label: isDiscovery \? "Expand" : "Summarize"/);
  assert.doesNotMatch(panel, /No fetch needed/);
  assert.doesNotMatch(panel, /Translated & summarized/);
  assert.doesNotMatch(panel, /Waiting to translate/);
  assert.doesNotMatch(panel, /label: "translating"/);
  assert.doesNotMatch(panel, /isTranslation \?/);
});

test("deterministic same-language reuse syncs as a normal item without a worker shard", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const body = "Shared article body. ".repeat(40);
  const task = {
    id: "reuse-task",
    type: "fetch_post",
    contentStatus: "ready",
    deterministicSync: true,
    builder: "Current Source",
    builderId: "builder_current",
    sourceType: "blog",
    builderSync: {
      builderId: "builder_current",
      kind: "BLOG",
      sourceType: "blog",
      name: "Current Source",
      sourceUrl: "https://current.example/feed.xml",
      fetchUrl: "https://current.example/feed.xml",
      subscribe: true,
    },
    item: {
      kind: "BLOG_POST",
      externalId: "current-post",
      title: "Launch notes",
      url: "https://example.com/posts/launch",
      publishedAt: "2026-06-26T10:00:00.000Z",
      sourceName: "Current Source",
      body,
      summary: "这是一条已经按当前语言写好的摘要，说明发布内容的重点、背景、关键事实、后续影响和对读者的实际价值。",
      headline: "发布说明突出关键影响",
      rawJson: {
        fetchTaskId: "reuse-task",
        readMethod: "Copied body from a Hub-shared post with the same URL",
        summaryMethod: "Copied matching-language summary from a Hub-shared post",
        hubSharedReuse: {
          source: "hub_shared_post",
          bodyReused: true,
          summaryReused: true,
          headlineReused: true,
          feedItemId: "feed_shared",
        },
      },
    },
  };
  const fetchResult = { status: "ok", summaryLanguage: "zh", fetchTasks: [task] };

  const shards = cli.shardFetchTasksForWorkers(fetchResult, 3);
  assert.equal(shards.shards.length, 0);

  const merged = cli.mergeShardSyncPayloads(fetchResult, []);
  assert.equal(merged.payload.summaryLanguage, "zh");
  assert.equal(merged.payload.builders.length, 1);
  assert.equal(merged.payload.builders[0].items.length, 1);
  assert.equal(merged.payload.builders[0].items[0].body, body);
  assert.equal(merged.payload.builders[0].items[0].summary, "这是一条已经按当前语言写好的摘要，说明发布内容的重点、背景、关键事实、后续影响和对读者的实际价值。");
  assert.equal(merged.payload.builders[0].items[0].headline, "发布说明突出关键影响");
  assert.equal(merged.payload.builders[0].items[0].rawJson.fetchTaskId, "reuse-task");
  assert.equal(merged.payload.builders[0].items[0].rawJson.deterministicSync, true);
  assert.equal(merged.payload.taskOutcomes.length, 0);
  assert.deepEqual(merged.accountedTaskIds, ["reuse-task"]);

  const validation = cli.validateAgentSyncPayload(fetchResult, merged.payload);
  assert.equal(validation.status, "ok");
  assert.equal(validation.validatedFetchTasks, 1);

  const planned = cli.fetchRunPlannedTaskPatches(fetchResult)[0];
  assert.equal(planned.status, "fetched");
  assert.equal(planned.summaryChars, task.item.summary.length);
  assert.equal(planned.headlineChars, task.item.headline.length);
  assert.equal(planned.readMethod, "Copied body from a Hub-shared post with the same URL");
  assert.equal(planned.summaryMethod, "Copied matching-language summary from a Hub-shared post");
});

function baseFetchTask() {
  return {
    id: "reuse-summary-only",
    type: "fetch_post",
    agentWorkType: "fetch_post",
    contentStatus: "requires_agent",
    builder: "Current Source",
    builderId: "builder_current",
    sourceType: "blog",
    builderSync: {
      builderId: "builder_current",
      kind: "BLOG",
      sourceType: "blog",
      name: "Current Source",
      sourceUrl: "https://current.example/feed.xml",
      fetchUrl: "https://current.example/feed.xml",
      subscribe: true,
    },
    item: {
      kind: "BLOG_POST",
      externalId: "current-post",
      title: "Launch notes",
      url: "https://example.com/posts/launch",
      publishedAt: "2026-06-26T10:00:00.000Z",
      sourceName: "Current Source",
      body: "",
      rawJson: { fetchTaskId: "reuse-summary-only" },
    },
  };
}

test("CLI shared-summary fallback keeps original distinct from fixed languages", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = baseFetchTask();
  const fixedLanguageReuse = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body: null,
    bodyReused: false,
    summary: "A source-language summary that should not count as English.",
    headline: "Source language summary needs translation",
    summaryLanguage: "source",
    source: {
      feedItemId: "feed_shared",
      builderId: "builder_shared",
      builderName: "Shared Source",
      url: "https://example.com/posts/launch",
    },
  }, { summaryLanguage: "English" });

  assert.equal(fixedLanguageReuse.agentWorkType, "translate_summary_only");
  assert.equal(fixedLanguageReuse.deterministicSync, false);
  assert.equal(fixedLanguageReuse.summaryTranslation.sourceLanguage, "source");

  const originalLanguageReuse = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body: null,
    bodyReused: false,
    summary: "A source-language summary that can be reused for original mode.",
    headline: "Source language summary can be reused",
    summaryLanguage: "source",
    source: {
      feedItemId: "feed_shared",
      builderId: "builder_shared",
      builderName: "Shared Source",
      url: "https://example.com/posts/launch",
    },
  }, { summaryLanguage: "original" });

  assert.equal(originalLanguageReuse.contentStatus, "ready");
  assert.equal(originalLanguageReuse.deterministicSync, true);
  assert.equal(originalLanguageReuse.item.rawJson.hubSharedReuse.summaryReused, true);
  assert.equal(originalLanguageReuse.item.rawJson.hubSharedReuse.headlineReused, true);
});

test("same-language Hub summary can sync without copying a reusable body", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = baseFetchTask();
  const reused = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body: null,
    bodyReused: false,
    summary: "这是一条已经按当前语言写好的摘要，说明发布内容的重点、背景、关键事实、后续影响和对读者的实际价值。",
    headline: "当前语言摘要可以直接复用",
    summaryLanguage: "zh",
    summaryMatchesTarget: true,
    source: {
      feedItemId: "feed_shared",
      builderId: "builder_shared",
      builderName: "Shared Source",
      url: "https://example.com/posts/launch",
    },
  });
  const fetchResult = { status: "ok", summaryLanguage: "zh", fetchTasks: [reused] };

  assert.equal(reused.contentStatus, "ready");
  assert.equal(reused.deterministicSync, true);
  assert.equal(reused.agentWorkType, "fetch_post");
  assert.equal(reused.item.body, "");
  assert.equal(reused.item.rawJson.hubSharedReuse.bodyReused, false);
  assert.equal(reused.item.rawJson.hubSharedReuse.summaryReused, true);
  assert.equal(reused.item.rawJson.hubSharedReuse.headlineReused, true);
  assert.equal(reused.item.rawJson.readMethod, undefined);
  assert.equal(reused.item.rawJson.summaryMethod, "Copied matching-language summary from a Hub-shared post");

  const shards = cli.shardFetchTasksForWorkers(fetchResult, 3);
  assert.equal(shards.shards.length, 0);

  const merged = cli.mergeShardSyncPayloads(fetchResult, []);
  assert.equal(merged.payload.builders[0].items[0].body, "");
  assert.equal(merged.payload.builders[0].items[0].summary, reused.item.summary);
  assert.equal(merged.payload.builders[0].items[0].headline, reused.item.headline);

  const validation = cli.validateAgentSyncPayload(fetchResult, merged.payload);
  assert.equal(validation.status, "ok");
  assert.equal(validation.validatedFetchTasks, 1);
});

test("same-language Hub summary without a headline cannot sync deterministically", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = baseFetchTask();
  const reused = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body: null,
    bodyReused: false,
    summary: "这是一条已经按当前语言写好的摘要，说明发布内容的重点、背景、关键事实、后续影响和对读者的实际价值。",
    summaryLanguage: "zh",
    summaryMatchesTarget: true,
    source: {
      feedItemId: "feed_shared",
      builderId: "builder_shared",
      builderName: "Shared Source",
      url: "https://example.com/posts/launch",
    },
  }, { summaryLanguage: "zh" });

  assert.equal(reused, task);
  assert.equal(reused.contentStatus, "requires_agent");
  assert.equal(reused.agentWorkType, "fetch_post");
});

test("same-language Hub summary must pass reusable and final validation before copy", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = baseFetchTask();
  const reused = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body: null,
    bodyReused: false,
    summary: "Too short.",
    summaryLanguage: "zh",
    summaryMatchesTarget: true,
    source: {
      feedItemId: "feed_shared",
      builderId: "builder_shared",
      builderName: "Shared Source",
      url: "https://example.com/posts/launch",
    },
  }, { summaryLanguage: "zh" });

  assert.equal(reused, task);
  assert.equal(reused.contentStatus, "requires_agent");
  assert.equal(reused.agentWorkType, "fetch_post");
});

test("same-language Hub summary that copies the body prefix reuses only the body", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = baseFetchTask();
  const summary = "This launch note explains the roadmap update, customer migration timing, pricing impact, and operational risks for teams.";
  const body = `${summary} It then adds implementation details, customer examples, and migration context that should be summarized freshly.`;
  const reused = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body,
    bodyReused: true,
    summary,
    summaryLanguage: "en",
    summaryMatchesTarget: true,
    source: {
      feedItemId: "feed_shared",
      builderId: "builder_shared",
      builderName: "Shared Source",
      url: "https://example.com/posts/launch",
    },
  }, { summaryLanguage: "en" });

  assert.notEqual(reused, task);
  assert.equal(reused.contentStatus, "ready");
  assert.equal(reused.deterministicSync, false);
  assert.equal(reused.item.body, body);
  assert.equal(reused.item.summary, undefined);
  assert.equal(reused.item.rawJson.hubSharedReuse.bodyReused, true);
  assert.equal(reused.item.rawJson.hubSharedReuse.summaryReused, false);
  assert.equal(reused.item.rawJson.hubSharedReuse.summaryTranslated, false);
});

test("different-language Hub summary must pass reusable validation before translation", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = baseFetchTask();
  const reused = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body: null,
    bodyReused: false,
    summary: "Too short.",
    summaryLanguage: "en",
    summaryMatchesTarget: false,
    source: {
      feedItemId: "feed_shared",
      builderId: "builder_shared",
      builderName: "Shared Source",
      url: "https://example.com/posts/launch",
    },
  }, { summaryLanguage: "zh" });

  assert.equal(reused, task);
  assert.equal(reused.contentStatus, "requires_agent");
  assert.equal(reused.agentWorkType, "fetch_post");
});

test("missing Hub summary or body leaves the post on the normal fetch path", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = baseFetchTask();
  const reused = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body: null,
    bodyReused: false,
    summary: null,
    summaryLanguage: null,
    summaryMatchesTarget: false,
    source: null,
  }, { summaryLanguage: "zh" });

  assert.equal(reused, task);
  assert.equal(reused.contentStatus, "requires_agent");
  assert.equal(reused.agentWorkType, "fetch_post");
});

test("different-language Hub summary becomes a ready fetch_post subtask that only translates summary", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = baseFetchTask();
  const reused = cli.applySharedPostReuseToTask(task, {
    id: task.id,
    body: null,
    bodyReused: false,
    summary: "This source explains a launch, the core product change, the likely audience impact, and the practical next steps for readers.",
    summaryLanguage: "en",
    summaryMatchesTarget: false,
    source: {
      feedItemId: "feed_shared",
      builderId: "builder_shared",
      builderName: "Shared Source",
      url: "https://example.com/posts/launch",
    },
  }, { summaryLanguage: "zh" });
  const fetchResult = { status: "ok", summaryLanguage: "zh", fetchTasks: [reused] };

  assert.equal(reused.type, "fetch_post");
  assert.equal(reused.agentWorkType, "translate_summary_only");
  assert.equal(reused.contentStatus, "ready");
  assert.equal(reused.deterministicSync, false);
  assert.equal(reused.item.body, "");
  assert.equal(reused.item.summary, undefined);
  assert.equal(reused.item.rawJson.hubSharedReuse.summaryReused, false);
  assert.equal(reused.summaryTranslation.sourceSummary, "This source explains a launch, the core product change, the likely audience impact, and the practical next steps for readers.");
  assert.match(reused.summaryInstructions.prompt, /Translate the Hub-shared summary only/i);
  assert.match(reused.summaryInstructions.prompt, /Do not fetch/i);

  const shards = cli.shardFetchTasksForWorkers(fetchResult, 3);
  assert.equal(shards.shards.length, 1);
  assert.equal((shards.shards[0].tasks[0] as { agentWorkType?: string }).agentWorkType, "translate_summary_only");

  const merged = cli.mergeShardSyncPayloads(fetchResult, [
    {
      name: "shard-0-result.json",
      payload: {
        builders: [
          {
            ...reused.builderSync,
            items: [
              {
                kind: reused.item.kind,
                externalId: reused.item.externalId,
                title: reused.item.title,
                url: reused.item.url,
                publishedAt: reused.item.publishedAt,
                sourceName: reused.item.sourceName,
                summary: "这条来源说明一次发布、核心产品变化、可能的受众影响，以及读者可以采取的后续步骤。",
                headline: "发布影响和后续步骤已翻译",
                rawJson: {
                  fetchTaskId: reused.id,
                  agentWorkType: "translate_summary_only",
                  summaryMethod: "Translated summary from a Hub-shared post",
                },
              },
            ],
          },
        ],
        taskOutcomes: [],
      },
    },
  ]);

  assert.equal(merged.payload.builders[0].items[0].body, "");
  const validation = cli.validateAgentSyncPayload(fetchResult, merged.payload);
  assert.equal(validation.status, "ok");
  assert.equal(validation.validatedFetchTasks, 1);
});
