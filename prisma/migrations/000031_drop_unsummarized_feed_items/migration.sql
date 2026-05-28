-- Policy: a FeedItem without a non-empty `summary` is not useful to
-- the reader. The companion route change (src/app/api/skill/builders/
-- route.ts) refuses to insert such rows going forward. This one-time
-- delete clears the legacy rows so chip counts and the dedup query
-- agree again. Whitespace-only summaries are treated as missing.
--
-- Builder._count.feedItems (used by the library row "N items" chip) is
-- computed live by Prisma; no separate counter to backfill.

DELETE FROM "FeedItem"
WHERE "summary" IS NULL
   OR length(trim("summary")) = 0;
