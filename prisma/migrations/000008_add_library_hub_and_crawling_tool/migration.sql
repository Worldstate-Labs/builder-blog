-- Add hub/library sharing and crawl provenance.
CREATE TYPE "LibraryHubKind" AS ENUM ('CENTRAL', 'PERSONAL');

ALTER TYPE "BuilderPoolOrigin" ADD VALUE 'HUB_IMPORT';

ALTER TABLE "FeedItem" ADD COLUMN "crawlingTool" TEXT;

UPDATE "FeedItem"
SET "crawlingTool" = 'Legacy crawl/import'
WHERE "crawlingTool" IS NULL;

CREATE TABLE "LibraryHubEntry" (
  "id" TEXT NOT NULL,
  "kind" "LibraryHubKind" NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "ownerUserId" TEXT,
  "importCount" INTEGER NOT NULL DEFAULT 0,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LibraryHubEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryHubItem" (
  "hubEntryId" TEXT NOT NULL,
  "builderId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LibraryHubItem_pkey" PRIMARY KEY ("hubEntryId","builderId")
);

CREATE TABLE "LibraryImport" (
  "userId" TEXT NOT NULL,
  "hubEntryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LibraryImport_pkey" PRIMARY KEY ("userId","hubEntryId")
);

CREATE UNIQUE INDEX "LibraryHubEntry_slug_key" ON "LibraryHubEntry"("slug");
CREATE INDEX "LibraryHubEntry_kind_idx" ON "LibraryHubEntry"("kind");
CREATE INDEX "LibraryHubEntry_ownerUserId_idx" ON "LibraryHubEntry"("ownerUserId");
CREATE INDEX "LibraryHubItem_builderId_idx" ON "LibraryHubItem"("builderId");
CREATE INDEX "LibraryImport_hubEntryId_idx" ON "LibraryImport"("hubEntryId");

ALTER TABLE "LibraryHubEntry"
  ADD CONSTRAINT "LibraryHubEntry_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryHubItem"
  ADD CONSTRAINT "LibraryHubItem_hubEntryId_fkey"
  FOREIGN KEY ("hubEntryId") REFERENCES "LibraryHubEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryHubItem"
  ADD CONSTRAINT "LibraryHubItem_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryImport"
  ADD CONSTRAINT "LibraryImport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryImport"
  ADD CONSTRAINT "LibraryImport_hubEntryId_fkey"
  FOREIGN KEY ("hubEntryId") REFERENCES "LibraryHubEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
