type UserContentBuilderPrisma = {
  builder: {
    findMany(args: unknown): Promise<Array<{ id: string; entityId: string | null }>>;
  };
  cloudSourceSubmission: {
    findMany(args: unknown): Promise<Array<{
      userBuilderId: string | null;
      cloudBuilderId: string;
      userBuilder: { entityId: string | null } | null;
      cloudBuilder: { entityId: string | null } | null;
    }>>;
  };
  feedItem?: {
    groupBy(args: unknown): Promise<Array<{
      builderId: string | null;
      kind: string;
      externalId: string;
      _max: {
        publishedAt: Date | null;
        createdAt: Date | null;
      };
    }>>;
  };
};

export async function resolveUserContentBuilderIds(params: {
  userId: string;
  logicalBuilderIds: string[];
  prisma?: UserContentBuilderPrisma;
}) {
  const prisma = (params.prisma ??
    (await import("@/lib/prisma")).prisma) as unknown as UserContentBuilderPrisma;
  const requestedIds = [...new Set(params.logicalBuilderIds.map((id) => id.trim()).filter(Boolean))];
  if (requestedIds.length === 0) return [];

  const logicalBuilders = await prisma.builder.findMany({
    where: { id: { in: requestedIds } },
    select: { id: true, entityId: true },
  });
  const requested = new Set(requestedIds);
  const entityByLogicalBuilderId = new Map(
    logicalBuilders
      .filter((builder) => requested.has(builder.id))
      .map((builder) => [builder.id, builder.entityId]),
  );
  const logicalBuilderIds = [...entityByLogicalBuilderId.keys()];
  if (logicalBuilderIds.length === 0) return [];

  const submissions = await prisma.cloudSourceSubmission.findMany({
    where: {
      userId: params.userId,
      userBuilderId: { in: logicalBuilderIds },
    },
    select: {
      userBuilderId: true,
      cloudBuilderId: true,
      userBuilder: { select: { entityId: true } },
      cloudBuilder: { select: { entityId: true } },
    },
  });

  const contentBuilderIds = new Set(logicalBuilderIds);
  for (const submission of submissions) {
    if (!submission.userBuilderId) continue;
    const logicalEntityId = entityByLogicalBuilderId.get(submission.userBuilderId);
    const userEntityId = submission.userBuilder?.entityId;
    const cloudEntityId = submission.cloudBuilder?.entityId;
    if (!logicalEntityId || logicalEntityId !== userEntityId || logicalEntityId !== cloudEntityId) continue;
    contentBuilderIds.add(submission.cloudBuilderId);
  }
  return [...contentBuilderIds];
}

export async function loadUserContentStatsByEntityId(params: {
  userId: string;
  logicalBuilderIds: string[];
  prisma?: UserContentBuilderPrisma;
}) {
  const prisma = (params.prisma ??
    (await import("@/lib/prisma")).prisma) as unknown as UserContentBuilderPrisma;
  if (!prisma.feedItem) {
    throw new Error("FeedItem access is required to load user content stats.");
  }
  const contentBuilderIds = await resolveUserContentBuilderIds({
    userId: params.userId,
    logicalBuilderIds: params.logicalBuilderIds,
    prisma,
  });
  if (contentBuilderIds.length === 0) {
    return new Map<string, { count: number; latestPostCreatedAt: Date | null }>();
  }

  const contentBuilders = await prisma.builder.findMany({
    where: { id: { in: contentBuilderIds } },
    select: { id: true, entityId: true },
  });
  const entityIdByBuilderId = new Map(
    contentBuilders.flatMap((builder) =>
      builder.entityId ? [[builder.id, builder.entityId] as const] : [],
    ),
  );
  const rows = await prisma.feedItem.groupBy({
    by: ["builderId", "kind", "externalId"],
    where: { builderId: { in: [...entityIdByBuilderId.keys()] } },
    _max: { publishedAt: true, createdAt: true },
  });

  const accumulated = new Map<
    string,
    { contentKeys: Set<string>; latestPostCreatedAt: Date | null }
  >();
  for (const row of rows) {
    if (!row.builderId) continue;
    const entityId = entityIdByBuilderId.get(row.builderId);
    if (!entityId) continue;
    const stats = accumulated.get(entityId) ?? {
      contentKeys: new Set<string>(),
      latestPostCreatedAt: null,
    };
    stats.contentKeys.add(`${row.kind}:${row.externalId}`);
    const rowDate = row._max.publishedAt ?? row._max.createdAt;
    if (rowDate && (!stats.latestPostCreatedAt || rowDate > stats.latestPostCreatedAt)) {
      stats.latestPostCreatedAt = rowDate;
    }
    accumulated.set(entityId, stats);
  }

  return new Map(
    [...accumulated].map(([entityId, stats]) => [
      entityId,
      {
        count: stats.contentKeys.size,
        latestPostCreatedAt: stats.latestPostCreatedAt,
      },
    ]),
  );
}
