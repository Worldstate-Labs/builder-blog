import type { Builder, BuilderKind, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export { pickPrimaryVariant, type ChannelVariant } from "@/lib/builder-channel-picker";

type EnsureEntityInput = {
  kind: BuilderKind;
  canonicalKey: string;
  name: string;
  handle?: string | null;
  bio?: string | null;
};

/**
 * Look up (or create) the BuilderEntity for a given canonical key. Idempotent.
 * Returns the entity id.
 */
export async function ensureBuilderEntity(input: EnsureEntityInput) {
  const entity = await prisma.builderEntity.upsert({
    where: { canonicalKey: input.canonicalKey },
    update: {},
    create: {
      canonicalKey: input.canonicalKey,
      kind: input.kind,
      name: input.name,
      handle: input.handle ?? null,
      bio: input.bio ?? null,
    },
    select: { id: true },
  });
  return entity.id;
}

/**
 * Given a set of Builder ids (channels), return the distinct entity ids they map to.
 */
export async function projectBuildersToEntities(builderIds: string[]): Promise<string[]> {
  if (builderIds.length === 0) return [];
  const rows = await prisma.builder.findMany({
    where: { id: { in: builderIds } },
    select: { entityId: true },
  });
  return [
    ...new Set(
      rows
        .map((row) => row.entityId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

/**
 * For a user, return the set of Builder ids they can reach across own + imported libraries.
 * Used by feed/digest pipelines as the candidate set.
 */
export async function reachableBuilderIdsForUser(userId: string): Promise<string[]> {
  // Own library: builders owned by this user.
  // Imported libraries: builders linked via LibraryHubItem in any library this user has imported.
  const [ownBuilders, importedHubItems, ownPoolEntries] = await Promise.all([
    prisma.builder.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    }),
    prisma.libraryHubItem.findMany({
      where: {
        hubEntry: {
          imports: { some: { userId } },
        },
      },
      select: { builderId: true },
    }),
    prisma.builderPoolEntry.findMany({
      where: { userId, removedAt: null },
      select: { builderId: true },
    }),
  ]);
  return [
    ...new Set([
      ...ownBuilders.map((b) => b.id),
      ...importedHubItems.map((item) => item.builderId),
      ...ownPoolEntries.map((entry) => entry.builderId),
    ]),
  ];
}

/**
 * Compute which entities become unreachable for this user after removing a library import,
 * versus which still have at least one channel via another library.
 */
export async function computeEntityReachabilityAfterRemoval(params: {
  userId: string;
  removedLibraryId: string;
}) {
  const [removedItems, remainingItems, ownBuilders, otherPoolBuilders] = await Promise.all([
    prisma.libraryHubItem.findMany({
      where: { hubEntryId: params.removedLibraryId },
      include: { builder: { select: { id: true, entityId: true } } },
    }),
    prisma.libraryHubItem.findMany({
      where: {
        hubEntryId: { not: params.removedLibraryId },
        hubEntry: { imports: { some: { userId: params.userId } } },
      },
      include: { builder: { select: { id: true, entityId: true } } },
    }),
    prisma.builder.findMany({
      where: { ownerUserId: params.userId },
      select: { id: true, entityId: true },
    }),
    prisma.builderPoolEntry.findMany({
      where: {
        userId: params.userId,
        removedAt: null,
        builder: {
          // exclude the ones in the removed library (they'll be soft-deleted)
          NOT: { hubItems: { some: { hubEntryId: params.removedLibraryId } } },
        },
      },
      select: { builderId: true, builder: { select: { entityId: true } } },
    }),
  ]);

  const removedEntityIds = new Set<string>();
  for (const item of removedItems) {
    if (item.builder.entityId) removedEntityIds.add(item.builder.entityId);
  }
  const remainingEntityIds = new Set<string>();
  for (const item of remainingItems) {
    if (item.builder.entityId) remainingEntityIds.add(item.builder.entityId);
  }
  for (const builder of ownBuilders) {
    if (builder.entityId) remainingEntityIds.add(builder.entityId);
  }
  for (const entry of otherPoolBuilders) {
    if (entry.builder.entityId) remainingEntityIds.add(entry.builder.entityId);
  }

  const orphanEntityIds: string[] = [];
  const survivingEntityIds: string[] = [];
  for (const entityId of removedEntityIds) {
    if (remainingEntityIds.has(entityId)) {
      survivingEntityIds.push(entityId);
    } else {
      orphanEntityIds.push(entityId);
    }
  }

  return {
    removedBuilderIds: removedItems.map((item) => item.builder.id),
    orphanEntityIds,
    survivingEntityIds,
  };
}

/**
 * Pick a new primary Builder facet for each given entity from the user's currently reachable channels.
 * Used after removing a library: any UserChannelPreference still pointing into the removed library
 * needs to rebind.
 */
export async function rebindPrimaryChannels(params: {
  userId: string;
  entityIds: string[];
  excludeLibraryId?: string;
}) {
  if (params.entityIds.length === 0) return 0;
  const prefs = await prisma.userChannelPreference.findMany({
    where: { userId: params.userId, entityId: { in: params.entityIds } },
    select: { entityId: true, primaryBuilderId: true, pinnedByUser: true },
  });
  let rebound = 0;
  for (const pref of prefs) {
    // Only rebind if the current primary is no longer reachable.
    const primaryStillReachable = await prisma.builder.findFirst({
      where: {
        id: pref.primaryBuilderId,
        OR: [
          { ownerUserId: params.userId },
          { hubItems: { some: { hubEntry: { imports: { some: { userId: params.userId } } } } } },
        ],
        ...(params.excludeLibraryId
          ? { hubItems: { none: { hubEntryId: params.excludeLibraryId } } }
          : {}),
      },
      select: { id: true },
    });
    if (primaryStillReachable) continue;

    const candidate = await pickPrimaryCandidateForEntity({
      userId: params.userId,
      entityId: pref.entityId,
      excludeLibraryId: params.excludeLibraryId,
    });
    if (!candidate) {
      // No reachable channel left → delete the preference.
      await prisma.userChannelPreference.delete({
        where: { userId_entityId: { userId: params.userId, entityId: pref.entityId } },
      });
    } else {
      await prisma.userChannelPreference.update({
        where: { userId_entityId: { userId: params.userId, entityId: pref.entityId } },
        data: { primaryBuilderId: candidate, pinnedByUser: false },
      });
    }
    rebound += 1;
  }
  return rebound;
}

async function pickPrimaryCandidateForEntity(params: {
  userId: string;
  entityId: string;
  excludeLibraryId?: string;
}): Promise<string | null> {
  // Prefer user's own builder for this entity.
  const own = await prisma.builder.findFirst({
    where: { entityId: params.entityId, ownerUserId: params.userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (own) return own.id;

  // Otherwise pick from any imported library the user has, excluding the removed one.
  const imported = await prisma.builder.findFirst({
    where: {
      entityId: params.entityId,
      hubItems: {
        some: {
          hubEntry: { imports: { some: { userId: params.userId } } },
          ...(params.excludeLibraryId ? { NOT: { hubEntryId: params.excludeLibraryId } } : {}),
        },
      },
    },
    orderBy: [{ lastCrawledAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  return imported?.id ?? null;
}

export type BuilderEntityWithChannels = {
  id: string;
  canonicalKey: string;
  kind: BuilderKind;
  name: string;
  handle: string | null;
  bio: string | null;
  channels: Array<
    Pick<
      Builder,
      | "id"
      | "ownerUserId"
      | "sourceType"
      | "sourceUrl"
      | "crawlUrl"
      | "lastCrawledAt"
      | "itemCount"
      | "status"
    >
  >;
};

export async function getEntityWithChannels(entityId: string) {
  return prisma.builderEntity.findUnique({
    where: { id: entityId },
    include: {
      builders: {
        select: {
          id: true,
          ownerUserId: true,
          sourceType: true,
          sourceUrl: true,
          crawlUrl: true,
          lastCrawledAt: true,
          itemCount: true,
          status: true,
          owner: { select: { id: true, email: true, name: true } },
          hubItems: {
            select: {
              hubEntry: { select: { id: true, name: true, slug: true, ownerUserId: true } },
            },
          },
        },
      },
    },
  });
}

export type SubscriptionWithEntity = Prisma.SubscriptionGetPayload<{
  include: { entity: true };
}>;
