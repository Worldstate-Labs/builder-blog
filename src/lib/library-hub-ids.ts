export function mergeAdminCommunityBuilderIds(
  personalBuilderIds: string[],
  preservedCentralBuilderIds: string[],
) {
  return [...new Set([...personalBuilderIds, ...preservedCentralBuilderIds].filter(Boolean))];
}
