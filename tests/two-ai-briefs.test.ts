import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("AI Brief is a fixed own and FollowBrief pair", () => {
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const pipelineCards = source("src/components/DigestPipelineImportForm.tsx");
  const selector = source("src/components/DigestPipelineSelectorView.tsx");
  const libraryHub = source("src/lib/library-hub.ts");

  assert.match(libraryHub, /adminCommunityDigestTitle = "FollowBrief AI Brief"/);
  assert.match(buildersPage, /title: "Your AI Brief"/);
  assert.match(buildersPage, /followBriefDigestPipeline/);
  assert.doesNotMatch(buildersPage, /DigestPipelineVisibilityToggle/);
  assert.doesNotMatch(buildersPage, /DigestPipelineImportForm mode="imported"/);
  assert.doesNotMatch(buildersPage, /digestPipelineShare\.findMany/);
  assert.doesNotMatch(buildersPage, /digestPipelineImport\.findMany/);
  assert.doesNotMatch(pipelineCards, /DigestPipelineTitleEditor/);
  assert.doesNotMatch(pipelineCards, /fetch\("\/api\/digest-pipelines/);

  assert.match(dashboardPage, /title: "Your AI Brief"/);
  assert.doesNotMatch(dashboardPage, /digestPipelineImport\.findMany/);
  assert.doesNotMatch(selector, /AI Brief collection/);
  assert.match(selector, /Your AI Brief/);
});

test("AI Brief page uses two direct cards without collection panels", () => {
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");

  assert.match(buildersPage, /className="digest-source-management digest-brief-list"/);
  assert.match(buildersPage, /<OwnDigestPipelineUpdatesCard/);
  assert.match(buildersPage, /<FollowBriefDigestPipelineCard/);
  assert.doesNotMatch(buildersPage, /Your AI Brief collection/);
  assert.doesNotMatch(buildersPage, /Imported AI Brief collections/);
  assert.doesNotMatch(buildersPage, /your-digest-panel library-section-panel/);
  assert.doesNotMatch(buildersPage, /imported-digest-panel library-section-panel/);
});

test("Hub is source-library-only and Brief mutations are unavailable", () => {
  const hubPage = source("src/app/(workspace)/library-hub/page.tsx");
  const hubLoading = source("src/app/(workspace)/library-hub/loading.tsx");
  const shareRoute = source("src/app/api/digest-pipelines/share/route.ts");
  const importRoute = source("src/app/api/digest-pipelines/imports/route.ts");
  const removeRoute = source("src/app/api/digest-pipelines/imports/[pipelineId]/route.ts");

  for (const value of [hubPage, hubLoading]) {
    assert.doesNotMatch(value, /WorkspaceTabShell|WorkspaceTopTabs|Hub tabs/);
    assert.doesNotMatch(value, /AI Brief collections|ai-digests/);
  }
  assert.match(hubPage, /LibraryHubImportForm/);

  for (const route of [shareRoute, importRoute, removeRoute]) {
    assert.match(route, /status:\s*404/);
    assert.doesNotMatch(route, /shareDigestPipelineToHub|updateDigestPipelineTitle|unshareDigestPipelineFromHub|importDigestPipelineFromHub|removeDigestPipelineImportFromHub/);
  }
});
