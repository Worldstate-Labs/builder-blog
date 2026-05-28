/**
 * Best-effort, server-side enrichment of a personal builder's display
 * name and avatar/thumbnail URL during the Add Builder flow. Every
 * per-source helper is wrapped in a 4-second timeout, an SSRF guard,
 * and a try/catch that swallows errors — enrichment never blocks or
 * fails the add flow.
 *
 * For each source:
 *   x        → X API v2 (only when X_BEARER_TOKEN is set)
 *   youtube  → channel page <meta og:title> / og:image
 *   blog     → page <meta og:title>/og:image, fallback <title> + favicons
 *   website  → same as blog
 *   podcast  → already enriched inline by resolvePodcast (iTunes
 *              artworkUrl600) — this helper does not re-fetch.
 *   pdf      → skipped on purpose.
 */
import { validatePublicHttpUrl } from "@/lib/safe-url";

export type BuilderEnrichment = {
  name?: string;
  avatarUrl?: string;
};

type EnrichmentInput = {
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
};

const USER_AGENT =
  "FollowBriefBot/1.0 (avatar resolver; +https://builder-blog.worldstatelabs.com)";

const FETCH_TIMEOUT_MS = 4000;

export async function enrichBuilderFromSource(
  input: EnrichmentInput,
): Promise<BuilderEnrichment> {
  const sourceType = (input.sourceType ?? "").toLowerCase();
  try {
    if (sourceType === "x") return await enrichX(input);
    if (sourceType === "youtube") return await enrichYouTube(input);
    if (sourceType === "blog" || sourceType === "website") {
      return await enrichHtmlPage(input);
    }
    // podcast: enriched inline by resolvePodcast (iTunes already gives
    // us collectionName + artworkUrl600 in the same response, so no
    // second fetch here).
    // pdf: skipped entirely.
    return {};
  } catch (error) {
    console.warn("[builder-enrichment] dispatch failed", { sourceType, error });
    return {};
  }
}

// ──────────────────────────────────────────────────────────────────
// X / Twitter — opportunistic, only when bearer token is configured.
// ──────────────────────────────────────────────────────────────────

async function enrichX(input: EnrichmentInput): Promise<BuilderEnrichment> {
  const bearer = process.env.X_BEARER_TOKEN?.trim();
  if (!bearer) return {};
  const handle = (input.handle ?? "").trim();
  if (!handle) return {};
  const apiUrl = `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=name,profile_image_url`;
  const check = validatePublicHttpUrl(apiUrl);
  if (!check.ok) return {};
  try {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${bearer}`,
      },
    });
    if (!response.ok) return {};
    const json = (await response.json().catch(() => null)) as
      | { data?: { name?: string; profile_image_url?: string } }
      | null;
    const data = json?.data;
    if (!data) return {};
    return {
      ...(data.name ? { name: data.name } : {}),
      ...(toSafeAvatarUrl(upgradeXAvatarSize(data.profile_image_url))
        ? { avatarUrl: toSafeAvatarUrl(upgradeXAvatarSize(data.profile_image_url)) ?? undefined }
        : {}),
    };
  } catch (error) {
    console.warn("[builder-enrichment] x fetch failed", { handle, error });
    return {};
  }
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

async function enrichYouTube(input: EnrichmentInput): Promise<BuilderEnrichment> {
  const pageUrl = input.sourceUrl ?? input.fetchUrl;
  if (!pageUrl) return {};
  const check = validatePublicHttpUrl(pageUrl);
  if (!check.ok) return {};
  try {
    const response = await fetchWithTimeout(pageUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return {};
    const html = await response.text().catch(() => "");
    if (!html) return {};
    const ogTitle = extractMetaContent(html, "og:title");
    const ogImage = extractMetaContent(html, "og:image");
    const name = ogTitle
      ? ogTitle.replace(/\s+-\s+YouTube\s*$/i, "").trim() || undefined
      : undefined;
    const avatarUrl = toSafeAvatarUrl(resolveMaybeRelative(ogImage, pageUrl));
    return {
      ...(name ? { name } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  } catch (error) {
    console.warn("[builder-enrichment] youtube fetch failed", { pageUrl, error });
    return {};
  }
}

// ──────────────────────────────────────────────────────────────────
// Generic HTML page (blog, website): og:title/og:image with fallbacks
// to <title> and apple-touch-icon / rel=icon. Every relative href is
// resolved against the page URL.
// ──────────────────────────────────────────────────────────────────

async function enrichHtmlPage(input: EnrichmentInput): Promise<BuilderEnrichment> {
  const pageUrl = input.sourceUrl ?? input.fetchUrl;
  if (!pageUrl) return {};
  const check = validatePublicHttpUrl(pageUrl);
  if (!check.ok) return {};
  try {
    const response = await fetchWithTimeout(pageUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return {};
    const html = await response.text().catch(() => "");
    if (!html) return {};
    const ogTitle = extractMetaContent(html, "og:title");
    const ogImage = extractMetaContent(html, "og:image");
    const titleTag = ogTitle ? null : extractTitleTag(html);
    const name = (ogTitle || titleTag || "").trim() || undefined;
    const rawAvatar =
      ogImage ||
      extractIconHref(html, /apple-touch-icon/i) ||
      extractIconHref(html, /(?:shortcut )?icon/i);
    const avatarUrl = toSafeAvatarUrl(resolveMaybeRelative(rawAvatar, pageUrl));
    return {
      ...(name ? { name } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  } catch (error) {
    console.warn("[builder-enrichment] html fetch failed", { pageUrl, error });
    return {};
  }
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
 * Tiny helper used by the POST/PATCH routes to decide which name wins
 * after enrichment. The user's typed display name (when non-empty)
 * always wins; otherwise the enriched name is preferred; otherwise the
 * resolver's derived name (handle / hostname / og:title-less fallback).
 */
export function pickFinalName(
  userTyped: string | null | undefined,
  resolved: string,
  enriched: string | null | undefined,
): string {
  const typed = (userTyped ?? "").trim();
  if (typed) return typed;
  const fromEnrichment = (enriched ?? "").trim();
  if (fromEnrichment) return fromEnrichment;
  return resolved;
}
