import assert from "node:assert/strict";
import test from "node:test";
import { prepareFeedItemStorage } from "../src/lib/source-content-policy";

test("YouTube transcripts are temporary by default while summaries persist", () => {
  const prepared = prepareFeedItemStorage({
    sourceType: "youtube",
    body: "Transcript sentence. ".repeat(200),
    summary: "A concise YouTube summary with the important points and source link.",
    rawJson: {
      fetchTaskId: "yt-task",
      transcriptSource: "youtube-captions",
      transcript: "Transcript sentence. ".repeat(200),
    },
  });

  assert.equal(prepared.policy.durableRawMode, "none");
  assert.equal(prepared.body, "");
  assert.equal(prepared.rawRetained, false);
  assert.equal((prepared.rawJson as Record<string, unknown>).rawContentPolicy && typeof (prepared.rawJson as Record<string, unknown>).rawContentPolicy, "object");
  assert.equal(((prepared.rawJson as Record<string, unknown>).rawContentPolicy as Record<string, unknown>).bodyStored, false);
  assert.deepEqual((prepared.rawJson as Record<string, unknown>).transcript, "[removed raw content]");
});

test("blog raw body can be retained with a source-specific durable cap", () => {
  const longBody = "Article details. ".repeat(5000);
  const prepared = prepareFeedItemStorage({
    sourceType: "blog",
    body: longBody,
    summary: "Blog summary.",
    rawJson: { fetchTaskId: "blog-task", html: "<article>raw</article>" },
  });

  assert.equal(prepared.policy.durableRawMode, "full");
  assert.ok(prepared.body.length <= 50_000);
  assert.equal(prepared.rawRetained, true);
  assert.equal((prepared.rawJson as Record<string, unknown>).html, "[removed raw content]");
});

test("podcast transcripts are temporary while show notes may be stored as excerpts", () => {
  const transcript = prepareFeedItemStorage({
    sourceType: "podcast",
    body: "Podcast transcript. ".repeat(300),
    summary: "Podcast transcript summary.",
    rawJson: { transcriptSource: "local-speech-to-text" },
  });
  const showNotes = prepareFeedItemStorage({
    sourceType: "podcast",
    body: "Show notes paragraph. ".repeat(300),
    summary: "Podcast show notes summary.",
    rawJson: { source: "personal-podcast" },
  });

  assert.equal(transcript.policy.durableRawMode, "none");
  assert.equal(transcript.body, "");
  assert.equal(transcript.rawRetained, false);
  assert.equal(showNotes.policy.durableRawMode, "excerpt");
  assert.ok(showNotes.body.startsWith("Show notes paragraph."));
});

test("X keeps tweet text but strips full raw API objects", () => {
  const prepared = prepareFeedItemStorage({
    sourceType: "x",
    body: "A short tweet text.",
    summary: "Tweet summary.",
    rawJson: {
      tweet: { id: "1", text: "A short tweet text.", edit_history_tweet_ids: ["1"] },
    },
  });

  assert.equal(prepared.policy.durableRawMode, "full");
  assert.equal(prepared.body, "A short tweet text.");
  assert.equal((prepared.rawJson as Record<string, unknown>).tweet, "[removed raw content]");
});

test("facts-only sources persist the structured body instead of using summary as body", () => {
  const prepared = prepareFeedItemStorage({
    sourceType: "product_hunt_top_products",
    body: "Product: Acme Launch\nTagline: Helps teams review launches.\nRank: #3\nMaker note: Built for workflow-heavy teams.",
    summary: "Structured product facts and summary.",
    rawJson: {
      html: "<main>raw product page</main>",
      comments: ["raw user comment"],
    },
  });

  assert.equal(prepared.policy.durableRawMode, "facts_only");
  assert.match(prepared.body, /^Product: Acme Launch/);
  assert.equal(prepared.rawRetained, true);
  assert.equal((prepared.rawJson as Record<string, unknown>).html, "[removed raw content]");
  assert.equal((prepared.rawJson as Record<string, unknown>).comments, "[removed raw content]");
});

test("durable body storage never falls back to summary when body is absent", () => {
  const prepared = prepareFeedItemStorage({
    sourceType: "product_hunt_top_products",
    body: "",
    summary: "Structured product facts and summary.",
    rawJson: {
      fetchTaskId: "task-empty-facts",
      html: "<main>raw product page</main>",
    },
  });

  assert.equal(prepared.policy.durableRawMode, "facts_only");
  assert.equal(prepared.body, "");
  assert.equal(prepared.rawRetained, false);
  assert.equal(((prepared.rawJson as Record<string, unknown>).rawContentPolicy as Record<string, unknown>).bodyStored, false);
});
