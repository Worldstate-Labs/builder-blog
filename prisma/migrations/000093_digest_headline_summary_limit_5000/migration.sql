UPDATE "DigestConfig"
SET
  "headlinePrompt" = replace(
    replace(
      "headlinePrompt",
      '1200 characters or fewer',
      '5000 characters or fewer'
    ),
    'Prefer 900 characters or fewer',
    'Prefer 4500 characters or fewer'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "headlinePrompt" LIKE '%1200 characters or fewer%';

UPDATE "UserDigestConfig"
SET
  "headlinePrompt" = replace(
    replace(
      "headlinePrompt",
      '1200 characters or fewer',
      '5000 characters or fewer'
    ),
    'Prefer 900 characters or fewer',
    'Prefer 4500 characters or fewer'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "headlinePrompt" LIKE '%1200 characters or fewer%';
