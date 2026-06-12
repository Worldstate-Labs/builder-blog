/**
 * Decode the HTML entities that leak into AI-generated summaries and digest
 * text. The model (and some upstream crawlers) emit apostrophes and quotes as
 * `&#x27;` / `&#39;` / `&quot;`; because we render that text as plain React
 * children — not via dangerouslySetInnerHTML — the browser never decodes them,
 * so readers see the literal `we&#x27;d` instead of `we'd`.
 *
 * This is a deliberately small, allowlisted decoder: it runs on both the server
 * and the client (no DOM dependency) and only resolves the handful of named
 * entities plus numeric/hex character references. It never interprets markup,
 * so it is safe to run over text that is subsequently rendered as plain text.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;

/**
 * Resolve a single character reference. Returns the original token unchanged
 * when it is not one we recognise, so unknown entities are left intact rather
 * than silently dropped.
 */
function decodeEntity(token: string, body: string): string {
  if (body[0] === "#") {
    const isHex = body[1] === "x" || body[1] === "X";
    const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
      return token;
    }
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return token;
    }
  }

  const named = NAMED_ENTITIES[body.toLowerCase()];
  return named ?? token;
}

export function decodeHtmlEntities(value: string): string {
  if (!value || value.indexOf("&") === -1) return value;
  return value.replace(ENTITY_PATTERN, (match, body: string) => decodeEntity(match, body));
}
