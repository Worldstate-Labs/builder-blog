CREATE TABLE "AgentJobRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "scheduleJob" TEXT,
  "instanceId" TEXT NOT NULL,
  "expectedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL,
  "heartbeatAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "exitCode" INTEGER,
  "signal" TEXT,
  "runtime" TEXT,
  "runnerPid" INTEGER,
  "workerPid" INTEGER,
  "hostname" TEXT,
  "platform" TEXT,
  "stage" TEXT,
  "summary" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentJobRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LibraryFetchRun" ADD COLUMN "jobRunId" TEXT;
ALTER TABLE "DigestRun" ADD COLUMN "jobRunId" TEXT;

CREATE UNIQUE INDEX "AgentJobRun_userId_instanceId_key"
  ON "AgentJobRun"("userId", "instanceId");
CREATE INDEX "AgentJobRun_userId_jobType_startedAt_idx"
  ON "AgentJobRun"("userId", "jobType", "startedAt" DESC);
CREATE INDEX "AgentJobRun_userId_scheduleJob_expectedAt_idx"
  ON "AgentJobRun"("userId", "scheduleJob", "expectedAt" DESC);
CREATE INDEX "AgentJobRun_userId_status_idx"
  ON "AgentJobRun"("userId", "status");
CREATE INDEX "LibraryFetchRun_userId_jobRunId_idx"
  ON "LibraryFetchRun"("userId", "jobRunId");
CREATE INDEX "DigestRun_userId_jobRunId_idx"
  ON "DigestRun"("userId", "jobRunId");

ALTER TABLE "AgentJobRun"
  ADD CONSTRAINT "AgentJobRun_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
