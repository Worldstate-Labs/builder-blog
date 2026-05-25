import { BuilderPoolOrigin, BuilderScope, LibraryHubKind } from "@prisma/client";
import { isAdminEmail } from "@/lib/admin";
import { addBuilderToPool } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";

export const adminCommunityLibraryName = "Community Library";
export const adminCommunityLibraryDescription =
  "Community source library curated by FollowBrief.";

export async function sharePersonalLibraryToHub(params: {
  userId: string;
  name: string;
  description?: string | null;
}) {
  const personalBuilders = await prisma.builder.findMany({
    where: {
      scope: BuilderScope.PERSONAL,
      ownerUserId: params.userId,
    },
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
      kind: LibraryHubKind.PERSONAL,
      slug: personalLibrarySlug(params.userId),
      name: params.name,
      description: params.description || null,
      ownerUserId: params.userId,
    },
  });

  await replaceLibraryHubItems(
    entry.id,
    personalBuilders.map((builder) => builder.id),
  );

  return { entry, builderCount: personalBuilders.length };
}

export async function adminCommunityLibraryHidden(userId: string) {
  const preference = await prisma.userFeedPreference.findUnique({
    where: { userId },
    select: { adminCommunityLibraryHidden: true },
  });
  return Boolean(preference?.adminCommunityLibraryHidden);
}

export async function setAdminCommunityLibraryHidden(userId: string, hidden: boolean) {
  await prisma.userFeedPreference.upsert({
    where: { userId },
    update: { adminCommunityLibraryHidden: hidden },
    create: { userId, adminCommunityLibraryHidden: hidden },
  });
}

export async function ensureAdminCommunityLibrary(
  userId: string,
  options: { checkHidden?: boolean } = {},
) {
  if (options.checkHidden !== false && (await adminCommunityLibraryHidden(userId))) {
    return { isPublic: false, builderCount: 0 };
  }

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
    where: { ownerUserId: params.userId, kind: LibraryHubKind.PERSONAL },
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
    where: {
      ownerUserId: userId,
      kind: LibraryHubKind.PERSONAL,
    },
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
      items: {
        select: {
          builderId: true,
        },
      },
    },
  });

  let builders = 0;
  let newImports = 0;
  for (const library of libraries) {
    if (library.ownerUserId === params.userId) continue;
    const isAdminCommunityLibrary = isAdminEmail(library.owner?.email);

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
      // Import count tracks first-time imports; re-importing still refreshes pool membership.
    }

    if (isAdminCommunityLibrary) {
      await setAdminCommunityLibraryHidden(params.userId, false);
    }
  }

  return { libraries: newImports, builders };
}

export async function removeLibraryImportFromHub(params: {
  userId: string;
  libraryId: string;
}) {
  const library = await prisma.libraryHubEntry.findUnique({
    where: { id: params.libraryId },
    include: {
      owner: { select: { email: true } },
      items: { select: { builderId: true } },
    },
  });
  if (!library || library.ownerUserId === params.userId) {
    return { removed: false, builders: 0 };
  }

  const builderIds = library.items.map((item) => item.builderId);
  const otherImports = await prisma.libraryImport.findMany({
    where: {
      userId: params.userId,
      hubEntryId: { not: params.libraryId },
    },
    include: {
      hubEntry: {
        include: {
          items: { select: { builderId: true } },
        },
      },
    },
  });
  const stillImportedBuilderIds = new Set(
    otherImports.flatMap((item) => item.hubEntry.items.map((hubItem) => hubItem.builderId)),
  );
  const removableBuilderIds = builderIds.filter(
    (builderId) => !stillImportedBuilderIds.has(builderId),
  );

  await prisma.$transaction([
    prisma.subscription.deleteMany({
      where: { userId: params.userId, builderId: { in: removableBuilderIds } },
    }),
    prisma.builderPoolEntry.updateMany({
      where: {
        userId: params.userId,
        builderId: { in: removableBuilderIds },
        origin: BuilderPoolOrigin.HUB_IMPORT,
      },
      data: { removedAt: new Date() },
    }),
    prisma.libraryImport.deleteMany({
      where: {
        userId: params.userId,
        hubEntryId: params.libraryId,
      },
    }),
    ...(isAdminEmail(library.owner?.email)
      ? [
          prisma.userFeedPreference.upsert({
            where: { userId: params.userId },
            update: { adminCommunityLibraryHidden: true },
            create: { userId: params.userId, adminCommunityLibraryHidden: true },
          }),
        ]
      : []),
  ]);

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
