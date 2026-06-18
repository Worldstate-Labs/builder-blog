import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("hub page exposes Source libraries and AI Digest collections as subtabs", () => {
  const hubPage = source("src/app/(workspace)/library-hub/page.tsx");
  const topTabs = source("src/components/WorkspaceTopTabs.tsx");

  assert.match(hubPage, /type LibraryHubTab = "source-library" \| "ai-digests"/);
  assert.match(hubPage, /WorkspaceTopTabs/);
  assert.match(hubPage, /ariaLabel="Hub tabs"/);
  assert.doesNotMatch(hubPage, /ariaLabel="Hub sections"/);
  assert.match(topTabs, /role="tablist"/);
  assert.match(hubPage, /label:\s*"Source libraries"/);
  assert.match(hubPage, /label:\s*"AI Digest collections"/);
  assert.doesNotMatch(hubPage, /label:\s*"AI Digest issues"/);
  assert.doesNotMatch(hubPage, /label:\s*"AI Digests"/);
  assert.doesNotMatch(hubPage, /label:\s*"Digests"/);
  assert.match(hubPage, /label:\s*"Source libraries"[\s\S]*href:\s*"\/library-hub\?tab=source-library"/);
  assert.match(hubPage, /label:\s*"AI Digest collections"[\s\S]*href:\s*"\/library-hub\?tab=ai-digests"/);
  assert.match(hubPage, /panelId:\s*"hub-panel-source-library"/);
  assert.match(hubPage, /tabId:\s*"hub-tab-source-library"/);
  assert.match(hubPage, /panelId:\s*"hub-panel-ai-digests"/);
  assert.match(hubPage, /tabId:\s*"hub-tab-ai-digests"/);
  assert.match(hubPage, /const selectedTabItem = selectedHubTabItem\(selectedTab\)/);
  assert.match(hubPage, /aria-labelledby=\{selectedTabItem\.tabId\}/);
  assert.match(hubPage, /id=\{selectedTabItem\.panelId\}/);
  assert.match(hubPage, /role="tabpanel"/);
  assert.match(hubPage, /selectedValue=\{selectedTab\}/);
  assert.match(hubPage, /parseHubTab/);
  assert.match(hubPage, /function selectedHubTabItem/);
  assert.match(hubPage, /value === "ai-digests" \|\| value === "digests"/);
  assert.match(hubPage, /return "ai-digests"/);
});
