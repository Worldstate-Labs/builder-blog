export function normalizeLegacyReturnTo(value: string) {
  if (value.startsWith("/recommendations")) return "/dashboard?tab=following";
  if (value.startsWith("/history")) return "/dashboard?tab=ai-digest";
  return value;
}

export function postReturnToFromPath(pathname: string, returnTo?: string | null) {
  if (!pathname.startsWith("/posts/")) return "";
  return normalizeLegacyReturnTo(returnTo ?? "");
}

export function postDetailHref(feedItemId: string, returnTo: string, returnLabel: string) {
  return withPostReturnTarget(`/posts/${feedItemId}`, returnTo, returnLabel);
}

export function withPostReturnTarget(href: string, returnTo: string, returnLabel: string) {
  if (!href.startsWith("/posts/")) return href;
  const [pathname, existingQuery = ""] = href.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set("returnTo", returnTo);
  params.set("returnLabel", returnLabel);
  return `${pathname}?${params.toString()}`;
}
