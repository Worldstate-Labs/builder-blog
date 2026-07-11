import { prisma } from "@/lib/prisma";
import {
  serializeCloudLibrary,
  serializeCloudLibrarySource,
  type CloudLibraryAdminSnapshot,
} from "@/lib/cloud-library-overview";

export async function getCloudLibraryAdminSnapshot(): Promise<CloudLibraryAdminSnapshot> {
  const libraryRows = await prisma.cloudLanguageLibrary.findMany({
    orderBy: { summaryLanguage: "asc" },
    include: {
      owner: { select: { email: true, name: true } },
      sourceTasks: {
        orderBy: { id: "asc" },
        include: {
          runTasks: {
            orderBy: { startedAt: "desc" },
            take: 1,
            include: { builder: { select: { name: true, sourceType: true } } },
          },
          builder: {
            select: {
              entityId: true,
              kind: true,
              name: true,
              sourceType: true,
              sourceUrl: true,
              fetchUrl: true,
              avatarUrl: true,
              avatarDataUrl: true,
            },
          },
        },
      },
    },
  });

  const builderIds = libraryRows.flatMap((library) =>
    library.sourceTasks.map((task) => task.builderId),
  );
  const [submitterGroups, postGroups] = await Promise.all([
    prisma.cloudSourceSubmission.groupBy({
      by: ["cloudBuilderId"],
      where: { cloudBuilderId: { in: builderIds }, active: true },
      _count: { _all: true },
    }),
    prisma.feedItem.groupBy({
      by: ["builderId"],
      where: { builderId: { in: builderIds } },
      _count: { _all: true },
    }),
  ]);
  const submitterCountByBuilder = new Map(
    submitterGroups.map((group) => [group.cloudBuilderId, group._count._all]),
  );
  const postCountByBuilder = new Map(
    postGroups.map((group) => [group.builderId, group._count._all]),
  );

  return {
    libraries: libraryRows.map((library) => {
      const activeSourceTasks = library.sourceTasks.filter(
        (task) => (submitterCountByBuilder.get(task.builderId) ?? 0) > 0,
      );
      return serializeCloudLibrary(
        library,
        activeSourceTasks.map((task) =>
          serializeCloudLibrarySource(task, {
            submitterCount: submitterCountByBuilder.get(task.builderId) ?? 0,
            postCount: postCountByBuilder.get(task.builderId) ?? 0,
          }),
        ),
      );
    }),
    languageLibraries: libraryRows.map((library) => ({
      id: library.id,
      summaryLanguage: library.summaryLanguage,
      ownerUserId: library.ownerUserId,
      ownerEmail: library.owner.email,
      ownerName: library.owner.name,
      enabled: library.enabled,
    })),
  };
}
