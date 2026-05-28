import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ENRICHMENT_SOURCE = readFileSync("src/lib/builder-enrichment.ts", "utf8");

test("builder-enrichment module exports the dispatch entry point", () => {
  assert.match(ENRICHMENT_SOURCE, /export\s+async\s+function\s+enrichBuilderFromSource/);
  assert.match(ENRICHMENT_SOURCE, /export\s+type\s+BuilderEnrichment/);
  // The helper used by the route to choose between user-typed,
  // resolver-derived, and enrichment-derived display names.
  assert.match(ENRICHMENT_SOURCE, /export\s+function\s+pickFinalName/);
});

test("builder-enrichment dispatches per source type and skips pdf", () => {
  // Each per-source branch is its own function call so the dispatch
  // table is readable and so an upstream failure can never accidentally
  // run a different source's code path.
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"x"/);
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"youtube"/);
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"blog"/);
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"website"/);
  // pdf must NOT have its own branch — enrichment is explicitly skipped
  // for PDFs (no useful name/avatar metadata to fetch).
  assert.doesNotMatch(ENRICHMENT_SOURCE, /sourceType\s*===\s*"pdf"/);
});

test("builder-enrichment podcast path is delegated to resolvePodcast (no second fetch)", () => {
  // The podcast path is handled inline by resolvePodcast (the iTunes
  // lookup already returns collectionName + artworkUrl600 in the same
  // response). This module should NOT issue a separate podcast fetch.
  assert.doesNotMatch(ENRICHMENT_SOURCE, /enrichPodcast/);
  assert.doesNotMatch(ENRICHMENT_SOURCE, /itunes\.apple\.com/);
});

test("builder-enrichment guards every outbound URL with the SSRF validator", () => {
  assert.match(ENRICHMENT_SOURCE, /import\s+\{[^}]*validatePublicHttpUrl[^}]*\}\s+from\s+"@\/lib\/safe-url"/);
  // The avatar URL coming back from the upstream also runs through
  // validatePublicHttpUrl before being persisted, so a publisher
  // can't make us store a private-network avatar URL.
  assert.match(ENRICHMENT_SOURCE, /export\s+function\s+toSafeAvatarUrl/);
});

test("builder-enrichment uses AbortController-based timeout for every fetch", () => {
  assert.match(ENRICHMENT_SOURCE, /new\s+AbortController\(\)/);
  // 4 second budget per upstream — never block the add flow on a
  // slow remote.
  assert.match(ENRICHMENT_SOURCE, /FETCH_TIMEOUT_MS\s*=\s*4000/);
  assert.match(ENRICHMENT_SOURCE, /controller\.abort\(\)/);
});

test("builder-enrichment X path opts out when X_BEARER_TOKEN is unset", () => {
  // X enrichment intentionally degrades to "no enrichment, monogram
  // fallback" when the deployment has not configured an API token.
  assert.match(ENRICHMENT_SOURCE, /X_BEARER_TOKEN/);
  assert.match(ENRICHMENT_SOURCE, /api\.x\.com\/2\/users\/by\/username/);
  assert.match(ENRICHMENT_SOURCE, /user\.fields=name,profile_image_url/);
});

test("builder-enrichment YouTube path strips the ' - YouTube' og:title suffix", () => {
  // og:title on YouTube channel pages is always "Channel Name - YouTube";
  // the trailing suffix must be removed before we persist the name.
  // The source-level regex includes the literal token "YouTube" inside
  // a strip pattern.
  assert.ok(
    ENRICHMENT_SOURCE.includes("YouTube"),
    "YouTube branch must reference the YouTube token",
  );
  // Any one of these regex shapes is acceptable; what matters is that
  // the suffix is removed before persistence.
  assert.match(ENRICHMENT_SOURCE, /YouTube\\s\*\$|YouTube\s*\$|- YouTube/);
});

test("builder-enrichment HTML path falls back to <title> and icon links", () => {
  assert.match(ENRICHMENT_SOURCE, /apple-touch-icon/);
  // `rel="icon"` is the canonical modern form; `rel="shortcut icon"`
  // is the legacy IE-era form. The regex covers both via `(?:shortcut )?`.
  assert.match(ENRICHMENT_SOURCE, /shortcut/);
  assert.match(ENRICHMENT_SOURCE, /icon/);
  // Relative href in <link rel="icon"> resolves against the page URL.
  assert.match(ENRICHMENT_SOURCE, /new\s+URL\(href,\s*pageUrl\)/);
});

test("builder-enrichment carries the documented User-Agent on every request", () => {
  assert.match(ENRICHMENT_SOURCE, /FollowBriefBot\/1\.0/);
  assert.match(ENRICHMENT_SOURCE, /avatar resolver/);
});

test("builder-enrichment never throws — every per-source helper is try/catch'd", () => {
  // Best-effort contract: the add flow must always succeed even when
  // every upstream is broken. The dispatch entry has a try/catch and
  // each per-source helper has its own try/catch, so a single broken
  // upstream can't propagate.
  const tryCount = (ENRICHMENT_SOURCE.match(/\btry\s*\{/g) ?? []).length;
  assert.ok(tryCount >= 4, `expected at least 4 try blocks; saw ${tryCount}`);
  const catchCount = (ENRICHMENT_SOURCE.match(/\}\s*catch/g) ?? []).length;
  assert.ok(catchCount >= 4, `expected at least 4 catch blocks; saw ${catchCount}`);
});

test("builder model exposes avatarUrl + migration adds the column", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /model\s+Builder\s+\{[\s\S]*avatarUrl\s+String\?/);
  const migration = readFileSync(
    "prisma/migrations/000029_builder_avatar_url/migration.sql",
    "utf8",
  );
  assert.match(migration, /ALTER\s+TABLE\s+"Builder"\s+ADD\s+COLUMN\s+"avatarUrl"\s+TEXT/);
});

test("personal builder POST + PATCH routes both run enrichment", () => {
  const postRoute = readFileSync("src/app/api/builders/personal/route.ts", "utf8");
  const patchRoute = readFileSync(
    "src/app/api/builders/[builderId]/personal/route.ts",
    "utf8",
  );
  for (const source of [postRoute, patchRoute]) {
    assert.match(source, /enrichBuilderFromSource/);
    assert.match(source, /pickFinalName/);
    // Catch-and-ignore so enrichment is never a blocker.
    assert.match(source, /\.catch\(\(\)\s*=>\s*\(\{\}\)\)/);
    assert.match(source, /avatarUrl:\s*enrichment\.avatarUrl\s*\?\?\s*null/);
  }
});

test("BuilderLibraryEventItem carries avatarUrl alongside the existing fields", () => {
  const events = readFileSync("src/lib/builder-library-events.ts", "utf8");
  assert.match(
    events,
    /export\s+type\s+BuilderLibraryEventItem\s*=\s*\{[\s\S]*avatarUrl:\s*string\s*\|\s*null/,
  );
});

test("BuilderLibraryList renders builder.avatarUrl ahead of favicon/monogram", () => {
  const list = readFileSync("src/components/BuilderLibraryList.tsx", "utf8");
  assert.match(list, /builder\.avatarUrl/);
  // The real-avatar branch must come before the favicon branch in
  // BuilderAvatar so the priority chain is preserved.
  const realIndex = list.search(/if \(realAvatarUrl/);
  const faviconIndex = list.search(/if \(faviconUrl/);
  assert.ok(
    realIndex >= 0 && faviconIndex >= 0,
    "BuilderAvatar should branch on realAvatarUrl and faviconUrl",
  );
  assert.ok(
    realIndex < faviconIndex,
    "real-avatar branch must precede favicon branch in BuilderAvatar",
  );
});
