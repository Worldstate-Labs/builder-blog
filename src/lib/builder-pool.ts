import { BuilderPoolOrigin, BuilderScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function ensureDefaultBuilderPool(userId: string) {
  const centralBuilders = await prisma.builder.findMany({
    where: { scope: BuilderScope.CENTRAL },
    select: { id: true },
  });

  for (const builder of centralBuilders) {
    await prisma.builderPoolEntry.upsert({
      where: {
        userId_builderId: {
          userId,
          builderId: builder.id,
        },
      },
      update: {},
      create: {
        userId,
        builderId: builder.id,
        origin: BuilderPoolOrigin.CENTRAL_DEFAULT,
      },
    });
  }
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
