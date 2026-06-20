import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/zod-error";
import { prisma } from "@/lib/prisma";
import { parseSkillDigestPayload } from "@/lib/skill-contracts";
import {
  displayLanguagePreference,
  isOriginalContentLanguagePreference,
  normalizeSummaryLanguagePreference,
} from "@/lib/language-preference";
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
  const languagePreference = preference?.summaryLanguage
    ? normalizeSummaryLanguagePreference(preference.summaryLanguage)
    : parsed.data.language;
  const language = isOriginalContentLanguagePreference(languagePreference)
    ? displayLanguagePreference(languagePreference)
    : languagePreference;

  const now = new Date();

  // `regenerate` never deletes history. Its only meaning is "let posts the user
  // already had digested be reused in a new digest", which the prepare/context
  // step implements by re-including already-digested candidates
  // (excludeDigestedForUserId is null when regenerate). At sync time we always
  // create a new digest and never remove past ones; the digestedItem upsert
  // below simply re-points an already-digested post's provenance to this new
  // digest while keeping its original digestedAt.

  // Coverage window = the published range of the posts this digest actually
  // presents, computed from the real candidates rather than the cosmetic 24h
  // label the CLI sends. Falls back to that label (or now-24h..now) only when
  // the digest presents no dated items (e.g. an empty "no updates" digest).
  let periodStart = parsed.data.periodStart
    ? new Date(parsed.data.periodStart)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let periodEnd = parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : now;
  const presentedFeedItemIds = parsed.data.digestedItems
    .map((item) => item.feedItemId)
    .filter((id): id is string => Boolean(id));
  if (presentedFeedItemIds.length > 0) {
    const dated = await prisma.feedItem.findMany({
      where: { id: { in: presentedFeedItemIds }, publishedAt: { not: null } },
      select: { publishedAt: true },
    });
    const times = dated
      .map((row) => row.publishedAt?.getTime())
      .filter((t): t is number => typeof t === "number");
    if (times.length > 0) {
      periodStart = new Date(Math.min(...times));
      periodEnd = new Date(Math.max(...times));
    }
  }

  const digest = await prisma.digest.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      headlineSummary: parsed.data.headlineSummary?.trim() || null,
      language,
      periodStart,
      periodEnd,
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

  // Complete the diagnostic funnel: link this digest back to the DigestRun that
  // recorded the candidate pool at `prepare`. includedKeys marks which
  // candidates the editorial step actually presented (the rest are "eligible but
  // dropped"). Scoped to this user and best-effort — a stale/missing runId must
  // not fail the sync the user cares about.
  if (parsed.data.runId) {
    try {
      await prisma.digestRun.updateMany({
        where: { id: parsed.data.runId, userId: user.id },
        data: {
          status: "synced",
          syncedAt: now,
          digestId: digest.id,
          digestTitle: digest.title,
          language,
          jobRunId: parsed.data.jobRunId ?? undefined,
          includedCount: parsed.data.digestedItems.length,
          includedKeys: parsed.data.digestedItems.map(
            (item) => `${item.entityId}:${item.kind}:${item.externalId}`,
          ),
        },
      });
    } catch (error) {
      console.error("Failed to link DigestRun on digest sync", error);
    }
  }

  return NextResponse.json({ status: "ok", digest });
}
