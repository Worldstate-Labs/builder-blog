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
  assert.match(PROBE_SOURCE, /X account @\$\{handle\} was not found/);
  // 401/403 → soft warning, not a reject.
  assert.match(PROBE_SOURCE, /401/);
  assert.match(PROBE_SOURCE, /403/);
  assert.match(PROBE_SOURCE, /X API could not verify this handle/);
  // X API URL is unchanged.
  assert.match(PROBE_SOURCE, /api\.x\.com\/2\/users\/by\/username/);
  assert.doesNotMatch(PROBE_SOURCE, /X account @\$\{handle\} doesn't exist|Got HTTP \$\{response\.status\} from the X API/);
});

test("probe classifies YouTube page responses by status", () => {
  // YouTube 404 must hard-reject with a user-facing reason.
  assert.match(PROBE_SOURCE, /YouTube channel not found/);
  // 403 / 429 / 5xx are degraded (soft) — page is reachable, just walled.
  assert.match(PROBE_SOURCE, /YouTube channel page/);
  assert.match(PROBE_SOURCE, /Could not reach the YouTube channel page/);
  assert.doesNotMatch(PROBE_SOURCE, /YouTube channel not found \(HTTP 404\)|Got HTTP \$\{response\.status\} from the YouTube channel page/);
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
  // 403 / 429 / 5xx are degraded but must require confirmation
  // instead of silently adding an unverified source.
  assert.match(PROBE_SOURCE, /Could not reach the page/);
  assert.match(PROBE_SOURCE, /Confirm the URL opens in your browser before saving it\./);
  assert.match(PROBE_SOURCE, /requiresConfirmation:\s*true/);
  assert.doesNotMatch(PROBE_SOURCE, /Couldn't reach/);
  assert.match(PROBE_SOURCE, /The page could not be found/);
  assert.match(PROBE_SOURCE, /Could not verify the page/);
  assert.doesNotMatch(PROBE_SOURCE, /The page returned HTTP \$\{response\.status\}|Got HTTP \$\{response\.status\} from the page|Could not reach the page \(HTTP \$\{response\.status\}\)/);
});

test("probe user-facing status copy avoids transport codes", () => {
  assert.match(PROBE_SOURCE, /The podcast RSS feed could not be found/);
  assert.match(PROBE_SOURCE, /Could not reach the podcast RSS feed/);
  assert.match(PROBE_SOURCE, /Could not verify the podcast RSS feed/);
  assert.doesNotMatch(
    PROBE_SOURCE,
    /Got HTTP \$\{response\.status\}|returned HTTP \$\{response\.status\}|\(HTTP \$\{response\.status\}\)|HTTP 404/,
  );
});

test("probe treats soft-404 HTML pages as hard not-found failures", () => {
  assert.match(PROBE_SOURCE, /function\s+isHtmlNotFoundPage/);
  assert.match(PROBE_SOURCE, /extractTitleTag\(html\)/);
  assert.match(PROBE_SOURCE, /extractMetaContent\(html,\s*"og:title"\)/);
  assert.match(PROBE_SOURCE, /firstHeadingText\(html,\s*"h1"\)/);
  assert.match(PROBE_SOURCE, /isHtmlNotFoundPage\(html\)[\s\S]*hardError:\s*"The page could not be found\."/);
});

test("probe rejects a 200 HTML page whose visible title is not found", async () => {
  const { probeAndEnrichSource } = await import("../src/lib/builder-enrichment");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      '<!doctype html><html><head><title>Page not found</title></head><body><h1>Page not found</h1></body></html>',
      { status: 200, headers: { "content-type": "text/html" } },
    );
  try {
    const outcome = await probeAndEnrichSource({
      sourceType: "blog",
      sourceUrl: "https://example.com/missing",
      fetchUrl: null,
      handle: null,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.hardError, "The page could not be found.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("probe accepts direct blog RSS without requiring page-scrape confirmation", async () => {
  const { probeAndEnrichSource } = await import("../src/lib/builder-enrichment");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<?xml version="1.0"?>
      <rss version="2.0">
        <channel><title>Example Articles</title></channel>
      </rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } },
    );
  try {
    const outcome = await probeAndEnrichSource({
      sourceType: "blog",
      sourceUrl: "https://example.com/feed.xml",
      fetchUrl: "https://example.com/feed.xml",
      handle: null,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.requiresConfirmation, undefined);
    assert.equal(outcome.discoveredFetchUrl, "https://example.com/feed.xml");
    assert.deepEqual(outcome.enrichment, { name: "Example Articles" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("probe rejects podcast RSS pasted as Blog / Article Feed with a source-type suggestion", async () => {
  const { probeAndEnrichSource } = await import("../src/lib/builder-enrichment");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<?xml version="1.0"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Example Podcast</title>
          <item>
            <title>Episode one</title>
            <enclosure url="https://cdn.example.com/e1.mp3" type="audio/mpeg" />
          </item>
        </channel>
      </rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } },
    );
  try {
    const outcome = await probeAndEnrichSource({
      sourceType: "blog",
      sourceUrl: "https://podcast.example.com/rss",
      fetchUrl: null,
      handle: null,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.hardError, "This looks like a Podcast / Audio Feed. Switch source type?");
    assert.equal(outcome.suggestId, "podcast");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("probe requires confirmation when an HTML page cannot be verified", async () => {
  const { probeAndEnrichSource } = await import("../src/lib/builder-enrichment");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 403 });
  try {
    const outcome = await probeAndEnrichSource({
      sourceType: "blog",
      sourceUrl: "https://example.com/bot-walled",
      fetchUrl: null,
      handle: null,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.requiresConfirmation, true);
    assert.match(outcome.warning ?? "", /Confirm the URL opens in your browser/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    callCount >= 4,
    `expected at least 4 validatePublicHttpUrl call sites; saw ${callCount}`,
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
  assert.match(POST_ROUTE, /probe\.suggestId/);
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
  assert.match(PATCH_ROUTE, /probe\.suggestId/);
  assert.match(PATCH_ROUTE, /status:\s*400/);
  assert.match(PATCH_ROUTE, /combineWarnings/);
  assert.match(PATCH_ROUTE, /resolution\.warning/);
  assert.match(PATCH_ROUTE, /probe\.warning/);
});

test("resolvePodcast surfaces the Apple-zero-results case as a hard ResolutionFailure", () => {
  // The Apple hard-fail must be owned by the resolver (not the probe)
  // so we don't double-call iTunes. results.length === 0 → ok: false.
  assert.match(RESOLVER_SOURCE, /results\.length\s*===\s*0/);
  assert.match(RESOLVER_SOURCE, /Apple Podcasts did not find this show\. Paste the actual RSS feed URL instead\./);
  assert.match(RESOLVER_SOURCE, /Paste an Apple Podcasts or RSS feed URL\./);
  assert.match(RESOLVER_SOURCE, /Apple Podcasts did not return an RSS feed\./);
  assert.match(RESOLVER_SOURCE, /Could not verify this show with Apple Podcasts\./);
  assert.match(RESOLVER_SOURCE, /Could not reach Apple Podcasts to find the RSS feed\./);
  assert.doesNotMatch(RESOLVER_SOURCE, /has no record|this podcast with Apple Podcasts|show — paste|id…|podcasts\.apple\.com\/\.\.\.|id\.\.\.|Apple lookup failed|Apple returned no RSS feed|Could not reach Apple to resolve|resolve the RSS feed/);
});

test("probe maps thrown errors into friendly sentences (no raw exception leakage)", () => {
  // The mapper covers: timeout (AbortError), DNS, connection refused,
  // and SSL/TLS — each with a sentence-case English phrase.
  assert.match(PROBE_SOURCE, /AbortError/);
  assert.match(PROBE_SOURCE, /ENOTFOUND/);
  assert.match(PROBE_SOURCE, /ECONNREFUSED/);
  assert.match(PROBE_SOURCE, /SSL|TLS/);
  assert.match(PROBE_SOURCE, /4 seconds/);
  assert.match(PROBE_SOURCE, /Local Agent retries at sync time/);
  assert.doesNotMatch(PROBE_SOURCE, /Local Agent verifies at sync time/);
  assert.match(PROBE_SOURCE, /Source could not be verified\. Local Agent retries at sync time\./);
  assert.match(PROBE_SOURCE, /No RSS feed found\. Local Agent will fetch articles by scraping the page\./);
  assert.doesNotMatch(PROBE_SOURCE, /No RSS feed found\. The agent will fetch articles by scraping the page\./);
  assert.doesNotMatch(PROBE_SOURCE, /Local Agent will (retry|verify) at sync time|the agent will (retry|verify)/);
  assert.doesNotMatch(PROBE_SOURCE, /Source (added|updated) unverified/);
});

test("probe auto-discovers an RSS/Atom feed link in HTML and surfaces it as discoveredFetchUrl", () => {
  // The discover helper exists and the ProbeOutcome shape carries
  // the discovered URL so the route can persist it as fetchUrl.
  assert.match(PROBE_SOURCE, /function\s+extractFeedLinkFromHtml/);
  assert.match(PROBE_SOURCE, /discoveredFetchUrl\?:\s*string/);
  // Discovery matches the canonical alternate-feed link shape.
  assert.match(PROBE_SOURCE, /alternate/);
  assert.match(PROBE_SOURCE, /application\\\/\(\?:rss\|atom\)\\\+xml/);
  // Podcast probe falls back to discovery when the body isn't XML,
  // and HARD-fails only when discovery also returns nothing.
  assert.match(
    PROBE_SOURCE,
    /did not return a parseable RSS feed, and no feed was linked from the page/,
  );
  assert.doesNotMatch(PROBE_SOURCE, /we couldn't find| — paste/);
});

test("routes persist the discovered feed URL as Builder.fetchUrl", () => {
  // POST and PATCH both prefer probe.discoveredFetchUrl over the
  // resolver's fetchUrl, so a user who pasted an HTML landing page
  // gets the real feed wired up for sync time.
  for (const route of [POST_ROUTE, PATCH_ROUTE]) {
    assert.match(route, /probe\.discoveredFetchUrl\s*\?\?\s*input\.fetchUrl/);
  }
});
