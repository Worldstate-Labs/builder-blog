-- Rename the "crawl" vocabulary to "fetch" across the schema.
-- This migration is rename-only: no data is dropped, no rows are touched.
-- Historical migration files (000001-000024) continue to use the old names;
-- the database arrives at the new names at the tail end of the chain.

-- 1. Builder.crawlUrl -> Builder.fetchUrl
ALTER TABLE "Builder" RENAME COLUMN "crawlUrl" TO "fetchUrl";

-- 2. Builder.lastCrawledAt -> Builder.lastFetchedAt
ALTER TABLE "Builder" RENAME COLUMN "lastCrawledAt" TO "lastFetchedAt";

-- 3. CrawlStatus enum type -> FetchStatus
ALTER TYPE "CrawlStatus" RENAME TO "FetchStatus";

-- 4. FeedItem.crawlingTool -> FeedItem.fetchTool
ALTER TABLE "FeedItem" RENAME COLUMN "crawlingTool" TO "fetchTool";

-- 5. SourceTypeConfig.defaultCrawlDays / defaultCrawlLimit
ALTER TABLE "SourceTypeConfig" RENAME COLUMN "defaultCrawlDays" TO "defaultFetchDays";
ALTER TABLE "SourceTypeConfig" RENAME COLUMN "defaultCrawlLimit" TO "defaultFetchLimit";

-- 6. Search index on the renamed column.
ALTER INDEX "Builder_crawlUrl_search_idx" RENAME TO "Builder_fetchUrl_search_idx";
