ALTER TABLE "DigestConfig" ADD COLUMN "headlinePrompt" TEXT;
ALTER TABLE "DigestConfig" ADD COLUMN "perSourceSummaryPrompt" TEXT;
ALTER TABLE "UserDigestConfig" ADD COLUMN "headlinePrompt" TEXT;
ALTER TABLE "UserDigestConfig" ADD COLUMN "perSourceSummaryPrompt" TEXT;

UPDATE "DigestConfig"
SET
  "headlinePrompt" = '# Digest Headline Prompt

Write only `headlineSummary` for the candidate posts in the supplied FollowBrief context.

Use `context.language`. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.',
  "perSourceSummaryPrompt" = '# Per-Source Summary Prompt

You are writing an optional source-level summary for exactly one source in a FollowBrief digest.

Use `context.language`. The input contains one source and that source''s candidate posts only. Write a short source-level summary only when this source has multiple candidate posts and those posts are meaningfully about the same actor, source, or main subject. If the posts are unrelated, too sparse, or there is only one candidate post, output an empty string.

Do not summarize every post again. Do not add facts beyond the supplied post summaries and metadata.'
WHERE "headlinePrompt" IS NULL OR "perSourceSummaryPrompt" IS NULL;

UPDATE "UserDigestConfig"
SET
  "headlinePrompt" = '# Digest Headline Prompt

Write only `headlineSummary` for the candidate posts in the supplied FollowBrief context.

Use `context.language`. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.',
  "perSourceSummaryPrompt" = '# Per-Source Summary Prompt

You are writing an optional source-level summary for exactly one source in a FollowBrief digest.

Use `context.language`. The input contains one source and that source''s candidate posts only. Write a short source-level summary only when this source has multiple candidate posts and those posts are meaningfully about the same actor, source, or main subject. If the posts are unrelated, too sparse, or there is only one candidate post, output an empty string.

Do not summarize every post again. Do not add facts beyond the supplied post summaries and metadata.'
WHERE "headlinePrompt" IS NULL OR "perSourceSummaryPrompt" IS NULL;

ALTER TABLE "DigestConfig" ALTER COLUMN "headlinePrompt" SET NOT NULL;
ALTER TABLE "DigestConfig" ALTER COLUMN "perSourceSummaryPrompt" SET NOT NULL;
ALTER TABLE "UserDigestConfig" ALTER COLUMN "headlinePrompt" SET NOT NULL;
ALTER TABLE "UserDigestConfig" ALTER COLUMN "perSourceSummaryPrompt" SET NOT NULL;
