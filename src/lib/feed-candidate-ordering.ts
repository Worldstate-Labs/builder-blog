export type SourceCoverageCandidate = {
  entityId: string;
};

/**
 * Preserve the incoming recency order, but when a limit is applied, first reserve
 * one slot for each source/entity that has candidates. If there are more sources
 * than slots, the sources with the newest representative win.
 */
export function prioritizeSourceCoverage<T extends SourceCoverageCandidate>(
  items: T[],
  limit?: number,
): T[] {
  if (!limit || items.length <= limit) return items;

  const selected = new Set<T>();
  const seenEntities = new Set<string>();
  const prioritized: T[] = [];

  for (const item of items) {
    if (seenEntities.has(item.entityId)) continue;
    seenEntities.add(item.entityId);
    selected.add(item);
    prioritized.push(item);
    if (prioritized.length >= limit) return prioritized;
  }

  for (const item of items) {
    if (selected.has(item)) continue;
    prioritized.push(item);
    if (prioritized.length >= limit) return prioritized;
  }

  return prioritized;
}
