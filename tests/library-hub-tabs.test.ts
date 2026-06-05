import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("hub page exposes Source Library and Digests as subtabs", () => {
  const hubPage = source("src/app/(workspace)/library-hub/page.tsx");
  const topTabs = source("src/components/WorkspaceTopTabs.tsx");

  assert.match(hubPage, /type LibraryHubTab = "source-library" \| "ai-digests"/);
  assert.match(hubPage, /WorkspaceTopTabs/);
  assert.match(hubPage, /ariaLabel="Hub sections"/);
  assert.match(topTabs, /role="tablist"/);
  assert.match(hubPage, /label:\s*"Source Library"/);
  assert.match(hubPage, /label:\s*"Digests"/);
  assert.doesNotMatch(hubPage, /label:\s*"AI Digests"/);
  assert.match(hubPage, /label:\s*"Source Library"[\s\S]*href:\s*"\/library-hub"/);
  assert.match(hubPage, /label:\s*"Digests"[\s\S]*href:\s*"\/library-hub\?tab=ai-digests"/);
  assert.match(hubPage, /selectedValue=\{selectedTab\}/);
  assert.match(hubPage, /parseHubTab/);
});
