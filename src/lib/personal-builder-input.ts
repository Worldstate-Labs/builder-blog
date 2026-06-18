import { BuilderKind } from "@prisma/client";
import { builderKindForSourceType } from "@/lib/source-registry";
import { normalizeHandle } from "@/lib/builder-keys";
import { toSafeAvatarUrl, type BuilderEnrichment } from "@/lib/builder-enrichment";
import {
  crossTypeWarning,
  isLikelyEpisodeOrPostUrl,
  podcastHostnameRejection,
  type DetectedSourceId,
} from "@/lib/source-value-detect";

export type PersonalBuilderInput = {
  kind: BuilderKind;
  sourceType: string;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  fetchUrl: string | null;
};

/**
 * Discriminated-union result. Success carries an optional non-blocking
 * warning (e.g. "Couldn't reach Apple to pre-resolve RSS — agent will
 * Local Agent will retry at sync time"). Failure carries a user-facing reason and an
 * optional suggestId so the UI can offer "switch to <type> and retry".
 */
export type ResolutionSuccess = {
  ok: true;
  value: PersonalBuilderInput;
  warning?: string;
  /**
   * Optional pre-resolved enrichment carried inline from the resolver
   * when the source's response already contained name/avatar fields
   * (e.g. podcast's iTunes lookup gives us `collectionName` and
   * `artworkUrl600` in the same call). Lets `POST /api/builders/personal`
   * skip a second network round-trip.
   */
  enrichment?: BuilderEnrichment;
};

export type ResolutionFailure = {
  ok: false;
  reason: string;
  suggestId?: DetectedSourceId;
};

export type Resolution = ResolutionSuccess | ResolutionFailure;

export const GITHUB_TRENDING_SOURCE_ID = "github_trending";
export const GITHUB_TRENDING_URL = "https://github.com/trending?since=daily";
export const PRODUCT_HUNT_TOP_PRODUCTS_SOURCE_ID = "product_hunt_top_products";
export const PRODUCT_HUNT_TOP_PRODUCTS_URL = "https://www.producthunt.com/";

/**
 * Resolve, validate, and auto-correct the user's AddBuilderForm input.
 * Async because the podcast path may call iTunes lookup to pre-resolve
 * the RSS feedUrl when an Apple Podcasts directory URL is pasted —
 * doing it here means the CLI doesn't have to re-resolve on every sync.
 */
export async function resolvePersonalBuilderInput(input: {
  displayName: string;
  sourceType: string;
  sourceValue: string;
}): Promise<Resolution> {
  const sourceType = normalizeSourceType(input.sourceType) || "x";
  const value = input.sourceValue.trim();
  if (!value) {
    return { ok: false, reason: "Source URL or handle is required." };
  }

  if (sourceType === GITHUB_TRENDING_SOURCE_ID) {
    return resolveGithubTrending(input.displayName);
  }
  if (sourceType === PRODUCT_HUNT_TOP_PRODUCTS_SOURCE_ID) {
    return resolveProductHuntTopProducts(input.displayName);
  }

  // Cross-type mismatch: user is in X mode but pasted a YouTube URL,
  // etc. Reject fast with a "switch to <type>" suggestion the UI can
  // surface as a one-click fix.
  const cross = crossTypeWarning(sourceType, value);
  if (cross) {
    return { ok: false, reason: cross.message, suggestId: cross.suggestId };
  }

  // Single-item URL: user pasted a single tweet / video URL when they
  // meant the channel/profile.
  const single = isLikelyEpisodeOrPostUrl(sourceType, value);
  if (single) {
    return { ok: false, reason: single };
  }

  if (sourceType === "x") return resolveX(input.displayName, value);
  if (sourceType === "youtube") return resolveYouTube(input.displayName, value);
  if (sourceType === "podcast") return resolvePodcast(input.displayName, value);
  if (sourceType === "blog") return resolveBlog(input.displayName, value);
  return resolveWebsite(input.displayName, sourceType, value);
}

// ──────────────────────────────────────────────────────────────────
// Per-source resolvers. Each returns Resolution directly so reason
// strings stay close to the validation logic they describe.
// ──────────────────────────────────────────────────────────────────

function resolveX(displayName: string, value: string): Resolution {
  const handle = handleFromXValue(value);
  if (!handle) {
    return {
      ok: false,
      reason: "X handle must look like @deepmind, or a full https://x.com/deepmind URL.",
    };
  }
  return {
    ok: true,
    value: {
      kind: BuilderKind.X,
      sourceType: "x",
      name: displayName.trim() || `@${handle}`,
      handle,
      sourceUrl: `https://x.com/${handle}`,
      fetchUrl: null,
    },
  };
}

function resolveYouTube(displayName: string, value: string): Resolution {
  const sourceUrl = youtubeUrlFromValue(value);
  if (!sourceUrl) {
    return {
      ok: false,
      reason: "YouTube source must be a youtube.com or youtu.be URL, or an @channel handle.",
    };
  }
  return {
    ok: true,
    value: {
      kind: builderKindForSourceType("youtube"),
      sourceType: "youtube",
      name: displayName.trim() || nameFromYouTubeUrl(sourceUrl),
      handle: null,
      sourceUrl,
      fetchUrl: null,
    },
  };
}

async function resolvePodcast(displayName: string, value: string): Promise<Resolution> {
  const rejection = podcastHostnameRejection(value);
  if (rejection) return { ok: false, reason: rejection };

  const sourceUrl = normalizedUrl(value);
  if (!sourceUrl) {
    return {
      ok: false,
      reason: "Paste an Apple Podcasts URL or the show's RSS feed URL.",
    };
  }

  // Apple Podcasts: pre-resolve the publisher's RSS via iTunes lookup
  // so the CLI doesn't repeat the call on every sync. 4s timeout +
  // graceful fallback so a flaky Apple endpoint never blocks the form.
  // The same response also gives us `collectionName` (display name)
  // and `artworkUrl600` (avatar), so we surface them inline as
  // enrichment without a second round-trip.
  const appleMatch = sourceUrl.match(/podcasts\.apple\.com\/[^?\s]*\/id(\d+)/i);
  let fetchUrl: string | null = null;
  let warning: string | undefined;
  let resolvedName: string | null = null;
  let enrichment: BuilderEnrichment | undefined;

  if (appleMatch) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const lookup = await fetch(`https://itunes.apple.com/lookup?id=${appleMatch[1]}`, {
        headers: { "User-Agent": "FollowBrief/1.0 (apple podcast resolver)" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (lookup.ok) {
        const json = (await lookup.json().catch(() => null)) as
          | {
              resultCount?: number;
              results?: Array<{
                feedUrl?: string;
                collectionName?: string;
                artworkUrl600?: string;
                artworkUrl100?: string;
              }>;
            }
          | null;
        const results = json?.results ?? [];
        // Apple's lookup is the canonical source for "does this podcast
        // exist?". Zero results means the id is wrong / the show was
        // pulled — treat that as a hard rejection so the user gets a
        // concrete reason instead of an empty library row.
        if (results.length === 0) {
          return {
            ok: false,
            reason:
              "Apple Podcasts has no record of this show. Paste the actual RSS feed URL instead.",
          };
        }
        const result = results[0];
        if (result?.feedUrl) {
          fetchUrl = result.feedUrl;
          if (result.collectionName) resolvedName = result.collectionName;
        } else {
          warning =
            "Apple returned no RSS feed for this podcast. Your Local Agent will retry at sync time.";
        }
        const artwork =
          toSafeAvatarUrl(result?.artworkUrl600) ??
          toSafeAvatarUrl(result?.artworkUrl100);
        if (result?.collectionName || artwork) {
          enrichment = {
            ...(result?.collectionName ? { name: result.collectionName } : {}),
            ...(artwork ? { avatarUrl: artwork } : {}),
          };
        }
      } else {
        warning = "Apple lookup failed. Your Local Agent will retry at sync time.";
      }
    } catch {
      warning = "Could not reach Apple to resolve the RSS feed. Your Local Agent will retry at sync time.";
    }
  }

  return {
    ok: true,
    value: {
      kind: BuilderKind.PODCAST,
      sourceType: "podcast",
      name: displayName.trim() || resolvedName || nameFromUrl(sourceUrl),
      handle: null,
      sourceUrl,
      fetchUrl,
    },
    ...(warning ? { warning } : {}),
    ...(enrichment ? { enrichment } : {}),
  };
}

function resolveBlog(displayName: string, value: string): Resolution {
  const sourceUrl = normalizedUrl(value);
  if (!sourceUrl) return { ok: false, reason: "URL is malformed." };

  // Substack convenience: <sub>.substack.com → the publisher always
  // hosts an RSS feed at /feed. Store it so the CLI doesn't have to
  // guess.
  const substackMatch = sourceUrl.match(/^(https?:\/\/[^/]+\.substack\.com)\/?$/i);
  const fetchUrl = substackMatch ? `${substackMatch[1]}/feed` : null;

  return {
    ok: true,
    value: {
      kind: builderKindForSourceType("blog"),
      sourceType: "blog",
      name: displayName.trim() || nameFromUrl(sourceUrl),
      handle: null,
      sourceUrl,
      fetchUrl,
    },
  };
}

function resolveGithubTrending(displayName: string): Resolution {
  return {
    ok: true,
    value: {
      kind: builderKindForSourceType(GITHUB_TRENDING_SOURCE_ID),
      sourceType: GITHUB_TRENDING_SOURCE_ID,
      name: displayName.trim() || "GitHub Trending",
      handle: null,
      sourceUrl: GITHUB_TRENDING_URL,
      fetchUrl: GITHUB_TRENDING_URL,
    },
  };
}

function resolveProductHuntTopProducts(displayName: string): Resolution {
  return {
    ok: true,
    value: {
      kind: builderKindForSourceType(PRODUCT_HUNT_TOP_PRODUCTS_SOURCE_ID),
      sourceType: PRODUCT_HUNT_TOP_PRODUCTS_SOURCE_ID,
      name: displayName.trim() || "Product Hunt Top Products",
      handle: null,
      sourceUrl: PRODUCT_HUNT_TOP_PRODUCTS_URL,
      fetchUrl: PRODUCT_HUNT_TOP_PRODUCTS_URL,
    },
  };
}

function resolveWebsite(displayName: string, sourceType: string, value: string): Resolution {
  const sourceUrl = normalizedUrl(value);
  if (!sourceUrl) return { ok: false, reason: "URL is malformed." };
  return {
    ok: true,
    value: {
      kind: builderKindForSourceType(sourceType),
      sourceType,
      name: displayName.trim() || nameFromUrl(sourceUrl),
      handle: null,
      sourceUrl,
      fetchUrl: null,
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// Helpers (unchanged in behavior from the original implementation;
// kept private to this module).
// ──────────────────────────────────────────────────────────────────

function handleFromXValue(value: string) {
  // URL-shaped input (with or without protocol): pull the first path
  // segment as the handle.
  const url = coerceToUrl(value, { hostMatch: /(^|\.)(x|twitter)\.com$/i });
  if (url) {
    const [handle] = url.pathname.split("/").filter(Boolean);
    return handle ? normalizeHandle(handle) : null;
  }
  // Bare handle ("@karpathy" or "karpathy"). X handles are
  // [A-Za-z0-9_]{1,15} — reject anything with "/" or "." so a partial
  // URL can't slip through this branch.
  const bare = value.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(bare)) return null;
  return normalizeHandle(bare);
}

/**
 * Single source of truth for "is this string a URL?" across every
 * personal-builder resolver. Accepts URLs with or without a protocol
 * but rejects bare handles ("@karpathy"), single words ("abc"), and
 * anything whose hostname doesn't contain a dot (i.e. not a real
 * registered domain shape).
 *
 * Pass `hostMatch` to additionally require the resolved hostname
 * match a platform regex (e.g. only x.com / twitter.com for X).
 */
function coerceToUrl(
  value: string,
  options: { hostMatch?: RegExp } = {},
): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // "@handle" inputs are bare handles, not URLs. They belong in
  // each platform's handle branch.
  if (trimmed.startsWith("@")) return null;
  // Cheap host shape check before we throw at new URL() — must look
  // like at least one label + dot + TLD-ish suffix, optionally with
  // a path or query. This is what excludes bare words like "abc".
  const looksLikeHost =
    /^(?:https?:\/\/)?[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(?:[\/:?#]|$)/i.test(trimmed);
  if (!looksLikeHost) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  if (!url.hostname || !url.hostname.includes(".")) return null;
  if (options.hostMatch && !options.hostMatch.test(url.hostname)) return null;
  return url;
}

function normalizedUrl(value: string) {
  return coerceToUrl(value)?.toString() ?? null;
}

function youtubeUrlFromValue(value: string) {
  // URL-shaped input: parse via the shared coercer with a YouTube
  // host whitelist.
  const url = coerceToUrl(value, {
    hostMatch: /(^|\.)(youtube\.com|youtu\.be)$/i,
  });
  if (url) return url.toString();
  // Bare @handle ("@RedpointAI" or "RedpointAI"). YouTube handles
  // accept [A-Za-z0-9_.-]; reject "/" so partial URLs can't pass.
  const handle = value.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(handle)) return null;
  return `https://www.youtube.com/@${handle}`;
}

function nameFromYouTubeUrl(value: string) {
  try {
    const url = new URL(value);
    const [firstPathPart] = url.pathname.split("/").filter(Boolean);
    if (firstPathPart?.startsWith("@")) return firstPathPart.slice(1);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function nameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function normalizeSourceType(sourceType: string) {
  const normalized = sourceType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "pdf" ? "website" : normalized;
}
