-- Keep the prompt template itself in English while still allowing localized
-- labels in generated digests.

UPDATE "DigestConfig"
SET
  "digestIntro" = replace(
    replace(
      "digestIntro",
      E'<summary paragraph 2 if needed>\n原文：<item.url>',
      E'<summary paragraph 2 if needed>\nSource: <item.url>'
    ),
    E'using\n  `原文：<item.url>` or a localized label. Do not put the source URL inside a\n  summary paragraph.',
    E'using\n  `Source: <item.url>`. A localized label such as `原文：<item.url>` is also\n  acceptable when the final digest is not in English. Do not put the source URL\n  inside a summary paragraph.'
  ),
  "updatedAt" = NOW()
WHERE "digestIntro" LIKE '%原文：<item.url>%';

UPDATE "UserDigestConfig"
SET
  "digestIntro" = replace(
    replace(
      "digestIntro",
      E'<summary paragraph 2 if needed>\n原文：<item.url>',
      E'<summary paragraph 2 if needed>\nSource: <item.url>'
    ),
    E'using\n  `原文：<item.url>` or a localized label. Do not put the source URL inside a\n  summary paragraph.',
    E'using\n  `Source: <item.url>`. A localized label such as `原文：<item.url>` is also\n  acceptable when the final digest is not in English. Do not put the source URL\n  inside a summary paragraph.'
  ),
  "updatedAt" = NOW()
WHERE "digestIntro" LIKE '%原文：<item.url>%';
