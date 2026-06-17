-- Update the post-summary digest prompt for the shared default and admin
-- user copy. Regular users keep their personal prompt unless they reset to
-- the default later.

UPDATE "DigestConfig"
SET
  "translate" = $$# Translation Prompt

You are rewriting, translating, and compressing an already-written per-post
summary into the target language given by context.language. If context.language
is source, keep each per-post summary in the same language as the supplied
summary instead of translating it to a fixed language.

## Instructions

- Render only the supplied per-post summary into natural, fluent prose in
  context.language. If context.language is source, use the supplied summary's
  own language. It must read as if originally written in that language, not
  translated.
- Keep the output to 500 words or fewer. Preserve the original per-post
  summary's key points, viewpoints, insights, important claims, concrete facts,
  names, numbers, URLs, and source attribution.
- Compress wording, not meaning. Do not drop a key claim just to make the copy
  shorter unless it is repetitive or low-signal.
- Do not write headlineSummary.
- Do not write source-level summaries.
- Keep technical terms in English where professionals in that language typically
  use them: AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent,
  transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, and tools.
- Keep all URLs unchanged.
- The tone should be professional but conversational, like a knowledgeable friend briefing you.
- Never use em dashes.$$,
  "updatedAt" = NOW()
WHERE "id" = 'global';

WITH admin_emails AS (
  SELECT lower(trim(email)) AS email
  FROM unnest(
    string_to_array(
      coalesce(current_setting('app.admin_emails', true), 'jie@worldstatelabs.com'),
      ','
    )
  ) AS email
),
admin_users AS (
  SELECT u.id
  FROM "User" u
  JOIN admin_emails ae ON lower(u.email) = ae.email
)
UPDATE "UserDigestConfig" udc
SET
  "translate" = $$# Translation Prompt

You are rewriting, translating, and compressing an already-written per-post
summary into the target language given by context.language. If context.language
is source, keep each per-post summary in the same language as the supplied
summary instead of translating it to a fixed language.

## Instructions

- Render only the supplied per-post summary into natural, fluent prose in
  context.language. If context.language is source, use the supplied summary's
  own language. It must read as if originally written in that language, not
  translated.
- Keep the output to 500 words or fewer. Preserve the original per-post
  summary's key points, viewpoints, insights, important claims, concrete facts,
  names, numbers, URLs, and source attribution.
- Compress wording, not meaning. Do not drop a key claim just to make the copy
  shorter unless it is repetitive or low-signal.
- Do not write headlineSummary.
- Do not write source-level summaries.
- Keep technical terms in English where professionals in that language typically
  use them: AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent,
  transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, and tools.
- Keep all URLs unchanged.
- The tone should be professional but conversational, like a knowledgeable friend briefing you.
- Never use em dashes.$$,
  "updatedAt" = NOW()
FROM admin_users
WHERE udc."userId" = admin_users.id;
