import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("home loading tabs mirror the default AI Digest tab without becoming interactive", () => {
  const loading = source("src/app/(workspace)/dashboard/loading.tsx");

  assert.match(loading, /aria-label="Today feed tabs"[\s\S]*role="tablist"/);
  assert.doesNotMatch(loading, /Loading Home|Home feed tabs|Loading Home content/);
  assert.match(loading, /id:\s*"tabs\.aiDigest" as const,\s*selected:\s*true/);
  assert.match(loading, /id:\s*"tabs\.following" as const,\s*selected:\s*false/);
  assert.match(loading, /id:\s*"tabs\.favorites" as const,\s*selected:\s*false/);
  assert.match(loading, /<I18nText id=\{id\} \/>/);
  assert.match(loading, /role="tab"/);
  assert.match(loading, /aria-disabled="true"/);
  assert.match(loading, /aria-selected=\{selected\}/);
  assert.match(loading, /tabIndex=\{-1\}/);
  assert.doesNotMatch(loading, /home-loading-tab is-active|data-active/);
  assert.match(loading, /className="ai-digest-stack home-loading-ai-digest"/);
  assert.match(loading, /className="digest-control-bar home-loading-control"/);
  assert.match(loading, /id:\s*"tabs\.aiDigestCollection" as const/);
  assert.match(loading, /id:\s*"tabs\.aiDigestIssue" as const/);
  assert.match(loading, /className="home-loading-digest-card"/);
  assert.doesNotMatch(loading, /className="feed-content-stack home-loading-content"|className="feed-skeleton-list"/);
});
