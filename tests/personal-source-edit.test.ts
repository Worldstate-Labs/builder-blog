import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { editableSourceIdentityChanged } from "../src/lib/personal-source-edit";

const PERSONAL_PATCH_ROUTE = readFileSync(
  "src/app/api/builders/[builderId]/personal/route.ts",
  "utf8",
);

test("editable source identity ignores probe-derived fetch URL changes", () => {
  assert.equal(
    editableSourceIdentityChanged(
      {
        sourceType: "blog",
        sourceUrl: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
        fetchUrl: null,
        handle: null,
      },
      {
        sourceType: "blog",
        sourceUrl: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
        fetchUrl: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
        handle: null,
      },
    ),
    false,
  );
});

test("editable source identity changes when the user-editable URL changes", () => {
  assert.equal(
    editableSourceIdentityChanged(
      {
        sourceType: "blog",
        sourceUrl: "https://example.com/feed.xml",
        fetchUrl: "https://example.com/feed.xml",
        handle: null,
      },
      {
        sourceType: "blog",
        sourceUrl: "https://example.com/other.xml",
        fetchUrl: "https://example.com/other.xml",
        handle: null,
      },
    ),
    true,
  );
});

test("editable source identity compares handles instead of canonicalized handle URLs", () => {
  assert.equal(
    editableSourceIdentityChanged(
      {
        sourceType: "x",
        sourceUrl: "https://twitter.com/cnbc",
        fetchUrl: null,
        handle: "cnbc",
      },
      {
        sourceType: "x",
        sourceUrl: "https://x.com/cnbc",
        fetchUrl: null,
        handle: "cnbc",
      },
    ),
    false,
  );
});

test("personal source patch confirmation uses editable identity, not probe fetch URL", () => {
  assert.match(PERSONAL_PATCH_ROUTE, /editableSourceIdentityChanged\(existing,/);
  assert.doesNotMatch(
    PERSONAL_PATCH_ROUTE,
    /finalFetchUrl\s*!==\s*\(existing\.fetchUrl\s*\?\?\s*null\)/,
  );
});
