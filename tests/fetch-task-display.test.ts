import assert from "node:assert/strict";
import test from "node:test";

import { fetchTaskDisplayLabel } from "../src/lib/fetch-task-display";

test("fetch task labels prefer title, then a compact URL, then decoded task identity", () => {
  assert.equal(
    fetchTaskDisplayLabel({
      id: "fetch_post:builder:BLOG_POST:https%3A%2F%2Fexample.com%2Ffallback",
      title: "  Human title  ",
      url: "https://example.com/ignored",
    }),
    "Human title",
  );
  assert.equal(
    fetchTaskDisplayLabel({
      id: "post_2",
      title: null,
      url: "https://example.com/research/agent-systems?utm_source=test",
    }),
    "example.com/research/agent-systems",
  );
  assert.equal(
    fetchTaskDisplayLabel({
      id: "fetch_post:builder:BLOG_POST:https%3A%2F%2Fexample.com%2Fdecoded-post",
      title: null,
      url: null,
    }),
    "example.com/decoded-post",
  );
});

test("fetch task labels use a stable post id instead of Untitled task", () => {
  assert.equal(
    fetchTaskDisplayLabel({ id: "opaque-task-1234567890", title: null, url: null }),
    "Post 34567890",
  );
});
