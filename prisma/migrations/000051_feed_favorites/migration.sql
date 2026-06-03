CREATE TABLE "FeedFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedItemId" TEXT,
    "entityId" TEXT NOT NULL,
    "kind" "FeedItemKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "favoritedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeedFavorite_userId_entityId_kind_externalId_key"
  ON "FeedFavorite"("userId", "entityId", "kind", "externalId");

CREATE INDEX "FeedFavorite_userId_favoritedAt_idx"
  ON "FeedFavorite"("userId", "favoritedAt");

CREATE INDEX "FeedFavorite_userId_entityId_idx"
  ON "FeedFavorite"("userId", "entityId");

CREATE INDEX "FeedFavorite_feedItemId_idx"
  ON "FeedFavorite"("feedItemId");

ALTER TABLE "FeedFavorite"
  ADD CONSTRAINT "FeedFavorite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedFavorite"
  ADD CONSTRAINT "FeedFavorite_feedItemId_fkey"
  FOREIGN KEY ("feedItemId") REFERENCES "FeedItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FeedFavorite"
  ADD CONSTRAINT "FeedFavorite_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "BuilderEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
