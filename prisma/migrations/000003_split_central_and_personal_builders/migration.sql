-- Split the builder catalog into a central web-crawled library and per-user
-- personal libraries synced by user-owned agents.

CREATE TYPE "BuilderScope" AS ENUM ('CENTRAL', 'PERSONAL');

ALTER TABLE "Builder"
  ADD COLUMN "scope" "BuilderScope" NOT NULL DEFAULT 'CENTRAL',
  ADD COLUMN "ownerUserId" TEXT,
  ADD COLUMN "libraryKey" TEXT;

UPDATE "Builder"
SET "libraryKey" = 'central:' || "canonicalKey"
WHERE "libraryKey" IS NULL;

ALTER TABLE "Builder" ALTER COLUMN "libraryKey" SET NOT NULL;

DROP INDEX "Builder_canonicalKey_key";
CREATE UNIQUE INDEX "Builder_libraryKey_key" ON "Builder"("libraryKey");
CREATE INDEX "Builder_scope_kind_idx" ON "Builder"("scope", "kind");
CREATE INDEX "Builder_ownerUserId_kind_idx" ON "Builder"("ownerUserId", "kind");

ALTER TABLE "Builder"
  ADD CONSTRAINT "Builder_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "FeedItem_kind_externalId_key";
CREATE UNIQUE INDEX "FeedItem_builderId_kind_externalId_key"
  ON "FeedItem"("builderId", "kind", "externalId");
