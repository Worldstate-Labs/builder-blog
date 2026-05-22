-- Track the user's builder pool separately from digest subscriptions.
-- Pool entry = available in the user's library. Subscription = included in
-- periodic digest context.

CREATE TYPE "BuilderPoolOrigin" AS ENUM ('CENTRAL_DEFAULT', 'PERSONAL_SYNC');

CREATE TABLE "BuilderPoolEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "origin" "BuilderPoolOrigin" NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderPoolEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuilderPoolEntry_userId_builderId_key"
  ON "BuilderPoolEntry"("userId", "builderId");
CREATE INDEX "BuilderPoolEntry_userId_removedAt_idx"
  ON "BuilderPoolEntry"("userId", "removedAt");
CREATE INDEX "BuilderPoolEntry_builderId_idx"
  ON "BuilderPoolEntry"("builderId");

ALTER TABLE "BuilderPoolEntry"
  ADD CONSTRAINT "BuilderPoolEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuilderPoolEntry"
  ADD CONSTRAINT "BuilderPoolEntry_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "BuilderPoolEntry" ("id", "userId", "builderId", "origin", "updatedAt")
SELECT 'bpe_' || substr(md5(random()::text || "User"."id" || "Builder"."id"), 1, 24),
       "User"."id",
       "Builder"."id",
       'CENTRAL_DEFAULT'::"BuilderPoolOrigin",
       CURRENT_TIMESTAMP
FROM "User"
CROSS JOIN "Builder"
WHERE "Builder"."scope" = 'CENTRAL'
ON CONFLICT ("userId", "builderId") DO NOTHING;

INSERT INTO "BuilderPoolEntry" ("id", "userId", "builderId", "origin", "updatedAt")
SELECT 'bpe_' || substr(md5(random()::text || "ownerUserId" || "id"), 1, 24),
       "ownerUserId",
       "id",
       'PERSONAL_SYNC'::"BuilderPoolOrigin",
       CURRENT_TIMESTAMP
FROM "Builder"
WHERE "scope" = 'PERSONAL'
  AND "ownerUserId" IS NOT NULL
ON CONFLICT ("userId", "builderId") DO NOTHING;
