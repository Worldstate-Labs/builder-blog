import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("hub page exposes Source Library and AI Digests as subtabs", () => {
  const hubPage = source("src/app/(workspace)/library-hub/page.tsx");

  assert.match(hubPage, /type LibraryHubTab = "source-library" \| "ai-digests"/);
  assert.match(hubPage, /function LibraryHubSubtabs/);
  assert.match(hubPage, /aria-label="Hub sections"/);
  assert.match(hubPage, /role="tablist"/);
  assert.match(hubPage, />\s*Source Library\s*</);
  assert.match(hubPage, />\s*AI Digests\s*</);
  assert.match(hubPage, /href="\/library-hub"/);
  assert.match(hubPage, /href="\/library-hub\?tab=ai-digests"/);
  assert.match(hubPage, /selectedTab === "source-library"/);
  assert.match(hubPage, /parseHubTab/);
});
