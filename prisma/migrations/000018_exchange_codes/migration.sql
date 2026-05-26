-- Create ExchangeCode table for one-shot CLI auth flow
CREATE TABLE IF NOT EXISTS "ExchangeCode" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "agentTokenId" TEXT NOT NULL,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "usedAt"       TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExchangeCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExchangeCode_code_key" ON "ExchangeCode"("code");
CREATE INDEX IF NOT EXISTS "ExchangeCode_agentTokenId_idx" ON "ExchangeCode"("agentTokenId");

ALTER TABLE "ExchangeCode" ADD CONSTRAINT "ExchangeCode_agentTokenId_fkey"
  FOREIGN KEY ("agentTokenId") REFERENCES "AgentToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
