const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "spm",
]);

function shouldDropParam(name: string) {
  const lower = name.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function normalizedPathname(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function canonicalPostUrl(value: string | null | undefined) {
  const input = String(value ?? "").trim();
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = normalizedPathname(url.pathname);
  const entries = [...url.searchParams.entries()]
    .filter(([key]) => !shouldDropParam(key))
    .sort(([aKey, aValue], [bKey, bValue]) => (
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)
    ));
  url.search = "";
  for (const [key, paramValue] of entries) url.searchParams.append(key, paramValue);
  return url.toString();
}

export function postUrlLookupVariants(value: string | null | undefined) {
  const input = String(value ?? "").trim();
  const variants = new Set<string>();
  if (!input) return [];
  variants.add(input);
  try {
    const url = new URL(input);
    url.hash = "";
    variants.add(url.toString());
    const canonical = canonicalPostUrl(input);
    if (canonical) {
      variants.add(canonical);
      const canonicalUrl = new URL(canonical);
      if (canonicalUrl.pathname !== "/") {
        canonicalUrl.pathname = `${canonicalUrl.pathname.replace(/\/+$/, "")}/`;
        variants.add(canonicalUrl.toString());
      }
    }
  } catch {
    // Non-URL input is not useful for server matching, but keeping the raw
    // value in the set makes the helper total and harmless.
  }
  return [...variants];
}
