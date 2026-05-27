-- Add ciphertext column for agent tokens (AES-256-GCM via app-side
-- encryption). The legacy plaintext `tokenValue` column remains
-- nullable so already-created rows still resolve; a follow-up
-- migration will drop it once rotated.

ALTER TABLE "AgentToken" ADD COLUMN "tokenCiphertext" TEXT;
