import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("home loading tabs mirror final tab semantics without picking an active tab", () => {
  const loading = source("src/app/(workspace)/dashboard/loading.tsx");

  assert.match(loading, /aria-label="Home feed tabs"[\s\S]*role="tablist"/);
  assert.match(loading, /\["AI Digest", "Following", "Favorites"\]\.map/);
  assert.match(loading, /role="tab"/);
  assert.match(loading, /aria-disabled="true"/);
  assert.match(loading, /aria-selected="false"/);
  assert.match(loading, /tabIndex=\{-1\}/);
  assert.doesNotMatch(loading, /home-loading-tab is-active|data-active/);
  assert.match(loading, /className="ai-digest-stack home-loading-ai-digest"/);
  assert.match(loading, /className="digest-control-bar home-loading-control"/);
  assert.match(loading, /\["AI Digest archive source", "AI Digest archive"\]\.map/);
  assert.match(loading, /className="home-loading-digest-card"/);
  assert.doesNotMatch(loading, /className="feed-content-stack home-loading-content"|className="feed-skeleton-list"/);
});
