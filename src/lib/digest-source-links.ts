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
      name: builder.entity.name || builder.name,
      sourceUrl: builder.sourceUrl,
      sourceType: builder.sourceType,
    });
  }

  if (digestId) {
    const digestedItems = await prisma.digestedItem.findMany({
      where: {
        userId,
        digestId,
        feedItemId: { not: null },
        feedItem: {
          is: {
            builder: {
              is: {
                entityId: { not: "" },
              },
            },
          },
        },
      },
      select: {
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

    for (const item of digestedItems) {
      const builder = item.feedItem?.builder;
      const entity = builder?.entity;
      const entityId = entity?.id ?? builder?.entityId;
      if (!builder || !entityId) continue;
      const aliases = uniqueSourceAliases([builder.name, item.feedItem?.sourceName]);
      const existing = byEntityId.get(entityId);
      if (existing) {
        existing.aliases = uniqueSourceAliases([...(existing.aliases ?? []), ...aliases]);
        continue;
      }
      byEntityId.set(entityId, {
        aliases,
        avatarUrl: builder.avatarUrl,
        avatarDataUrl: builder.avatarDataUrl,
        entityId,
        fetchUrl: builder.fetchUrl,
        handle: entity?.handle ?? builder.handle,
        href: `/builder/${entityId}`,
        name: entity?.name || builder.name,
        sourceUrl: builder.sourceUrl,
        sourceType: builder.sourceType,
      });
    }
  }
  return [...byEntityId.values()];
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
