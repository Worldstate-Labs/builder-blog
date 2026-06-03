-- Rename the X source-type label back to "X/Twitter" across the default
-- source config and already-materialized per-user copies.
UPDATE "SourceTypeConfig"
SET "label" = 'X/Twitter'
WHERE "sourceId" = 'x'
  AND "label" IN ('X', 'X / Twitter');

UPDATE "UserSourceTypeConfig"
SET "label" = 'X/Twitter'
WHERE "sourceId" = 'x'
  AND "label" IN ('X', 'X / Twitter');
