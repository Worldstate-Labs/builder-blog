-- Values above the current UI/API maximum came from older clients that
-- silently clamped user input. Normalize those stale preferences to the
-- product default so the dialog opens at 30 days instead of displaying 90.
UPDATE "UserFeedPreference"
SET "digestMaxPostAgeDays" = 30
WHERE "digestMaxPostAgeDays" IS NULL
   OR "digestMaxPostAgeDays" < 1
   OR "digestMaxPostAgeDays" > 90;
