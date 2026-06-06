UPDATE "DigestConfig"
SET "headlinePrompt" = replace(
  "headlinePrompt",
  'Use `context.language`. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Keep it to 300 characters or fewer. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.',
  'Use `context.language`. If `context.language` is `source`, write in the dominant language of the supplied candidate post summaries. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Keep it to 300 characters or fewer. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.'
)
WHERE "headlinePrompt" LIKE '%Use `context.language`. Keep it compact: one short news-headline paragraph%';

UPDATE "UserDigestConfig"
SET "headlinePrompt" = replace(
  "headlinePrompt",
  'Use `context.language`. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Keep it to 300 characters or fewer. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.',
  'Use `context.language`. If `context.language` is `source`, write in the dominant language of the supplied candidate post summaries. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Keep it to 300 characters or fewer. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.'
)
WHERE "headlinePrompt" LIKE '%Use `context.language`. Keep it compact: one short news-headline paragraph%';

UPDATE "DigestConfig"
SET "perSourceSummaryPrompt" = replace(
  "perSourceSummaryPrompt",
  'Use `context.language`. The input contains one source and that source''s candidate posts only. Write a short source-level summary only when this source has multiple candidate posts and those posts are meaningfully about the same actor, source, or main subject. If the posts are unrelated, too sparse, or there is only one candidate post, output an empty string.',
  'Use `context.language`. If `context.language` is `source`, write in the dominant language of this source group''s supplied post summaries. The input contains one source and that source''s candidate posts only. Write a short source-level summary only when this source has multiple candidate posts and those posts are meaningfully about the same actor, source, or main subject. If the posts are unrelated, too sparse, or there is only one candidate post, output an empty string.'
)
WHERE "perSourceSummaryPrompt" LIKE '%Use `context.language`. The input contains one source%';

UPDATE "UserDigestConfig"
SET "perSourceSummaryPrompt" = replace(
  "perSourceSummaryPrompt",
  'Use `context.language`. The input contains one source and that source''s candidate posts only. Write a short source-level summary only when this source has multiple candidate posts and those posts are meaningfully about the same actor, source, or main subject. If the posts are unrelated, too sparse, or there is only one candidate post, output an empty string.',
  'Use `context.language`. If `context.language` is `source`, write in the dominant language of this source group''s supplied post summaries. The input contains one source and that source''s candidate posts only. Write a short source-level summary only when this source has multiple candidate posts and those posts are meaningfully about the same actor, source, or main subject. If the posts are unrelated, too sparse, or there is only one candidate post, output an empty string.'
)
WHERE "perSourceSummaryPrompt" LIKE '%Use `context.language`. The input contains one source%';

UPDATE "DigestConfig"
SET "translate" = replace(
  replace(
    "translate",
    'summary into the target language given by context.language.',
    'summary into the target language given by context.language. If context.language
is source, keep each per-post summary in the same language as the supplied
summary instead of translating it to a fixed language.'
  ),
  '- Render only the supplied per-post summary into natural, fluent prose in
  context.language. It must read as if originally written in that language, not
  translated.',
  '- Render only the supplied per-post summary into natural, fluent prose in
  context.language. If context.language is source, use the supplied summary''s
  own language. It must read as if originally written in that language, not
  translated.'
)
WHERE "translate" LIKE '%summary into the target language given by context.language.%';

UPDATE "UserDigestConfig"
SET "translate" = replace(
  replace(
    "translate",
    'summary into the target language given by context.language.',
    'summary into the target language given by context.language. If context.language
is source, keep each per-post summary in the same language as the supplied
summary instead of translating it to a fixed language.'
  ),
  '- Render only the supplied per-post summary into natural, fluent prose in
  context.language. It must read as if originally written in that language, not
  translated.',
  '- Render only the supplied per-post summary into natural, fluent prose in
  context.language. If context.language is source, use the supplied summary''s
  own language. It must read as if originally written in that language, not
  translated.'
)
WHERE "translate" LIKE '%summary into the target language given by context.language.%';
