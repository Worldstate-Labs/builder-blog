import assert from "node:assert/strict";
import test from "node:test";
import { rankSearchDocuments } from "../src/lib/search";

test("search snippets prefer body matches when the title also matches", () => {
  const results = rankSearchDocuments({
    query: "agent memory",
    mode: "hybrid",
    documents: [
      {
        id: "snippet",
        type: "feed",
        title: "Agent memory launch notes",
        body: [
          "Opening context about teams, shipping, launches, operations, and product routines.",
          "More background about evaluation notes before the useful passage appears.",
          "The retrieval system keeps agent memory fresh across long-running work.",
        ].join(" "),
      },
    ],
  });

  assert.equal(results.length, 1);
  assert.match(results[0].snippet, /agent memory/i);
  assert.doesNotMatch(results[0].snippet, /^Opening context/);
});

test("search snippets fall back to the first body token match for non-phrase queries", () => {
  const results = rankSearchDocuments({
    query: "agent retrieval",
    mode: "hybrid",
    documents: [
      {
        id: "snippet",
        type: "feed",
        title: "Agent operating notes",
        body: [
          "Introductory setup text about launches and daily planning.",
          "Later in the article, retrieval quality becomes the central topic.",
        ].join(" "),
      },
    ],
  });

  assert.equal(results.length, 1);
  assert.match(results[0].snippet, /retrieval quality/i);
  assert.doesNotMatch(results[0].snippet, /^Introductory setup/);
});
