// Server-enforced minimum that guarantees a post actually carries real crawled
// text before it can be persisted to the cloud. Mirrors the length floor of the
// CLI's `genericContentQuality` (minChars / minContentUnits) using the same per-source
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
const DEFAULT_MIN_CONTENT_UNITS = 1;

const CJK_UNIT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ALNUM_UNIT = /[\p{Letter}\p{Number}]/u;
const TIMESTAMP_TOKEN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

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

function readPositiveIntCompat(
  standards: unknown,
  primaryField: string,
  legacyField: string,
): number | undefined {
  return readPositiveInt(standards, primaryField) ?? readPositiveInt(standards, legacyField);
}

// Content units are language-neutral enough for gating: Latin/number runs count
// as one unit, while CJK scripts count per character. Timestamps are removed
// first so time-only transcripts do not satisfy the content floor.
function contentUnits(text: string): string[] {
  const units: string[] = [];
  let current = "";
  for (const char of text.replace(TIMESTAMP_TOKEN, " ")) {
    if (CJK_UNIT.test(char)) {
      if (current) {
        units.push(current.toLowerCase());
        current = "";
      }
      units.push(char);
    } else if (ALNUM_UNIT.test(char)) {
      current += char;
    } else if (current) {
      units.push(current.toLowerCase());
      current = "";
    }
  }
  if (current) units.push(current.toLowerCase());
  return units;
}

// `standards` accepts the source config's `contentQuality` verbatim (untyped
// Json) — only minChars / minContentUnits are read.
export function checkBodyContentQuality(
  body: string | null | undefined,
  standards?: unknown,
): ContentQualityVerdict {
  const normalized = String(body ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return { ok: false, reason: "content_missing" };
  const minChars = readPositiveInt(standards, "minChars") ?? DEFAULT_MIN_CHARS;
  const minContentUnits =
    readPositiveIntCompat(standards, "minContentUnits", "minWords") ??
    DEFAULT_MIN_CONTENT_UNITS;
  if (normalized.length < minChars || contentUnits(normalized).length < minContentUnits) {
    return { ok: false, reason: "content_too_short" };
  }
  return { ok: true };
}
