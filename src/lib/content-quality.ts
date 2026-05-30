// Server-enforced minimum that guarantees a post actually carries real crawled
// text before it can be persisted to the cloud. Mirrors the length floor of the
// CLI's `genericContentQuality` (minChars / minWords) using the same per-source
// standards (SourceTypeConfig.contentQuality). The deeper semantic checks —
// disallowed primary sources, near-duplicate-of-title, transcript ratios — stay
// in the client-side validate-agent-sync step; this is the bypass-proof floor.

export type ContentQualityReason = "content_missing" | "content_too_short";
export type ContentQualityVerdict =
  | { ok: true }
  | { ok: false; reason: ContentQualityReason };

// Fallback floor when a source has no configured standards. 1/1 means "any
// non-whitespace text", so we never reject more than an unconfigured source did.
const DEFAULT_MIN_CHARS = 1;
const DEFAULT_MIN_WORDS = 1;

// Latin/CJK word tokens, matching the CLI's word heuristic.
const WORD_TOKEN = /[A-Za-z0-9一-鿿]+/g;

// Pull a positive integer field out of an untyped standards object (the source
// config's contentQuality is stored as Prisma Json), else undefined.
function readPositiveInt(standards: unknown, field: string): number | undefined {
  if (standards && typeof standards === "object" && !Array.isArray(standards)) {
    const value = (standards as Record<string, unknown>)[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return undefined;
}

// `standards` accepts the source config's `contentQuality` verbatim (untyped
// Json) — only minChars / minWords are read.
export function checkBodyContentQuality(
  body: string | null | undefined,
  standards?: unknown,
): ContentQualityVerdict {
  const normalized = String(body ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return { ok: false, reason: "content_missing" };
  const words = normalized.match(WORD_TOKEN) ?? [];
  const minChars = readPositiveInt(standards, "minChars") ?? DEFAULT_MIN_CHARS;
  const minWords = readPositiveInt(standards, "minWords") ?? DEFAULT_MIN_WORDS;
  if (normalized.length < minChars || words.length < minWords) {
    return { ok: false, reason: "content_too_short" };
  }
  return { ok: true };
}
