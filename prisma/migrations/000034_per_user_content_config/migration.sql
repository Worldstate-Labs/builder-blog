-- Per-user content configuration. The existing SourceTypeConfig / DigestConfig
-- rows stay as the system "default" template; each user gets a full copy
-- (materialized lazily in app code) that they edit independently.

-- CreateTable
CREATE TABLE "UserSourceTypeConfig" (
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "agentDefaultStatus" TEXT NOT NULL DEFAULT 'ready',
    "defaultFetchDays" INTEGER NOT NULL DEFAULT 7,
    "defaultFetchLimit" INTEGER NOT NULL DEFAULT 3,
    "contentQuality" JSONB NOT NULL,
    "summaryPromptBody" TEXT NOT NULL,
    "fetchPromptBody" TEXT,
    "summaryStyle" TEXT NOT NULL,
    "summaryLanguage" TEXT NOT NULL DEFAULT 'zh',
    "summaryLengthHint" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "UserSourceTypeConfig_pkey" PRIMARY KEY ("userId", "sourceId")
);

-- CreateIndex
CREATE INDEX "UserSourceTypeConfig_userId_idx" ON "UserSourceTypeConfig"("userId");

-- CreateTable
CREATE TABLE "UserDigestConfig" (
    "userId" TEXT NOT NULL,
    "digestTopPrompt" TEXT NOT NULL,
    "digestIntro" TEXT NOT NULL,
    "translate" TEXT NOT NULL,
    "digestOrder" JSONB NOT NULL,
    "commonSummaryRules" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "UserDigestConfig_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserSourceTypeConfig" ADD CONSTRAINT "UserSourceTypeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDigestConfig" ADD CONSTRAINT "UserDigestConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
