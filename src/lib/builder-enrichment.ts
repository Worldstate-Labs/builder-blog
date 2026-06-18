/**
 * Server-side reachability probe + best-effort enrichment of a personal
 * builder's display name and avatar/thumbnail URL during the Add Builder
 * (and Edit Builder) flow.
 *
 * Unlike the previous "enrichment swallows everything" contract, this
 * module now classifies the response into one of three outcomes:
 *
 *   ok        → reachable + extractable metadata (proceed)
 *   warning   → reachable but degraded (proceed, surface info banner)
 *   hardError → unreachable / definitively wrong (reject the add)
 *
 * For each source, the probe target:
 *   x        → X API v2 user lookup (only when X_BEARER_TOKEN is set)
 *   youtube  → channel page <meta og:title> / og:image
 *   blog     → page <meta og:title>/og:image, fallback <title> + favicons
 *   website  → same as blog
 *   podcast  → Apple Podcasts iTunes lookup is owned by resolvePodcast;
 *              non-Apple feeds are GET'd here and asserted to be XML.
 *
 * Every probe runs under a single 4-second AbortController, behind the
 * shared SSRF guard, and with the same FollowBriefBot User-Agent.
 */
import { validatePublicHttpUrl } from "@/lib/safe-url";

export type BuilderEnrichment = {
  name?: string;
  avatarUrl?: string;
};

/**
 * The structured outcome of probing a source. Callers (POST/PATCH
 * `/api/builders/.../personal`) use `ok` to decide between a 400
 * response (carrying `hardError`) and a successful upsert (carrying
 * any `warning` and `enrichment`).
 */
export type ProbeOutcome = {
  ok: boolean;
  /** Present iff ok=false; user-facing reason the add should be rejected. */
  hardError?: string;
  /**
   * Present iff ok=true and the source was reachable but degraded
   * (slow, partial, bot-walled); surfaced as info to the UI but doesn't
   * block the add.
   */
  warning?: string;
  /**
   * Auto-discovered RSS/Atom feed URL when the user pasted an HTML
   * landing page instead of the feed itself. The route persists this
   * as Builder.fetchUrl so the CLI hits the real feed at sync time
   * instead of re-scraping HTML on every fetch.
   */
  discoveredFetchUrl?: string;
  /**
   * When true, the warning is significant enough that the route should
   * surface it as a confirmation prompt BEFORE persisting — e.g. a
   * blog with no RSS feed (fetch still works via the agent, but the
   * user should know they're opting into the slower path). Transient
   * warnings (network timeouts, 503s) don't set this flag.
   */
  requiresConfirmation?: boolean;
  /** What we managed to pull (name, avatarUrl). May be empty. */
  enrichment: BuilderEnrichment;
};

type ProbeInput = {
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
};

const USER_AGENT =
  "FollowBriefBot/1.0 (avatar resolver; +https://builder-blog.worldstatelabs.com)";

const FETCH_TIMEOUT_MS = 4000;
const AVATAR_CACHE_MAX_BYTES = 192 * 1024;

// ──────────────────────────────────────────────────────────────────
// Public dispatch.
// ──────────────────────────────────────────────────────────────────

export async function probeAndEnrichSource(input: ProbeInput): Promise<ProbeOutcome> {
  const sourceType = (input.sourceType ?? "").toLowerCase();
  try {
    if (sourceType === "x") return await probeX(input);
    if (sourceType === "youtube") return await probeYouTube(input);
    if (sourceType === "blog" || sourceType === "website") {
      return await probeHtmlPage(input);
    }
    if (sourceType === "podcast") return await probePodcast(input);
    // Unknown source type → treat as a no-op probe (don't block the add).
    return { ok: true, enrichment: {} };
  } catch (error) {
    console.warn("[builder-enrichment] dispatch failed", { sourceType, error });
    // Defensive: any unexpected throw becomes a soft warning, not a
    // hard reject — we don't want a bug in this module to break adds.
    return {
      ok: true,
      warning: "Source added unverified. Local Agent can retry later.",
      enrichment: {},
    };
  }
}

/**
 * Back-compat alias for the older enrichment-only API. Existing callers
 * that only want the enrichment payload (and don't care about
 * ok/warning/hardError) can keep working unchanged.
 */
export async function enrichBuilderFromSource(
  input: ProbeInput,
): Promise<BuilderEnrichment> {
  const outcome = await probeAndEnrichSource(input);
  return outcome.enrichment;
}

export async function resolveAvatarDataUrl(
  avatarUrl: string | null | undefined,
): Promise<string | null> {
  const safeUrl = toSafeAvatarUrl(avatarUrl);
  if (!safeUrl) return null;
  const check = validatePublicHttpUrl(safeUrl);
  if (!check.ok) return null;

  try {
    const response = await fetchWithTimeout(safeUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!contentType?.startsWith("image/")) return null;

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > AVATAR_CACHE_MAX_BYTES) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_CACHE_MAX_BYTES) return null;
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch (error) {
    console.warn("[builder-enrichment] avatar cache fetch failed", { avatarUrl: safeUrl, error });
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// X / Twitter — only probes when bearer token is configured.
// ──────────────────────────────────────────────────────────────────

async function probeX(input: ProbeInput): Promise<ProbeOutcome> {
  const bearer = process.env.X_BEARER_TOKEN?.trim();
  const handle = (input.handle ?? "").trim();
  if (!bearer) {
    // Without a token we can't probe at all — treat as OK with no
    // warning so the add isn't blocked nor noisily annotated.
    return { ok: true, enrichment: {} };
  }
  if (!handle) {
    return { ok: true, enrichment: {} };
  }
  const apiUrl = `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=name,profile_image_url`;
  const check = validatePublicHttpUrl(apiUrl);
  if (!check.ok) {
    return { ok: true, enrichment: {} };
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${bearer}`,
      },
    });
  } catch (error) {
    console.warn("[builder-enrichment] x fetch failed", { handle, error });
    return {
      ok: true,
      warning: networkErrorMessage(error, "the X API"),
      enrichment: {},
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      hardError: `X account @${handle} was not found.`,
      enrichment: {},
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: true,
      warning: "X API rejected the lookup. Handle not verified.",
      enrichment: {},
    };
  }
  if (response.status === 429 || response.status >= 500) {
    return {
      ok: true,
      warning: "X API could not verify this handle. Local Agent verifies at sync time.",
      enrichment: {},
    };
  }
  if (!response.ok) {
    return {
      ok: true,
      warning: "X API could not verify this handle.",
      enrichment: {},
    };
  }
  const json = (await response.json().catch(() => null)) as
    | { data?: { name?: string; profile_image_url?: string } }
    | null;
  const data = json?.data;
  if (!data) {
    // 200 but no user data — treat as hard error: the handle resolved
    // to no account in X's database.
    return {
      ok: false,
      hardError: `X account @${handle} was not found.`,
      enrichment: {},
    };
  }
  const avatarUrl =
    toSafeAvatarUrl(upgradeXAvatarSize(data.profile_image_url)) ?? undefined;
  return {
    ok: true,
    enrichment: {
      ...(data.name ? { name: data.name } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    },
  };
}

// X returns the 400x400 "_normal" thumbnail by default; swap to the
// uncropped original which renders better at 36px and at retina.
function upgradeXAvatarSize(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/_normal(\.[a-z]+)$/i, "$1");
}

// ──────────────────────────────────────────────────────────────────
// YouTube channel page — OpenGraph tags carry the channel name + the
// avatar JPEG, no API key required.
// ──────────────────────────────────────────────────────────────────

async function probeYouTube(input: ProbeInput): Promise<ProbeOutcome> {
  const pageUrl = input.sourceUrl ?? input.fetchUrl;
  if (!pageUrl) return { ok: true, enrichment: {} };
  const check = validatePublicHttpUrl(pageUrl);
  if (!check.ok) return { ok: true, enrichment: {} };
  let response: Response;
  try {
    response = await fetchWithTimeout(pageUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
  } catch (error) {
    console.warn("[builder-enrichment] youtube fetch failed", { pageUrl, error });
    return {
      ok: true,
      warning: networkErrorMessage(error, "the YouTube channel page"),
      enrichment: {},
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      hardError: "YouTube channel not found.",
      enrichment: {},
    };
  }
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    return {
      ok: true,
      warning: "Could not reach the YouTube channel page. Local Agent retries at sync time.",
      enrichment: {},
    };
  }
  if (!response.ok) {
    return {
      ok: true,
      warning: "Could not verify the YouTube channel page. Local Agent retries at sync time.",
      enrichment: {},
    };
  }
  const html = await response.text().catch(() => "");
  if (!html) {
    return {
      ok: true,
      warning: "YouTube returned an empty page. Local Agent retries at sync time.",
      enrichment: {},
    };
  }
  const ogTitle = extractMetaContent(html, "og:title");
  const ogImage = extractMetaContent(html, "og:image");
  const name = ogTitle
    ? ogTitle.replace(/\s+-\s+YouTube\s*$/i, "").trim() || undefined
    : undefined;
  const avatarUrl = toSafeAvatarUrl(resolveMaybeRelative(ogImage, pageUrl)) ?? undefined;
  const enrichment: BuilderEnrichment = {
    ...(name ? { name } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
  if (!name && !avatarUrl && !extractTitleTag(html)) {
    return {
      ok: true,
      warning:
        "YouTube returned a page without OpenGraph metadata. Local Agent retries at sync time.",
      enrichment,
    };
  }
  return { ok: true, enrichment };
}

// ──────────────────────────────────────────────────────────────────
// Generic HTML page (blog, website): og:title/og:image with fallbacks
// to <title> and apple-touch-icon / rel=icon. Every relative href is
// resolved against the page URL.
// ──────────────────────────────────────────────────────────────────

async function probeHtmlPage(input: ProbeInput): Promise<ProbeOutcome> {
  const pageUrl = input.sourceUrl ?? input.fetchUrl;
  if (!pageUrl) return { ok: true, enrichment: {} };
  const check = validatePublicHttpUrl(pageUrl);
  if (!check.ok) return { ok: true, enrichment: {} };
  let response: Response;
  try {
    response = await fetchWithTimeout(pageUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
  } catch (error) {
    console.warn("[builder-enrichment] html fetch failed", { pageUrl, error });
    return {
      ok: true,
      warning: networkErrorMessage(error, "the page"),
      enrichment: {},
    };
  }
  if (response.status === 404 || response.status === 410) {
    return {
      ok: false,
      hardError: "The page could not be found.",
      enrichment: {},
    };
  }
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    return {
      ok: true,
      warning: "Could not reach the page. Local Agent retries at sync time.",
      enrichment: {},
    };
  }
  if (!response.ok) {
    return {
      ok: true,
      warning: "Could not verify the page. Local Agent retries at sync time.",
      enrichment: {},
    };
  }
  const html = await response.text().catch(() => "");
  if (!html) {
    return {
      ok: true,
      warning: "The page returned an empty body. Local Agent retries at sync time.",
      enrichment: {},
    };
  }
  const ogTitle = extractMetaContent(html, "og:title");
  const ogImage = extractMetaContent(html, "og:image");
  const titleTag = ogTitle ? null : extractTitleTag(html);
  const name = (ogTitle || titleTag || "").trim() || undefined;
  const rawAvatar =
    ogImage ||
    extractIconHref(html, /apple-touch-icon/i) ||
    extractIconHref(html, /(?:shortcut )?icon/i);
  const avatarUrl = toSafeAvatarUrl(resolveMaybeRelative(rawAvatar, pageUrl)) ?? undefined;
  const enrichment: BuilderEnrichment = {
    ...(name ? { name } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
  // Same convenience as the podcast branch — if the HTML page links
  // to an RSS/Atom feed, surface it so the route can persist it as
  // the Builder's fetchUrl. Useful for blogs whose owners paste the
  // homepage URL instead of /feed.xml.
  const discoveredFeed = extractFeedLinkFromHtml(html, pageUrl);
  const discoveredFetchUrl = (() => {
    if (!discoveredFeed) return undefined;
    const check = validatePublicHttpUrl(discoveredFeed);
    return check.ok ? discoveredFeed : undefined;
  })();
  const warnings: string[] = [];
  let requiresConfirmation = false;
  if (!name && !avatarUrl) {
    warnings.push(
      "The page is reachable but has no OpenGraph metadata or <title>. Local Agent retries at sync time.",
    );
  }
  // Blog-with-no-RSS is a "still fetchable, just slower" outcome —
  // surface it to the user as a confirmation prompt before persisting
  // so they understand the agent path they're opting into.
  if (input.sourceType === "blog" && !discoveredFetchUrl) {
    warnings.push("No RSS feed found. The agent will fetch articles by scraping the page.");
    requiresConfirmation = true;
  }
  const warning = warnings.length > 0 ? warnings.join(" ") : undefined;
  return {
    ok: true,
    enrichment,
    ...(discoveredFetchUrl ? { discoveredFetchUrl } : {}),
    ...(warning ? { warning } : {}),
    ...(requiresConfirmation ? { requiresConfirmation: true } : {}),
  };
}

// ──────────────────────────────────────────────────────────────────
// Podcast — Apple Podcasts iTunes lookup is owned by resolvePodcast
// (which can surface a HARD failure on its own); here we probe the
// resolved RSS / sourceUrl for reachability + XML-ness.
// ──────────────────────────────────────────────────────────────────

async function probePodcast(input: ProbeInput): Promise<ProbeOutcome> {
  // Apple Podcasts: the resolver already pre-fetched iTunes and (if
  // it returned no results) surfaced a hard error. Here we have an
  // Apple page URL with no separately-fetchable RSS — nothing useful
  // to probe, so don't double-charge the user-visible add latency.
  const isApple = !!input.sourceUrl?.match(/podcasts\.apple\.com\//i);
  const fetchTarget = input.fetchUrl ?? (isApple ? null : input.sourceUrl);
  if (!fetchTarget) return { ok: true, enrichment: {} };
  const check = validatePublicHttpUrl(fetchTarget);
  if (!check.ok) return { ok: true, enrichment: {} };

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchTarget, {
      headers: { "User-Agent": USER_AGENT },
    });
  } catch (error) {
    console.warn("[builder-enrichment] podcast fetch failed", { fetchTarget, error });
    return {
      ok: true,
      warning: networkErrorMessage(error, "the podcast RSS feed"),
      enrichment: {},
    };
  }
  if (response.status === 404 || response.status === 410) {
    return {
      ok: false,
      hardError: "The podcast RSS feed could not be found.",
      enrichment: {},
    };
  }
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    return {
      ok: true,
      warning: "Could not reach the podcast RSS feed. Local Agent retries at sync time.",
      enrichment: {},
    };
  }
  if (!response.ok) {
    return {
      ok: true,
      warning: "Could not verify the podcast RSS feed. Local Agent retries at sync time.",
      enrichment: {},
    };
  }
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const body = await response.text().catch(() => "");
  const looksLikeXml =
    contentType.startsWith("application/xml") ||
    contentType.startsWith("application/rss+xml") ||
    contentType.startsWith("application/atom+xml") ||
    contentType.startsWith("text/xml") ||
    body.trimStart().startsWith("<?xml") ||
    /^<(?:rss|feed)\b/i.test(body.trimStart());
  if (looksLikeXml) {
    return { ok: true, enrichment: {} };
  }
  // Body isn't an RSS/Atom feed — maybe the user pasted an HTML
  // landing page (Substack root, podcast website, etc.). Try to
  // discover an alternate-feed link in the HTML <head>; if found,
  // persist it as the fetchUrl so the CLI hits the real feed at
  // sync time. The discovered URL is trusted on this pass (no
  // second probe) to keep add latency bounded.
  const discovered = extractFeedLinkFromHtml(body, fetchTarget);
  if (discovered) {
    const discoveredCheck = validatePublicHttpUrl(discovered);
    if (discoveredCheck.ok) {
      return {
        ok: true,
        discoveredFetchUrl: discovered,
        enrichment: {},
      };
    }
  }
  return {
    ok: false,
    hardError:
      "That URL did not return a parseable RSS feed, and no feed was linked from the page. Paste the actual RSS feed URL.",
    enrichment: {},
  };
}

// ──────────────────────────────────────────────────────────────────
// Shared helpers.
// ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: { headers: Record<string, string> },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: init.headers,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a thrown fetch error into a friendly sentence the UI can show.
 * Distinguishes timeout (AbortError), DNS / network unreachable, and
 * TLS handshake failures from a generic catch-all.
 */
function networkErrorMessage(error: unknown, subject: string): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "AbortError") {
    return `${capitalize(subject)} took longer than 4 seconds to respond. Local Agent retries at sync time.`;
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return `${capitalize(subject)} hostname could not be resolved (DNS).`;
  }
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(message)) {
    return `${capitalize(subject)} refused the connection.`;
  }
  if (/SSL|TLS|CERT_|certificate/i.test(message)) {
    return `${capitalize(subject)} returned an SSL/TLS error.`;
  }
  return `Could not reach ${subject}. Local Agent retries at sync time.`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractMetaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta\\s+[^>]*property=["']${escaped}["'][^>]*content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta\\s+[^>]*content=["']([^"']+)["'][^>]*property=["']${escaped}["']`,
      "i",
    ),
    // Some pages use name="" instead of property="" for og:* fallback.
    new RegExp(
      `<meta\\s+[^>]*name=["']${escaped}["'][^>]*content=["']([^"']+)["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim());
}

function extractIconHref(html: string, relPattern: RegExp): string | null {
  // <link ... rel="..." href="..."> in either attribute order.
  const linkPattern = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkPattern) ?? []) {
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
    if (!relMatch?.[1]) continue;
    if (!relPattern.test(relMatch[1])) continue;
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch?.[1]) return decodeHtmlEntities(hrefMatch[1].trim());
  }
  return null;
}

/**
 * Find an RSS/Atom feed URL declared in an HTML page's `<head>` via
 * `<link rel="alternate" type="application/rss+xml" href="…">` (or
 * the atom equivalent). Returns the first match resolved to an
 * absolute URL against `pageUrl`, or null if none.
 *
 * Common case: user pastes a Substack root URL (no /feed) — we
 * discover `<link rel="alternate" type="application/rss+xml"
 * href="/feed">` and persist that as the Builder's fetchUrl so the
 * CLI hits the real feed at sync time.
 */
function extractFeedLinkFromHtml(html: string, pageUrl: string): string | null {
  const linkPattern = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkPattern) ?? []) {
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
    if (!relMatch?.[1] || !/\balternate\b/i.test(relMatch[1])) continue;
    const typeMatch = tag.match(/\btype=["']([^"']+)["']/i);
    if (
      !typeMatch?.[1] ||
      !/application\/(?:rss|atom)\+xml/i.test(typeMatch[1])
    ) {
      continue;
    }
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) continue;
    const resolved = resolveMaybeRelative(
      decodeHtmlEntities(hrefMatch[1].trim()),
      pageUrl,
    );
    if (resolved) return resolved;
  }
  return null;
}

function resolveMaybeRelative(
  href: string | null | undefined,
  pageUrl: string,
): string | null {
  if (!href) return null;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Resolve the avatar URL through the same SSRF guard used for
 * sourceUrl/fetchUrl. Avatars are persisted and re-served client-side
 * (an <img src=...>), so we never want to store a private-network URL.
 */
export function toSafeAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const check = validatePublicHttpUrl(raw);
  if (!check.ok) return null;
  return check.url.toString();
}

/**
 * Best-effort hostname extraction for building urlSignals. Returns
 * null when the input isn't a parseable URL or has no host.
 */
export function hostnameOrNull(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Tiny helper used by the POST/PATCH routes to decide which name wins
 * after enrichment. The user's typed display name (when non-empty)
 * always wins; otherwise the enriched name is preferred; otherwise the
 * resolver's derived name (handle / hostname / og:title-less fallback).
 */
export function pickFinalName(
  userTyped: string | null | undefined,
  resolved: string,
  enriched: string | null | undefined,
  opts: { urlSignals?: ReadonlyArray<string | null | undefined> } = {},
): string {
  const typed = (userTyped ?? "").trim();
  const fromEnrichment = (enriched ?? "").trim();

  // The client auto-fills the Display name field from the typed URL
  // (e.g. "podcasts.apple.com" for an Apple Podcasts link). When the
  // user submits without overriding it, that low-quality string would
  // otherwise win over the much better enriched name (e.g. iTunes'
  // "硅谷101" or a blog's og:title). Treat user input as "weak" if it
  // exactly matches any URL-derivable signal — hostname (with or
  // without "www."), handle, "@handle", or the resolved name itself.
  if (typed && fromEnrichment) {
    const weakSignals = new Set<string>();
    for (const raw of opts.urlSignals ?? []) {
      const value = (raw ?? "").trim().toLowerCase();
      if (!value) continue;
      weakSignals.add(value);
      weakSignals.add(value.replace(/^www\./, ""));
      weakSignals.add(value.replace(/^@/, ""));
    }
    weakSignals.add(resolved.trim().toLowerCase());
    if (weakSignals.has(typed.toLowerCase())) {
      return fromEnrichment;
    }
  }

  if (typed) return typed;
  if (fromEnrichment) return fromEnrichment;
  return resolved;
}

/**
 * Combine an optional resolver warning with an optional probe warning
 * into a single string suitable for the response `warning` field. Each
 * is shown as-is when only one is present; both are concatenated with
 * "; " when both are present.
 */
export function combineWarnings(
  ...parts: ReadonlyArray<string | null | undefined>
): string | undefined {
  const filtered = parts.map((p) => (p ?? "").trim()).filter((p) => p.length > 0);
  if (filtered.length === 0) return undefined;
  return filtered.join("; ");
}
