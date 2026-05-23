import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSearchQuery,
  rankSearchDocuments,
  searchHighlightTerms,
} from "../src/lib/search";

test("search parses plus-prefixed terms as required terms", () => {
  const parsed = parseSearchQuery("agent +retrieval -pricing");

  assert.equal(parsed.cleanQuery, "agent retrieval");
  assert.deepEqual(parsed.requiredOperatorTerms, ["retrieval"]);
  assert.deepEqual(parsed.excludedTerms, ["pricing"]);
});

test("search required terms filter hybrid semantic matches", () => {
  const results = rankSearchDocuments({
    query: "agent +retrieval",
    mode: "hybrid",
    documents: [
      {
        id: "required",
        type: "feed",
        title: "Agent launch",
        body: "The post explains retrieval quality for long-running agents.",
      },
      {
        id: "semantic-only",
        type: "feed",
        title: "Agent launch",
        body: "The post explains assistant memory without the required word.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["required"]);
});

test("search highlighting includes required terms without the plus syntax", () => {
  assert.deepEqual(searchHighlightTerms("agent +retrieval"), ["retrieval", "agent"]);
});
