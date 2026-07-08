import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRecommendationTimeline } from "@/lib/recommendations";
import { serializeRecommendationTimeline } from "@/lib/recommendation-view-model";
import { normalizeRecommendationSortMode } from "@/lib/recommendation-sort";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const timeline = await getRecommendationTimeline({
    userId: session.user.id,
    itemLimit: 6,
    sortMode: normalizeRecommendationSortMode(url.searchParams.get("sort")),
  });

  return NextResponse.json(serializeRecommendationTimeline(timeline));
}
