-- Persist hashed prompt-link capabilities separately from exchange codes.
-- Raw opaque prompt tokens are never stored; only their SHA-256 hashes live here.
CREATE TABLE IF NOT EXISTS "AgentPromptLink" (
  "id"             TEXT         NOT NULL,
  "tokenHash"      TEXT         NOT NULL,
  "exchangeCodeId" TEXT         NOT NULL,
  "job"            TEXT         NOT NULL,
  "options"        JSONB        NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentPromptLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentPromptLink_tokenHash_key" ON "AgentPromptLink"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentPromptLink_exchangeCodeId_key" ON "AgentPromptLink"("exchangeCodeId");

DO $$ BEGIN
  ALTER TABLE "AgentPromptLink"
    ADD CONSTRAINT "AgentPromptLink_exchangeCodeId_fkey"
    FOREIGN KEY ("exchangeCodeId") REFERENCES "ExchangeCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
