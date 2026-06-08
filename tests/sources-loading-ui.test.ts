import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("sources AI Digest loading state names the same sections as the loaded tab", () => {
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  const fallbackBlock = buildersPage.match(
    /function DigestSourcesFallback\(\) \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";

  assert.match(fallbackBlock, /Your AI Digest collection/);
  assert.match(fallbackBlock, /Imported AI Digest archives/);
  assert.match(fallbackBlock, /aria-label="Loading your AI Digest collection"/);
  assert.match(fallbackBlock, /aria-label="Loading imported AI Digest archives"/);
  assert.doesNotMatch(fallbackBlock, /<div className="source-sync-skeleton-panel" \/>\s*<div className="source-sync-skeleton-panel" \/>/);
});
