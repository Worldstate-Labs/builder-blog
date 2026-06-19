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
  const digestHeadlineSummary = source("src/components/DigestHeadlineSummary.tsx");
  const digestPipelineForm = source("src/components/DigestPipelineImportForm.tsx");
  const globals = source("src/app/globals.css");
  const fallbackBlock = buildersPage.match(
    /function DigestSourcesFallback\(\) \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";

  assert.match(buildersLoading, /Source syncing/);
  assert.match(buildersLoading, /className="sources-sync-section sources-sync-panel library-section-panel"/);
  assert.match(buildersLoading, /Your source library/);
  assert.match(buildersLoading, /Imported source libraries/);
  assert.match(buildersLoading, /className="your-library-panel library-section-panel"/);
  assert.match(buildersLoading, /className="source-section-skeleton-row"/);
  assert.match(buildersLoading, /className="source-section-skeleton-card"/);
  assert.doesNotMatch(buildersLoading, /<div className="source-sync-skeleton-panel" \/>\s*<div className="source-sync-skeleton-panel" \/>/);

  assert.match(fallbackBlock, /Your AI Digest collection/);
  assert.match(fallbackBlock, /Imported AI Digest collections/);
  assert.match(fallbackBlock, /className="your-digest-section your-digest-panel library-section-panel"/);
  assert.match(fallbackBlock, /className="imported-digest-section imported-digest-panel library-section-panel"/);
  assert.doesNotMatch(fallbackBlock, /Imported AI Digest issues/);
  assert.match(fallbackBlock, /aria-label="Loading your AI Digest collection"/);
  assert.match(fallbackBlock, /aria-label="Loading imported AI Digest collections"/);
  assert.doesNotMatch(fallbackBlock, /<div className="source-sync-skeleton-panel" \/>\s*<div className="source-sync-skeleton-panel" \/>/);

  assert.match(digestHeadlineSummary, /Latest headlines/);
  assert.doesNotMatch(digestHeadlineSummary, />Headlines</);
  assert.match(digestPipelineForm, /panel \? null : \(\s*<div className="hub-list-count-row at-desktop">/);
  assert.match(digestPipelineForm, /panel=\{panel\}/);
  assert.match(digestPipelineForm, /const description = panel \? null : digestPipelineCardDescription\(pipeline\)/);
  assert.match(digestPipelineForm, /const panelMeta = panel \? digestPipelinePanelMeta\(pipeline\) : null/);
  assert.match(digestPipelineForm, /className=\{panel \? "fb-hub-card-panel-meta" : "fb-hub-card-byline"\}/);
  assert.doesNotMatch(digestPipelineForm, /\{panel \? null : \(\s*<div className="fb-hub-card-stats">/);
  assert.match(digestPipelineForm, /<div className="fb-hub-card-stats">/);
  assert.match(digestPipelineForm, /function digestPipelinePanelMeta\(pipeline: HubDigestPipeline\)/);
  assert.match(digestPipelineForm, /return byline/);
  assert.doesNotMatch(digestPipelineForm, /\$\{formatCount\(pipeline\.digestCount\)\} \$\{issueLabel\}/);
  assert.match(globals, /\.fb-hub-card-panel-meta\s*{[\s\S]*font-size:\s*0\.75rem/);
});
