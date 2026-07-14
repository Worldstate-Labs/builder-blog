CREATE TABLE "ResetFence" (
    "id" TEXT NOT NULL,
    "lastResetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResetFence_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ResetFence" ("id", "lastResetAt", "updatedAt")
VALUES ('global', TIMESTAMP '1970-01-01 00:00:00', CURRENT_TIMESTAMP);
