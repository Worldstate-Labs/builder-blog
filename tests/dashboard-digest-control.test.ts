import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("home digest keeps pipeline and history selection in a dedicated control bar", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");

  assert.match(dashboardPage, /function DigestControlBar/);
  assert.match(dashboardPage, /aria-label="AI Digest selection"/);
  assert.match(dashboardPage, /<DigestPipelineSelector/);
  assert.match(dashboardPage, /<DigestArchivePicker/);
  assert.match(dashboardPage, /AI Digest/);
  assert.match(dashboardPage, /History/);
  assert.doesNotMatch(dashboardPage, /Your digest/);
  assert.match(dashboardPage, /No saved issues/);
  assert.match(dashboardPage, /md:grid-cols-2/);
  assert.match(dashboardPage, /selectedDigestId=\{selectedDigest\?\.id \?\? null\}/);
  assert.doesNotMatch(dashboardPage, /headerAction=\{/);
});

test("home digest pipeline selector resets archive selection when changing pipelines", () => {
  const digestPipelineSelector = source("src/components/DigestPipelineSelector.tsx");

  assert.match(digestPipelineSelector, /const href = pipeline\.isOwnPipeline/);
  assert.match(digestPipelineSelector, /\? "\/dashboard\?tab=ai-digest"/);
  assert.match(digestPipelineSelector, /`\/dashboard\?tab=ai-digest&pipeline=\$\{pipeline\.id\}`/);
  assert.doesNotMatch(digestPipelineSelector, /&digest=\$\{digest/);
});

test("home digest pipeline selector labels the selected pipeline owner", () => {
  const digestPipelineSelector = source("src/components/DigestPipelineSelector.tsx");

  assert.match(digestPipelineSelector, /function pipelineOwnerLine/);
  assert.match(digestPipelineSelector, /pipeline\.isOwnPipeline \? "Your AI Digest" : pipeline\.ownerLabel/);
  assert.doesNotMatch(digestPipelineSelector, /Your digest/);
  assert.match(digestPipelineSelector, /options\.length <= 1[\s\S]*pipelineOwnerLine\(selectedPipeline\)/);
  assert.match(digestPipelineSelector, /<summary[\s\S]*pipelineOwnerLine\(selectedPipeline\)/);
  assert.match(digestPipelineSelector, /pipelineOwnerLine\(pipeline\)/);
});

test("home digest pipeline menu closes after a selection", () => {
  const digestPipelineSelector = source("src/components/DigestPipelineSelector.tsx");

  assert.match(digestPipelineSelector, /"use client"/);
  assert.match(digestPipelineSelector, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(digestPipelineSelector, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(digestPipelineSelector, /onClick=\{\(event\) => \{/);
  assert.match(digestPipelineSelector, /setOpen\(false\)/);
  assert.match(digestPipelineSelector, /if \(active\) event\.preventDefault\(\)/);
});

test("home digest prioritizes pipelines with content before ownership", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");

  assert.match(dashboardPage, /digest\.groupBy\(\{/);
  assert.match(dashboardPage, /itemCount:\s*\{\s*gt:\s*0\s*\}/);
  assert.match(dashboardPage, /hasDigestContentByOwnerId/);
  assert.match(dashboardPage, /hasContent:\s*hasDigestContentByOwnerId\.has\(userId\)/);
  assert.match(dashboardPage, /hasContent:\s*hasDigestContentByOwnerId\.has\(pipeline\.ownerUserId\)/);
  assert.match(dashboardPage, /\.sort\(compareDigestPipelinePriority\)/);
  assert.match(dashboardPage, /if \(a\.hasContent !== b\.hasContent\) return a\.hasContent \? -1 : 1/);
  assert.match(dashboardPage, /if \(a\.isOwnPipeline !== b\.isOwnPipeline\) return a\.isOwnPipeline \? -1 : 1/);
  assert.match(dashboardPage, /digestPipelineOptions\.find\(\(pipeline\) => pipeline\.id === pipelineId\)/);
});
