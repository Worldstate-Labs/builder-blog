/**
 * SSRF defense for user-supplied URLs that the server will later fetch
 * (RSS feeds, blog index pages, podcast feeds, YouTube channels,
 * `fetchUrl` field on a personal builder, etc.).
 *
 * `validatePublicHttpUrl` returns the parsed URL when the string is a
 * well-formed http(s) URL whose host is a public, routable domain or
 * IP. Anything else — IPv4/IPv6 in private/loopback/link-local/CGNAT
 * ranges, `localhost`, the AWS/GCP metadata IPs, IPv4-mapped IPv6
 * forms, and non-http schemes — is rejected with a short reason.
 *
 * This is a SYNCHRONOUS structural check. It does not resolve the
 * hostname, so a public-looking hostname can still point at a private
 * IP at fetch time. Pair this with a fetch-side hook (or a fetch
 * proxy) for full coverage; for now this blocks the obvious cases
 * (literal IP, `.local`, `localhost`, metadata.google.internal etc.).
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intra",
  ".corp",
  ".lan",
  ".home",
  ".home.arpa",
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1") return true;
  if (lower === "::") return true;
  // Unique-local fc00::/7
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // Multicast ff00::/8
  if (lower.startsWith("ff")) return true;
  // IPv4-mapped IPv6 ::ffff:a.b.c.d — check the wrapped IPv4 too
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped && isPrivateIPv4(mapped[1])) return true;
  return false;
}

export function validatePublicHttpUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL is invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http(s) URLs are allowed" };
  }
  const host = url.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: "URL is missing a host" };
  }
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: "URL points at a reserved hostname" };
  }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      return { ok: false, reason: "URL points at a reserved hostname" };
    }
  }
  // IPv4 literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIPv4(host)) {
    return { ok: false, reason: "URL points at a private network address" };
  }
  // IPv6 literal (URL.hostname for v6 includes the brackets stripped)
  if (host.includes(":") && isPrivateIPv6(host)) {
    return { ok: false, reason: "URL points at a private network address" };
  }
  return { ok: true, url };
}
