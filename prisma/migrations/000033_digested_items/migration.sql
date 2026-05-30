-- Per-user "digested" marker (mirrors FeedRead). Replaces the time-window
-- incremental + hard 90-day cap for digest candidate selection.

-- The publishedAt lookback is now optional (null = no floor); drop the
-- mandatory 90-day default.
ALTER TABLE "UserFeedPreference" ALTER COLUMN "digestMaxPostAgeDays" DROP NOT NULL;
ALTER TABLE "UserFeedPreference" ALTER COLUMN "digestMaxPostAgeDays" DROP DEFAULT;

-- CreateTable
CREATE TABLE "DigestedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedItemId" TEXT,
    "entityId" TEXT NOT NULL,
    "kind" "FeedItemKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "digestId" TEXT,
    "digestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestedItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestedItem_userId_entityId_kind_externalId_key" ON "DigestedItem"("userId", "entityId", "kind", "externalId");

-- CreateIndex
CREATE INDEX "DigestedItem_userId_digestedAt_idx" ON "DigestedItem"("userId", "digestedAt");

-- CreateIndex
CREATE INDEX "DigestedItem_feedItemId_idx" ON "DigestedItem"("feedItemId");

-- AddForeignKey
ALTER TABLE "DigestedItem" ADD CONSTRAINT "DigestedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestedItem" ADD CONSTRAINT "DigestedItem_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "FeedItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestedItem" ADD CONSTRAINT "DigestedItem_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "BuilderEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: continue the prior incremental behavior at cut-over. For each user,
-- mark every candidate post of their subscribed entities that was published on
-- or before their latest digest's period end as already digested. Posts after
-- the last digest stay undigested and surface on the next run. Keyed by content
-- identity (entityId, kind, externalId), deduped via DISTINCT.
INSERT INTO "DigestedItem" ("id", "userId", "feedItemId", "entityId", "kind", "externalId", "digestedAt")
SELECT
    -- cuid-like id derived from the per-user content identity (matches the
    -- 'prefix_' || md5 convention used by earlier backfill migrations).
    'di_' || substr(md5(s."userId" || b."entityId" || fi."kind"::text || fi."externalId"), 1, 24),
    s."userId",
    NULL,
    b."entityId",
    fi."kind",
    fi."externalId",
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT sub."userId", b2."entityId"
    FROM "Subscription" sub
    JOIN "Builder" b2 ON b2."id" = sub."builderId"
) s
JOIN "Builder" b ON b."entityId" = s."entityId"
JOIN "FeedItem" fi ON fi."builderId" = b."id"
JOIN LATERAL (
    SELECT MAX(d."periodEnd") AS last_period_end
    FROM "Digest" d
    WHERE d."userId" = s."userId"
) ld ON TRUE
WHERE ld.last_period_end IS NOT NULL
  AND fi."publishedAt" IS NOT NULL
  AND fi."publishedAt" <= ld.last_period_end
GROUP BY s."userId", b."entityId", fi."kind", fi."externalId"
ON CONFLICT ("userId", "entityId", "kind", "externalId") DO NOTHING;
