UPDATE "DigestConfig"
SET "headlinePrompt" = '# Brief Headline Prompt

Write only `headlineSummary` for the candidate posts in the supplied FollowBrief context.

Use `context.language`. If `context.language` is `source`, write in the dominant language of the supplied candidate post summaries.

Write one line per source, even when that source has multiple candidate posts. Use this exact line format:

- Source name: one sentence summary

Rules:

- Include every source that has candidate posts.
- Keep each source summary to 50 characters or fewer for Chinese/Japanese/Korean output, or 50 words or fewer for word-delimited languages.
- Summarize all candidate posts from that source together instead of listing each post.
- Use only facts already present in the candidate post summaries and metadata.
- Do not include raw URLs.'
WHERE "headlinePrompt" LIKE '# Brief Headline Prompt%one short news-headline paragraph%suitable for a mobile brief header%';

UPDATE "UserDigestConfig"
SET "headlinePrompt" = '# Brief Headline Prompt

Write only `headlineSummary` for the candidate posts in the supplied FollowBrief context.

Use `context.language`. If `context.language` is `source`, write in the dominant language of the supplied candidate post summaries.

Write one line per source, even when that source has multiple candidate posts. Use this exact line format:

- Source name: one sentence summary

Rules:

- Include every source that has candidate posts.
- Keep each source summary to 50 characters or fewer for Chinese/Japanese/Korean output, or 50 words or fewer for word-delimited languages.
- Summarize all candidate posts from that source together instead of listing each post.
- Use only facts already present in the candidate post summaries and metadata.
- Do not include raw URLs.'
WHERE "headlinePrompt" LIKE '# Brief Headline Prompt%one short news-headline paragraph%suitable for a mobile brief header%';
