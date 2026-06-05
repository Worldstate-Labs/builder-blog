-- Backfill the GitHub Trending summary prompt that was seeded with Chinese
-- section labels before the prompt became language-neutral. Restrict the
-- update to rows still carrying the old template so later manual edits are not
-- overwritten.
UPDATE "SourceTypeConfig"
SET "summaryPromptBody" = $$# Github Trending Repo Summary Prompt

You are summarizing one GitHub Trending repository investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Use this structure, translating the section labels naturally when the selected
language is not English:

Project name:
What the project does:
Why it is gaining stars quickly:
Project URL:
Date:

Rules:

- Keep it concise but concrete.
- Mention stars today when the body or metadata provides it.
- In "What the project does", explain the actual product/library/agent/tool and who would use it.
- In "Why it is gaining stars quickly", separate confirmed causes from reasonable inference. Do not overstate weak evidence.
- Preserve the repository URL and any important supporting URLs from the body.$$
WHERE "sourceId" = 'github_trending'
  AND "summaryPromptBody" LIKE '%Write the summary in Chinese with this exact structure:%'
  AND "summaryPromptBody" LIKE '%项目名称：%';

UPDATE "UserSourceTypeConfig"
SET "summaryPromptBody" = $$# Github Trending Repo Summary Prompt

You are summarizing one GitHub Trending repository investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Use this structure, translating the section labels naturally when the selected
language is not English:

Project name:
What the project does:
Why it is gaining stars quickly:
Project URL:
Date:

Rules:

- Keep it concise but concrete.
- Mention stars today when the body or metadata provides it.
- In "What the project does", explain the actual product/library/agent/tool and who would use it.
- In "Why it is gaining stars quickly", separate confirmed causes from reasonable inference. Do not overstate weak evidence.
- Preserve the repository URL and any important supporting URLs from the body.$$
WHERE "sourceId" = 'github_trending'
  AND "summaryPromptBody" LIKE '%Write the summary in Chinese with this exact structure:%'
  AND "summaryPromptBody" LIKE '%项目名称：%';
