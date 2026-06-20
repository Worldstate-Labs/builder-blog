import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function cssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escapedSelector}\\s*{[^}]*}`))?.[0] ?? "";
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

  assert.match(digestHeadlineSummary, />Headlines</);
  assert.doesNotMatch(digestHeadlineSummary, /Latest headlines/);
  assert.match(digestPipelineForm, /panel \? null : \(\s*<div className="hub-list-count-row at-desktop">/);
  assert.match(digestPipelineForm, /panel=\{panel\}/);
  assert.doesNotMatch(digestPipelineForm, /digestPipelineCardDescription/);
  assert.doesNotMatch(digestPipelineForm, /className="fb-hub-card-byline"/);
  assert.doesNotMatch(digestPipelineForm, /<DigestPipelineByline ownerLabel=\{pipeline\.ownerLabel\}/);
  assert.doesNotMatch(digestPipelineForm, /\{panel \? null : \(\s*<div className="fb-hub-card-stats">/);
  assert.match(digestPipelineForm, /function DigestPipelineInfoCard/);
  assert.equal((digestPipelineForm.match(/<DigestPipelineInfoCard/g) ?? []).length, 2);
  assert.doesNotMatch(digestPipelineForm, /label=\{pipeline\.viewCount === 1 \? "view" : "views"\}/);
  assert.match(digestPipelineForm, /statsClassName="fb-hub-card-stats fb-hub-card-stats--with-owner"/);
  assert.match(digestPipelineForm, /className="fb-hub-card-owner"/);
  assert.match(digestPipelineForm, /by <UserName>\{digestPipelineOwnerName\(pipeline\.ownerLabel\)\}<\/UserName>/);
  assert.doesNotMatch(digestPipelineForm, /digestPipelinePanelMeta/);
  assert.doesNotMatch(digestPipelineForm, /fb-hub-card-panel-meta/);
  assert.doesNotMatch(digestPipelineForm, /\$\{formatCount\(pipeline\.digestCount\)\} \$\{issueLabel\}/);
  assert.match(globals, /\.fb-hub-card-stats--with-owner\s*{[\s\S]*gap:\s*0\.5rem 1rem/);
  assert.match(globals, /\.fb-hub-card-owner\s*{[\s\S]*margin-left:\s*auto/);
  assert.match(globals, /\.fb-user-name\s*{[\s\S]*border-radius:\s*999px/);
  assert.match(cssRule(globals, ".library-section-summary--static"), /grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(cssRule(globals, ".imported-digest-head"), /grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(cssRule(globals, ".digest-source-management .digest-pipeline-card .fb-hub-card-head"), /flex-wrap:\s*nowrap/);
  assert.match(globals, /@media \(max-width:\s*1023\.99px\)[\s\S]*\.your-digest-panel > \.library-section-summary--static\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(globals, /@media \(max-width:\s*1023\.99px\)[\s\S]*\.your-digest-panel > \.library-section-summary--static > \.hub-share-control,[\s\S]*\.your-digest-panel > \.library-section-summary--static > \.source-section-skeleton-chip\s*{[\s\S]*justify-self:\s*start/);
  assert.match(globals, /@media \(max-width:\s*1023\.99px\)[\s\S]*\.imported-libraries-head,\s*\.imported-digest-head\s*{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(globals, /@media \(max-width:\s*1023\.99px\)[\s\S]*\.digest-source-management \.digest-pipeline-card \.fb-hub-card-head\s*{[\s\S]*flex-direction:\s*column/);
  assert.match(globals, /@media \(max-width:\s*1023\.99px\)[\s\S]*\.digest-source-management \.digest-pipeline-card \.fb-hub-card-actions\s*{[\s\S]*justify-content:\s*flex-start[\s\S]*width:\s*100%/);
  const hubHeadlineKickerRule = cssRule(globals, ".fb-hub-digest-preview .digest-headline-kicker");
  assert.match(hubHeadlineKickerRule, /color:\s*var\(--ink\)/);
  assert.match(hubHeadlineKickerRule, /font-size:\s*0\.875rem/);
  assert.match(hubHeadlineKickerRule, /text-transform:\s*none/);
  assert.doesNotMatch(hubHeadlineKickerRule, /color:\s*var\(--accent\)|text-transform:\s*uppercase/);
});
