-- M3: Constraint cutover and legacy cleanup.
--
-- Order: (1) backfill data from M1-shaped columns into the new entity layer; (2) swap
-- constraints; (3) drop legacy columns/tables/enums.
--
-- Safe to run on an empty database (all backfill steps degenerate to no-ops). Safe to run
-- against production assuming M1 has been applied.

-- ============================================================
-- 1. DATA BACKFILL
-- ============================================================

-- 1a. Create one BuilderEntity per (kind, canonicalKey) cluster, seeded from the latest
--     Builder row's display fields.
INSERT INTO "BuilderEntity" (id, "canonicalKey", kind, name, handle, bio, "createdAt", "updatedAt")
SELECT
  -- 25-char cuid-like id derived from the canonicalKey
  'be_' || substr(md5(b."canonicalKey"), 1, 24) AS id,
  b."canonicalKey",
  b.kind,
  b.name,
  b.handle,
  b.bio,
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT ON ("canonicalKey", kind)
    "canonicalKey", kind, name, handle, bio
  FROM "Builder"
  ORDER BY "canonicalKey", kind, "updatedAt" DESC
) b
ON CONFLICT ("canonicalKey") DO NOTHING;

-- 1b. Wire Builder.entityId from BuilderEntity by canonicalKey.
UPDATE "Builder" b
SET "entityId" = e.id
FROM "BuilderEntity" e
WHERE b."entityId" IS NULL AND e."canonicalKey" = b."canonicalKey";

-- 1c. Reassign scope=CENTRAL builders to the admin user (earliest admin by createdAt)
--     and ensure they belong to the admin's library. Requires an admin user to exist.
DO $$
DECLARE
  admin_user_id TEXT;
  admin_library_id TEXT;
BEGIN
  SELECT id INTO admin_user_id
  FROM "User"
  WHERE email = ANY(string_to_array(coalesce(current_setting('app.admin_emails', true), 'jie@worldstatelabs.com'), ','))
  ORDER BY "createdAt" ASC
  LIMIT 1;

  IF admin_user_id IS NULL THEN
    RAISE NOTICE 'No admin user found; skipping CENTRAL→admin reassignment.';
    RETURN;
  END IF;

  -- Reassign owner.
  UPDATE "Builder"
  SET "ownerUserId" = admin_user_id
  WHERE "ownerUserId" IS NULL OR scope = 'CENTRAL';

  -- Ensure admin's personal library exists.
  INSERT INTO "LibraryHubEntry" (id, kind, slug, name, description, "ownerUserId", "createdAt", "updatedAt")
  VALUES (
    'lhe_admin_' || substr(md5(admin_user_id), 1, 16),
    'PERSONAL',
    'personal-' || admin_user_id,
    'Community Library',
    'Community source library curated by FollowBrief.',
    admin_user_id,
    NOW(),
    NOW()
  )
  ON CONFLICT (slug) DO UPDATE SET "updatedAt" = NOW()
  RETURNING id INTO admin_library_id;

  IF admin_library_id IS NULL THEN
    SELECT id INTO admin_library_id FROM "LibraryHubEntry" WHERE slug = 'personal-' || admin_user_id;
  END IF;

  -- Ensure every admin-owned builder is in the admin library.
  INSERT INTO "LibraryHubItem" ("hubEntryId", "builderId", "createdAt")
  SELECT admin_library_id, b.id, NOW()
  FROM "Builder" b
  WHERE b."ownerUserId" = admin_user_id
  ON CONFLICT DO NOTHING;
END $$;

-- 1d. Inline UserBuilderCrawl state onto Builder. Latest crawl per builder wins.
UPDATE "Builder" b
SET
  "lastCrawledAt" = ubc."lastCrawledAt",
  "lastForcedAt"  = ubc."lastForcedAt",
  "itemCount"     = ubc."itemCount",
  status          = 'OK'
FROM (
  SELECT DISTINCT ON ("builderId") "builderId", "lastCrawledAt", "lastForcedAt", "itemCount"
  FROM "UserBuilderCrawl"
  ORDER BY "builderId", "lastCrawledAt" DESC
) ubc
WHERE ubc."builderId" = b.id;

-- 1e. Backfill Subscription.entityId from Builder.entityId.
UPDATE "Subscription" s
SET "entityId" = b."entityId"
FROM "Builder" b
WHERE s."entityId" IS NULL AND s."builderId" = b.id AND b."entityId" IS NOT NULL;

-- 1f. Backfill FeedRead canonical fields from FeedItem→Builder→entity.
UPDATE "FeedRead" fr
SET
  "entityId" = b."entityId",
  kind = fi.kind,
  "externalId" = fi."externalId"
FROM "FeedItem" fi
JOIN "Builder" b ON b.id = fi."builderId"
WHERE fr."entityId" IS NULL AND fr."feedItemId" = fi.id AND b."entityId" IS NOT NULL;

-- 1g. Dedupe duplicate subscriptions per (userId, entityId): keep earliest, delete the rest.
DELETE FROM "Subscription" s
WHERE s.id NOT IN (
  SELECT DISTINCT ON ("userId", "entityId") id
  FROM "Subscription"
  WHERE "entityId" IS NOT NULL
  ORDER BY "userId", "entityId", "createdAt" ASC
);

-- 1h. Dedupe duplicate feedReads per (userId, entityId, kind, externalId).
DELETE FROM "FeedRead" fr
WHERE fr.id NOT IN (
  SELECT DISTINCT ON ("userId", "entityId", kind, "externalId") id
  FROM "FeedRead"
  WHERE "entityId" IS NOT NULL AND kind IS NOT NULL AND "externalId" IS NOT NULL
  ORDER BY "userId", "entityId", kind, "externalId", "readAt" ASC
);

-- 1i. Migrate UserFeedPreference.adminCommunityLibraryHidden → UserLibraryVisibility.
DO $$
DECLARE
  admin_library_id TEXT;
BEGIN
  SELECT lhe.id INTO admin_library_id
  FROM "LibraryHubEntry" lhe
  JOIN "User" u ON u.id = lhe."ownerUserId"
  WHERE u.email = ANY(string_to_array(coalesce(current_setting('app.admin_emails', true), 'jie@worldstatelabs.com'), ','))
  ORDER BY lhe."updatedAt" DESC
  LIMIT 1;

  IF admin_library_id IS NOT NULL THEN
    INSERT INTO "UserLibraryVisibility" ("userId", "hubEntryId", hidden)
    SELECT "userId", admin_library_id, true
    FROM "UserFeedPreference"
    WHERE "adminCommunityLibraryHidden" = true
    ON CONFLICT ("userId", "hubEntryId") DO UPDATE SET hidden = true;
  END IF;
END $$;

-- ============================================================
-- 2. CONSTRAINT CUTOVER
-- ============================================================

-- Subscription: swap unique key from (userId, builderId) to (userId, entityId).
ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_userId_builderId_key";
DROP INDEX IF EXISTS "Subscription_userId_entityId_idx";
ALTER TABLE "Subscription" ALTER COLUMN "entityId" SET NOT NULL;
ALTER TABLE "Subscription" ALTER COLUMN "builderId" DROP NOT NULL;
CREATE UNIQUE INDEX "Subscription_userId_entityId_key" ON "Subscription"("userId", "entityId");
CREATE INDEX "Subscription_userId_builderId_idx" ON "Subscription"("userId", "builderId");

-- Subscription FK to Builder: switch ON DELETE to SetNull (subscription survives builder deletion).
ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_builderId_fkey";
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- FeedRead: swap unique key from (userId, feedItemId) to (userId, entityId, kind, externalId).
ALTER TABLE "FeedRead" DROP CONSTRAINT IF EXISTS "FeedRead_userId_feedItemId_key";
DROP INDEX IF EXISTS "FeedRead_userId_entityId_kind_externalId_idx";
ALTER TABLE "FeedRead" ALTER COLUMN "entityId" SET NOT NULL;
ALTER TABLE "FeedRead" ALTER COLUMN kind SET NOT NULL;
ALTER TABLE "FeedRead" ALTER COLUMN "externalId" SET NOT NULL;
ALTER TABLE "FeedRead" ALTER COLUMN "feedItemId" DROP NOT NULL;
CREATE UNIQUE INDEX "FeedRead_userId_entityId_kind_externalId_key" ON "FeedRead"("userId", "entityId", kind, "externalId");

-- FeedRead FK to FeedItem: switch to SetNull (read state survives FeedItem deletion).
ALTER TABLE "FeedRead" DROP CONSTRAINT IF EXISTS "FeedRead_feedItemId_fkey";
ALTER TABLE "FeedRead"
  ADD CONSTRAINT "FeedRead_feedItemId_fkey"
  FOREIGN KEY ("feedItemId") REFERENCES "FeedItem"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Builder: tighten NOT NULL on entity / owner; drop scope.
ALTER TABLE "Builder" ALTER COLUMN "entityId" SET NOT NULL;
ALTER TABLE "Builder" ALTER COLUMN "ownerUserId" SET NOT NULL;
DROP INDEX IF EXISTS "Builder_scope_kind_idx";

-- Builder FK to User: tighten to NOT NULL via reissue of FK constraint.
ALTER TABLE "Builder" DROP CONSTRAINT IF EXISTS "Builder_ownerUserId_fkey";
ALTER TABLE "Builder"
  ADD CONSTRAINT "Builder_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Builder" DROP CONSTRAINT IF EXISTS "Builder_entityId_fkey";
ALTER TABLE "Builder"
  ADD CONSTRAINT "Builder_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "BuilderEntity"(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 3. DROP LEGACY COLUMNS / TABLES / ENUM VALUES
-- ============================================================

-- BuilderPoolEntry: remap any CENTRAL_DEFAULT origin to HUB_IMPORT before dropping the enum value.
UPDATE "BuilderPoolEntry" SET origin = 'HUB_IMPORT' WHERE origin = 'CENTRAL_DEFAULT';

-- Drop columns.
ALTER TABLE "Builder" DROP COLUMN IF EXISTS scope;
ALTER TABLE "LibraryHubEntry" DROP COLUMN IF EXISTS kind;
ALTER TABLE "UserFeedPreference" DROP COLUMN IF EXISTS "adminCommunityLibraryHidden";

-- Drop legacy indexes.
DROP INDEX IF EXISTS "LibraryHubEntry_kind_idx";

-- Drop legacy table.
DROP TABLE IF EXISTS "UserBuilderCrawl";

-- Drop legacy enums. Postgres requires recreating to drop values, so we rebuild the
-- BuilderPoolOrigin enum without CENTRAL_DEFAULT.
DROP TYPE IF EXISTS "BuilderScope";
DROP TYPE IF EXISTS "LibraryHubKind";

CREATE TYPE "BuilderPoolOrigin_new" AS ENUM ('PERSONAL_SYNC', 'HUB_IMPORT');
ALTER TABLE "BuilderPoolEntry"
  ALTER COLUMN origin TYPE "BuilderPoolOrigin_new"
  USING (origin::text::"BuilderPoolOrigin_new");
DROP TYPE "BuilderPoolOrigin";
ALTER TYPE "BuilderPoolOrigin_new" RENAME TO "BuilderPoolOrigin";
