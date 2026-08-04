import { ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS } from "@/lib/admin-fetch-only-sources";

// A source that users cannot fetch must always have a FollowBrief-maintained producer.
export const PLATFORM_MAINTAINED_SOURCE_TYPE_IDS = ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS;

const PLATFORM_MAINTAINED_SOURCE_TYPE_SET = new Set<string>(
  PLATFORM_MAINTAINED_SOURCE_TYPE_IDS,
);

export function normalizePlatformMaintainedSourceType(
  sourceType: string | null | undefined,
) {
  return sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}

export function isPlatformMaintainedSourceType(
  sourceType: string | null | undefined,
) {
  return PLATFORM_MAINTAINED_SOURCE_TYPE_SET.has(
    normalizePlatformMaintainedSourceType(sourceType),
  );
}
