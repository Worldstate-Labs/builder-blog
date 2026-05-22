export function subscriptionBuilderIdsInPool(
  poolBuilderIds: string[],
  subscriptionBuilderIds: string[],
) {
  const pool = new Set(poolBuilderIds);
  return subscriptionBuilderIds.filter((builderId) => pool.has(builderId));
}
