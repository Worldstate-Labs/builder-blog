import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/BuilderFeedItems.tsx", import.meta.url),
  "utf8",
);

test("an open source feed reloads when workspace content changes", () => {
  assert.match(source, /contentSyncStateChanged/);
  assert.match(
    source,
    /window\.addEventListener\(contentSyncStateChanged,\s*refreshOpenFeed\)/,
  );
  assert.match(
    source,
    /window\.removeEventListener\(contentSyncStateChanged,\s*refreshOpenFeed\)/,
  );
  assert.match(source, /\[builderId, totalCount, isOpen, refreshVersion\]/);
});

test("a feed does not show an empty state while a refresh is in flight", () => {
  assert.match(source, /items\?\.length === 0 && !isLoading && !error/);
});
