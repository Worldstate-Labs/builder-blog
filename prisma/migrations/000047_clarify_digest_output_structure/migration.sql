-- Clarify the digest markdown contract in existing prompt rows. This only
-- replaces the exact previous Output structure section, preserving all other
-- admin/user prompt edits.

WITH patch(old_block, new_block) AS (
  VALUES (
    $old$## Output structure (Markdown — follow EXACTLY)

The FollowBrief web app parses this exact structure. Putting a title on the
wrong line makes it render as a tiny gray monospace "source" label instead of a
title, so follow this precisely:

- `## <Section name>` — one heading per section (translated to the target language).
- `### <source>` — the SOURCE identity ONLY: a domain or handle such as
  `### claude.com` or `### LatentSpacePod`. NEVER put an article title on a
  `###` line.
- `**<Article title>**` — each post's title, alone on its own line and fully
  wrapped in `**`. This is the ONLY correct place for a title.
- Then the summary paragraphs for that post.
- End each post with its source link on its own line, e.g. `原文：<url>`
  (a localized label is fine) or a bare URL.

Example (one post under one source — translate the prose to the target language):$old$,
    $new$## Output structure (Markdown - follow exactly)

FollowBrief uses a small parser, so every post must use this exact block shape:

```md
## <section name>
### <source identity only>
**<post title only>**
<summary paragraph 1>
<summary paragraph 2 if needed>
原文：<item.url>
```

Format rules:

- Use one `##` heading per section, translated to the target language.
- Use one `###` line per source. This line is only the source identity, such
  as `### claude.com` or `### LatentSpacePod`.
- Never put an article title, date, or commentary on a `###` line.
- After a `###` source line, every post must start with one standalone bold
  title line: `**<post title only>**`.
- Put the summary paragraphs after the bold title line.
- Put the source URL on the final standalone line for that post, using
  `原文：<item.url>` or a localized label. Do not put the source URL inside a
  summary paragraph.
- Repeat the bold-title + summary + source-link block for each post under the
  same source.

Example (one post under one source - translate the prose to the target language):$new$
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
    $old$## Output structure (Markdown — follow EXACTLY)

The FollowBrief web app parses this exact structure. Putting a title on the
wrong line makes it render as a tiny gray monospace "source" label instead of a
title, so follow this precisely:

- `## <Section name>` — one heading per section (translated to the target language).
- `### <source>` — the SOURCE identity ONLY: a domain or handle such as
  `### claude.com` or `### LatentSpacePod`. NEVER put an article title on a
  `###` line.
- `**<Article title>**` — each post's title, alone on its own line and fully
  wrapped in `**`. This is the ONLY correct place for a title.
- Then the summary paragraphs for that post.
- End each post with its source link on its own line, e.g. `原文：<url>`
  (a localized label is fine) or a bare URL.

Example (one post under one source — translate the prose to the target language):$old$,
    $new$## Output structure (Markdown - follow exactly)

FollowBrief uses a small parser, so every post must use this exact block shape:

```md
## <section name>
### <source identity only>
**<post title only>**
<summary paragraph 1>
<summary paragraph 2 if needed>
原文：<item.url>
```

Format rules:

- Use one `##` heading per section, translated to the target language.
- Use one `###` line per source. This line is only the source identity, such
  as `### claude.com` or `### LatentSpacePod`.
- Never put an article title, date, or commentary on a `###` line.
- After a `###` source line, every post must start with one standalone bold
  title line: `**<post title only>**`.
- Put the summary paragraphs after the bold title line.
- Put the source URL on the final standalone line for that post, using
  `原文：<item.url>` or a localized label. Do not put the source URL inside a
  summary paragraph.
- Repeat the bold-title + summary + source-link block for each post under the
  same source.

Example (one post under one source - translate the prose to the target language):$new$
  )
)
UPDATE "UserDigestConfig" AS config
SET
  "digestIntro" = replace(config."digestIntro", patch.old_block, patch.new_block),
  "updatedAt" = NOW()
FROM patch
WHERE config."digestIntro" LIKE '%' || patch.old_block || '%';
