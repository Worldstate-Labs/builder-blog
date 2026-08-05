ALTER TABLE "CloudFetchRun" ADD COLUMN "agentJobRunId" TEXT;

CREATE INDEX "CloudFetchRun_createdByUserId_agentJobRunId_status_idx"
ON "CloudFetchRun"("createdByUserId", "agentJobRunId", "status");

ALTER TABLE "CloudFetchRun"
  ADD CONSTRAINT "CloudFetchRun_agentJobRunId_fkey"
  FOREIGN KEY ("agentJobRunId") REFERENCES "AgentJobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
