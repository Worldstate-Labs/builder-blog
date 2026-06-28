import assert from "node:assert/strict";
import test from "node:test";
import { BuilderKind, FeedItemKind } from "@prisma/client";
import { syncBuilderFeedItems } from "../src/lib/builder-feed-sync";

test("cloud feed sync writes items to an existing cloud-owned builder without personal library side effects", async () => {
  const now = new Date("2026-06-27T12:00:00.000Z");
  const prisma = fakeBuilderFeedSyncPrisma();

  const result = await syncBuilderFeedItems({
    prisma,
    now,
    builders: [
      {
        builderId: "cloud_builder_zh",
        kind: BuilderKind.BLOG,
        sourceType: "blog",
        name: "Cloud Blog",
        sourceUrl: "https://example.com/feed.xml",
        fetchUrl: "https://example.com/feed.xml",
        subscribe: false,
        items: [
          {
            kind: FeedItemKind.BLOG_POST,
            externalId: "post-1",
            title: "Translated existing summary",
            body: "",
            summary: "这是一条从已有英文摘要翻译来的中文摘要。",
            url: "https://example.com/posts/post-1",
            publishedAt: "2026-06-26T10:00:00.000Z",
            rawJson: {
              fetchTaskId: "fetch_post:cloud_builder_zh:post-1",
              agentWorkType: "translate_summary_only",
              agentRuntime: "claude",
              agentModel: "claude-sonnet",
            },
          },
        ],
      },
    ],
    force: false,
    fetchTool: "Cloud Agent sync",
    summaryLanguage: "zh",
    mode: {
      type: "existing",
      allowedBuilderIds: new Set(["cloud_builder_zh"]),
    },
    contentStandardsBySourceId: new Map([
      ["blog", { minChars: 20, minContentUnits: 4 }],
    ]),
    addBuilderToPoolFn: async () => {
      throw new Error("cloud sync must not add builders to a personal pool");
    },
  });

  assert.equal(result.builders, 1);
  assert.equal(result.feedItems, 1);
  assert.equal(result.skippedFeedItems, 0);
  assert.equal(result.subscriptions, 0);
  assert.deepEqual(result.itemResults, [
    {
      fetchTaskId: "fetch_post:cloud_builder_zh:post-1",
      kind: FeedItemKind.BLOG_POST,
      externalId: "post-1",
      status: "synced",
    },
  ]);

  assert.equal(prisma.feedItem.upsertCalls.length, 1);
  assert.equal(prisma.feedItem.upsertCalls[0].create.builderId, "cloud_builder_zh");
  assert.equal(prisma.feedItem.upsertCalls[0].create.body, "");
  assert.equal(prisma.feedItem.upsertCalls[0].create.summary, "这是一条从已有英文摘要翻译来的中文摘要。");
  assert.equal(prisma.feedItem.upsertCalls[0].create.fetchTool, "claude (model claude-sonnet)");
  assert.equal(
    JSON.parse(String(prisma.feedItem.upsertCalls[0].create.rawJson)).summaryLanguage,
    "zh",
  );

  assert.deepEqual(prisma.builder.updateCalls[0], {
    where: { id: "cloud_builder_zh" },
    data: {
      lastFetchedAt: now,
      itemCount: 1,
      status: "OK",
      lastError: null,
    },
  });
});

function fakeBuilderFeedSyncPrisma() {
  return {
    builder: {
      findFirstCalls: [] as unknown[],
      updateCalls: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
      async findFirst(args: unknown) {
        this.findFirstCalls.push(args);
        return {
          id: "cloud_builder_zh",
          ownerUserId: "cloud_owner_zh",
          entityId: "entity_1",
        };
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        this.updateCalls.push(args);
        return { id: args.where.id, ...args.data };
      },
    },
    feedItem: {
      findManyCalls: [] as unknown[],
      updateManyCalls: [] as unknown[],
      upsertCalls: [] as Array<{
        where: Record<string, unknown>;
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }>,
      async findMany(args: unknown) {
        this.findManyCalls.push(args);
        return [];
      },
      async updateMany(args: unknown) {
        this.updateManyCalls.push(args);
        return { count: 0 };
      },
      async upsert(args: {
        where: Record<string, unknown>;
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) {
        this.upsertCalls.push(args);
        return { id: "feed_item_1", ...args.create };
      },
    },
    canonicalPost: {
      upsertCalls: [] as unknown[],
      async upsert(args: unknown) {
        this.upsertCalls.push(args);
        return { id: "canonical_post_1" };
      },
    },
  };
}
