CREATE TABLE "BackupSourceCandidate" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "fetchUrl" TEXT,
  "handle" TEXT,
  "avatarUrl" TEXT,
  "avatarDataUrl" TEXT,
  "firstBuilderId" TEXT,
  "lastBuilderId" TEXT,
  "firstAddedByUserId" TEXT,
  "lastAddedByUserId" TEXT,
  "seenCount" INTEGER NOT NULL DEFAULT 1,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BackupSourceCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupSourceCandidate_sourceKey_key" ON "BackupSourceCandidate"("sourceKey");
CREATE INDEX "BackupSourceCandidate_sourceType_idx" ON "BackupSourceCandidate"("sourceType");
CREATE INDEX "BackupSourceCandidate_lastSeenAt_idx" ON "BackupSourceCandidate"("lastSeenAt");
CREATE INDEX "BackupSourceCandidate_updatedAt_idx" ON "BackupSourceCandidate"("updatedAt");
