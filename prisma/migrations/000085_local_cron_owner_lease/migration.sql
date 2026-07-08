ALTER TABLE "LibraryCronJob"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "ownerHeartbeatAt" TIMESTAMP(3);

ALTER TABLE "DigestCronJob"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "ownerHeartbeatAt" TIMESTAMP(3);

CREATE INDEX "LibraryCronJob_userId_ownerId_idx" ON "LibraryCronJob"("userId", "ownerId");
CREATE INDEX "DigestCronJob_userId_ownerId_idx" ON "DigestCronJob"("userId", "ownerId");
