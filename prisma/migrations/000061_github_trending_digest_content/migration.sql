-- Historical digests store rendered markdown/headline text, so fixing builder
-- and source rows is not enough for already-synced digest archives.
UPDATE "Digest"
SET
  "title" = replace("title", 'Github Trending', 'GitHub Trending'),
  "content" = replace("content", 'Github Trending', 'GitHub Trending'),
  "headlineSummary" = CASE
    WHEN "headlineSummary" IS NULL THEN NULL
    ELSE replace("headlineSummary", 'Github Trending', 'GitHub Trending')
  END
WHERE "title" LIKE '%Github Trending%'
   OR "content" LIKE '%Github Trending%'
   OR "headlineSummary" LIKE '%Github Trending%';

-- DigestRun snapshots feed the digest log/detail surfaces. They are JSONB in
-- Postgres; replacing this exact brand string preserves valid JSON.
UPDATE "DigestRun"
SET
  "digestTitle" = CASE
    WHEN "digestTitle" IS NULL THEN NULL
    ELSE replace("digestTitle", 'Github Trending', 'GitHub Trending')
  END,
  "candidates" = replace("candidates"::text, 'Github Trending', 'GitHub Trending')::jsonb,
  "subscriptions" = replace("subscriptions"::text, 'Github Trending', 'GitHub Trending')::jsonb,
  "includedKeys" = CASE
    WHEN "includedKeys" IS NULL THEN NULL
    ELSE replace("includedKeys"::text, 'Github Trending', 'GitHub Trending')::jsonb
  END
WHERE COALESCE("digestTitle", '') LIKE '%Github Trending%'
   OR "candidates"::text LIKE '%Github Trending%'
   OR "subscriptions"::text LIKE '%Github Trending%'
   OR COALESCE("includedKeys"::text, '') LIKE '%Github Trending%';
