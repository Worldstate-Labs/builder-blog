import assert from "node:assert/strict";
import test from "node:test";
import { decodeHtmlEntities } from "../src/lib/decode-entities";

test("decodes the hex apostrophe the model emits", () => {
  assert.equal(decodeHtmlEntities("we&#x27;d have rejected"), "we'd have rejected");
});

test("decodes decimal and named entities", () => {
  assert.equal(decodeHtmlEntities("a &#39;b&#39; &amp; &quot;c&quot;"), "a 'b' & \"c\"");
  assert.equal(decodeHtmlEntities("rock &amp; roll"), "rock & roll");
});

test("decodes curly punctuation references", () => {
  assert.equal(decodeHtmlEntities("don&rsquo;t &mdash; really"), "don’t — really");
});

test("leaves plain text and unknown tokens untouched", () => {
  assert.equal(decodeHtmlEntities("no entities here"), "no entities here");
  assert.equal(decodeHtmlEntities("Q&A about &notanentity;"), "Q&A about &notanentity;");
  assert.equal(decodeHtmlEntities(""), "");
});

test("ignores out-of-range numeric references", () => {
  assert.equal(decodeHtmlEntities("&#0; &#1114112;"), "&#0; &#1114112;");
});
