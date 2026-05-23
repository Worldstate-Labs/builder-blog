import type {
  RecommendationResult,
  RecommendationSnapshotResult,
} from "@/lib/recommendations";
import type {
  RecommendationFeedEntry,
  RecommendationSnapshotEntry,
} from "@/components/RecommendationFeed";

export function serializeRecommendationTimeline(timeline: {
  snapshots: RecommendationSnapshotResult[];
  unreadRemaining: number;
  strategy: string;
}) {
  return {
    snapshots: timeline.snapshots.map(serializeRecommendationSnapshot),
    unreadRemaining: timeline.unreadRemaining,
    strategy: timeline.strategy,
  };
}

export function serializeRecommendationSnapshot(
  snapshot: RecommendationSnapshotResult,
): RecommendationSnapshotEntry {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt.toISOString(),
    reason: snapshot.reason,
    items: snapshot.items.map(serializeRecommendation),
  };
}

function serializeRecommendation(
  result: RecommendationResult & { rank: number; readAt: Date | null },
): RecommendationFeedEntry {
  return {
    score: result.score,
    reasons: result.reasons,
    rank: result.rank,
    readAt: result.readAt?.toISOString() ?? null,
    item: {
      id: result.item.id,
      title: result.item.title,
      body: result.item.body,
      url: result.item.url,
      publishedAt: result.item.publishedAt?.toISOString() ?? null,
      createdAt: result.item.createdAt.toISOString(),
      sourceName: result.item.sourceName,
      crawlingTool: result.item.crawlingTool,
      builder: result.item.builder
        ? {
            name: result.item.builder.name,
            sourceType: result.item.builder.sourceType,
            kind: result.item.builder.kind,
            sourceUrl: result.item.builder.sourceUrl,
            crawlUrl: result.item.builder.crawlUrl,
          }
        : null,
    },
  };
}
