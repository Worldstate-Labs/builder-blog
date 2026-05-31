-- Drop now-unused UserFeedPreference columns. The Settings "Feed preferences"
-- module is gone; only digestMaxPostAgeDays survives (moved into the digest
-- prompt dialogs). digestFrequency was never the real digest cadence (the cron
-- cadence selector is), and recommendationProfile is no longer used in ranking.
ALTER TABLE "UserFeedPreference" DROP COLUMN IF EXISTS "digestFrequency";
ALTER TABLE "UserFeedPreference" DROP COLUMN IF EXISTS "digestCustomFrequencyDays";
ALTER TABLE "UserFeedPreference" DROP COLUMN IF EXISTS "recommendationProfile";

-- The DigestFrequency enum is now unreferenced anywhere in the schema.
DROP TYPE IF EXISTS "DigestFrequency";
