-- R3: drop the unreachable default on UserLibraryVisibility.hidden. Every writer
-- (setLibraryHidden, removeLibraryImportFromHub) sets `hidden` explicitly, so
-- the column default never applied. Column itself is kept.
ALTER TABLE "UserLibraryVisibility" ALTER COLUMN "hidden" DROP DEFAULT;

-- R4: remove the never-written DigestStatus.GENERATED enum value. SYNCED is the
-- only value ever persisted (api/skill/digests writes SYNCED). PostgreSQL has no
-- ALTER TYPE ... DROP VALUE, so the type is recreated. The USING cast below will
-- FAIL (intentionally) if any historical row still holds 'GENERATED' — that is
-- the safe outcome: surface the data rather than silently lose it.
ALTER TABLE "Digest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "DigestStatus" RENAME TO "DigestStatus_old";
CREATE TYPE "DigestStatus" AS ENUM ('SYNCED');
ALTER TABLE "Digest" ALTER COLUMN "status" TYPE "DigestStatus" USING ("status"::text::"DigestStatus");
ALTER TABLE "Digest" ALTER COLUMN "status" SET DEFAULT 'SYNCED';
DROP TYPE "DigestStatus_old";
