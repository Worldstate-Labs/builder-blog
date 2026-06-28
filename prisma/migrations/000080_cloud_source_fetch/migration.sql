CREATE TYPE "CloudFetchFrequency" AS ENUM ('DAILY', 'WEEKLY');

CREATE TYPE "CloudSourceTaskStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

CREATE TYPE "CloudFetchQueueStatus" AS ENUM ('QUEUED', 'LEASED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TYPE "CloudFetchRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

CREATE TABLE "CloudFetchConfig" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "maxTasksPerHour" INTEGER NOT NULL DEFAULT 20,
  "maxActiveLeases" INTEGER NOT NULL DEFAULT 20,
  "workerSecondsPerHour" INTEGER NOT NULL DEFAULT 3600,
  "defaultBatchSize" INTEGER NOT NULL DEFAULT 10,
  "leaseTtlMinutes" INTEGER NOT NULL DEFAULT 60,
  "schedulingLeadMinutes" INTEGER NOT NULL DEFAULT 120,
  "planningHorizonHours" INTEGER NOT NULL DEFAULT 48,
  "retryBaseMinutes" INTEGER NOT NULL DEFAULT 30,
  "starvationReserveRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  "retryReserveRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  "failureCircuitBreakerThreshold" INTEGER NOT NULL DEFAULT 5,
  "canonicalCooldownMinutes" INTEGER NOT NULL DEFAULT 60,
  "durationColdStartBufferRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT,

  CONSTRAINT "CloudFetchConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CloudLanguageLibrary" (
  "id" TEXT NOT NULL,
  "summaryLanguage" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "hubEntryId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CloudLanguageLibrary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CloudSourceSubmission" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userBuilderId" TEXT,
  "cloudBuilderId" TEXT NOT NULL,
  "summaryLanguage" TEXT NOT NULL,
  "frequency" "CloudFetchFrequency" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CloudSourceSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CloudSourceTask" (
  "id" TEXT NOT NULL,
  "cloudLanguageLibraryId" TEXT NOT NULL,
  "builderId" TEXT NOT NULL,
  "summaryLanguage" TEXT NOT NULL,
  "effectiveFrequency" "CloudFetchFrequency" NOT NULL,
  "status" "CloudSourceTaskStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastQueuedAt" TIMESTAMP(3),
  "lastStartedAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastFailureReason" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "consecutiveDeferrals" INTEGER NOT NULL DEFAULT 0,
  "lastDeferredAt" TIMESTAMP(3),
  "estimatedDurationSeconds" INTEGER,
  "estimatedSuccessProbability" DOUBLE PRECISION,
  "durationP50Seconds" INTEGER,
  "durationP75Seconds" INTEGER,
  "durationP90Seconds" INTEGER,
  "durationSampleCount" INTEGER NOT NULL DEFAULT 0,
  "successSampleCount" INTEGER NOT NULL DEFAULT 0,
  "circuitBreakerUntil" TIMESTAMP(3),
  "circuitBreakerReason" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "mustSucceedBy" TIMESTAMP(3),
  "lastRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CloudSourceTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CloudFetchQueueItem" (
  "id" TEXT NOT NULL,
  "cloudSourceTaskId" TEXT NOT NULL,
  "status" "CloudFetchQueueStatus" NOT NULL DEFAULT 'QUEUED',
  "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "mustSucceedBy" TIMESTAMP(3) NOT NULL,
  "leasedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "runId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CloudFetchQueueItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CloudFetchRun" (
  "id" TEXT NOT NULL,
  "leaseOwner" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" "CloudFetchRunStatus" NOT NULL DEFAULT 'RUNNING',
  "requestedLimit" INTEGER NOT NULL,
  "tasksClaimed" INTEGER NOT NULL DEFAULT 0,
  "tasksSucceeded" INTEGER NOT NULL DEFAULT 0,
  "tasksFailed" INTEGER NOT NULL DEFAULT 0,
  "usageTokens" INTEGER,
  "usageCostUsd" DECIMAL(10,4),
  "summary" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdByUserId" TEXT,

  CONSTRAINT "CloudFetchRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CloudFetchRunTask" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "cloudSourceTaskId" TEXT NOT NULL,
  "builderId" TEXT NOT NULL,
  "summaryLanguage" TEXT NOT NULL,
  "status" "CloudFetchRunStatus" NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "plannedPosts" INTEGER NOT NULL DEFAULT 0,
  "syncedPosts" INTEGER NOT NULL DEFAULT 0,
  "failedPosts" INTEGER NOT NULL DEFAULT 0,
  "estimatedDurationSeconds" INTEGER,
  "actualDurationSeconds" INTEGER,
  "successProbabilitySnapshot" DOUBLE PRECISION,
  "failureReason" TEXT,
  "usageTokens" INTEGER,
  "usageCostUsd" DECIMAL(10,4),
  "details" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "CloudFetchRunTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CloudLanguageLibrary_summaryLanguage_key" ON "CloudLanguageLibrary"("summaryLanguage");
CREATE UNIQUE INDEX "CloudLanguageLibrary_ownerUserId_key" ON "CloudLanguageLibrary"("ownerUserId");
CREATE UNIQUE INDEX "CloudLanguageLibrary_hubEntryId_key" ON "CloudLanguageLibrary"("hubEntryId");
CREATE INDEX "CloudLanguageLibrary_enabled_idx" ON "CloudLanguageLibrary"("enabled");

CREATE UNIQUE INDEX "CloudSourceSubmission_userId_cloudBuilderId_key" ON "CloudSourceSubmission"("userId", "cloudBuilderId");
CREATE INDEX "CloudSourceSubmission_cloudBuilderId_active_idx" ON "CloudSourceSubmission"("cloudBuilderId", "active");
CREATE INDEX "CloudSourceSubmission_summaryLanguage_active_idx" ON "CloudSourceSubmission"("summaryLanguage", "active");

CREATE UNIQUE INDEX "CloudSourceTask_builderId_key" ON "CloudSourceTask"("builderId");
CREATE INDEX "CloudSourceTask_cloudLanguageLibraryId_status_idx" ON "CloudSourceTask"("cloudLanguageLibraryId", "status");
CREATE INDEX "CloudSourceTask_status_nextAttemptAt_idx" ON "CloudSourceTask"("status", "nextAttemptAt");
CREATE INDEX "CloudSourceTask_mustSucceedBy_idx" ON "CloudSourceTask"("mustSucceedBy");

CREATE INDEX "CloudFetchQueueItem_status_dueAt_idx" ON "CloudFetchQueueItem"("status", "dueAt");
CREATE INDEX "CloudFetchQueueItem_leaseOwner_leaseExpiresAt_idx" ON "CloudFetchQueueItem"("leaseOwner", "leaseExpiresAt");
CREATE INDEX "CloudFetchQueueItem_cloudSourceTaskId_status_idx" ON "CloudFetchQueueItem"("cloudSourceTaskId", "status");
CREATE UNIQUE INDEX "CloudFetchQueueItem_active_task_key"
ON "CloudFetchQueueItem"("cloudSourceTaskId")
WHERE "status" IN ('QUEUED', 'LEASED');

CREATE INDEX "CloudFetchRun_startedAt_idx" ON "CloudFetchRun"("startedAt" DESC);
CREATE INDEX "CloudFetchRun_status_idx" ON "CloudFetchRun"("status");

CREATE UNIQUE INDEX "CloudFetchRunTask_runId_cloudSourceTaskId_key" ON "CloudFetchRunTask"("runId", "cloudSourceTaskId");
CREATE INDEX "CloudFetchRunTask_cloudSourceTaskId_finishedAt_idx" ON "CloudFetchRunTask"("cloudSourceTaskId", "finishedAt");
CREATE INDEX "CloudFetchRunTask_builderId_finishedAt_idx" ON "CloudFetchRunTask"("builderId", "finishedAt");

ALTER TABLE "CloudLanguageLibrary"
  ADD CONSTRAINT "CloudLanguageLibrary_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudLanguageLibrary"
  ADD CONSTRAINT "CloudLanguageLibrary_hubEntryId_fkey"
  FOREIGN KEY ("hubEntryId") REFERENCES "LibraryHubEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CloudSourceSubmission"
  ADD CONSTRAINT "CloudSourceSubmission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudSourceSubmission"
  ADD CONSTRAINT "CloudSourceSubmission_userBuilderId_fkey"
  FOREIGN KEY ("userBuilderId") REFERENCES "Builder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CloudSourceSubmission"
  ADD CONSTRAINT "CloudSourceSubmission_cloudBuilderId_fkey"
  FOREIGN KEY ("cloudBuilderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudSourceTask"
  ADD CONSTRAINT "CloudSourceTask_cloudLanguageLibraryId_fkey"
  FOREIGN KEY ("cloudLanguageLibraryId") REFERENCES "CloudLanguageLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudSourceTask"
  ADD CONSTRAINT "CloudSourceTask_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudFetchQueueItem"
  ADD CONSTRAINT "CloudFetchQueueItem_cloudSourceTaskId_fkey"
  FOREIGN KEY ("cloudSourceTaskId") REFERENCES "CloudSourceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudFetchQueueItem"
  ADD CONSTRAINT "CloudFetchQueueItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CloudFetchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CloudFetchRunTask"
  ADD CONSTRAINT "CloudFetchRunTask_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CloudFetchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudFetchRunTask"
  ADD CONSTRAINT "CloudFetchRunTask_cloudSourceTaskId_fkey"
  FOREIGN KEY ("cloudSourceTaskId") REFERENCES "CloudSourceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CloudFetchRunTask"
  ADD CONSTRAINT "CloudFetchRunTask_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
