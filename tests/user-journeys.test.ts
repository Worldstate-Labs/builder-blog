import assert from "node:assert/strict";
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
    builders: [
      {
        kind: "PODCAST",
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
  assert.equal(parsed.data.builders[0].kind, BuilderKind.PODCAST);
  assert.equal(parsed.data.builders[0].subscribe, true);
  assert.equal(parsed.data.builders[0].items[0].kind, FeedItemKind.PODCAST_EPISODE);
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
