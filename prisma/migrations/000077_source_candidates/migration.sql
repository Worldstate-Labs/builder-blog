CREATE TABLE "SourceCandidate" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "fetchUrl" TEXT,
  "handle" TEXT,
  "avatarUrl" TEXT,
  "avatarDataUrl" TEXT,
  "seedBuilderId" TEXT,
  "seededFrom" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SourceCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceCandidate_sourceKey_key" ON "SourceCandidate"("sourceKey");
CREATE INDEX "SourceCandidate_sourceType_idx" ON "SourceCandidate"("sourceType");
CREATE INDEX "SourceCandidate_updatedAt_idx" ON "SourceCandidate"("updatedAt");

INSERT INTO "SourceCandidate" (
  "id",
  "sourceKey",
  "name",
  "sourceType",
  "sourceUrl",
  "fetchUrl",
  "handle",
  "avatarUrl",
  "avatarDataUrl",
  "seedBuilderId",
  "seededFrom",
  "createdAt",
  "updatedAt"
)
SELECT
  "Builder"."id",
  "Builder"."canonicalKey",
  "Builder"."name",
  "Builder"."sourceType",
  "Builder"."sourceUrl",
  "Builder"."fetchUrl",
  "Builder"."handle",
  "Builder"."avatarUrl",
  "Builder"."avatarDataUrl",
  "Builder"."id",
  'admin_source_library',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "LibraryHubEntry"
INNER JOIN "LibraryHubItem"
  ON "LibraryHubItem"."hubEntryId" = "LibraryHubEntry"."id"
INNER JOIN "Builder"
  ON "Builder"."id" = "LibraryHubItem"."builderId"
WHERE "LibraryHubEntry"."isFeatured" = true
ON CONFLICT ("sourceKey") DO NOTHING;
