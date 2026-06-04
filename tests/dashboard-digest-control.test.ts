import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("home digest keeps pipeline and issue selection in a dedicated control bar", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");

  assert.match(dashboardPage, /function DigestControlBar/);
  assert.match(dashboardPage, /aria-label="Digest selection"/);
  assert.match(dashboardPage, /<DigestPipelineSelector/);
  assert.match(dashboardPage, /<DigestArchivePicker/);
  assert.match(dashboardPage, /Digest/);
  assert.match(dashboardPage, /Issue/);
  assert.match(dashboardPage, /Read-only/);
  assert.match(dashboardPage, /No saved issues/);
  assert.match(dashboardPage, /selectedDigestId=\{selectedDigest\?\.id \?\? null\}/);
  assert.doesNotMatch(dashboardPage, /headerAction=\{/);
});

test("home digest pipeline selector resets archive selection when changing pipelines", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");

  assert.match(dashboardPage, /const href = pipeline\.isOwnPipeline/);
  assert.match(dashboardPage, /\? "\/dashboard\?tab=ai-digest"/);
  assert.match(dashboardPage, /`\/dashboard\?tab=ai-digest&pipeline=\$\{pipeline\.id\}`/);
  assert.doesNotMatch(dashboardPage, /&digest=\$\{digest/);
});
