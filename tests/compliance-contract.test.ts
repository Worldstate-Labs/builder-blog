import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function assertFile(path: string) {
  assert.ok(existsSync(join(root, path)), `Expected ${path} to exist`);
  return source(path);
}

test("public legal pages disclose privacy, terms, AI, third-party, sharing, and rights", () => {
  const privacyPage = assertFile("src/app/privacy/page.tsx");
  const termsPage = assertFile("src/app/terms/page.tsx");
  const legalPage = assertFile("src/components/LegalPage.tsx");
  const legalCopy = assertFile("src/lib/legal-pages.ts");
  const globals = source("src/app/globals.css");
  const loginPage = source("src/app/login/page.tsx");
  const i18n = source("src/lib/i18n.ts");
  const publicHeader = source("src/components/PublicHeader.tsx");
  const userMenu = source("src/components/UserMenu.tsx");
  const privacyContract = `${privacyPage}\n${legalCopy}`;
  const termsContract = `${termsPage}\n${legalCopy}`;
  const loginContract = `${loginPage}\n${i18n}`;

  for (const page of [privacyPage, termsPage]) {
    const pageContract = `${page}\n${legalCopy}`;
    assert.match(pageContract, /FollowBrief/);
    assert.match(pageContract, /Privacy|Terms/);
    assert.match(page, /getCurrentSession\(\)/);
    assert.match(page, /<PublicHeader current="(?:privacy|terms)" session=\{session\} \/>/);
    assert.match(page, /<LegalPage/);
  }

  assert.match(legalPage, /className="legal-page-shell"/);
  assert.match(legalPage, /className="legal-toc"/);
  assert.match(legalPage, /href=\{`#\$\{block\.id\}`\}/);
  assert.match(legalPage, /className="legal-section"/);
  assert.match(globals, /\.legal-page-shell/);
  assert.match(globals, /\.legal-toc/);
  assert.match(globals, /\.legal-document/);
  assert.match(globals, /\.legal-section/);

  assert.match(privacyContract, /OAuth profile|email|read history|favorites|access keys|IP address|User-Agent/);
  assert.match(privacyContract, /Local Agent|AI Brief|summar/i);
  assert.match(privacyContract, /temporarily process crawled source content|source type policy/i);
  assert.match(privacyContract, /Google|GitHub|Apple|X|YouTube|Product Hunt|OpenAI/);
  assert.match(privacyContract, /access|export|correct|delete/);
  assert.match(privacyContract, /retention|retain|delete/i);
  assert.match(privacyContract, /Hub|source librar/);
  assert.doesNotMatch(privacyContract, /share source libraries or AI Brief collections|share a source library or AI Brief collection/);
  assert.match(privacyContract, /Your AI Brief[^.]*not published to Hub/);
  assert.match(privacyContract, /legalUpdatedDate = "July 16, 2026"/);
  assert.match(privacyContract, /Last updated:\s*\$\{legalUpdatedDate\}/);
  assert.match(privacyContract, /legal@worldstatelabs\.com/);
  assert.doesNotMatch(privacyContract, /jie@worldstatelabs\.com/);
  assert.match(privacyContract, /operated by Worldstate Labs/);
  assert.match(privacyContract, /Account and identity data|Content and source data|Usage, device, and diagnostic data/);
  assert.match(privacyContract, /OAuth providers|hosting, database, security, observability, AI, crawler, and agent runtime providers/i);
  assert.match(privacyContract, /provider terms and settings|workflow you configure/i);
  assert.match(privacyContract, /recent operational run logs/i);
  assert.match(privacyContract, /We do not sell personal information|cross-context behavioral advertising/i);
  assert.match(privacyContract, /We use session cookies|authentication/i);
  assert.match(privacyContract, /not intended for children under 13/i);
  assert.match(privacyContract, /AI summaries and recommendations are assistive|not used to make legal, financial, employment, housing, credit, health, or insurance decisions/i);
  assert.match(privacyContract, /account export|account deletion|correct|object|restrict|portability/i);
  assert.match(privacyContract, /operational backups and security logs/i);
  assert.match(privacyContract, /legal@worldstatelabs\.com/);
  assert.doesNotMatch(privacyContract, /only as long as needed/i);

  assert.match(termsContract, /third-party sources|third-party APIs|platform terms/i);
  assert.match(termsContract, /private, paywalled, access-controlled|durable raw retention|Source owners/i);
  assert.match(termsContract, /Local Agent|access key|AI Brief/);
  assert.match(termsContract, /Do not|must not/i);
  assert.match(termsContract, /legalUpdatedDate = "July 16, 2026"/);
  assert.match(termsContract, /Last updated:\s*\$\{legalUpdatedDate\}/);
  assert.match(termsContract, /legal@worldstatelabs\.com/);
  assert.doesNotMatch(termsContract, /jie@worldstatelabs\.com/);
  assert.match(termsContract, /operated by Worldstate Labs/);
  assert.match(termsContract, /You must be able to form a binding contract/i);
  assert.match(termsContract, /You are responsible for keeping your account, devices, Local Agent files, and access keys secure/i);
  assert.match(termsContract, /Do not use FollowBrief to scrape private areas|bypass paywalls|violate robots/i);
  assert.match(termsContract, /transcription or speech-to-text tools|local or hosted agent runtimes/i);
  assert.match(termsContract, /recent operational run logs/i);
  assert.match(termsContract, /No professional advice|AS IS|AS AVAILABLE|Limitation of liability/i);
  assert.match(termsContract, /suspend or terminate access/i);
  assert.match(termsContract, /material changes/i);
  assert.match(termsContract, /governed by the laws of California/i);
  assert.match(loginContract, /login\.agreementPrefix": "By signing in, you agree to and acknowledge the"/);
  assert.match(loginContract, /href="\/privacy"[\s\S]*href="\/terms"/);

  for (const surface of [publicHeader, userMenu]) {
    assert.match(surface, /href="\/privacy"/);
    assert.match(surface, /href="\/terms"/);
  }
});

test("settings exposes account data export and deletion controls backed by scoped APIs", () => {
  const settingsPage = source("src/app/(workspace)/settings/page.tsx");
  const accountPanel = assertFile("src/components/AccountDataPanel.tsx");
  const exportRoute = assertFile("src/app/api/account/export/route.ts");
  const deleteRoute = assertFile("src/app/api/account/delete/route.ts");

  assert.match(settingsPage, /AccountDataPanel/);
  assert.match(accountPanel, /Export account data/);
  assert.match(accountPanel, /Delete account/);
  assert.match(accountPanel, /useI18n/);
  assert.match(accountPanel, /translateUiPhrase/);
  assert.match(accountPanel, /\/api\/account\/export/);
  assert.match(accountPanel, /\/api\/account\/delete/);
  assert.match(accountPanel, /DELETE/);
  assert.doesNotMatch(accountPanel, /signOut/);
  assert.match(accountPanel, /window\.location\.replace\("\/"\)/);

  assert.match(exportRoute, /getCurrentSession\(\)/);
  assert.match(exportRoute, /session\.user\.id/);
  assert.match(exportRoute, /"content-disposition"/i);
  assert.match(exportRoute, /tokenCiphertext:\s*false|omitSecretFields|serializeSafeAccountExport/);
  assert.doesNotMatch(exportRoute, /access_token:\s*true|refresh_token:\s*true|id_token:\s*true|tokenValue:\s*true|tokenCiphertext:\s*true/);

  assert.match(deleteRoute, /getCurrentSession\(\)/);
  assert.match(deleteRoute, /session\.user\.id/);
  assert.match(deleteRoute, /feedItem\.deleteMany/);
  assert.match(deleteRoute, /user\.delete/);
  assert.match(deleteRoute, /session-token/);
  assert.match(deleteRoute, /maxAge:\s*0/);
});

test("account API resets only session-owned generated fetch and brief state", () => {
  const routePath = join(root, "src/app/api/account/generated-data/reset/route.ts");
  const oldRoutePath = join(root, "src/app/api/admin/maintenance/fetch-digest-reset/route.ts");
  const route = assertFile("src/app/api/account/generated-data/reset/route.ts");
  const handler = assertFile("src/lib/account-generated-data-reset-route.ts");
  const helper = assertFile("src/lib/fetch-digest-reset.ts");

  assert.equal(existsSync(routePath), true);
  assert.equal(existsSync(oldRoutePath), false);
  assert.match(route, /createAccountGeneratedDataResetPost\(\)/);
  assert.doesNotMatch(route, /isAdminEmail|userId|email|scope/);
  assert.match(handler, /getCurrentSession/);
  assert.match(handler, /const userId = session\?\.user\?\.id/);
  assert.match(handler, /dependencies\.reset\(userId\)/);
  assert.match(handler, /confirmation[\s\S]*RESET/);

  assert.match(helper, /resetUserFetchDigestState/);
  assert.match(helper, /feedItem\.deleteMany\([\s\S]*ownerUserId: normalizedUserId/);
  assert.match(helper, /libraryFetchRun\.deleteMany\([\s\S]*userId: normalizedUserId/);
  assert.match(helper, /digestRun\.deleteMany\([\s\S]*userId: normalizedUserId/);
  assert.match(helper, /digest\.deleteMany\([\s\S]*userId: normalizedUserId/);
  assert.match(helper, /digestedItem\.deleteMany\([\s\S]*userId: normalizedUserId/);
  assert.match(helper, /agentJobRun\.deleteMany\([\s\S]*userId: normalizedUserId[\s\S]*FETCH_DIGEST_JOB_TYPES/);
  assert.doesNotMatch(helper, /cloudFetch|cloudSource|cloudLanguage|user\.count/);
});

test("every authenticated account sees a personal generated-data reset panel", () => {
  const settingsPage = source("src/app/(workspace)/settings/page.tsx");
  const panel = assertFile("src/components/GeneratedDataResetPanel.tsx");

  assert.equal(existsSync(join(root, "src/components/AdminMaintenancePanel.tsx")), false);
  assert.match(settingsPage, /<GeneratedDataResetPanel \/>/);
  assert.doesNotMatch(settingsPage, /isAdmin \? <GeneratedDataResetPanel \/>/);
  assert.match(panel, /Generated data/);
  assert.match(panel, /Reset fetch and AI Brief data/);
  assert.match(panel, /\/api\/account\/generated-data\/reset/);
  assert.match(panel, /contentSyncStateChanged/);
  assert.match(panel, /window\.dispatchEvent\(new Event\(contentSyncStateChanged\)\)/);
  assert.match(panel, /useI18n/);
  assert.match(panel, /translateUiPhrase/);
  assert.doesNotMatch(panel, /Admin maintenance|every user|all fetch|Cloud work|deletedCloud|users:/);
});

test("official worker writes share the durable reset fence and reject stale runs", () => {
  const schema = source("prisma/schema.prisma");
  const resetFence = assertFile("src/lib/reset-fence.ts");
  const fetchRuns = source("src/app/api/skill/fetch-runs/route.ts");
  const fetchRunPatch = source("src/app/api/skill/fetch-runs/[id]/route.ts");
  const jobRuns = source("src/app/api/skill/job-runs/route.ts");
  const builders = source("src/app/api/skill/builders/route.ts");
  const digestContext = source("src/app/api/skill/context/route.ts");
  const digests = source("src/app/api/skill/digests/route.ts");
  const cloudSync = source("src/app/api/admin/cloud-fetch/sync/route.ts");

  assert.match(schema, /model ResetFence \{[\s\S]*lastResetAt\s+DateTime/);
  assert.match(resetFence, /FOR SHARE/);
  assert.match(resetFence, /startedAt\.getTime\(\) <= lastResetAt\.getTime\(\)/);
  assert.match(fetchRuns, /\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*libraryFetchRun\.create/);
  assert.match(fetchRunPatch, /\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*libraryFetchRun\.update/);
  assert.match(jobRuns, /\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*agentJobRun\.(?:create|update)/);
  assert.match(builders, /libraryFetchRun\.findFirst[\s\S]*createdAt:\s*true/);
  assert.match(builders, /\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*syncBuilderFeedItems[\s\S]*patchFetchRunForBuilderSync/);
  for (const personalRoute of [fetchRuns, fetchRunPatch, builders, digestContext, digests]) {
    assert.match(personalRoute, /userResetFenceId\(user\.id\)/);
  }
  assert.match(jobRuns, /parsed\.data\.jobType === "cloud-library-fetch"[\s\S]*GLOBAL_RESET_FENCE_ID[\s\S]*userResetFenceId\(user\.id\)/);
  assert.match(builders, /BUILDER_SYNC_TRANSACTION_OPTIONS[\s\S]*maxWait:\s*60_000[\s\S]*timeout:\s*60_000/);
  assert.match(cloudSync, /cloudFetchRun\.findUnique[\s\S]*status:\s*true/);
  assert.match(cloudSync, /run\.status !== "RUNNING"/);
  assert.match(cloudSync, /classifyCloudFetchTerminalWrite/);
  assert.match(source("src/lib/cloud-fetch-terminal-reconcile.ts"), /params\.status === "RUNNING"/);
  assert.match(cloudSync, /\$transaction[\s\S]*lockResetFenceForWorker[\s\S]*syncBuilderFeedItems[\s\S]*applyCloudFetchTaskSyncResult/);
  assert.match(cloudSync, /CLOUD_SYNC_TRANSACTION_OPTIONS[\s\S]*maxWait:\s*60_000[\s\S]*timeout:\s*60_000/);
  assert.doesNotMatch(cloudSync, /userResetFenceId/);
});

test("source library sharing explains Hub visibility before publishing", () => {
  const libraryToggle = source("src/components/LibraryVisibilityToggle.tsx");

  assert.equal(existsSync(join(root, "src/components/DigestPipelineVisibilityToggle.tsx")), false);
  assert.match(libraryToggle, /Share source library\?/);
  assert.match(libraryToggle, /source names|source links|Hub/i);
  assert.match(libraryToggle, /Continue sharing/);
});

test("production config defines baseline browser security headers", () => {
  const nextConfig = source("next.config.ts");

  assert.match(nextConfig, /async headers\(\)/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /Referrer-Policy/);
  assert.match(nextConfig, /Permissions-Policy/);
  assert.match(nextConfig, /Strict-Transport-Security/);
  assert.match(nextConfig, /X-Content-Type-Options/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
});
