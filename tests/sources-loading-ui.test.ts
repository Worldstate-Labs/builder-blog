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
  const buildersLoading = source("src/app/(workspace)/builders/loading.tsx");
  const fallbackBlock = buildersPage.match(
    /function DigestSourcesFallback\(\) \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";

  assert.match(buildersLoading, /Your source library/);
  assert.match(buildersLoading, /Imported source libraries/);
  assert.match(buildersLoading, /className="your-library-panel library-section-panel"/);
  assert.match(buildersLoading, /className="source-section-skeleton-row"/);
  assert.match(buildersLoading, /className="source-section-skeleton-card"/);
  assert.doesNotMatch(buildersLoading, /<div className="source-sync-skeleton-panel" \/>\s*<div className="source-sync-skeleton-panel" \/>/);

  assert.match(fallbackBlock, /Your AI Digest collection/);
  assert.match(fallbackBlock, /Imported AI Digest collections/);
  assert.doesNotMatch(fallbackBlock, /Imported AI Digest issues/);
  assert.match(fallbackBlock, /aria-label="Loading your AI Digest collection"/);
  assert.match(fallbackBlock, /aria-label="Loading imported AI Digest collections"/);
  assert.doesNotMatch(fallbackBlock, /<div className="source-sync-skeleton-panel" \/>\s*<div className="source-sync-skeleton-panel" \/>/);
});
