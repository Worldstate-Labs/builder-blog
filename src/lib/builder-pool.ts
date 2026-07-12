import { BuilderPoolOrigin } from "@prisma/client";
import { adminEmails, isAdminEmail } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const adminCommunityLibraryName = "Community source library";
const adminCommunityLibraryDescription =
  "Community source library curated by FollowBrief.";

export async function addBuilderToPool(params: {
  userId: string;
  builderId: string;
  origin: BuilderPoolOrigin;
}) {
  const where = {
    userId_builderId: {
      userId: params.userId,
      builderId: params.builderId,
    },
  };
  const existing = await prisma.builderPoolEntry.findUnique({
    where,
    select: { origin: true },
  });
  // A HUB_IMPORT must never downgrade a builder the user added themselves
  // (PERSONAL_SYNC). Doing so makes their own builder non-removable (the
  // builder library delete route blocks HUB_IMPORT origins) and hides it from
  // the private library section (which filters to PERSONAL_SYNC). A direct
  // PERSONAL_SYNC add is the stronger claim, so it may still upgrade an
  // existing HUB_IMPORT entry.
  const origin =
    existing?.origin === BuilderPoolOrigin.PERSONAL_SYNC &&
    params.origin === BuilderPoolOrigin.HUB_IMPORT
      ? BuilderPoolOrigin.PERSONAL_SYNC
      : params.origin;
  return prisma.builderPoolEntry.upsert({
    where,
    update: {
      origin,
      removedAt: null,
    },
    create: {
      userId: params.userId,
      builderId: params.builderId,
      origin: params.origin,
    },
  });
}

export async function activePoolBuilderIds(userId: string) {
  await ensureDefaultCommunityLibraryImport(userId);
  const entries = await prisma.builderPoolEntry.findMany({
    where: { userId, removedAt: null },
    select: { builderId: true },
  });
  return entries.map((entry) => entry.builderId);
}

export async function ensureDefaultCommunityLibraryImport(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user || isAdminEmail(user.email)) return { imported: false, builderCount: 0 };

  const library = await findOrCreateDefaultCommunityLibrary();
  if (!library || library.items.length === 0) return { imported: false, builderCount: 0 };

  // Respect the user's per-library visibility preference (UserLibraryVisibility).
  const visibility = await prisma.userLibraryVisibility.findUnique({
    where: { userId_hubEntryId: { userId, hubEntryId: library.id } },
    select: { hidden: true },
  });
  if (visibility?.hidden) {
    return { imported: false, builderCount: 0 };
  }

  const builderIds = [...new Set(library.items.map((item) => item.builderId))];
  const [existingImport, activeImportedBuilderCount] = await Promise.all([
    prisma.libraryImport.findUnique({
      where: { userId_hubEntryId: { userId, hubEntryId: library.id } },
      select: { userId: true },
    }),
    prisma.builderPoolEntry.count({
      where: {
        userId,
        builderId: { in: builderIds },
        removedAt: null,
      },
    }),
  ]);
  if (existingImport && activeImportedBuilderCount === builderIds.length) {
    return { imported: true, builderCount: builderIds.length };
  }

  await prisma.$transaction([
    prisma.builderPoolEntry.updateMany({
      // Only normalize / re-activate hub entries. Excluding PERSONAL_SYNC keeps
      // a builder the user added themselves from being downgraded to HUB_IMPORT
      // (which would make it non-removable and hide it from the private
      // library). Mirrors the guard in addBuilderToPool.
      where: {
        userId,
        builderId: { in: builderIds },
        origin: { not: BuilderPoolOrigin.PERSONAL_SYNC },
      },
      data: {
        origin: BuilderPoolOrigin.HUB_IMPORT,
        removedAt: null,
      },
    }),
    prisma.builderPoolEntry.createMany({
      data: builderIds.map((builderId) => ({
        userId,
        builderId,
        origin: BuilderPoolOrigin.HUB_IMPORT,
      })),
      skipDuplicates: true,
    }),
    ...(existingImport
      ? []
      : [
          prisma.libraryImport.create({
            data: { userId, hubEntryId: library.id },
          }),
          prisma.libraryHubEntry.update({
            where: { id: library.id },
            data: { importCount: { increment: 1 } },
          }),
        ]),
  ]);

  return { imported: true, builderCount: builderIds.length };
}

async function findOrCreateDefaultCommunityLibrary() {
  const existing = await prisma.libraryHubEntry.findFirst({
    where: { isFeatured: true },
    include: {
      items: { select: { builderId: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;

  const admin = await prisma.user.findFirst({
    where: { email: { in: adminEmails() } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) return null;

  const ownedBuilders = await prisma.builder.findMany({
    where: { ownerUserId: admin.id },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  const entry = await prisma.libraryHubEntry.upsert({
    where: { slug: `personal-${admin.id}` },
    update: {
      name: adminCommunityLibraryName,
      description: adminCommunityLibraryDescription,
      isFeatured: true,
    },
    create: {
      slug: `personal-${admin.id}`,
      name: adminCommunityLibraryName,
      description: adminCommunityLibraryDescription,
      ownerUserId: admin.id,
      isFeatured: true,
    },
  });

  await prisma.$transaction([
    prisma.libraryHubItem.deleteMany({ where: { hubEntryId: entry.id } }),
    ...(ownedBuilders.length > 0
      ? [
          prisma.libraryHubItem.createMany({
            data: ownedBuilders.map((builder) => ({
              hubEntryId: entry.id,
              builderId: builder.id,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return prisma.libraryHubEntry.findUnique({
    where: { id: entry.id },
    include: {
      items: { select: { builderId: true } },
    },
  });
}
