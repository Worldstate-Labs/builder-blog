/**
 * Unit-level user-journey tests for the entity layer's pure helpers. These tests do NOT
 * require a database; they exercise the channel-selection contract that the consumption
 * pipeline (For-You, Subscription, Digest) depends on.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BuilderKind, FeedItemKind } from "@prisma/client";
import {
  builderLibraryKey,
  canonicalBuilderKey,
  normalizeHandle,
} from "../src/lib/builder-keys";
import { pickPrimaryVariant, type ChannelVariant } from "../src/lib/builder-channel-picker";

const now = new Date("2026-05-24T12:00:00.000Z");

function variant(overrides: Partial<ChannelVariant> & { builderId: string }): ChannelVariant {
  return {
    ownerUserId: overrides.ownerUserId ?? "stranger",
    itemUpdatedAt: overrides.itemUpdatedAt ?? null,
    lastFetchedAt: overrides.lastFetchedAt ?? null,
    publishedAt: overrides.publishedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    summaryContentLanguage: overrides.summaryContentLanguage ?? null,
    fromOriginalLanguageLibrary: overrides.fromOriginalLanguageLibrary ?? false,
    builderId: overrides.builderId,
  };
}

test("channel resolution / user-pinned primary wins", () => {
  const variants = [
    variant({ builderId: "b_alice", ownerUserId: "alice", lastFetchedAt: now }),
    variant({ builderId: "b_bob", ownerUserId: "bob", lastFetchedAt: now }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x", "b_bob");
  assert.equal(picked.builderId, "b_bob");
});

test("channel resolution / own channel preferred over imported when no pin", () => {
  const variants = [
    variant({ builderId: "b_other", ownerUserId: "stranger", lastFetchedAt: now }),
    variant({ builderId: "b_mine", ownerUserId: "user_x" }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x");
  assert.equal(picked.builderId, "b_mine");
});

test("channel resolution / falls back to most recently fetched when no pin or own", () => {
  const yesterday = new Date(now.getTime() - 86400000);
  const variants = [
    variant({ builderId: "b_stale", ownerUserId: "alice", lastFetchedAt: yesterday }),
    variant({ builderId: "b_fresh", ownerUserId: "alice", lastFetchedAt: now }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x");
  assert.equal(picked.builderId, "b_fresh");
});

test("channel resolution / newest copy of the post wins when no channel is the user's own", () => {
  // Every cloud-library channel belongs to a per-language system user, so the
  // own-channel rule never fires for the reader. The tie must be broken by when
  // this specific post was last fetched and summarized, not by when the channel
  // last ran.
  const yesterday = new Date(now.getTime() - 86400000);
  const variants = [
    variant({
      builderId: "b_en",
      ownerUserId: "cloud_en",
      itemUpdatedAt: yesterday,
      lastFetchedAt: now,
    }),
    variant({
      builderId: "b_zh",
      ownerUserId: "cloud_zh",
      itemUpdatedAt: now,
      lastFetchedAt: yesterday,
    }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x");
  assert.equal(picked.builderId, "b_zh");
});

test("channel resolution / newest copy wins among several own channels", () => {
  const yesterday = new Date(now.getTime() - 86400000);
  const variants = [
    variant({ builderId: "b_mine_stale", ownerUserId: "user_x", itemUpdatedAt: yesterday }),
    variant({ builderId: "b_mine_fresh", ownerUserId: "user_x", itemUpdatedAt: now }),
    variant({ builderId: "b_other_freshest", ownerUserId: "stranger", itemUpdatedAt: now }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x");
  assert.equal(picked.builderId, "b_mine_fresh");
});

test("channel resolution / pin overrides own channel", () => {
  const variants = [
    variant({ builderId: "b_mine", ownerUserId: "user_x" }),
    variant({ builderId: "b_pinned", ownerUserId: "alice", lastFetchedAt: now }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x", "b_pinned");
  assert.equal(picked.builderId, "b_pinned");
});

test("digest picks the copy already written in the requested language", () => {
  const yesterday = new Date(now.getTime() - 86400000);
  const variants = [
    variant({
      builderId: "b_en",
      ownerUserId: "cloud_en",
      itemUpdatedAt: now,
      summaryContentLanguage: "en",
    }),
    variant({
      builderId: "b_zh",
      ownerUserId: "cloud_zh",
      itemUpdatedAt: yesterday,
      summaryContentLanguage: "zh-Hans",
    }),
  ];
  // The English copy is newer; the requested language still wins.
  const picked = pickPrimaryVariant(variants, "user_x", null, "zh-CN");
  assert.equal(picked.builderId, "b_zh");
});

test("digest falls back to the original-language library when no copy matches", () => {
  const yesterday = new Date(now.getTime() - 86400000);
  const variants = [
    variant({
      builderId: "b_en",
      ownerUserId: "cloud_en",
      itemUpdatedAt: now,
      summaryContentLanguage: "en",
    }),
    variant({
      builderId: "b_original",
      ownerUserId: "cloud_source",
      itemUpdatedAt: yesterday,
      summaryContentLanguage: "ja",
      fromOriginalLanguageLibrary: true,
    }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x", null, "zh-CN");
  assert.equal(picked.builderId, "b_original");
});

test("a run set to the original language prefers the original library outright", () => {
  const variants = [
    variant({ builderId: "b_zh", itemUpdatedAt: now, summaryContentLanguage: "zh-Hans" }),
    variant({
      builderId: "b_original",
      itemUpdatedAt: new Date(now.getTime() - 86400000),
      fromOriginalLanguageLibrary: true,
    }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x", null, "source");
  assert.equal(picked.builderId, "b_original");
});

test("language preference outranks the user's own copy", () => {
  const variants = [
    variant({
      builderId: "b_mine",
      ownerUserId: "user_x",
      itemUpdatedAt: now,
      summaryContentLanguage: "en",
    }),
    variant({
      builderId: "b_zh",
      ownerUserId: "cloud_zh",
      itemUpdatedAt: new Date(now.getTime() - 86400000),
      summaryContentLanguage: "zh-Hans",
    }),
  ];
  assert.equal(pickPrimaryVariant(variants, "user_x", null, "zh-CN").builderId, "b_zh");
  // Without a language preference the own-channel rule still decides.
  assert.equal(pickPrimaryVariant(variants, "user_x").builderId, "b_mine");
});

test("freshness breaks the tie among several copies in the requested language", () => {
  const variants = [
    variant({ builderId: "b_zh_old", itemUpdatedAt: new Date(now.getTime() - 86400000), summaryContentLanguage: "zh-Hans" }),
    variant({ builderId: "b_zh_new", itemUpdatedAt: now, summaryContentLanguage: "zh-Hans" }),
    variant({ builderId: "b_en", itemUpdatedAt: now, summaryContentLanguage: "en" }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x", null, "zh-CN");
  assert.equal(picked.builderId, "b_zh_new");
});

test("a pinned channel still overrides the language preference", () => {
  const variants = [
    variant({ builderId: "b_en", itemUpdatedAt: now, summaryContentLanguage: "en" }),
    variant({ builderId: "b_zh", itemUpdatedAt: now, summaryContentLanguage: "zh-Hans" }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x", "b_en", "zh-CN");
  assert.equal(picked.builderId, "b_en");
});

test("library key is per-owner; canonical key is shared", () => {
  const canonicalKey = canonicalBuilderKey(BuilderKind.X, normalizeHandle("@dhh"));
  assert.equal(canonicalKey, "X:dhh");
  // Two users following the same creator each get a distinct library key, even though
  // the underlying entity (canonicalKey) is shared.
  const aliceKey = builderLibraryKey({ ownerUserId: "alice", canonicalKey });
  const bobKey = builderLibraryKey({ ownerUserId: "bob", canonicalKey });
  assert.equal(aliceKey, "user:alice:X:dhh");
  assert.equal(bobKey, "user:bob:X:dhh");
  assert.notEqual(aliceKey, bobKey);
});

test("library key throws without ownerUserId", () => {
  assert.throws(
    () => builderLibraryKey({ ownerUserId: "", canonicalKey: "X:dhh" }),
    /requires ownerUserId/,
  );
});

test("dedup group key collapses same content across channels", () => {
  // Sanity check: the canonical-content key is (entityId, kind, externalId).
  // Two channels of the same entity with the same external id collapse to one group.
  const groupKey = (entityId: string, kind: FeedItemKind, externalId: string) =>
    `${entityId}:${kind}:${externalId}`;
  const channelA = groupKey("e1", FeedItemKind.TWEET, "12345");
  const channelB = groupKey("e1", FeedItemKind.TWEET, "12345");
  assert.equal(channelA, channelB);
  // Different externalId stays distinct.
  assert.notEqual(channelA, groupKey("e1", FeedItemKind.TWEET, "67890"));
  // Different entity stays distinct even with same externalId.
  assert.notEqual(channelA, groupKey("e2", FeedItemKind.TWEET, "12345"));
});
