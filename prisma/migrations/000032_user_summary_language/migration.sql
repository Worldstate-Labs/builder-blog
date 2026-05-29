-- Account-wide summary output language (nullable; null = per-source default).
ALTER TABLE "UserFeedPreference" ADD COLUMN "summaryLanguage" TEXT;
