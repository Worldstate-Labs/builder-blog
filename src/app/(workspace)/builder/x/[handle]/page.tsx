import { notFound, redirect } from "next/navigation";
import { BuilderKind } from "@prisma/client";
import { getCurrentSession } from "@/lib/auth";
import { canonicalBuilderKey, normalizeHandle } from "@/lib/builder-keys";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ handle: string }> };

/**
 * Human-friendly URL alias: /builder/x/<handle> → redirects to /builder/<entityId>.
 * EntityId is the canonical URL; this alias gives shareable, stable URLs for X creators.
 */
export default async function BuilderHandleAlias({ params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const { handle } = await params;
  const canonicalKey = canonicalBuilderKey(BuilderKind.X, normalizeHandle(handle));
  const entity = await prisma.builderEntity.findFirst({
    where: {
      canonicalKey,
      builders: {
        some: {
          OR: [
            { ownerUserId: session.user.id },
            { poolEntries: { some: { userId: session.user.id, removedAt: null } } },
          ],
        },
      },
    },
    select: { id: true },
  });
  if (!entity) notFound();
  redirect(`/builder/${entity.id}`);
}
