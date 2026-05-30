-- Diagnostic record of one digest generation attempt (digest analogue of
-- LibraryFetchRun). Created at `prepare` with a snapshot of the candidate
-- funnel, then updated to "synced" when the digest is posted back. The
-- candidate/subscription snapshots + includedKeys are stored inline so the
-- funnel survives deletion of the produced Digest or its DigestedItem markers.

-- CreateTable
CREATE TABLE "DigestRun" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'prepared',
  "source"            TEXT NOT NULL DEFAULT 'skill',
  "preparedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "syncedAt"          TIMESTAMP(3),
  "lookbackCutoff"    TIMESTAMP(3),
  "maxPostAgeDays"    INTEGER,
  "lastDigestAt"      TIMESTAMP(3),
  "regenerate"        BOOLEAN NOT NULL DEFAULT false,
  "subscriptionCount" INTEGER NOT NULL DEFAULT 0,
  "candidateCount"    INTEGER NOT NULL DEFAULT 0,
  "includedCount"     INTEGER,
  "candidates"        JSONB NOT NULL,
  "subscriptions"     JSONB NOT NULL,
  "includedKeys"      JSONB,
  "digestId"          TEXT,
  "digestTitle"       TEXT,
  "language"          TEXT,
  CONSTRAINT "DigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DigestRun_userId_preparedAt_idx"
  ON "DigestRun"("userId", "preparedAt" DESC);

-- AddForeignKey
ALTER TABLE "DigestRun" ADD CONSTRAINT "DigestRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
