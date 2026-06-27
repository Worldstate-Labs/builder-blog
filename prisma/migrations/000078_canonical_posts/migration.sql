CREATE TABLE "CanonicalPost" (
  "id" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CanonicalPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanonicalPost_canonicalUrl_key" ON "CanonicalPost"("canonicalUrl");

ALTER TABLE "FeedItem" ADD COLUMN "canonicalPostId" TEXT;

CREATE INDEX "FeedItem_canonicalPostId_idx" ON "FeedItem"("canonicalPostId");

ALTER TABLE "FeedItem"
  ADD CONSTRAINT "FeedItem_canonicalPostId_fkey"
  FOREIGN KEY ("canonicalPostId") REFERENCES "CanonicalPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
