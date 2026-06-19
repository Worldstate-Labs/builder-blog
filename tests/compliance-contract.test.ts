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
  const publicHeader = source("src/components/PublicHeader.tsx");
  const userMenu = source("src/components/UserMenu.tsx");

  for (const page of [privacyPage, termsPage]) {
    assert.match(page, /FollowBrief/);
    assert.match(page, /Privacy|Terms/);
    assert.match(page, /getCurrentSession\(\)/);
    assert.match(page, /<PublicHeader current="(?:privacy|terms)" session=\{session\} \/>/);
  }

  assert.match(privacyPage, /OAuth profile|email|read history|favorites|access keys|IP address|User-Agent/);
  assert.match(privacyPage, /Local Agent|AI Digest|summar/i);
  assert.match(privacyPage, /temporarily process crawled source content|source type policy/i);
  assert.match(privacyPage, /Google|GitHub|Apple|X|YouTube|Product Hunt|OpenAI/);
  assert.match(privacyPage, /access|export|correct|delete/);
  assert.match(privacyPage, /retention|retain|delete/i);
  assert.match(privacyPage, /Hub|shared source libraries|AI Digest collections/);

  assert.match(termsPage, /third-party sources|third-party APIs|platform terms/i);
  assert.match(termsPage, /private, paywalled, access-controlled|durable raw retention|Source owners/i);
  assert.match(termsPage, /Local Agent|access key|AI Digest/);
  assert.match(termsPage, /Do not|must not/i);

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
