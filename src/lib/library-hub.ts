import { BuilderPoolOrigin, BuilderScope, LibraryHubKind } from "@prisma/client";
import { addBuilderToPool } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";

export const centralLibraryHubSlug = "central-library";

export async function syncCentralLibraryHub() {
  const centralBuilders = await prisma.builder.findMany({
    where: { scope: BuilderScope.CENTRAL },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  const entry = await prisma.libraryHubEntry.upsert({
    where: { slug: centralLibraryHubSlug },
    update: {
      name: "Central library",
      description: "Default Builder Blog library curated and crawled by the web app.",
    },
    create: {
      kind: LibraryHubKind.CENTRAL,
      slug: centralLibraryHubSlug,
      name: "Central library",
      description: "Default Builder Blog library curated and crawled by the web app.",
    },
  });

  await prisma.$transaction([
    prisma.libraryHubItem.deleteMany({ where: { hubEntryId: entry.id } }),
    ...(centralBuilders.length > 0
      ? [
          prisma.libraryHubItem.createMany({
            data: centralBuilders.map((builder) => ({
              hubEntryId: entry.id,
              builderId: builder.id,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return entry;
}

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

  await prisma.$transaction([
    prisma.libraryHubItem.deleteMany({ where: { hubEntryId: entry.id } }),
    ...(personalBuilders.length > 0
      ? [
          prisma.libraryHubItem.createMany({
            data: personalBuilders.map((builder) => ({
              hubEntryId: entry.id,
              builderId: builder.id,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return { entry, builderCount: personalBuilders.length };
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
  }

  return { libraries: newImports, builders };
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
