export const ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS = [
  "github_trending",
  "product_hunt_top_products",
] as const;

const ADMIN_FETCH_ONLY_SOURCE_TYPE_SET = new Set<string>(
  ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS,
);

export function normalizeAdminFetchOnlySourceType(
  sourceType: string | null | undefined,
) {
  return sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}

export function isAdminFetchOnlySourceType(
  sourceType: string | null | undefined,
) {
  return ADMIN_FETCH_ONLY_SOURCE_TYPE_SET.has(
    normalizeAdminFetchOnlySourceType(sourceType),
  );
}
