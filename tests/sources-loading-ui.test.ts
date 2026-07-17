import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("Sources loading states mirror the loaded source and user-Brief surfaces", () => {
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  const buildersLoading = source("src/app/(workspace)/builders/loading.tsx");
  const digestHeadlineSummary = source("src/components/DigestHeadlineSummary.tsx");
  const digestPipelineCards = source("src/components/DigestPipelineImportForm.tsx");
  const globals = source("src/app/globals.css");
  const fallbackBlock = buildersPage.match(
    /function DigestSourcesFallback\(\) \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";

  assert.match(buildersLoading, /Source syncing/);
  assert.match(buildersLoading, /Your source library/);
  assert.match(buildersLoading, /Imported source libraries/);
  assert.match(buildersLoading, /className="your-library-panel library-section-panel"/);
  assert.match(buildersLoading, /className="source-section-skeleton-row"/);

  assert.match(fallbackBlock, /className="own-digest-card"/);
  assert.match(fallbackBlock, /Loading AI Brief controls/);
  assert.doesNotMatch(fallbackBlock, /FollowBrief AI Brief/);
  assert.match(fallbackBlock, /digest-brief-list/);
  assert.equal((fallbackBlock.match(/<article/g) ?? []).length, 1);
  assert.doesNotMatch(fallbackBlock, /AI Brief collection|Imported AI Brief/);
  assert.doesNotMatch(fallbackBlock, /library-section-panel/);

  assert.match(digestPipelineCards, /function DigestPipelineInfoCard/);
  assert.doesNotMatch(digestPipelineCards, /FollowBriefDigestPipelineCard/);
  assert.match(digestPipelineCards, /OwnDigestPipelineCard/);
  assert.doesNotMatch(digestPipelineCards, /DigestPipelineTitleEditor|Import|Remove import|fetch\(/);
  assert.match(digestPipelineCards, /pipeline\.digestCount === 1 \? "issue" : "issues"/);
  assert.match(digestHeadlineSummary, />Headlines</);
  assert.match(globals, /\.digest-source-management\s*\{[\s\S]*gap:\s*1\.25rem/);
});
