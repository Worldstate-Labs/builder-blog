import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("Hub directly exposes source libraries without collection tabs", () => {
  const hubPage = source("src/app/(workspace)/library-hub/page.tsx");
  const hubLoading = source("src/app/(workspace)/library-hub/loading.tsx");

  for (const value of [hubPage, hubLoading]) {
    assert.doesNotMatch(value, /WorkspaceTabShell|WorkspaceTopTabs|role="tablist"/);
    assert.doesNotMatch(value, /AI Brief collections|ai-digests|Hub tabs/);
  }

  assert.match(hubPage, /LibraryHubImportForm/);
  assert.match(hubPage, /loadSourceLibraryHubPageData/);
  assert.match(hubPage, /ensureDefaultCommunityLibraryImport/);
  assert.doesNotMatch(hubPage, /DigestPipelineImportForm|digestPipelineShare|digestPipelineImport/);
  assert.match(hubLoading, /Loading source libraries/);
});
