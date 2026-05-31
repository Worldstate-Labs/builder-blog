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

export function digestPipelineTitle(owner: {
  name?: string | null;
  email?: string | null;
}) {
  const identity = owner.name || owner.email?.split("@")[0] || "Builder";
  return `${identity}'s Digest`;
}

export function displayDigestPipelineTitle(title: string) {
  return title.replace(/'s AI Builder Digest$/, "'s Digest");
}

export function digestPipelineSlug(userId: string) {
  return `digest-${userId}`;
}

export async function sharePersonalLibraryToHub(params: {
  userId: string;
  name: string;
  description?: string | null;
  email?: string | null;
}) {
  const ownedBuilders = await prisma.builder.findMany({
    where: { ownerUserId: params.userId },
    select: { id: true },
    orderBy: { name: "asc" },
  });

  const featured = isAdminEmail(params.email);

  const entry = await prisma.libraryHubEntry.upsert({
    where: { slug: personalLibrarySlug(params.userId) },
    update: {
      name: params.name,
      description: params.description || null,
      isFeatured: featured,
    },
    create: {
      slug: personalLibrarySlug(params.userId),
      name: params.name,
      description: params.description || null,
      ownerUserId: params.userId,
      isFeatured: featured,
    },
  });

  await replaceLibraryHubItems(
    entry.id,
    ownedBuilders.map((builder) => builder.id),
  );

  return { entry, builderCount: ownedBuilders.length };
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
 * Look up the featured community library hub entry. Returns null if none has been flagged yet.
 */
export async function findAdminCommunityLibrary() {
  return prisma.libraryHubEntry.findFirst({
    where: { isFeatured: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function ensureAdminCommunityLibrary(userId: string, email?: string | null) {
  const result = await sharePersonalLibraryToHub({
    userId,
    name: adminCommunityLibraryName,
    description: adminCommunityLibraryDescription,
    email,
  });
  return { isPublic: true, builderCount: result.builderCount };
}

export async function syncPersonalLibraryHubForUser(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
}) {
  if (isAdminEmail(params.email)) {
    return ensureAdminCommunityLibrary(params.userId, params.email);
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
    email: params.email,
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
    // 3. Drop subscriptions for channels that are no longer reachable.
    prisma.subscription.deleteMany({
      where: { userId: params.userId, builderId: { in: removableBuilderIds } },
    }),
    // Drop channel preferences for orphaned entities (no remaining reachable channel).
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

export async function shareDigestPipelineToHub(params: {
  userId: string;
  title?: string | null;
  description?: string | null;
  name?: string | null;
  email?: string | null;
}) {
  return prisma.digestPipelineShare.upsert({
    where: { ownerUserId: params.userId },
    update: {
      title: params.title?.trim() || digestPipelineTitle(params),
      description: params.description?.trim() || null,
      isPublic: true,
    },
    create: {
      ownerUserId: params.userId,
      slug: digestPipelineSlug(params.userId),
      title: params.title?.trim() || digestPipelineTitle(params),
      description: params.description?.trim() || null,
      isPublic: true,
    },
  });
}

export async function unshareDigestPipelineFromHub(userId: string) {
  const result = await prisma.digestPipelineShare.deleteMany({
    where: { ownerUserId: userId },
  });
  return { removed: result.count };
}

export async function importDigestPipelineFromHub(params: {
  userId: string;
  pipelineId: string;
}) {
  const pipeline = await prisma.digestPipelineShare.findFirst({
    where: { id: params.pipelineId, isPublic: true },
    select: { id: true, ownerUserId: true },
  });
  if (!pipeline || pipeline.ownerUserId === params.userId) {
    return { imported: false };
  }

  try {
    await prisma.digestPipelineImport.create({
      data: {
        userId: params.userId,
        pipelineId: pipeline.id,
      },
    });
    await prisma.digestPipelineShare.update({
      where: { id: pipeline.id },
      data: { importCount: { increment: 1 } },
    });
    return { imported: true };
  } catch {
    return { imported: false };
  }
}

export async function removeDigestPipelineImportFromHub(params: {
  userId: string;
  pipelineId: string;
}) {
  const result = await prisma.digestPipelineImport.deleteMany({
    where: {
      userId: params.userId,
      pipelineId: params.pipelineId,
    },
  });
  return { removed: result.count > 0 };
}

export async function recordDigestPipelineHubViews(pipelineIds: string[]) {
  const ids = [...new Set(pipelineIds.filter(Boolean))];
  if (ids.length === 0) return;
  await prisma.digestPipelineShare.updateMany({
    where: { id: { in: ids }, isPublic: true },
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
