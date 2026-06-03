UPDATE "DigestConfig"
SET "headlinePrompt" = replace(
  "headlinePrompt",
  'Use `context.language`. Keep it compact: under 300 ' || 'Ch' || 'inese characters, or an equivalent short news-headline paragraph in the selected language. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.',
  'Use `context.language`. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.'
)
WHERE "headlinePrompt" LIKE ('%under 300 ' || 'Ch' || 'inese characters%');

UPDATE "UserDigestConfig"
SET "headlinePrompt" = replace(
  "headlinePrompt",
  'Use `context.language`. Keep it compact: under 300 ' || 'Ch' || 'inese characters, or an equivalent short news-headline paragraph in the selected language. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.',
  'Use `context.language`. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.'
)
WHERE "headlinePrompt" LIKE ('%under 300 ' || 'Ch' || 'inese characters%');
