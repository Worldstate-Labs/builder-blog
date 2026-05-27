-- Track CLI-reported machine identity (hostname, OS platform, local
-- username) so the user can recognize each token in the Settings UI.
-- All three columns are best-effort metadata, not auth signals.

ALTER TABLE "AgentToken" ADD COLUMN "lastHostname" TEXT;
ALTER TABLE "AgentToken" ADD COLUMN "lastPlatform" TEXT;
ALTER TABLE "AgentToken" ADD COLUMN "lastUser" TEXT;
