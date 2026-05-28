export const builderLibraryStatsChanged = "builder-blog:library-stats-changed";
export const builderLibrarySubscribeAll = "builder-blog:library-subscribe-all";
export const builderLibraryBuilderAdded = "builder-blog:library-builder-added";

export type BuilderLibraryEventItem = {
  allowRemove: boolean;
  /** Real photo/thumbnail/artwork resolved server-side at add time; null when the source didn't expose one or enrichment was skipped (e.g. pdf, X without X_BEARER_TOKEN). UI falls back to a favicon or monogram. */
  avatarUrl: string | null;
  fetchUrl: string | null;
  /** Canonical creator id — used for grouping channels and navigation to /builder/[entityId]. Subscription itself stays per-channel. */
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
  fetchedCount?: number;
  fetchedDelta?: number;
  inLibraryCount?: number;
  inLibraryDelta?: number;
  subscribedDelta?: number;
  subscribedCount?: number;
};
