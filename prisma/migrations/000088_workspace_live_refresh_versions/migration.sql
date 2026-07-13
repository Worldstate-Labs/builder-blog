-- Add monotonic freshness signals for rows whose visible fields change in place.
ALTER TABLE "FeedItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "FeedRead" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "FeedFavorite" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UserLibraryVisibility" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CloudFetchRun" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CloudFetchRunTask" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Prisma supplies @updatedAt values after the backfill.
ALTER TABLE "FeedItem" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "FeedRead" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "FeedFavorite" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "UserLibraryVisibility" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "CloudFetchRun" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "CloudFetchRunTask" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX "FeedItem_builderId_updatedAt_idx" ON "FeedItem"("builderId", "updatedAt");
CREATE INDEX "FeedRead_userId_updatedAt_idx" ON "FeedRead"("userId", "updatedAt");
CREATE INDEX "FeedFavorite_userId_updatedAt_idx" ON "FeedFavorite"("userId", "updatedAt");
CREATE INDEX "UserLibraryVisibility_userId_updatedAt_idx" ON "UserLibraryVisibility"("userId", "updatedAt");
CREATE INDEX "CloudFetchRun_updatedAt_idx" ON "CloudFetchRun"("updatedAt");
CREATE INDEX "CloudFetchRunTask_builderId_updatedAt_idx" ON "CloudFetchRunTask"("builderId", "updatedAt");
