import { redirect } from "next/navigation";

export default async function LegacyRecommendationItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ feedItemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { feedItemId } = await params;
  const query = new URLSearchParams();
  const resolvedSearchParams = await searchParams;
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
    } else if (value) {
      query.set(key, value);
    }
  }
  const returnTo = query.get("returnTo") ?? "";
  if (!returnTo || returnTo.startsWith("/recommendations")) {
    query.set("returnTo", "/dashboard?tab=following");
    query.set("returnLabel", "Following");
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  redirect(`/posts/${feedItemId}${suffix}`);
}
