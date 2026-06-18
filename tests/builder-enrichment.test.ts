import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ENRICHMENT_SOURCE = readFileSync("src/lib/builder-enrichment.ts", "utf8");

test("builder-enrichment module exports the dispatch entry point", () => {
  // The probe is the new entry point; enrichBuilderFromSource remains
  // as a thin back-compat alias that returns probe.enrichment.
  assert.match(ENRICHMENT_SOURCE, /export\s+async\s+function\s+probeAndEnrichSource/);
  assert.match(ENRICHMENT_SOURCE, /export\s+async\s+function\s+enrichBuilderFromSource/);
  assert.match(ENRICHMENT_SOURCE, /export\s+type\s+BuilderEnrichment/);
  // The helper used by the route to choose between user-typed,
  // resolver-derived, and enrichment-derived display names.
  assert.match(ENRICHMENT_SOURCE, /export\s+function\s+pickFinalName/);
});

test("builder-enrichment dispatches supported source types", () => {
  // Each per-source branch is its own function call so the dispatch
  // table is readable and so an upstream failure can never accidentally
  // run a different source's code path.
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"x"/);
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"youtube"/);
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"blog"/);
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"website"/);
  assert.match(ENRICHMENT_SOURCE, /sourceType\s*===\s*"podcast"/);
  assert.doesNotMatch(ENRICHMENT_SOURCE, /sourceType\s*===\s*"pdf"/);
});

test("builder-enrichment podcast probe does NOT re-call iTunes (resolver owns that path)", () => {
  // iTunes lookup (and its 0-result hard-fail) is owned by
  // resolvePodcast — the probe must not duplicate that round-trip.
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

test("builder-enrichment can cache a bounded avatar image snapshot", () => {
  assert.match(ENRICHMENT_SOURCE, /export\s+async\s+function\s+resolveAvatarDataUrl/);
  assert.match(ENRICHMENT_SOURCE, /AVATAR_CACHE_MAX_BYTES\s*=\s*192\s*\*\s*1024/);
  assert.match(ENRICHMENT_SOURCE, /contentType\?\.startsWith\("image\/"\)/);
  assert.match(ENRICHMENT_SOURCE, /data:\$\{contentType\};base64/);
  assert.match(ENRICHMENT_SOURCE, /validatePublicHttpUrl\(safeUrl\)/);
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

test("builder model exposes live and cached avatar fields + migrations add the columns", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /model\s+Builder\s+\{[\s\S]*avatarUrl\s+String\?/);
  assert.match(schema, /model\s+Builder\s+\{[\s\S]*avatarDataUrl\s+String\?/);
  const avatarUrlMigration = readFileSync(
    "prisma/migrations/000029_builder_avatar_url/migration.sql",
    "utf8",
  );
  assert.match(avatarUrlMigration, /ALTER\s+TABLE\s+"Builder"\s+ADD\s+COLUMN\s+"avatarUrl"\s+TEXT/);
  const avatarDataUrlMigration = readFileSync(
    "prisma/migrations/000068_builder_avatar_data_url/migration.sql",
    "utf8",
  );
  assert.match(
    avatarDataUrlMigration,
    /ALTER\s+TABLE\s+"Builder"\s+ADD\s+COLUMN\s+"avatarDataUrl"\s+TEXT/,
  );
});

test("personal builder POST + PATCH routes both run the probe + enrichment", () => {
  const postRoute = readFileSync("src/app/api/builders/personal/route.ts", "utf8");
  const patchRoute = readFileSync(
    "src/app/api/builders/[builderId]/personal/route.ts",
    "utf8",
  );
  for (const source of [postRoute, patchRoute]) {
    assert.match(source, /probeAndEnrichSource/);
    assert.match(source, /pickFinalName/);
    // Probe failures must be caught defensively (a thrown probe should
    // not 500 the request).
    assert.match(source, /\.catch\(/);
    assert.match(source, /const avatarUrl = enrichment\.avatarUrl \?\? null/);
    assert.match(source, /resolveAvatarDataUrl\(avatarUrl\)/);
  }
});

test("BuilderLibraryEventItem carries live and cached avatar fields", () => {
  const events = readFileSync("src/lib/builder-library-events.ts", "utf8");
  assert.match(
    events,
    /export\s+type\s+BuilderLibraryEventItem\s*=\s*\{[\s\S]*avatarUrl:\s*string\s*\|\s*null/,
  );
  assert.match(events, /avatarDataUrl\?:\s*string\s*\|\s*null/);
});

test("source avatar renders live avatar, cached DB avatar, then favicon/monogram", () => {
  const list = readFileSync("src/components/BuilderLibraryList.tsx", "utf8");
  const avatar = readFileSync("src/components/SourceAvatar.tsx", "utf8");
  const detailPage = readFileSync("src/app/(workspace)/builder/[entityId]/page.tsx", "utf8");
  assert.match(list, /<SourceAvatar className="builder-library-avatar" imageSize=\{40\} source=\{builder\} \/>/);
  assert.match(detailPage, /<SourceAvatar/);
  assert.match(avatar, /source\.avatarUrl/);
  assert.match(avatar, /source\.avatarDataUrl/);
  assert.match(avatar, /function renderImageAvatar\(url: string\)/);
  assert.match(avatar, /className="source-avatar-fallback"/);
  assert.match(avatar, /return renderImageAvatar\(realAvatarUrl\)/);
  assert.match(avatar, /return renderImageAvatar\(cachedAvatarUrl\)/);
  assert.match(avatar, /return renderImageAvatar\(faviconUrl\)/);
  // The live-avatar branch must come before the cached DB snapshot,
  // which must come before favicon fallback on both list and detail.
  const realIndex = avatar.search(/if \(realAvatarUrl/);
  const cachedIndex = avatar.search(/if \(cachedAvatarUrl/);
  const faviconIndex = avatar.search(/if \(faviconUrl/);
  assert.ok(
    realIndex >= 0 && cachedIndex >= 0 && faviconIndex >= 0,
    "SourceAvatar should branch on realAvatarUrl, cachedAvatarUrl, and faviconUrl",
  );
  assert.ok(
    realIndex < cachedIndex && cachedIndex < faviconIndex,
    "avatar fallback order must be live URL, DB cache, favicon",
  );
});
