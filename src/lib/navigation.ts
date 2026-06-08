export function normalizeLegacyReturnTo(value: string) {
  if (value.startsWith("/recommendations")) return "/dashboard?tab=following";
  if (value.startsWith("/history")) return "/dashboard?tab=ai-digest";
  return value;
}

export function postDetailHref(feedItemId: string, returnTo: string, returnLabel: string) {
  const params = new URLSearchParams({ returnLabel, returnTo });
  return `/posts/${feedItemId}?${params.toString()}`;
}
