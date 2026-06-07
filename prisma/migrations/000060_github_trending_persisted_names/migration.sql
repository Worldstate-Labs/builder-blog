-- Existing GitHub Trending builders/entities/feed items can keep rendering the
-- old "Github" capitalization even after SourceTypeConfig labels are fixed.
-- Backfill the persisted display names that feed Hub, Search, and feed cards.
UPDATE "Builder"
SET "name" = 'GitHub Trending'
WHERE "sourceType" = 'github_trending'
  AND "name" = 'Github Trending';

UPDATE "BuilderEntity"
SET "name" = 'GitHub Trending'
WHERE "name" = 'Github Trending'
  AND "canonicalKey" IN (
    SELECT DISTINCT "canonicalKey"
    FROM "Builder"
    WHERE "sourceType" = 'github_trending'
  );

UPDATE "FeedItem"
SET "sourceName" = 'GitHub Trending'
WHERE "sourceName" = 'Github Trending';
