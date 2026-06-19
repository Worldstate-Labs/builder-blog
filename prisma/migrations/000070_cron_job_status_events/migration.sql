CREATE TABLE "CronJobStatusEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "job" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT,
  "reason" TEXT,
  "runtime" TEXT,
  "hostname" TEXT,
  "platform" TEXT,
  "localLabel" TEXT,
  "localPlistExists" BOOLEAN,
  "launchctlLoaded" BOOLEAN,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CronJobStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CronJobStatusEvent_userId_job_createdAt_idx"
  ON "CronJobStatusEvent"("userId", "job", "createdAt" DESC);
CREATE INDEX "CronJobStatusEvent_userId_eventType_createdAt_idx"
  ON "CronJobStatusEvent"("userId", "eventType", "createdAt" DESC);

ALTER TABLE "CronJobStatusEvent"
  ADD CONSTRAINT "CronJobStatusEvent_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
