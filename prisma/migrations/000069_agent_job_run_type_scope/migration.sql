DROP INDEX IF EXISTS "AgentJobRun_userId_instanceId_key";

CREATE UNIQUE INDEX "AgentJobRun_userId_jobType_instanceId_key"
  ON "AgentJobRun"("userId", "jobType", "instanceId");

CREATE INDEX "AgentJobRun_userId_instanceId_idx"
  ON "AgentJobRun"("userId", "instanceId");
