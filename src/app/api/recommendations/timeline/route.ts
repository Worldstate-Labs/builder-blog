import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRecommendationTimeline } from "@/lib/recommendations";
import { serializeRecommendationTimeline } from "@/lib/recommendation-view-model";

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timeline = await getRecommendationTimeline({
    userId: session.user.id,
    itemLimit: 6,
  });

  return NextResponse.json(serializeRecommendationTimeline(timeline));
}
