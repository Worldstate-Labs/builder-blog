ALTER TABLE "CloudSourceTask"
  ADD COLUMN "estimatedPostYield" DOUBLE PRECISION,
  ADD COLUMN "postYieldSampleCount" INTEGER NOT NULL DEFAULT 0;
