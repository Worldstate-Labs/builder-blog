-- Rename the X source-type label from "X / Twitter" → "X".
-- Idempotent and edit-respecting: only touches the row when its label
-- is still the previous default, so admins who customised the label
-- keep their value.

UPDATE "SourceTypeConfig"
SET "label" = 'X'
WHERE "sourceId" = 'x'
  AND "label" = 'X / Twitter';
