import { BuilderPoolOrigin, BuilderScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function ensureDefaultBuilderPool(userId: string) {
  const [centralBuilders, existingEntries] = await Promise.all([
    prisma.builder.findMany({
      where: { scope: BuilderScope.CENTRAL },
      select: { id: true },
    }),
    prisma.builderPoolEntry.findMany({
      where: {
        userId,
        builder: { scope: BuilderScope.CENTRAL },
      },
      select: { builderId: true },
    }),
  ]);

  const existingBuilderIds = new Set(
    existingEntries.map((entry) => entry.builderId),
  );
  const missingBuilders = centralBuilders.filter(
    (builder) => !existingBuilderIds.has(builder.id),
  );

  if (missingBuilders.length === 0) {
    return;
  }

  await prisma.builderPoolEntry.createMany({
    data: missingBuilders.map((builder) => ({
      userId,
      builderId: builder.id,
      origin: BuilderPoolOrigin.CENTRAL_DEFAULT,
    })),
    skipDuplicates: true,
  });
}

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
  await ensureDefaultBuilderPool(userId);
  const entries = await prisma.builderPoolEntry.findMany({
    where: { userId, removedAt: null },
    select: { builderId: true },
  });
  return entries.map((entry) => entry.builderId);
}
