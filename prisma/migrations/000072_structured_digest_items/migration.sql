ALTER TABLE "Digest" ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "Digest" DROP COLUMN "content";
