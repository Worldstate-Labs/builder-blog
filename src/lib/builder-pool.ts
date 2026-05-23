import { BuilderPoolOrigin } from "@prisma/client";
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
  const entries = await prisma.builderPoolEntry.findMany({
    where: { userId, removedAt: null },
    select: { builderId: true },
  });
  return entries.map((entry) => entry.builderId);
}
