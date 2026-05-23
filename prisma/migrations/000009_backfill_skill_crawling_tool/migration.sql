UPDATE "FeedItem"
SET "crawlingTool" = 'Codex Desktop Builder Blog skill crawler (YouTube RSS + feed description)'
WHERE "crawlingTool" = 'Legacy crawl/import'
  AND "rawJson" LIKE '%"source":"personal-youtube"%';

UPDATE "FeedItem"
SET "crawlingTool" = 'Codex Desktop Builder Blog skill crawler (RSS/HTML article extractor)'
WHERE "crawlingTool" = 'Legacy crawl/import'
  AND "rawJson" LIKE '%"source":"personal-blog"%';
