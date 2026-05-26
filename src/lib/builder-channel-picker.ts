/**
 * Pure helper for picking the "primary" channel variant for a (user, entity) group.
 * Lives in its own module so consumers (and tests) can use it without pulling in Prisma.
 */

export type ChannelVariant = {
  builderId: string;
  ownerUserId: string;
  lastCrawledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
};

/**
 * Order:
 *   1. User-pinned primary channel.
 *   2. Channel owned by the user.
 *   3. Channel with the most recent crawl / publish / create timestamp.
 */
export function pickPrimaryVariant<T extends ChannelVariant>(
  variants: T[],
  userId: string,
  pinnedBuilderId?: string | null,
): T {
  if (pinnedBuilderId) {
    const match = variants.find((v) => v.builderId === pinnedBuilderId);
    if (match) return match;
  }
  const own = variants.find((v) => v.ownerUserId === userId);
  if (own) return own;
  return [...variants].sort((a, b) => {
    const aTime = (a.lastCrawledAt ?? a.publishedAt ?? a.createdAt).getTime();
    const bTime = (b.lastCrawledAt ?? b.publishedAt ?? b.createdAt).getTime();
    return bTime - aTime;
  })[0]!;
}
