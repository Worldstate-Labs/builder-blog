/**
 * Pure helper for picking the "primary" channel variant for a (user, entity) group.
 * Lives in its own module so consumers (and tests) can use it without pulling in Prisma.
 */

import { actualContentLanguagesMatch, normalizeConcreteLanguageTag } from "@/lib/content-language";
import { isOriginalContentLanguagePreference } from "@/lib/language-preference";

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
  /** Language this copy's summary is written in, when known. */
  summaryContentLanguage?: string | null;
  /** Whether this copy comes from a library that summarizes in the original content language. */
  fromOriginalLanguageLibrary?: boolean;
};

/**
 * Order:
 *   1. User-pinned primary channel.
 *   2. When `preferredSummaryLanguage` is set, copies whose summary is written in
 *      that language; failing that, copies from the original-language library.
 *      Callers that do not care about language (the reading feed) skip this step.
 *   3. Channels owned by the user, if any survive (imported/cloud copies lose to them).
 *   4. Within whatever group survives, the copy fetched and summarized most recently.
 *
 * Step 4 deliberately ranks on the post's own write time first: a channel's
 * `lastFetchedAt` advances on every run of that channel, so it says nothing about
 * when *this* post was last summarized. Ranking on it alone froze a group onto
 * whichever channel ran last, even when another library held a newer copy of the
 * very same post.
 */
export function pickPrimaryVariant<T extends ChannelVariant>(
  variants: T[],
  userId: string,
  pinnedBuilderId?: string | null,
  preferredSummaryLanguage?: string | null,
): T {
  if (pinnedBuilderId) {
    const match = variants.find((v) => v.builderId === pinnedBuilderId);
    if (match) return match;
  }
  // Language before ownership, not after: a brief asked for one language must not
  // be dragged back into another one just because the reader happens to own a
  // copy of that post. With no language preference this is a no-op and ownership
  // decides, as it does for the reading feed.
  const languageMatches = preferLanguage(variants, preferredSummaryLanguage);
  const own = languageMatches.filter((v) => v.ownerUserId === userId);
  const pool = own.length > 0 ? own : languageMatches;
  return [...pool].sort((a, b) => {
    const delta = variantFreshness(b) - variantFreshness(a);
    // Stable, deterministic order when two copies carry the same timestamp.
    return delta !== 0 ? delta : a.builderId.localeCompare(b.builderId);
  })[0]!;
}

function preferLanguage<T extends ChannelVariant>(
  variants: T[],
  preferredSummaryLanguage: string | null | undefined,
): T[] {
  if (!preferredSummaryLanguage || variants.length < 2) return variants;

  // A fixed target language: copies actually written in it win outright.
  if (!isOriginalContentLanguagePreference(preferredSummaryLanguage)) {
    const target = normalizeConcreteLanguageTag(preferredSummaryLanguage);
    if (target) {
      const matching = variants.filter((variant) =>
        actualContentLanguagesMatch(variant.summaryContentLanguage, target),
      );
      if (matching.length > 0) return matching;
    }
  }

  // No copy in the requested language (or the request *is* "original"): fall back
  // to the library that summarizes in the content's own language, which reads
  // closer to the source than an arbitrary third language would.
  const original = variants.filter((variant) => variant.fromOriginalLanguageLibrary);
  return original.length > 0 ? original : variants;
}

function variantFreshness(variant: ChannelVariant): number {
  return (
    variant.itemUpdatedAt ??
    variant.lastFetchedAt ??
    variant.publishedAt ??
    variant.createdAt
  ).getTime();
}
