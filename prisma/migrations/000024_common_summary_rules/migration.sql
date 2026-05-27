-- Refactor single-post summary prompt construction:
--   * Drop the per-source `summaryPromptSinglePostAdaptation` column —
--     the once-skill template now folds those instructions into a single
--     admin-editable global field.
--   * Add `DigestConfig.commonSummaryRules`, the new global block of
--     constraints prepended to every library-once single-post summary.
-- The default text below is the verbatim seed used in
-- src/lib/source-config-seed.ts (DEFAULT_COMMON_SUMMARY_RULES); the
-- one-time UPDATE backfills the column on existing rows before the NOT
-- NULL constraint is set.

ALTER TABLE "SourceTypeConfig" DROP COLUMN "summaryPromptSinglePostAdaptation";

ALTER TABLE "DigestConfig" ADD COLUMN "commonSummaryRules" TEXT;

UPDATE "DigestConfig"
SET "commonSummaryRules" = $$This task is self-contained; do not read external prompt files.

- Summarize exactly one supplied task item.
- Use task.item.body as the primary content.
- Use task.item.title, source metadata, and task.item.url only as context and source attribution.
- Include the direct source URL for every claim.
- Do not summarize from title, description, or page metadata alone.
- Apply the quality bar and no-fabrication, direct-quote-only, source-link rules stated in the source-specific prompt below.$$;

ALTER TABLE "DigestConfig" ALTER COLUMN "commonSummaryRules" SET NOT NULL;
