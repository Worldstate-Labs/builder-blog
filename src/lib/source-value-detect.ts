/**
 * Cross-platform detection helpers shared by the server-side validator
 * (`personal-builder-input.ts`) and the client-side inline preview
 * (`AddBuilderForm.tsx`). Pure functions, no Prisma / no DOM imports —
 * safe to bundle into the client without dragging in server modules.
 *
 * The split into discrete helpers is deliberate:
 *
 *  - `detectSourceTypeFromValue`: best-effort guess of which source type
 *    the user *probably* meant from the URL/handle they pasted. Returns
 *    null when the value is too ambiguous (bare handles, RSS URLs, etc.).
 *  - `crossTypeWarning`: pairs the detected type against the declared
 *    source type and returns a "looks like X — switch?" suggestion.
 *  - `podcastHostnameRejection`: hard-rejects known-unsupported podcast
 *    platforms (Spotify, 小宇宙, 喜马拉雅, 网易云) with a user-facing
 *    reason.
 *  - `isLikelyEpisodeOrPostUrl`: catches per-item URLs (single tweet,
 *    single video) that should be channel-level instead.
 */

export type DetectedSourceId =
  | "x"
  | "blog"
  | "github_trending"
  | "product_hunt_top_products"
  | "youtube"
  | "podcast"
  | "website";

export const DETECTED_SOURCE_LABELS: Record<DetectedSourceId, string> = {
  x: "X/Twitter",
  blog: "Blog",
  github_trending: "GitHub Trending",
  product_hunt_top_products: "Product Hunt Top Products",
  youtube: "YouTube",
  podcast: "Podcast",
  website: "Website",
};

/**
 * Detect the probable source type from a raw user input. Returns null
 * when the input is too ambiguous to assign confidently (bare handles
 * without a host, plain RSS feed URLs without a known publisher).
 */
export function detectSourceTypeFromValue(value: string): DetectedSourceId | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;

  if (/(^|\/\/)(www\.)?(x|twitter)\.com\//.test(v)) return "x";
  if (/(^|\/\/)github\.com\/trending(\?|\/|$)/.test(v)) return "github_trending";
  if (/(^|\/\/)(www\.)?producthunt\.com\/?(?:[?#]|$)/.test(v)) {
    return "product_hunt_top_products";
  }
  if (/(^|\/\/)(www\.)?producthunt\.com\/products(?:\/|[?#]|$)/.test(v)) {
    return "product_hunt_top_products";
  }
  if (/(^|\/\/)(www\.)?(youtube\.com|youtu\.be)\//.test(v)) return "youtube";

  if (/(^|\/\/)podcasts\.apple\.com\//.test(v)) return "podcast";
  if (/(^|\/\/)open\.spotify\.com\/show\//.test(v)) return "podcast";
  if (/(^|\/\/)(www\.)?xiaoyuzhoufm\.com\//.test(v)) return "podcast";
  if (/(^|\/\/)(www\.)?ximalaya\.com\//.test(v)) return "podcast";
  if (/(^|\/\/)music\.163\.com\/[^/]*\/?#?\/?djradio/.test(v)) return "podcast";
  if (/(^|\/\/)overcast\.fm\/itunes/.test(v)) return "podcast";

  // Substack / Medium / common blog hosts.
  if (/\.substack\.com(\/|$)/.test(v)) return "blog";
  if (/(^|\/\/)(www\.)?medium\.com\//.test(v) || /\.medium\.com(\/|$)/.test(v)) return "blog";

  return null;
}

/**
 * If the declared source type clearly mismatches what the user pasted,
 * return a suggestion. Null when no confident mismatch exists.
 */
export function crossTypeWarning(
  declared: string,
  value: string,
): { suggestId: DetectedSourceId; message: string } | null {
  const detected = detectSourceTypeFromValue(value);
  if (!detected || detected === declared) return null;
  return {
    suggestId: detected,
    message: `This looks like a ${DETECTED_SOURCE_LABELS[detected]} URL. Switch source type?`,
  };
}

/**
 * Hard-rejection messages for known-unsupported podcast directories
 * (Spotify show pages, 小宇宙, 喜马拉雅, 网易云). We can't extract an
 * RSS feed from these, so accepting them would just produce a broken
 * builder.
 */
export function podcastHostnameRejection(value: string): string | null {
  const v = value.toLowerCase();
  if (/(^|\/\/)open\.spotify\.com\/show\//.test(v)) {
    return "Spotify does not expose podcast RSS. Paste an Apple Podcasts or RSS feed URL.";
  }
  if (/(^|\/\/)(www\.)?xiaoyuzhoufm\.com\//.test(v)) {
    return "小宇宙 does not expose RSS feeds. Paste an Apple Podcasts or RSS feed URL.";
  }
  if (/(^|\/\/)(www\.)?ximalaya\.com\//.test(v)) {
    return "喜马拉雅 uses a proprietary protocol. Its content cannot be imported via RSS.";
  }
  if (/(^|\/\/)music\.163\.com/.test(v)) {
    return "网易云音乐 uses a proprietary protocol. Content cannot be imported via RSS.";
  }
  return null;
}

/**
 * Catch URLs that point at a single item (tweet, video) rather than the
 * channel/profile feed. Returns a user-facing reason when the URL is
 * single-item-shaped for the declared source type.
 */
export function isLikelyEpisodeOrPostUrl(declared: string, value: string): string | null {
  const v = value.trim();
  if (declared === "youtube") {
    if (/youtube\.com\/watch\?v=/i.test(v)) {
      return "Single-video URL. Paste the channel URL (e.g. https://youtube.com/@channel) instead.";
    }
    if (/youtu\.be\/[A-Za-z0-9_-]/i.test(v)) {
      return "Single-video URL. Paste the channel URL (e.g. https://youtube.com/@channel) instead.";
    }
  }
  if (declared === "x") {
    if (/(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(v)) {
      return "Single-tweet URL. Paste the profile URL (e.g. https://x.com/handle) instead.";
    }
  }
  return null;
}
