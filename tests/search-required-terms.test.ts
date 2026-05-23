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

test("search parses plus-prefixed quoted phrases as required phrases", () => {
  const parsed = parseSearchQuery('agent +"retrieval quality" -"pricing page"');

  assert.equal(parsed.cleanQuery, "agent retrieval quality");
  assert.deepEqual(parsed.requiredPhrases, ["retrieval quality"]);
  assert.deepEqual(parsed.requiredOperatorTerms, []);
  assert.deepEqual(parsed.excludedPhrases, ["pricing page"]);
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

test("search required phrases filter hybrid semantic matches", () => {
  const results = rankSearchDocuments({
    query: 'agent +"retrieval quality"',
    mode: "hybrid",
    documents: [
      {
        id: "required",
        type: "feed",
        title: "Agent launch",
        body: "The post explains retrieval quality for long-running agents.",
      },
      {
        id: "split",
        type: "feed",
        title: "Agent launch",
        body: "The post mentions retrieval work and quality checks separately.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["required"]);
});

test("search highlighting includes required terms without the plus syntax", () => {
  assert.deepEqual(searchHighlightTerms("agent +retrieval"), ["retrieval", "agent"]);
});

test("search highlighting includes required phrases without the plus syntax", () => {
  assert.deepEqual(searchHighlightTerms('agent +"retrieval quality"'), [
    "retrieval quality",
    "agent",
  ]);
});

test("search highlighting includes quoted OR phrases", () => {
  assert.deepEqual(searchHighlightTerms('"agent memory" OR "retrieval quality"'), [
    "retrieval quality",
    "agent memory",
  ]);
});
