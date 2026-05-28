CREATE TABLE "LibraryFetchRun" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "startedAt"         TIMESTAMP(3) NOT NULL,
  "finishedAt"        TIMESTAMP(3) NOT NULL,
  "durationMs"        INTEGER NOT NULL,
  "status"            TEXT NOT NULL,
  "source"            TEXT NOT NULL,
  "cliVersion"        TEXT,
  "hostname"          TEXT,
  "platform"          TEXT,
  "buildersAttempted" INTEGER NOT NULL DEFAULT 0,
  "itemsFetched"      INTEGER NOT NULL DEFAULT 0,
  "tasksGenerated"    INTEGER NOT NULL DEFAULT 0,
  "userActionsCount"  INTEGER NOT NULL DEFAULT 0,
  "errorCount"        INTEGER NOT NULL DEFAULT 0,
  "summary"           TEXT NOT NULL,
  "details"           JSONB NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryFetchRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LibraryFetchRun_userId_startedAt_idx"
  ON "LibraryFetchRun"("userId", "startedAt" DESC);

ALTER TABLE "LibraryFetchRun" ADD CONSTRAINT "LibraryFetchRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
