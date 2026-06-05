ALTER TABLE "FeedFavorite" ADD COLUMN "markedReadAt" TIMESTAMP(3);

CREATE INDEX "FeedFavorite_userId_markedReadAt_idx" ON "FeedFavorite"("userId", "markedReadAt");
