CREATE TABLE "UserBuilderCrawl" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "builderId" TEXT NOT NULL,
  "lastCrawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastForcedAt" TIMESTAMP(3),
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserBuilderCrawl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserBuilderCrawl_userId_builderId_key"
  ON "UserBuilderCrawl"("userId", "builderId");

CREATE INDEX "UserBuilderCrawl_userId_lastCrawledAt_idx"
  ON "UserBuilderCrawl"("userId", "lastCrawledAt");

CREATE INDEX "UserBuilderCrawl_builderId_idx"
  ON "UserBuilderCrawl"("builderId");

ALTER TABLE "UserBuilderCrawl"
  ADD CONSTRAINT "UserBuilderCrawl_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBuilderCrawl"
  ADD CONSTRAINT "UserBuilderCrawl_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
