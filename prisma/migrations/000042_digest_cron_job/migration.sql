-- CreateTable
CREATE TABLE "DigestCronJob" (
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
    "regenerateDigest" BOOLEAN NOT NULL DEFAULT false,
    "hostname" TEXT,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestCronJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigestCronJob_userId_key" ON "DigestCronJob"("userId");

-- CreateIndex
CREATE INDEX "DigestCronJob_userId_status_idx" ON "DigestCronJob"("userId", "status");

-- AddForeignKey
ALTER TABLE "DigestCronJob" ADD CONSTRAINT "DigestCronJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
