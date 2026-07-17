import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/zod-error";
import { prisma } from "@/lib/prisma";
import { parseSkillDigestPayload } from "@/lib/skill-contracts";
import {
  displayLanguagePreference,
  isOriginalContentLanguagePreference,
  normalizeSummaryLanguagePreference,
} from "@/lib/language-preference";
import { cleanStructuredDigestItems } from "@/lib/structured-digest";
import { getUserFromBearer } from "@/lib/tokens";
import { lockResetFenceForWorker, StaleWorkerWriteError } from "@/lib/reset-fence";

const DIGEST_SYNC_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

export async function POST(request: Request) {
  try {
    return await syncDigest(request);
  } catch (error) {
    console.error("Brief sync failed", error);
    const status = error instanceof StaleWorkerWriteError ? error.statusCode : 500;
    return NextResponse.json(digestSyncErrorResponse(error), { status });
  }
}

async function syncDigest(request: Request) {
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
  const digestItems = cleanStructuredDigestItems(parsed.data.items);
  if (digestItems.length === 0) {
    return NextResponse.json({ error: "Brief items are empty" }, { status: 400 });
  }
  const digestedItems = parsed.data.digestedItems.length > 0
    ? parsed.data.digestedItems
    : digestItems.map((item) => ({
        entityId: item.post.entityId,
        kind: item.post.kind,
        externalId: item.post.externalId,
        feedItemId: item.post.feedItemId,
      }));
  if (!parsed.data.runId) {
    return NextResponse.json(
      { error: "A prepared Brief run is required for sync." },
      { status: 409 },
    );
  }
  if (!parsed.data.jobRunId) {
    return NextResponse.json(
      { error: "jobRunId is required; start a new Brief with the current runner." },
      { status: 409 },
    );
  }
  const runId = parsed.data.runId;
  const jobRunId = parsed.data.jobRunId;

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
  // none of the structured items has a dated persisted feed item.
  const presentedFeedItemIds = digestedItems
    .map((item) => item.feedItemId)
    .filter((id): id is string => Boolean(id));

  const digest = await prisma.$transaction(async (tx) => {
    const digestRun = await tx.digestRun.findFirst({
      where: {
        id: runId,
        userId: user.id,
        status: "prepared",
        jobRunId,
      },
      select: { id: true },
    });
    if (!digestRun) throw new StaleWorkerWriteError();
    const jobRun = await tx.agentJobRun.findFirst({
      where: {
        userId: user.id,
        jobType: "digest-build",
        instanceId: jobRunId,
      },
      select: { createdAt: true },
    });
    if (!jobRun) throw new StaleWorkerWriteError();
    await lockResetFenceForWorker(tx, jobRun.createdAt);

    let periodStart = parsed.data.periodStart
      ? new Date(parsed.data.periodStart)
      : new Date(now.getTime() - 24 * 60 * 60 * 1000);
    let periodEnd = parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : now;
    if (presentedFeedItemIds.length > 0) {
      const dated = await tx.feedItem.findMany({
        where: { id: { in: presentedFeedItemIds }, publishedAt: { not: null } },
        select: { publishedAt: true },
      });
      const times = dated
        .map((row) => row.publishedAt?.getTime())
        .filter((time): time is number => typeof time === "number");
      if (times.length > 0) {
        periodStart = new Date(Math.min(...times));
        periodEnd = new Date(Math.max(...times));
      }
    }

    const createdDigest = await tx.digest.create({
      data: {
        userId: user.id,
        title: parsed.data.title,
        items: digestItems,
        headlineSummary: parsed.data.headlineSummary?.trim() || null,
        language,
        periodStart,
        periodEnd,
        itemCount: parsed.data.itemCount || digestItems.length,
        source: "skill",
        status: "SYNCED",
      },
    });

    // Mark every candidate post presented to this digest as digested for this
    // user, so it won't participate in future digests (unless the user overrides).
    // Keyed by canonical content identity (entityId, kind, externalId) — matches
    // across channel variants. Idempotent: re-marking on an override run is a
    // no-op via the unique key. Provenance: digestId + the presented feedItemId.
    for (const item of digestedItems) {
      await tx.digestedItem.upsert({
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
          digestId: createdDigest.id,
          digestedAt: now,
        },
        // On override the row already exists; refresh its provenance to the
        // newest digest but keep the original first-digested timestamp.
        update: {
          feedItemId: item.feedItemId ?? null,
          digestId: createdDigest.id,
        },
      });
    }

    // Atomic transition: only the request that still finds the run in
    // "prepared" wins. Under READ COMMITTED a concurrent sync blocks on this
    // row until we commit, then matches zero rows and rolls back — so two
    // syncs of the same run can't both create a Digest.
    const synced = await tx.digestRun.updateMany({
      where: { id: digestRun.id, status: "prepared" },
      data: {
        status: "synced",
        syncedAt: now,
        digestId: createdDigest.id,
        digestTitle: createdDigest.title,
        language,
        jobRunId,
        includedCount: digestedItems.length,
        includedKeys: digestedItems.map(
          (item) => `${item.entityId}:${item.kind}:${item.externalId}`,
        ),
      },
    });
    if (synced.count === 0) throw new StaleWorkerWriteError();

    return createdDigest;
  }, DIGEST_SYNC_TRANSACTION_OPTIONS);

  return NextResponse.json({ status: "ok", digest });
}

function digestSyncErrorResponse(error: unknown) {
  const code = readErrorField(error, "code");
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Unknown error";

  return {
    error: "Brief sync failed",
    ...(code ? { code } : {}),
    message,
  };
}

function readErrorField(error: unknown, key: string): string | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}
