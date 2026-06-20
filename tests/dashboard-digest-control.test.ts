import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("home digest keeps collection and issue selection in a dedicated control bar", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const digestArchivePicker = source("src/components/DigestArchivePickerView.tsx");
  const digestPipelineSelector = source("src/components/DigestPipelineSelectorView.tsx");
  const globals = source("src/app/globals.css");

  assert.match(dashboardPage, /function DigestControlBar/);
  assert.match(dashboardPage, /aria-label="AI Digest collection and issue selection"/);
  assert.match(dashboardPage, /className="digest-control-bar"/);
  assert.match(dashboardPage, /className="digest-control-field"/);
  assert.match(dashboardPage, /className="digest-control-label"/);
  assert.match(dashboardPage, /className="digest-control-picker"/);
  assert.match(dashboardPage, /className="digest-control-empty"/);
  assert.match(dashboardPage, /<DigestPipelineSelector/);
  assert.match(dashboardPage, /<DigestArchivePicker/);
  assert.match(dashboardPage, />\s*AI Digest collection\s*<\/span>/);
  assert.match(dashboardPage, />\s*AI Digest issue\s*<\/span>/);
  assert.doesNotMatch(dashboardPage, /aria-label="AI Digest selection"/);
  assert.doesNotMatch(dashboardPage, /Your digest/);
  assert.match(dashboardPage, /No AI Digest issues/);
  assert.doesNotMatch(dashboardPage, />\s*No AI Digest archives\s*<\/span>/);
  assert.doesNotMatch(dashboardPage, /No archived AI Digests/);
  assert.match(globals, /\.digest-control-bar\s*{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(digestPipelineSelector, /className="digest-pipeline-selector"/);
  assert.match(digestPipelineSelector, /className="digest-pipeline-trigger"/);
  assert.match(digestPipelineSelector, /className="digest-pipeline-static"/);
  assert.match(digestPipelineSelector, /className="digest-pipeline-menu"/);
  assert.match(digestPipelineSelector, /aria-expanded=\{open\}/);
  assert.match(digestPipelineSelector, /aria-controls=\{menuId\}/);
  assert.match(digestPipelineSelector, /aria-haspopup="listbox"/);
  assert.match(digestPipelineSelector, /role="listbox"/);
  assert.match(digestPipelineSelector, /aria-label="AI Digest collections"/);
  assert.doesNotMatch(digestPipelineSelector, /aria-label="AI Digest choices"|aria-label="AI Digest sources"/);
  assert.match(digestPipelineSelector, /className="digest-pipeline-option"/);
  assert.match(digestPipelineSelector, /role="option"/);
  assert.match(digestPipelineSelector, /aria-selected=\{active\}/);
  assert.match(digestPipelineSelector, /onKeyDown=\{handlePickerKeyDown\}/);
  assert.match(digestPipelineSelector, /event\.key === "Escape"/);
  assert.match(digestPipelineSelector, /const pickerNavigationKeys = new Set\(\["ArrowDown", "ArrowUp", "Home", "End"\]\)/);
  assert.match(digestPipelineSelector, /pickerNavigationKeys\.has\(event\.key\)/);
  assert.match(digestPipelineSelector, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*focusOption\(initialFocusDirectionForKey\(event\.key\)\)/);
  assert.match(digestPipelineSelector, /focusOption\(focusDirectionForKey\(event\.key\)\)/);
  assert.match(digestPipelineSelector, /function initialFocusDirectionForKey\(key: string\)/);
  assert.match(digestPipelineSelector, /function focusDirectionForKey\(key: string\)/);
  assert.match(digestPipelineSelector, /summaryRef\.current\?\.focus\(\)/);
  assert.match(digestPipelineSelector, /data-active=\{active \? "true" : undefined\}/);
  assert.match(digestArchivePicker, /digests\.length <= 1[\s\S]*className="digest-picker-static"/);
  assert.match(digestArchivePicker, /aria-label=\{`AI Digest issue: \$\{selectedLabel\}`\}/);
  assert.match(digestArchivePicker, /aria-label=\{`Choose AI Digest issue, current: \$\{selectedLabel\}`\}/);
  assert.match(digestArchivePicker, /const pickerNavigationKeys = new Set\(\["ArrowDown", "ArrowUp", "Home", "End"\]\)/);
  assert.match(digestArchivePicker, /focusOption\(focusDirectionForKey\(event\.key\)\)/);
  assert.match(digestArchivePicker, /role="listbox" aria-label="AI Digest issues"/);
  assert.match(digestArchivePicker, /issueNumber: number/);
  assert.match(digestArchivePicker, /itemCount: number/);
  assert.match(digestArchivePicker, /Issue #\{digest\.issueNumber\}/);
  assert.match(digestArchivePicker, /className="digest-picker-subtitle"/);
  assert.match(digestArchivePicker, /from \{digest\.itemCount\} \{digest\.itemCount === 1 \? "post" : "posts"\}/);
  assert.doesNotMatch(digestArchivePicker, /CountMeta/);
  assert.match(dashboardPage, /selectedDigestIssueCount/);
  assert.match(dashboardPage, /serializeDigestArchiveOption\(digest, digestIssueCount - index\)/);
  assert.match(dashboardPage, /itemCount:\s*digest\.itemCount/);
  assert.match(globals, /\.digest-pipeline-trigger\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(globals, /\.digest-picker-subtitle\s*{[\s\S]*color:\s*var\(--muted\)/);
  assert.match(globals, /\.digest-control-picker \.digest-picker-summary,[\s\S]*\.digest-control-picker \.digest-picker-static\s*{[\s\S]*min-height:\s*2\.5rem/);
  assert.match(globals, /\.digest-pipeline-option\[data-active="true"\]/);
  assert.doesNotMatch(dashboardPage, /rounded-\[8px\]|md:grid-cols-2|\[&_\.digest-picker/);
  assert.doesNotMatch(digestPipelineSelector, /rounded-\[|grid-cols-\[|text-\[var|font-\[|shadow-\[|min-h-10|px-3|py-2|h-3\.5|w-3\.5/);
  assert.match(dashboardPage, /selectedDigestId=\{selectedDigest\?\.id \?\? null\}/);
  assert.doesNotMatch(dashboardPage, /headerAction=\{/);
});

test("home digest pipeline selector resets issue selection when changing collections", () => {
  const digestPipelineSelector = source("src/components/DigestPipelineSelectorView.tsx");
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");

  assert.match(digestPipelineSelector, /const href = `\/dashboard\?tab=ai-digest&pipeline=\$\{pipeline\.id\}`/);
  assert.match(dashboardPage, /id: "own"/);
  assert.doesNotMatch(digestPipelineSelector, /pipeline\.isOwnPipeline[\s\S]{0,120}"\/dashboard\?tab=ai-digest"/);
  assert.match(digestPipelineSelector, /`\/dashboard\?tab=ai-digest&pipeline=\$\{pipeline\.id\}`/);
  assert.doesNotMatch(digestPipelineSelector, /&digest=\$\{digest/);
});

test("home digest issue selector preserves explicit own collection selection", () => {
  const digestArchivePicker = source("src/components/DigestArchivePickerView.tsx");

  assert.match(digestArchivePicker, /function digestHref/);
  assert.match(digestArchivePicker, /params\.set\("pipeline", selectedPipelineId\)/);
  assert.doesNotMatch(digestArchivePicker, /if \(!isOwnPipeline\) params\.set\("pipeline", selectedPipelineId\)/);
});

test("home digest pipeline selector labels the selected pipeline owner", () => {
  const digestPipelineSelector = source("src/components/DigestPipelineSelectorView.tsx");

  assert.match(digestPipelineSelector, /function PipelineOwnerLine/);
  assert.match(digestPipelineSelector, /function pipelineOwnerLine/);
  assert.match(digestPipelineSelector, /pipeline\.isOwnPipeline \? "Your AI Digest collection" : `by \$\{pipeline\.ownerLabel\}`/);
  assert.match(digestPipelineSelector, /by <UserName>\{pipeline\.ownerLabel\}<\/UserName>/);
  assert.doesNotMatch(digestPipelineSelector, /Shared by <UserName>\{pipeline\.ownerLabel\}<\/UserName>/);
  assert.doesNotMatch(digestPipelineSelector, /Your digest|Your AI Digest" :/);
  assert.doesNotMatch(digestPipelineSelector, /: pipeline\.ownerLabel/);
  assert.doesNotMatch(digestPipelineSelector, /Shared by Shared by/);
  assert.match(digestPipelineSelector, /options\.length <= 1[\s\S]*<PipelineOwnerLine pipeline=\{selectedPipeline\}/);
  assert.match(digestPipelineSelector, /<summary[\s\S]*<PipelineOwnerLine pipeline=\{selectedPipeline\}/);
  assert.match(digestPipelineSelector, /<PipelineOwnerLine pipeline=\{pipeline\}/);
});

test("home digest pipeline menu closes after a selection", () => {
  const digestPipelineSelector = source("src/components/DigestPipelineSelectorView.tsx");

  assert.match(digestPipelineSelector, /"use client"/);
  assert.match(digestPipelineSelector, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(digestPipelineSelector, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(digestPipelineSelector, /function handlePickerKeyDown/);
  assert.match(digestPipelineSelector, /function focusOption/);
  assert.match(digestPipelineSelector, /querySelectorAll<HTMLAnchorElement>\("\.digest-pipeline-option"\)/);
  assert.match(digestPipelineSelector, /option\.getAttribute\("aria-selected"\) === "true"/);
  assert.match(digestPipelineSelector, /event\.preventDefault\(\)/);
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
