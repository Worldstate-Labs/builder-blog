export const builderLibraryStatsChanged = "builder-blog:library-stats-changed";
export const builderLibrarySubscribeAll = "builder-blog:library-subscribe-all";

export type BuilderLibraryStatsChange = {
  crawledDelta?: number;
  inLibraryDelta?: number;
  subscribedDelta?: number;
  subscribedCount?: number;
};
