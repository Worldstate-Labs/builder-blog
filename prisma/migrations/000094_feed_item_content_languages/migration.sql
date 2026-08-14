ALTER TABLE "FeedItem"
ADD COLUMN "contentLanguage" TEXT,
ADD COLUMN "summaryContentLanguage" TEXT;

CREATE INDEX "FeedItem_canonicalPostId_summaryContentLanguage_idx"
ON "FeedItem"("canonicalPostId", "summaryContentLanguage");
