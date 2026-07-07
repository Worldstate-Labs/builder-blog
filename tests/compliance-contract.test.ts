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
  const legalCopy = assertFile("src/lib/legal-pages.ts");
  const publicHeader = source("src/components/PublicHeader.tsx");
  const userMenu = source("src/components/UserMenu.tsx");
  const privacyContract = `${privacyPage}\n${legalCopy}`;
  const termsContract = `${termsPage}\n${legalCopy}`;

  for (const page of [privacyPage, termsPage]) {
    assert.match(page, /FollowBrief/);
    assert.match(page, /Privacy|Terms/);
    assert.match(page, /getCurrentSession\(\)/);
    assert.match(page, /<PublicHeader current="(?:privacy|terms)" session=\{session\} \/>/);
  }

  assert.match(privacyContract, /OAuth profile|email|read history|favorites|access keys|IP address|User-Agent/);
  assert.match(privacyContract, /Local Agent|AI Digest|summar/i);
  assert.match(privacyContract, /temporarily process crawled source content|source type policy/i);
  assert.match(privacyContract, /Google|GitHub|Apple|X|YouTube|Product Hunt|OpenAI/);
  assert.match(privacyContract, /access|export|correct|delete/);
  assert.match(privacyContract, /retention|retain|delete/i);
  assert.match(privacyContract, /Hub|shared source libraries|AI Digest collections/);
  assert.match(privacyContract, /Last updated: July 7, 2026/);
  assert.match(privacyContract, /Contact:\s*jie@worldstatelabs\.com/);
  assert.match(privacyContract, /Account and identity data|Content and source data|Usage, device, and diagnostic data/);
  assert.match(privacyContract, /OAuth providers|hosting, database, security, observability, AI, crawler, and agent runtime providers/i);
  assert.match(privacyContract, /We do not sell personal information|cross-context behavioral advertising/i);
  assert.match(privacyContract, /We use session cookies|authentication/i);
  assert.match(privacyContract, /not intended for children under 13/i);
  assert.match(privacyContract, /AI summaries and recommendations are assistive|not used to make legal, financial, employment, housing, credit, health, or insurance decisions/i);
  assert.match(privacyContract, /account export|account deletion|correct|object|restrict|portability/i);
  assert.match(privacyContract, /operational backups and security logs/i);

  assert.match(termsContract, /third-party sources|third-party APIs|platform terms/i);
  assert.match(termsContract, /private, paywalled, access-controlled|durable raw retention|Source owners/i);
  assert.match(termsContract, /Local Agent|access key|AI Digest/);
  assert.match(termsContract, /Do not|must not/i);
  assert.match(termsContract, /Last updated: July 7, 2026/);
  assert.match(termsContract, /Contact:\s*jie@worldstatelabs\.com/);
  assert.match(termsContract, /You must be able to form a binding contract/i);
  assert.match(termsContract, /You are responsible for keeping your account, devices, Local Agent files, and access keys secure/i);
  assert.match(termsContract, /Do not use FollowBrief to scrape private areas|bypass paywalls|violate robots/i);
  assert.match(termsContract, /No professional advice|AS IS|AS AVAILABLE|Limitation of liability/i);
  assert.match(termsContract, /suspend or terminate access/i);
  assert.match(termsContract, /material changes/i);
  assert.match(termsContract, /governed by the laws of California/i);

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
  assert.match(accountPanel, /\/api\/account\/export/);
  assert.match(accountPanel, /\/api\/account\/delete/);
  assert.match(accountPanel, /DELETE/);

  assert.match(exportRoute, /getCurrentSession\(\)/);
  assert.match(exportRoute, /session\.user\.id/);
  assert.match(exportRoute, /"content-disposition"/i);
  assert.match(exportRoute, /tokenCiphertext:\s*false|omitSecretFields|serializeSafeAccountExport/);
  assert.doesNotMatch(exportRoute, /access_token:\s*true|refresh_token:\s*true|id_token:\s*true|tokenValue:\s*true|tokenCiphertext:\s*true/);

  assert.match(deleteRoute, /getCurrentSession\(\)/);
  assert.match(deleteRoute, /session\.user\.id/);
  assert.match(deleteRoute, /feedItem\.deleteMany/);
  assert.match(deleteRoute, /user\.delete/);
});

test("admin settings can reset all fetch and digest generated state through one shared helper", () => {
  const settingsPage = source("src/app/(workspace)/settings/page.tsx");
  const panel = assertFile("src/components/AdminMaintenancePanel.tsx");
  const route = assertFile("src/app/api/admin/maintenance/fetch-digest-reset/route.ts");
  const helper = assertFile("src/lib/fetch-digest-reset.ts");
  const script = assertFile("scripts/clear-fetch-digest-state.mts");

  assert.match(settingsPage, /isAdmin \? <AdminMaintenancePanel \/> : null/);
  assert.match(panel, /Reset fetch and digest state/);
  assert.match(panel, /\/api\/admin\/maintenance\/fetch-digest-reset/);
  assert.match(panel, /RESET/);

  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /isAdminEmail\(session\.user\.email\)/);
  assert.match(route, /resetFetchDigestState\(\)/);
  assert.match(route, /confirmation[\s\S]*RESET/);

  assert.match(helper, /feedItem\.deleteMany/);
  assert.match(helper, /libraryFetchRun\.deleteMany/);
  assert.match(helper, /digestRun\.deleteMany/);
  assert.match(helper, /digest\.deleteMany/);
  assert.match(helper, /digestedItem\.deleteMany/);
  assert.match(helper, /agentJobRun\.deleteMany/);
  assert.match(helper, /jobType:\s*\{\s*in:\s*\[\s*"library-fetch",\s*"digest-build"\s*\]/);
  assert.match(helper, /builder\.updateMany[\s\S]*lastFetchedAt:\s*null/);
  assert.match(helper, /builder\.updateMany[\s\S]*status:\s*"IDLE"/);
  assert.match(helper, /maxWait:\s*60_000/);
  assert.match(script, /resetFetchDigestState/);
});

test("sharing controls explain Hub visibility before publishing user content", () => {
  const digestToggle = source("src/components/DigestPipelineVisibilityToggle.tsx");
  const libraryToggle = source("src/components/LibraryVisibilityToggle.tsx");

  assert.match(digestToggle, /Share AI Digest collection\?/);
  assert.match(digestToggle, /latest AI Digest metadata|headline|Hub/i);
  assert.match(digestToggle, /Continue sharing/);
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
