/**
 * Pure helper for picking the "primary" channel variant for a (user, entity) group.
 * Lives in its own module so consumers (and tests) can use it without pulling in Prisma.
 */

export type ChannelVariant = {
  builderId: string;
  ownerUserId: string;
  /**
   * When this specific copy of the post was last written by a sync — i.e. when it
   * was last fetched and summarized. This is per-post, unlike `lastFetchedAt`,
   * which moves for every post of the channel.
   */
  itemUpdatedAt: Date | null;
  lastFetchedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
};

/**
 * Order:
 *   1. User-pinned primary channel.
 *   2. Channels owned by the user, if any exist (imported/cloud copies lose to them).
 *   3. Within that tie group — all-own or all-not-own alike — the copy that was
 *      fetched and summarized most recently.
 *
 * Rule 3 deliberately ranks on the post's own write time first: a channel's
 * `lastFetchedAt` advances on every run of that channel, so it says nothing about
 * when *this* post was last summarized. Ranking on it alone froze a group onto
 * whichever channel ran last, even when another library held a newer copy of the
 * very same post.
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
  const own = variants.filter((v) => v.ownerUserId === userId);
  const pool = own.length > 0 ? own : variants;
  return [...pool].sort((a, b) => {
    const delta = variantFreshness(b) - variantFreshness(a);
    // Stable, deterministic order when two copies carry the same timestamp.
    return delta !== 0 ? delta : a.builderId.localeCompare(b.builderId);
  })[0]!;
}

function variantFreshness(variant: ChannelVariant): number {
  return (
    variant.itemUpdatedAt ??
    variant.lastFetchedAt ??
    variant.publishedAt ??
    variant.createdAt
  ).getTime();
}
