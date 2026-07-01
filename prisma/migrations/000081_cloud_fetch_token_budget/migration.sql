ALTER TABLE "CloudFetchConfig"
  ADD COLUMN "tokenBudgetPerHour" INTEGER NOT NULL DEFAULT 1000000,
  DROP COLUMN "maxTasksPerHour",
  DROP COLUMN "maxActiveLeases",
  DROP COLUMN "workerSecondsPerHour",
  DROP COLUMN "defaultBatchSize",
  DROP COLUMN "planningHorizonHours",
  DROP COLUMN "retryReserveRatio";

ALTER TABLE "CloudSourceTask"
  ADD COLUMN "estimatedTokenCost" INTEGER,
  ADD COLUMN "tokenSampleCount" INTEGER NOT NULL DEFAULT 0;
