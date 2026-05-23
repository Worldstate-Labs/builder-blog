-- CreateTable
CREATE TABLE "RecommendationSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'recommendation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationSnapshotItem" (
    "snapshotId" TEXT NOT NULL,
    "feedItemId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationSnapshotItem_pkey" PRIMARY KEY ("snapshotId","feedItemId")
);

-- CreateIndex
CREATE INDEX "RecommendationSnapshot_userId_createdAt_idx" ON "RecommendationSnapshot"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationSnapshotItem_feedItemId_idx" ON "RecommendationSnapshotItem"("feedItemId");

-- CreateIndex
CREATE INDEX "RecommendationSnapshotItem_snapshotId_rank_idx" ON "RecommendationSnapshotItem"("snapshotId", "rank");

-- AddForeignKey
ALTER TABLE "RecommendationSnapshot" ADD CONSTRAINT "RecommendationSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationSnapshotItem" ADD CONSTRAINT "RecommendationSnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RecommendationSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationSnapshotItem" ADD CONSTRAINT "RecommendationSnapshotItem_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "FeedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
