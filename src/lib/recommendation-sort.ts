export const defaultRecommendationSortMode = "recent";

export const recommendationSortModes = ["relevant", "recent"] as const;

export type RecommendationSortMode = (typeof recommendationSortModes)[number];

export function normalizeRecommendationSortMode(
  value: string | null | undefined,
): RecommendationSortMode {
  return value === "recent" ? "recent" : defaultRecommendationSortMode;
}
