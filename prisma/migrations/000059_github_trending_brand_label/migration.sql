-- Normalize the user-visible GitHub brand capitalization across existing
-- source config rows. Seed defaults are updated in code, but existing rows are
-- preserved by the seeding path and need an explicit backfill.
UPDATE "SourceTypeConfig"
SET "label" = 'GitHub Trending'
WHERE "sourceId" = 'github_trending'
  AND "label" = 'Github Trending';

UPDATE "UserSourceTypeConfig"
SET "label" = 'GitHub Trending'
WHERE "sourceId" = 'github_trending'
  AND "label" = 'Github Trending';
