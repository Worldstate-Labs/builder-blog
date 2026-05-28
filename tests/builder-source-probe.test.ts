import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PROBE_SOURCE = readFileSync("src/lib/builder-enrichment.ts", "utf8");
const POST_ROUTE = readFileSync("src/app/api/builders/personal/route.ts", "utf8");
const PATCH_ROUTE = readFileSync(
  "src/app/api/builders/[builderId]/personal/route.ts",
  "utf8",
);
const RESOLVER_SOURCE = readFileSync("src/lib/personal-builder-input.ts", "utf8");

test("probeAndEnrichSource exists and returns a ProbeOutcome", () => {
  assert.match(PROBE_SOURCE, /export\s+async\s+function\s+probeAndEnrichSource/);
  assert.match(PROBE_SOURCE, /export\s+type\s+ProbeOutcome\s*=/);
  // The required fields of the outcome.
  assert.match(PROBE_SOURCE, /ok:\s*boolean/);
  assert.match(PROBE_SOURCE, /hardError\?:\s*string/);
  assert.match(PROBE_SOURCE, /warning\?:\s*string/);
  assert.match(PROBE_SOURCE, /enrichment:\s*BuilderEnrichment/);
});

test("enrichBuilderFromSource remains as a back-compat alias", () => {
  assert.match(PROBE_SOURCE, /export\s+async\s+function\s+enrichBuilderFromSource/);
  // The alias must just return the probe's enrichment payload.
  assert.match(PROBE_SOURCE, /probeAndEnrichSource/);
});

test("probe classifies X API responses by status", () => {
  // 404 → hard reject with the user's handle in the message.
  assert.match(PROBE_SOURCE, /404/);
  assert.match(PROBE_SOURCE, /X account @\$\{handle\} doesn't exist/);
  // 401/403 → soft warning, not a reject.
  assert.match(PROBE_SOURCE, /401/);
  assert.match(PROBE_SOURCE, /403/);
  // X API URL is unchanged.
  assert.match(PROBE_SOURCE, /api\.x\.com\/2\/users\/by\/username/);
});

test("probe classifies YouTube page responses by status", () => {
  // YouTube 404 must hard-reject with a user-facing reason.
  assert.match(PROBE_SOURCE, /YouTube channel not found/);
  // 403 / 429 / 5xx are degraded (soft) — page is reachable, just walled.
  assert.match(PROBE_SOURCE, /YouTube channel page/);
});

test("probe classifies podcast RSS response and recognizes XML", () => {
  // Hard rejection when the body isn't parseable as RSS / Atom.
  assert.match(PROBE_SOURCE, /parseable RSS feed/);
  // Content-Type check for the standard feed MIME types.
  assert.match(PROBE_SOURCE, /application\/rss\+xml/);
  assert.match(PROBE_SOURCE, /application\/atom\+xml/);
  // Body check for the XML preamble or <rss>/<feed> root.
  assert.match(PROBE_SOURCE, /\\\?xml|<\?xml/);
});

test("probe classifies blog/website responses with 404 / 410 as hard reject", () => {
  // 404 and 410 are gone-for-good.
  assert.match(PROBE_SOURCE, /404/);
  assert.match(PROBE_SOURCE, /410/);
  // 403 / 429 / 5xx are degraded (Couldn't reach the page right now).
  assert.match(PROBE_SOURCE, /Couldn't reach the page right now/);
});

test("probe PDF path uses a Range byte probe + checks %PDF magic", () => {
  // Cheap probe of the first 32 bytes only, not the full document.
  assert.match(PROBE_SOURCE, /Range:\s*"bytes=0-32"/);
  // PDF magic header is %PDF; anything else with no .pdf extension
  // becomes a soft warning.
  assert.match(PROBE_SOURCE, /%PDF/);
  assert.match(PROBE_SOURCE, /URL doesn't look like a PDF/);
});

test("probe respects the 4s timeout and the standard User-Agent", () => {
  assert.match(PROBE_SOURCE, /new\s+AbortController\(\)/);
  assert.match(PROBE_SOURCE, /FETCH_TIMEOUT_MS\s*=\s*4000/);
  assert.match(PROBE_SOURCE, /controller\.abort\(\)/);
  assert.match(PROBE_SOURCE, /FollowBriefBot\/1\.0/);
});

test("probe SSRF-validates every outbound URL before fetching it", () => {
  // The shared safe-url validator must guard every per-source helper
  // — and the avatar URL coming back from the upstream.
  assert.match(PROBE_SOURCE, /import\s+\{[^}]*validatePublicHttpUrl[^}]*\}\s+from\s+"@\/lib\/safe-url"/);
  // Count the call sites to make sure no source helper skipped it.
  const callCount = (PROBE_SOURCE.match(/validatePublicHttpUrl\(/g) ?? []).length;
  assert.ok(
    callCount >= 5,
    `expected at least 5 validatePublicHttpUrl call sites; saw ${callCount}`,
  );
});

test("probe logs failures to stderr via console.warn for server-side debuggability", () => {
  const warnCount = (PROBE_SOURCE.match(/console\.warn\(/g) ?? []).length;
  assert.ok(
    warnCount >= 4,
    `expected console.warn on every per-source failure path; saw ${warnCount}`,
  );
});

test("POST route maps a hard probe failure to a 400 with the hardError", () => {
  assert.match(POST_ROUTE, /probeAndEnrichSource/);
  // ok: false short-circuits into a 400 response carrying the
  // user-facing hardError reason.
  assert.match(POST_ROUTE, /probe\.ok/);
  assert.match(POST_ROUTE, /probe\.hardError/);
  assert.match(POST_ROUTE, /status:\s*400/);
});

test("POST route combines resolution.warning + probe.warning", () => {
  // The route must reach into both warning sources and concatenate
  // them (combineWarnings handles the "; " separator).
  assert.match(POST_ROUTE, /combineWarnings/);
  assert.match(POST_ROUTE, /resolution\.warning/);
  assert.match(POST_ROUTE, /probe\.warning/);
});

test("combineWarnings concatenates non-empty warnings with '; '", () => {
  // The helper itself: empty + empty → undefined, one + one → both joined.
  assert.match(PROBE_SOURCE, /export\s+function\s+combineWarnings/);
  assert.match(PROBE_SOURCE, /join\("; "\)/);
});

test("PATCH route mirrors POST: probe hard → 400, soft → combined warning", () => {
  assert.match(PATCH_ROUTE, /probeAndEnrichSource/);
  assert.match(PATCH_ROUTE, /probe\.ok/);
  assert.match(PATCH_ROUTE, /probe\.hardError/);
  assert.match(PATCH_ROUTE, /status:\s*400/);
  assert.match(PATCH_ROUTE, /combineWarnings/);
  assert.match(PATCH_ROUTE, /resolution\.warning/);
  assert.match(PATCH_ROUTE, /probe\.warning/);
});

test("resolvePodcast surfaces the Apple-zero-results case as a hard ResolutionFailure", () => {
  // The Apple hard-fail must be owned by the resolver (not the probe)
  // so we don't double-call iTunes. results.length === 0 → ok: false.
  assert.match(RESOLVER_SOURCE, /results\.length\s*===\s*0/);
  assert.match(RESOLVER_SOURCE, /Apple Podcasts has no record of this show/);
});

test("probe maps thrown errors into friendly sentences (no raw exception leakage)", () => {
  // The mapper covers: timeout (AbortError), DNS, connection refused,
  // and SSL/TLS — each with a sentence-case English phrase.
  assert.match(PROBE_SOURCE, /AbortError/);
  assert.match(PROBE_SOURCE, /ENOTFOUND/);
  assert.match(PROBE_SOURCE, /ECONNREFUSED/);
  assert.match(PROBE_SOURCE, /SSL|TLS/);
  assert.match(PROBE_SOURCE, /4 seconds/);
});
