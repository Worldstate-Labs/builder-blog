import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeCloudLibrary,
  serializeCloudLibrarySource,
  serializeCloudSourceSubmitter,
} from "../src/lib/cloud-library-overview";

test("serializeCloudLibrarySource flattens task status, builder identity, and counts", () => {
  const result = serializeCloudLibrarySource(
    {
      builderId: "cb_1",
      status: "PAUSED",
      effectiveFrequency: "WEEKLY",
      lastSuccessAt: new Date("2026-06-26T10:00:00.000Z"),
      lastFailureAt: new Date("2026-06-27T10:00:00.000Z"),
      lastFailureReason: "summary_missing",
      nextAttemptAt: new Date("2026-06-28T10:00:00.000Z"),
      consecutiveFailures: 2,
      circuitBreakerUntil: null,
      builder: {
        entityId: "ent_1",
        kind: "BLOG",
        name: "Example Feed",
        sourceType: "blog",
        sourceUrl: "https://example.com/feed",
        fetchUrl: "https://example.com/feed.xml",
        avatarUrl: "https://example.com/avatar.png",
        avatarDataUrl: null,
      },
    },
    { submitterCount: 3, postCount: 42 },
  );

  assert.deepEqual(result, {
    builderId: "cb_1",
    entityId: "ent_1",
    kind: "BLOG",
    sourceName: "Example Feed",
    sourceType: "blog",
    sourceUrl: "https://example.com/feed",
    fetchUrl: "https://example.com/feed.xml",
    avatarUrl: "https://example.com/avatar.png",
    avatarDataUrl: null,
    status: "PAUSED",
    effectiveFrequency: "WEEKLY",
    lastSuccessAt: "2026-06-26T10:00:00.000Z",
    lastFailureAt: "2026-06-27T10:00:00.000Z",
    lastFailureReason: "summary_missing",
    nextAttemptAt: "2026-06-28T10:00:00.000Z",
    consecutiveFailures: 2,
    circuitBreakerUntil: null,
    submitterCount: 3,
    postCount: 42,
    latestRunTask: null,
  });
});

test("serializeCloudLibrarySource tolerates a missing builder and null timestamps", () => {
  const result = serializeCloudLibrarySource(
    {
      builderId: "cb_2",
      status: "ACTIVE",
      effectiveFrequency: "DAILY",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      nextAttemptAt: null,
      consecutiveFailures: 0,
      circuitBreakerUntil: null,
      builder: null,
    },
    { submitterCount: 0, postCount: 0 },
  );

  assert.equal(result.sourceName, null);
  assert.equal(result.sourceType, null);
  assert.equal(result.sourceUrl, null);
  assert.equal(result.lastSuccessAt, null);
  assert.equal(result.nextAttemptAt, null);
  assert.equal(result.latestRunTask, null);
});

test("serializeCloudLibrary carries owner email, enabled flag, and a source count", () => {
  const result = serializeCloudLibrary(
    { id: "lib_zh", summaryLanguage: "zh", enabled: true, owner: { email: "cloud-zh@example.com" } },
    [
      { builderId: "cb_1" } as never,
      { builderId: "cb_2" } as never,
    ],
  );

  assert.equal(result.id, "lib_zh");
  assert.equal(result.summaryLanguage, "zh");
  assert.equal(result.ownerEmail, "cloud-zh@example.com");
  assert.equal(result.enabled, true);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.sources.length, 2);
});

test("serializeCloudSourceSubmitter exposes the submitting user and their frequency", () => {
  const result = serializeCloudSourceSubmitter({
    frequency: "DAILY",
    submittedAt: new Date("2026-06-25T09:00:00.000Z"),
    active: true,
    user: { email: "reader@example.com", name: "Reader" },
  });

  assert.deepEqual(result, {
    email: "reader@example.com",
    name: "Reader",
    frequency: "DAILY",
    submittedAt: "2026-06-25T09:00:00.000Z",
    active: true,
  });
});
