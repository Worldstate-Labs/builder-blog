-- M1: Additive entity layer + inline crawl state.
-- No data destruction. All new columns are nullable; constraint cutover happens in M3.

-- CrawlStatus enum
DO $$ BEGIN
  CREATE TYPE "CrawlStatus" AS ENUM ('IDLE', 'RUNNING', 'OK', 'ERROR', 'STALE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- BuilderEntity (canonical creator)
CREATE TABLE IF NOT EXISTS "BuilderEntity" (
  "id"           TEXT          NOT NULL,
  "canonicalKey" TEXT          NOT NULL,
  "kind"         "BuilderKind" NOT NULL,
  "name"         TEXT          NOT NULL,
  "handle"       TEXT,
  "bio"          TEXT,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "BuilderEntity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BuilderEntity_canonicalKey_key" ON "BuilderEntity"("canonicalKey");
CREATE INDEX IF NOT EXISTS "BuilderEntity_kind_idx" ON "BuilderEntity"("kind");
CREATE INDEX IF NOT EXISTS "BuilderEntity_handle_idx" ON "BuilderEntity"("handle");

-- Builder: add entityId + inline crawl state (all nullable / defaulted; no data churn)
ALTER TABLE "Builder"
  ADD COLUMN IF NOT EXISTS "entityId"      TEXT,
  ADD COLUMN IF NOT EXISTS "lastCrawledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastForcedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "itemCount"     INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "status"        "CrawlStatus" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS "lastError"     TEXT;

DO $$ BEGIN
  ALTER TABLE "Builder"
    ADD CONSTRAINT "Builder_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "BuilderEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Builder_entityId_idx" ON "Builder"("entityId");

-- Subscription: add entityId (nullable until M2 backfill; unique key swap happens in M3)
ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "entityId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "BuilderEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Subscription_userId_entityId_idx" ON "Subscription"("userId", "entityId");

-- FeedRead: add canonical (entityId, kind, externalId) trio (nullable until M2 backfill)
ALTER TABLE "FeedRead"
  ADD COLUMN IF NOT EXISTS "entityId"   TEXT,
  ADD COLUMN IF NOT EXISTS "kind"       "FeedItemKind",
  ADD COLUMN IF NOT EXISTS "externalId" TEXT;

DO $$ BEGIN
  ALTER TABLE "FeedRead"
    ADD CONSTRAINT "FeedRead_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "BuilderEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "FeedRead_userId_entityId_kind_externalId_idx"
  ON "FeedRead"("userId", "entityId", "kind", "externalId");

-- UserChannelPreference (per-user primary channel choice for an entity)
CREATE TABLE IF NOT EXISTS "UserChannelPreference" (
  "userId"           TEXT         NOT NULL,
  "entityId"         TEXT         NOT NULL,
  "primaryBuilderId" TEXT         NOT NULL,
  "pinnedByUser"     BOOLEAN      NOT NULL DEFAULT false,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserChannelPreference_pkey" PRIMARY KEY ("userId", "entityId")
);

DO $$ BEGIN
  ALTER TABLE "UserChannelPreference"
    ADD CONSTRAINT "UserChannelPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserChannelPreference"
    ADD CONSTRAINT "UserChannelPreference_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "BuilderEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserChannelPreference"
    ADD CONSTRAINT "UserChannelPreference_primaryBuilderId_fkey"
    FOREIGN KEY ("primaryBuilderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "UserChannelPreference_primaryBuilderId_idx" ON "UserChannelPreference"("primaryBuilderId");

-- UserLibraryVisibility (generalization of UserFeedPreference.adminCommunityLibraryHidden)
CREATE TABLE IF NOT EXISTS "UserLibraryVisibility" (
  "userId"     TEXT    NOT NULL,
  "hubEntryId" TEXT    NOT NULL,
  "hidden"     BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "UserLibraryVisibility_pkey" PRIMARY KEY ("userId", "hubEntryId")
);

DO $$ BEGIN
  ALTER TABLE "UserLibraryVisibility"
    ADD CONSTRAINT "UserLibraryVisibility_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserLibraryVisibility"
    ADD CONSTRAINT "UserLibraryVisibility_hubEntryId_fkey"
    FOREIGN KEY ("hubEntryId") REFERENCES "LibraryHubEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "UserLibraryVisibility_hubEntryId_idx" ON "UserLibraryVisibility"("hubEntryId");
