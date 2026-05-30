import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/zod-error";
import { prisma } from "@/lib/prisma";
import { parseSkillDigestPayload } from "@/lib/skill-contracts";
import { getUserFromBearer } from "@/lib/tokens";

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseSkillDigestPayload(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  // Record the digest's language from the account-wide summary-language
  // preference (the same setting the digest/library dialogs write). The agent
  // is prompted to write the body in this language, so the stored metadata
  // stays in sync with the actual output. Falls back to the payload value.
  const preference = await prisma.userFeedPreference.findUnique({
    where: { userId: user.id },
    select: { summaryLanguage: true },
  });
  const language = preference?.summaryLanguage?.trim() || parsed.data.language;

  const now = new Date();

  // "Re-generate today's digest": replace this user's existing same-day
  // digest(s) instead of stacking a duplicate. "Today" = the current UTC
  // calendar day, scoped strictly to this user. Default flow (regenerate
  // false) is unchanged — always create.
  if (parsed.data.regenerate) {
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    await prisma.digest.deleteMany({
      where: { userId: user.id, createdAt: { gte: dayStart, lt: dayEnd } },
    });
  }

  const digest = await prisma.digest.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      language,
      periodStart: parsed.data.periodStart
        ? new Date(parsed.data.periodStart)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000),
      periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : now,
      itemCount: parsed.data.itemCount,
      source: "skill",
      status: "SYNCED",
    },
  });

  // Mark every candidate post presented to this digest as digested for this
  // user, so it won't participate in future digests (unless the user overrides).
  // Keyed by canonical content identity (entityId, kind, externalId) — matches
  // across channel variants. Idempotent: re-marking on an override run is a
  // no-op via the unique key. Provenance: digestId + the presented feedItemId.
  if (parsed.data.digestedItems.length > 0) {
    await prisma.$transaction(
      parsed.data.digestedItems.map((item) =>
        prisma.digestedItem.upsert({
          where: {
            userId_entityId_kind_externalId: {
              userId: user.id,
              entityId: item.entityId,
              kind: item.kind,
              externalId: item.externalId,
            },
          },
          create: {
            userId: user.id,
            entityId: item.entityId,
            kind: item.kind,
            externalId: item.externalId,
            feedItemId: item.feedItemId ?? null,
            digestId: digest.id,
            digestedAt: now,
          },
          // On override the row already exists; refresh its provenance to the
          // newest digest but keep the original first-digested timestamp.
          update: {
            feedItemId: item.feedItemId ?? null,
            digestId: digest.id,
          },
        }),
      ),
    );
  }

  return NextResponse.json({ status: "ok", digest });
}
