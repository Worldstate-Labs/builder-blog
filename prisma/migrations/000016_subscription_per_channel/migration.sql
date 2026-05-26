-- Revert Subscription to per-channel: a user subscribes to a specific Builder facet
-- (one channel of a creator inside one library), not the canonical entity.
-- Consumption-layer dedup (For-You, Subscription feed, digest) still collapses to entity.
--
-- Steps:
--   1. Drop subscriptions orphaned by M3's SetNull cascade (where builderId is now NULL).
--   2. Drop the entity-keyed unique + FK.
--   3. Drop entityId column (no longer needed; derived via Builder.entityId).
--   4. Tighten builderId to NOT NULL and re-add (userId, builderId) unique.
--   5. Restore CASCADE delete on Subscription→Builder so removing a channel cleans up its subs.

DELETE FROM "Subscription" WHERE "builderId" IS NULL;

DROP INDEX IF EXISTS "Subscription_userId_entityId_key";
DROP INDEX IF EXISTS "Subscription_userId_builderId_idx";

ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_entityId_fkey";
ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_builderId_fkey";

ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "entityId";

ALTER TABLE "Subscription" ALTER COLUMN "builderId" SET NOT NULL;

CREATE UNIQUE INDEX "Subscription_userId_builderId_key"
  ON "Subscription"("userId", "builderId");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"(id) ON DELETE CASCADE ON UPDATE CASCADE;
