import assert from "node:assert/strict";
import test from "node:test";
import { canonicalFetchTaskId } from "../src/lib/fetch-task-id";

test("canonical fetch task ids collapse encoded and decoded post URLs", () => {
  const encoded = "fetch_post:builder_1:BLOG_POST:https%3A%2F%2Fexample.com%2Fposts%2Fone%3Fa%3D1";
  const decoded = "fetch_post:builder_1:BLOG_POST:https://example.com/posts/one?a=1";

  assert.equal(canonicalFetchTaskId(encoded), encoded);
  assert.equal(canonicalFetchTaskId(decoded), encoded);
});

test("canonical fetch task ids preserve encoded percent literals and non-post ids", () => {
  assert.equal(
    canonicalFetchTaskId("fetch_post:builder_1:BLOG_POST:https%3A%2F%2Fexample.com%2F%252F"),
    "fetch_post:builder_1:BLOG_POST:https%3A%2F%2Fexample.com%2F%252F",
  );
  assert.equal(canonicalFetchTaskId("candidate_discovery:source:blog"), "candidate_discovery:source:blog");
});
