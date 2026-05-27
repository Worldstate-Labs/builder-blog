import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRecommendationTimeline } from "@/lib/recommendations";
import { serializeRecommendationTimeline } from "@/lib/recommendation-view-model";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const timeline = await getRecommendationTimeline({
    userId: session.user.id,
    snapshotLimit: 1,
    itemLimit: 6,
    scope: recommendationScope(url.searchParams.get("scope")),
  });

  return NextResponse.json(serializeRecommendationTimeline(timeline));
}

function recommendationScope(value: string | null) {
  return value === "subscription" ? "subscription" : "for-you";
}
