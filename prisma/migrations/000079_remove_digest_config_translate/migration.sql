-- Remove the now-unused per-post "translate" digest prompt. Post summaries are
-- copied verbatim by the CLI; the digest agent no longer rewrites or translates
-- them, so the stored prompt is dead config.
ALTER TABLE "DigestConfig" DROP COLUMN "translate";
ALTER TABLE "UserDigestConfig" DROP COLUMN "translate";
