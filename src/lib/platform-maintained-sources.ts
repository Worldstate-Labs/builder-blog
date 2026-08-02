export const PLATFORM_MAINTAINED_SOURCE_TYPE_IDS = ["new_product_launches"] as const;

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
