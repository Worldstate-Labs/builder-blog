ALTER TABLE "LibraryHubEntry" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "LibraryHubEntry_isFeatured_idx" ON "LibraryHubEntry"("isFeatured");

-- Backfill: mark the existing admin-owned library as featured so behavior
-- stays the same on first deploy. After this, admin email no longer drives
-- "is this the community library."
UPDATE "LibraryHubEntry" SET "isFeatured" = true
WHERE id IN (
  SELECT lhe.id
  FROM "LibraryHubEntry" lhe
  JOIN "User" u ON u.id = lhe."ownerUserId"
  WHERE u.email = ANY(string_to_array(coalesce(current_setting('app.admin_emails', true), 'jie@worldstatelabs.com'), ','))
);
