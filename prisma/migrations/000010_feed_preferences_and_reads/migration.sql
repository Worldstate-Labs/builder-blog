-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('DAILY', 'WEEKLY', 'CUSTOM');

-- CreateTable
CREATE TABLE "UserFeedPreference" (
    "userId" TEXT NOT NULL,
    "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'DAILY',
    "digestCustomFrequencyDays" INTEGER,
    "digestMaxPostAgeDays" INTEGER NOT NULL DEFAULT 90,
    "recommendationProfile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFeedPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "FeedRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedItemId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'recommendation',
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedRead_userId_feedItemId_key" ON "FeedRead"("userId", "feedItemId");

-- CreateIndex
CREATE INDEX "FeedRead_userId_readAt_idx" ON "FeedRead"("userId", "readAt");

-- CreateIndex
CREATE INDEX "FeedRead_feedItemId_idx" ON "FeedRead"("feedItemId");

-- AddForeignKey
ALTER TABLE "UserFeedPreference" ADD CONSTRAINT "UserFeedPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedRead" ADD CONSTRAINT "FeedRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedRead" ADD CONSTRAINT "FeedRead_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "FeedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
