/**
 * Snapshot rows pin one copy of a post. These cover the read-time swap that
 * re-runs the primary-variant rule so a newer copy synced by another source
 * library replaces the stale pin.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { FeedItemKind } from "@prisma/client";
import {
  resolveVariantReplacements,
  type SnapshotFeedItem,
} from "../src/lib/recommendations";

const now = new Date("2026-08-18T12:00:00.000Z");
const yesterday = new Date(now.getTime() - 86400000);

function copy(overrides: {
  id: string;
  builderId: string;
  ownerUserId?: string;
  updatedAt?: Date;
  lastFetchedAt?: Date | null;
  summary?: string;
  reads?: { readAt: Date }[];
  favorites?: { favoritedAt: Date }[];
}): SnapshotFeedItem {
  return {
    id: overrides.id,
    kind: FeedItemKind.BLOG_POST,
    externalId: "abc-legal-managed-agents",
    title: "How ABC Legal turned every employee into a builder",
    headline: null,
    body: "body",
    summary: overrides.summary ?? "summary",
    url: "https://claude.com/abc-legal",
    publishedAt: yesterday,
    createdAt: yesterday,
    updatedAt: overrides.updatedAt ?? yesterday,
    sourceName: "Claude Blog",
    fetchTool: null,
    builderId: overrides.builderId,
    builder: {
      id: overrides.builderId,
      entityId: "entity_claude_blog",
      avatarUrl: null,
      avatarDataUrl: null,
      name: "Claude Blog",
      handle: null,
      kind: "BLOG",
      sourceType: "blog",
      sourceUrl: "https://claude.com",
      fetchUrl: null,
      bio: null,
      ownerUserId: overrides.ownerUserId ?? "cloud_system",
      lastFetchedAt: overrides.lastFetchedAt ?? null,
    },
    reads: overrides.reads,
    favorites: overrides.favorites,
  } as SnapshotFeedItem;
}

test("snapshot swaps in the copy summarized most recently", () => {
  const pinned = copy({
    id: "item_en",
    builderId: "b_en",
    ownerUserId: "cloud_en",
    updatedAt: yesterday,
    lastFetchedAt: now,
    summary: "English summary",
  });
  const fresher = copy({
    id: "item_zh",
    builderId: "b_zh",
    ownerUserId: "cloud_zh",
    updatedAt: now,
    lastFetchedAt: yesterday,
    summary: "中文摘要",
  });

  const replacements = resolveVariantReplacements({
    pinByEntityId: new Map(),
    pinnedRows: [pinned],
    userId: "user_x",
    variants: [pinned, fresher],
  });

  assert.equal(replacements.get("item_en")?.summary, "中文摘要");
});

test("snapshot keeps its pinned copy when that copy is already the winner", () => {
  const pinned = copy({ id: "item_zh", builderId: "b_zh", updatedAt: now });
  const stale = copy({ id: "item_en", builderId: "b_en", updatedAt: yesterday });

  const replacements = resolveVariantReplacements({
    pinByEntityId: new Map(),
    pinnedRows: [pinned],
    userId: "user_x",
    variants: [pinned, stale],
  });

  assert.equal(replacements.size, 0);
});

test("a user-pinned channel still overrides the freshness rule", () => {
  const pinned = copy({ id: "item_en", builderId: "b_en", updatedAt: yesterday });
  const fresher = copy({ id: "item_zh", builderId: "b_zh", updatedAt: now });

  const replacements = resolveVariantReplacements({
    pinByEntityId: new Map([["entity_claude_blog", "b_en"]]),
    pinnedRows: [pinned],
    userId: "user_x",
    variants: [pinned, fresher],
  });

  assert.equal(replacements.size, 0);
});

test("read and favorite state survives the swap", () => {
  const readAt = new Date(now.getTime() - 3600000);
  const favoritedAt = new Date(now.getTime() - 7200000);
  const pinned = copy({
    id: "item_en",
    builderId: "b_en",
    updatedAt: yesterday,
    reads: [{ readAt }],
    favorites: [{ favoritedAt }],
  });
  const fresher = copy({ id: "item_zh", builderId: "b_zh", updatedAt: now });

  const swapped = resolveVariantReplacements({
    pinByEntityId: new Map(),
    pinnedRows: [pinned],
    userId: "user_x",
    variants: [pinned, fresher],
  }).get("item_en");

  assert.equal(swapped?.id, "item_zh");
  assert.deepEqual(swapped?.reads, [{ readAt }]);
  assert.deepEqual(swapped?.favorites, [{ favoritedAt }]);
});

test("a post with only one copy is left untouched", () => {
  const only = copy({ id: "item_zh", builderId: "b_zh", updatedAt: now });
  const replacements = resolveVariantReplacements({
    pinByEntityId: new Map(),
    pinnedRows: [only],
    userId: "user_x",
    variants: [only],
  });
  assert.equal(replacements.size, 0);
});
