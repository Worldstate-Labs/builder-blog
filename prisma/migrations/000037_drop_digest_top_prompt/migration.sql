-- Remove the dead digestTopPrompt column. It was exposed in context.digest and
-- the legacy context.prompts.digest, but no prompt / contract / CLI ever
-- consumed it for digest writing (the agent assembles from digestIntro +
-- translate + order), so configuring it had no effect. Dropping it from the
-- default template and every per-user copy.
ALTER TABLE "DigestConfig" DROP COLUMN "digestTopPrompt";
ALTER TABLE "UserDigestConfig" DROP COLUMN "digestTopPrompt";
