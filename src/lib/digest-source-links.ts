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

export async function digestSourceLinksForUser(userId: string): Promise<DigestSourceLink[]> {
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
  return [...byEntityId.values()];
}
