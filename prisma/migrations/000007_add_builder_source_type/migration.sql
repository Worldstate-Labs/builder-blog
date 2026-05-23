ALTER TABLE "Builder"
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'auto';

CREATE INDEX "Builder_sourceType_idx" ON "Builder"("sourceType");
