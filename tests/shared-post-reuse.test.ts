import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { canonicalPostUrl, postUrlLookupVariants } from "../src/lib/canonical-url";

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
  assert.match(route, /checkBodyContentQuality/);
  assert.match(route, /summaryLanguageMatches/);
});

test("shared post reuse uses a persisted canonical post identity", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const route = readFileSync("src/app/api/skill/shared-post-reuse/route.ts", "utf8");
  const builderSync = readFileSync("src/app/api/skill/builders/route.ts", "utf8");

  assert.match(schema, /model CanonicalPost \{/);
  assert.match(schema, /canonicalUrl\s+String\s+@unique/);
  assert.match(schema, /canonicalPostId\s+String\?/);
  assert.match(schema, /canonicalPost\s+CanonicalPost\?/);
  assert.match(schema, /@@index\(\[canonicalPostId\]\)/);

  assert.match(route, /canonicalPost:\s*\{\s*is:\s*\{\s*canonicalUrl:\s*\{\s*in:/);
  assert.match(route, /OR:\s*\[\s*\{\s*canonicalPost:/);
  assert.match(builderSync, /ensureCanonicalPostId\(item\.url\)/);
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
  assert.match(route, /rawJsonWithSummaryLanguage/);
  assert.match(route, /normalizeSummaryLanguagePreference/);
  assert.match(route, /summaryLanguage/);
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
      rawJson: {
        fetchTaskId: "reuse-task",
        readMethod: "Copied body from a Hub-shared post with the same URL",
        summaryMethod: "Copied matching-language summary from a Hub-shared post",
        hubSharedReuse: {
          source: "hub_shared_post",
          bodyReused: true,
          summaryReused: true,
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
  assert.equal(planned.readMethod, "Copied body from a Hub-shared post with the same URL");
  assert.equal(planned.summaryMethod, "Copied matching-language summary from a Hub-shared post");
});
