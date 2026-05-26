-- Add plaintext token value and machine tracking columns to AgentToken
ALTER TABLE "AgentToken" ADD COLUMN IF NOT EXISTS "tokenValue" TEXT;
ALTER TABLE "AgentToken" ADD COLUMN IF NOT EXISTS "lastIp" TEXT;
ALTER TABLE "AgentToken" ADD COLUMN IF NOT EXISTS "lastUserAgent" TEXT;
