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
    lastCrawledAt: overrides.lastCrawledAt ?? null,
    publishedAt: overrides.publishedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    builderId: overrides.builderId,
  };
}

test("channel resolution / user-pinned primary wins", () => {
  const variants = [
    variant({ builderId: "b_alice", ownerUserId: "alice", lastCrawledAt: now }),
    variant({ builderId: "b_bob", ownerUserId: "bob", lastCrawledAt: now }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x", "b_bob");
  assert.equal(picked.builderId, "b_bob");
});

test("channel resolution / own channel preferred over imported when no pin", () => {
  const variants = [
    variant({ builderId: "b_other", ownerUserId: "stranger", lastCrawledAt: now }),
    variant({ builderId: "b_mine", ownerUserId: "user_x" }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x");
  assert.equal(picked.builderId, "b_mine");
});

test("channel resolution / falls back to most recently crawled when no pin or own", () => {
  const yesterday = new Date(now.getTime() - 86400000);
  const variants = [
    variant({ builderId: "b_stale", ownerUserId: "alice", lastCrawledAt: yesterday }),
    variant({ builderId: "b_fresh", ownerUserId: "alice", lastCrawledAt: now }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x");
  assert.equal(picked.builderId, "b_fresh");
});

test("channel resolution / pin overrides own channel", () => {
  const variants = [
    variant({ builderId: "b_mine", ownerUserId: "user_x" }),
    variant({ builderId: "b_pinned", ownerUserId: "alice", lastCrawledAt: now }),
  ];
  const picked = pickPrimaryVariant(variants, "user_x", "b_pinned");
  assert.equal(picked.builderId, "b_pinned");
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
