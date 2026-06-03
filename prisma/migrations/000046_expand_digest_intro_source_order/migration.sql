-- Move the old three-section digest ordering text to the current five
-- active source types. This is intentionally edit-respecting: it only
-- replaces the exact old default block inside existing prompts.

WITH patch(old_block, new_block) AS (
  VALUES (
    E'Then organize content in this order:\n\n1. X / Twitter section - list each builder with new posts\n2. Official Blogs section - list each blog post from AI companies or builders\n3. Podcasts section - list each podcast or video episode with new content',
    E'Then organize content in this order:\n\n1. X / Twitter section - list each builder with new posts\n2. Official Blogs section - list each blog post from AI companies or builders\n3. YouTube section - list each video episode with new content\n4. Podcasts section - list each podcast episode with new content\n5. Websites section - list each website source with new content'
  )
)
UPDATE "DigestConfig" AS config
SET
  "digestIntro" = replace(config."digestIntro", patch.old_block, patch.new_block),
  "updatedAt" = NOW()
FROM patch
WHERE config."digestIntro" LIKE '%' || patch.old_block || '%';

WITH patch(old_block, new_block) AS (
  VALUES (
    E'Then organize content in this order:\n\n1. X / Twitter section - list each builder with new posts\n2. Official Blogs section - list each blog post from AI companies or builders\n3. Podcasts section - list each podcast or video episode with new content',
    E'Then organize content in this order:\n\n1. X / Twitter section - list each builder with new posts\n2. Official Blogs section - list each blog post from AI companies or builders\n3. YouTube section - list each video episode with new content\n4. Podcasts section - list each podcast episode with new content\n5. Websites section - list each website source with new content'
  )
)
UPDATE "UserDigestConfig" AS config
SET
  "digestIntro" = replace(config."digestIntro", patch.old_block, patch.new_block),
  "updatedAt" = NOW()
FROM patch
WHERE config."digestIntro" LIKE '%' || patch.old_block || '%';
