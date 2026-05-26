export const builderLibraryStatsChanged = "builder-blog:library-stats-changed";
export const builderLibrarySubscribeAll = "builder-blog:library-subscribe-all";
export const builderLibraryBuilderAdded = "builder-blog:library-builder-added";

export type BuilderLibraryEventItem = {
  allowRemove: boolean;
  crawlLabel: string;
  crawlUrl: string | null;
  /** Canonical creator id — drives builder-detail navigation and per-entity Follow state. */
  entityId: string | null;
  feedItemCount: number;
  handle: string | null;
  id: string;
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  latestPostCreatedAt: string | null;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  subscribed: boolean;
};

export type BuilderLibraryStatsChange = {
  crawledCount?: number;
  crawledDelta?: number;
  inLibraryCount?: number;
  inLibraryDelta?: number;
  subscribedDelta?: number;
  subscribedCount?: number;
};
