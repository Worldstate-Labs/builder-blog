-- Add crawler-specific source URL storage for feeds such as podcast RSS.
ALTER TABLE "Builder" ADD COLUMN "crawlUrl" TEXT;
