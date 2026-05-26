import { BuilderPoolOrigin } from "@prisma/client";
import { isAdminEmail } from "@/lib/admin";
import { addBuilderToPool } from "@/lib/builder-pool";
import {
  computeEntityReachabilityAfterRemoval,
  rebindPrimaryChannels,
} from "@/lib/builder-entities";
import { prisma } from "@/lib/prisma";

export const adminCommunityLibraryName = "Community Library";
export const adminCommunityLibraryDescription =
  "Community source library curated by FollowBrief.";

export async function sharePersonalLibraryToHub(params: {
  userId: string;
  name: string;
  description?: string | null;
}) {
  const ownedBuilders = await prisma.builder.findMany({
    where: { ownerUserId: params.userId },
    select: { id: true },
    orderBy: { name: "asc" },
  });

  const entry = await prisma.libraryHubEntry.upsert({
    where: { slug: personalLibrarySlug(params.userId) },
    update: {
      name: params.name,
      description: params.description || null,
    },
    create: {
      slug: personalLibrarySlug(params.userId),
      name: params.name,
      description: params.description || null,
      ownerUserId: params.userId,
    },
  });

  await replaceLibraryHubItems(
    entry.id,
    ownedBuilders.map((builder) => builder.id),
  );

  return { entry, builderCount: ownedBuilders.length };
}

export async function isLibraryHidden(userId: string, hubEntryId: string) {
  const vis = await prisma.userLibraryVisibility.findUnique({
    where: { userId_hubEntryId: { userId, hubEntryId } },
    select: { hidden: true },
  });
  return Boolean(vis?.hidden);
}

export async function setLibraryHidden(params: {
  userId: string;
  hubEntryId: string;
  hidden: boolean;
}) {
  await prisma.userLibraryVisibility.upsert({
    where: { userId_hubEntryId: { userId: params.userId, hubEntryId: params.hubEntryId } },
    update: { hidden: params.hidden },
    create: {
      userId: params.userId,
      hubEntryId: params.hubEntryId,
      hidden: params.hidden,
    },
  });
}

/**
 * Look up the admin's library hub entry (the "Community Library"). Returns null if no admin
 * user has shared one yet.
 */
export async function findAdminCommunityLibrary() {
  return prisma.libraryHubEntry.findFirst({
    where: { owner: { email: { not: null } } },
    include: { owner: { select: { email: true } } },
    orderBy: { updatedAt: "desc" },
  }).then((entry) =>
    entry && isAdminEmail(entry.owner?.email) ? entry : null,
  );
}

export async function ensureAdminCommunityLibrary(userId: string) {
  const result = await sharePersonalLibraryToHub({
    userId,
    name: adminCommunityLibraryName,
    description: adminCommunityLibraryDescription,
  });
  return { isPublic: true, builderCount: result.builderCount };
}

export async function syncPersonalLibraryHubForUser(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
}) {
  if (isAdminEmail(params.email)) {
    return ensureAdminCommunityLibrary(params.userId);
  }

  const sharedLibrary = await prisma.libraryHubEntry.findFirst({
    where: { ownerUserId: params.userId },
    select: { name: true, description: true },
  });
  if (!sharedLibrary) return { isPublic: false, builderCount: 0 };

  const result = await sharePersonalLibraryToHub({
    userId: params.userId,
    name: sharedLibrary.name || `${params.name || params.email || "Personal"} library`,
    description: sharedLibrary.description,
  });
  return { isPublic: true, builderCount: result.builderCount };
}

export async function unsharePersonalLibraryFromHub(userId: string) {
  const result = await prisma.libraryHubEntry.deleteMany({
    where: { ownerUserId: userId },
  });
  return { removed: result.count };
}

export async function importLibrariesFromHub(params: {
  userId: string;
  libraryIds: string[];
}) {
  const libraryIds = [...new Set(params.libraryIds.filter(Boolean))];
  if (libraryIds.length === 0) return { libraries: 0, builders: 0 };

  const libraries = await prisma.libraryHubEntry.findMany({
    where: { id: { in: libraryIds } },
    include: {
      owner: { select: { email: true } },
      items: { select: { builderId: true } },
    },
  });

  let builders = 0;
  let newImports = 0;
  for (const library of libraries) {
    if (library.ownerUserId === params.userId) continue;

    for (const item of library.items) {
      await addBuilderToPool({
        userId: params.userId,
        builderId: item.builderId,
        origin: BuilderPoolOrigin.HUB_IMPORT,
      });
      builders += 1;
    }

    try {
      await prisma.libraryImport.create({
        data: {
          userId: params.userId,
          hubEntryId: library.id,
        },
      });
      newImports += 1;
      await prisma.libraryHubEntry.update({
        where: { id: library.id },
        data: { importCount: { increment: 1 } },
      });
    } catch {
      // Re-import: just refresh pool membership, don't double-count import.
    }

    // Importing un-hides the library if previously hidden.
    await setLibraryHidden({
      userId: params.userId,
      hubEntryId: library.id,
      hidden: false,
    });
  }

  return { libraries: newImports, builders };
}

export async function removeLibraryImportFromHub(params: {
  userId: string;
  libraryId: string;
}) {
  const library = await prisma.libraryHubEntry.findUnique({
    where: { id: params.libraryId },
    include: { owner: { select: { email: true } } },
  });
  if (!library || library.ownerUserId === params.userId) {
    return { removed: false, builders: 0 };
  }

  const reachability = await computeEntityReachabilityAfterRemoval({
    userId: params.userId,
    removedLibraryId: params.libraryId,
  });

  // Compute the subset of removed builders that the user still reaches via other libraries.
  const remainingBuilderIds = await prisma.libraryHubItem
    .findMany({
      where: {
        hubEntryId: { not: params.libraryId },
        hubEntry: { imports: { some: { userId: params.userId } } },
        builderId: { in: reachability.removedBuilderIds },
      },
      select: { builderId: true },
    })
    .then((rows) => new Set(rows.map((r) => r.builderId)));

  const removableBuilderIds = reachability.removedBuilderIds.filter(
    (builderId) => !remainingBuilderIds.has(builderId),
  );

  await prisma.$transaction([
    // 1. Soft-delete pool entries for facets that disappear from this user's view.
    prisma.builderPoolEntry.updateMany({
      where: {
        userId: params.userId,
        builderId: { in: removableBuilderIds },
        origin: BuilderPoolOrigin.HUB_IMPORT,
      },
      data: { removedAt: new Date() },
    }),
    // 2. Remove the import record itself.
    prisma.libraryImport.deleteMany({
      where: { userId: params.userId, hubEntryId: params.libraryId },
    }),
    // 3. Cascade-unfollow entities that became orphaned (no remaining reachable channel).
    prisma.subscription.deleteMany({
      where: { userId: params.userId, entityId: { in: reachability.orphanEntityIds } },
    }),
    prisma.userChannelPreference.deleteMany({
      where: { userId: params.userId, entityId: { in: reachability.orphanEntityIds } },
    }),
    // 4. Mark the library hidden so auto-import (admin community) doesn't re-add it.
    prisma.userLibraryVisibility.upsert({
      where: {
        userId_hubEntryId: { userId: params.userId, hubEntryId: params.libraryId },
      },
      update: { hidden: true },
      create: {
        userId: params.userId,
        hubEntryId: params.libraryId,
        hidden: true,
      },
    }),
  ]);

  // 5. Rebind primary channels for surviving entities whose primary was inside the removed library.
  await rebindPrimaryChannels({
    userId: params.userId,
    entityIds: reachability.survivingEntityIds,
    excludeLibraryId: params.libraryId,
  });

  return { removed: true, builders: removableBuilderIds.length };
}

export async function recordLibraryHubViews(libraryIds: string[]) {
  const ids = [...new Set(libraryIds.filter(Boolean))];
  if (ids.length === 0) return;
  await prisma.libraryHubEntry.updateMany({
    where: { id: { in: ids } },
    data: { viewCount: { increment: 1 } },
  });
}

export function personalLibrarySlug(userId: string) {
  return `personal-${userId}`;
}

async function replaceLibraryHubItems(hubEntryId: string, builderIds: string[]) {
  await prisma.$transaction([
    prisma.libraryHubItem.deleteMany({ where: { hubEntryId } }),
    ...(builderIds.length > 0
      ? [
          prisma.libraryHubItem.createMany({
            data: builderIds.map((builderId) => ({
              hubEntryId,
              builderId,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}
