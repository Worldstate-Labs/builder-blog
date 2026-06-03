-- Add an admin-editable global extraction rule block. This is the fetch-side
-- counterpart to DigestConfig.commonSummaryRules: the agent receives it for
-- every requires_agent fetch task before any source-specific fetch prompt.

ALTER TABLE "DigestConfig" ADD COLUMN "commonFetchRules" TEXT;
ALTER TABLE "UserDigestConfig" ADD COLUMN "commonFetchRules" TEXT;

UPDATE "DigestConfig"
SET "commonFetchRules" = $$Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to pick any extraction method available: web fetch, local CLI tools (yt-dlp, curl, ffmpeg, headless browser, etc.), transcription APIs - anything you have.

Keep trying available methods until real primary content that meets `task.minimumContentQuality` is obtained, or no method remains.$$;

UPDATE "UserDigestConfig"
SET "commonFetchRules" = $$Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to pick any extraction method available: web fetch, local CLI tools (yt-dlp, curl, ffmpeg, headless browser, etc.), transcription APIs - anything you have.

Keep trying available methods until real primary content that meets `task.minimumContentQuality` is obtained, or no method remains.$$;

ALTER TABLE "DigestConfig" ALTER COLUMN "commonFetchRules" SET NOT NULL;
ALTER TABLE "UserDigestConfig" ALTER COLUMN "commonFetchRules" SET NOT NULL;
