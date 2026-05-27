import { BuilderPoolOrigin } from "@prisma/client";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function addBuilderToPool(params: {
  userId: string;
  builderId: string;
  origin: BuilderPoolOrigin;
}) {
  return prisma.builderPoolEntry.upsert({
    where: {
      userId_builderId: {
        userId: params.userId,
        builderId: params.builderId,
      },
    },
    update: {
      origin: params.origin,
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

  const library = await prisma.libraryHubEntry.findFirst({
    where: { isFeatured: true },
    include: {
      items: { select: { builderId: true } },
    },
  });
  if (!library || library.items.length === 0) return { imported: false, builderCount: 0 };

  // Respect user's library visibility preference (replaces adminCommunityLibraryHidden).
  const visibility = await prisma.userLibraryVisibility.findUnique({
    where: { userId_hubEntryId: { userId, hubEntryId: library.id } },
    select: { hidden: true },
  });
  if (visibility?.hidden) {
    return { imported: false, builderCount: 0 };
  }

  const builderIds = [...new Set(library.items.map((item) => item.builderId))];
  const existingImport = await prisma.libraryImport.findUnique({
    where: { userId_hubEntryId: { userId, hubEntryId: library.id } },
    select: { userId: true },
  });

  await prisma.$transaction([
    prisma.builderPoolEntry.updateMany({
      where: { userId, builderId: { in: builderIds } },
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
