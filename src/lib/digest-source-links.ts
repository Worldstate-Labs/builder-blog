import { prisma } from "@/lib/prisma";

export type DigestSourceLink = {
  aliases?: string[];
  avatarUrl?: string | null;
  avatarDataUrl?: string | null;
  entityId: string;
  href: string;
  name: string;
  handle?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  fetchUrl?: string | null;
};
type DigestSourceBuilder = Awaited<ReturnType<typeof builderRowsForEntities>>[number];

export async function digestSourceLinksForUser(userId: string, digestId?: string | null): Promise<DigestSourceLink[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    include: {
      builder: {
        include: {
          entity: {
            select: {
              handle: true,
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const byEntityId = new Map<string, DigestSourceLink>();
  for (const subscription of subscriptions) {
    const builder = subscription.builder;
    if (!builder?.entity || byEntityId.has(builder.entity.id)) continue;
    byEntityId.set(builder.entity.id, {
      aliases: [builder.name],
      avatarUrl: builder.avatarUrl,
      avatarDataUrl: builder.avatarDataUrl,
      entityId: builder.entity.id,
      fetchUrl: builder.fetchUrl,
      handle: builder.entity.handle ?? builder.handle,
      href: `/builder/${builder.entity.id}`,
      name: builder.name || builder.entity.name,
      sourceUrl: builder.sourceUrl,
      sourceType: builder.sourceType,
    });
  }

  if (digestId) {
    const digestedItems = await prisma.digestedItem.findMany({
      where: {
        userId,
        digestId,
      },
      select: {
        entityId: true,
        entity: {
          select: {
            handle: true,
            id: true,
            name: true,
          },
        },
        feedItem: {
          select: {
            sourceName: true,
            builder: {
              select: {
                avatarUrl: true,
                avatarDataUrl: true,
                entityId: true,
                fetchUrl: true,
                handle: true,
                name: true,
                sourceType: true,
                sourceUrl: true,
                entity: {
                  select: {
                    handle: true,
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { digestedAt: "asc" },
    });
    const digestedEntityIds = [...new Set(digestedItems.map((item) => item.entityId.trim()).filter(Boolean))];
    const buildersByEntityId = await buildersForEntities(userId, digestedEntityIds);

    for (const item of digestedItems) {
      const itemEntityId = item.entityId.trim();
      const builder = item.feedItem?.builder ?? buildersByEntityId.get(itemEntityId) ?? null;
      const entity = item.entity ?? builder?.entity;
      const entityId = entity?.id ?? builder?.entityId ?? itemEntityId;
      if (!entityId) continue;
      const aliases = uniqueSourceAliases([builder?.name, item.feedItem?.sourceName, entity?.name]);
      const existing = byEntityId.get(entityId);
      if (existing) {
        existing.aliases = uniqueSourceAliases([...(existing.aliases ?? []), ...aliases]);
        continue;
      }
      byEntityId.set(entityId, {
        aliases,
        avatarUrl: builder?.avatarUrl ?? null,
        avatarDataUrl: builder?.avatarDataUrl ?? null,
        entityId,
        fetchUrl: builder?.fetchUrl ?? null,
        handle: entity?.handle ?? builder?.handle ?? null,
        href: `/builder/${entityId}`,
        name: builder?.name || entity?.name || itemEntityId,
        sourceUrl: builder?.sourceUrl ?? null,
        sourceType: builder?.sourceType ?? null,
      });
    }
  }
  return [...byEntityId.values()];
}

async function buildersForEntities(ownerUserId: string, entityIds: string[]) {
  if (entityIds.length === 0) return new Map<string, DigestSourceBuilder>();
  const builders = await builderRowsForEntities(ownerUserId, entityIds);
  const byEntityId = new Map<string, DigestSourceBuilder>();
  for (const builder of builders) {
    if (!byEntityId.has(builder.entityId)) byEntityId.set(builder.entityId, builder);
  }
  return byEntityId;
}

async function builderRowsForEntities(ownerUserId: string, entityIds: string[]) {
  return prisma.builder.findMany({
    where: {
      ownerUserId,
      entityId: { in: entityIds },
    },
    select: {
      avatarUrl: true,
      avatarDataUrl: true,
      entityId: true,
      fetchUrl: true,
      handle: true,
      name: true,
      sourceType: true,
      sourceUrl: true,
      entity: {
        select: {
          handle: true,
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ ownerUserId: "asc" }, { updatedAt: "desc" }],
  });
}

function uniqueSourceAliases(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of values) {
    const alias = value?.trim();
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    aliases.push(alias);
  }
  return aliases;
}
