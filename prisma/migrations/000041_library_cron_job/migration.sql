CREATE TABLE "LibraryCronJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "stoppedAt" TIMESTAMP(3),
  "frequencyKey" TEXT NOT NULL,
  "frequencyLabel" TEXT NOT NULL,
  "schedule" TEXT NOT NULL,
  "intervalMinutes" INTEGER NOT NULL,
  "runtime" TEXT,
  "overrideFetched" BOOLEAN NOT NULL DEFAULT false,
  "hostname" TEXT,
  "platform" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LibraryCronJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryCronJob_userId_key" ON "LibraryCronJob"("userId");
CREATE INDEX "LibraryCronJob_userId_status_idx" ON "LibraryCronJob"("userId", "status");

ALTER TABLE "LibraryCronJob"
  ADD CONSTRAINT "LibraryCronJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
