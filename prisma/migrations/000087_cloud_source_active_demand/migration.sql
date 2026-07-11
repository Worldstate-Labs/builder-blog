-- A cloud source is active only while at least one user has an active
-- submission for it. Preserve task/build history, but remove orphaned sources
-- from scheduling and from the public Cloud library membership.
UPDATE "CloudSourceTask" AS task
SET "status" = 'PAUSED'
WHERE NOT EXISTS (
  SELECT 1
  FROM "CloudSourceSubmission" AS submission
  WHERE submission."cloudBuilderId" = task."builderId"
    AND submission."active" = true
);

UPDATE "CloudFetchQueueItem" AS queue
SET "status" = 'CANCELLED'
WHERE queue."status" = 'QUEUED'
  AND EXISTS (
    SELECT 1
    FROM "CloudSourceTask" AS task
    WHERE task."id" = queue."cloudSourceTaskId"
      AND task."status" = 'PAUSED'
  );

DELETE FROM "LibraryHubItem" AS item
USING "CloudLanguageLibrary" AS library
WHERE library."hubEntryId" = item."hubEntryId"
  AND NOT EXISTS (
    SELECT 1
    FROM "CloudSourceSubmission" AS submission
    WHERE submission."cloudBuilderId" = item."builderId"
      AND submission."active" = true
  );
