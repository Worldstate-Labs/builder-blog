-- Align default fetch and digest windows with the prompt UI:
-- fetch/digest windows default to 30 days and user-selectable values are capped
-- in application code at 90 days.

ALTER TABLE "SourceTypeConfig" ALTER COLUMN "defaultFetchDays" SET DEFAULT 30;
ALTER TABLE "UserSourceTypeConfig" ALTER COLUMN "defaultFetchDays" SET DEFAULT 30;

-- Existing rows that still carry the old seeded defaults should follow the new
-- default. Preserve manually customized values outside the old defaults.
UPDATE "SourceTypeConfig"
SET "defaultFetchDays" = 30
WHERE "defaultFetchDays" IN (1, 7);

UPDATE "UserSourceTypeConfig"
SET "defaultFetchDays" = 30
WHERE "defaultFetchDays" IN (1, 7);

-- GitHub Trending and Product Hunt now use the same top-3 fetch limit as other
-- source types. Only rewrite the prior seeded top-5 rows.
UPDATE "SourceTypeConfig"
SET "defaultFetchLimit" = 3
WHERE "sourceId" IN ('github_trending', 'product_hunt_top_products')
  AND "defaultFetchLimit" = 5;

UPDATE "UserSourceTypeConfig"
SET "defaultFetchLimit" = 3
WHERE "sourceId" IN ('github_trending', 'product_hunt_top_products')
  AND "defaultFetchLimit" = 5;

-- The previous UI commonly stored 90 as the account digest window. Move those
-- old-default rows to the new 30-day default; other customized values remain.
UPDATE "UserFeedPreference"
SET "digestMaxPostAgeDays" = 30
WHERE "digestMaxPostAgeDays" IS NULL
   OR "digestMaxPostAgeDays" = 90;
