UPDATE "DigestConfig"
SET "headlinePrompt" = '# Brief Headline Prompt

Write only `headlineSummary` for the candidate posts in the supplied FollowBrief context.

Use `context.language`. If `context.language` is `source`, write in the dominant language of the supplied candidate post summaries.

Write compact headline lines covering all candidate sources. Prefer one line per
source, but if the headline would exceed the hard length limit, combine related
or lower-priority sources into one line. Use this exact line format:

- Source name: one sentence summary
- Source A and Source B: one sentence summary

Rules:

- Cover every source that has candidate posts. A source may be covered by a
  combined line such as `GitHub Trending and Product Hunt Top Products: ...`.
- Use the same source order as the brief: follow `context.digest.order` when provided; otherwise use Podcast RSS, YouTube, Blog, X/Twitter, GitHub Trending, Product Hunt Top Products, then Website. Within each source type, order sources by source name.
- Keep each source summary to 50 characters or fewer for Chinese/Japanese/Korean output, or 50 words or fewer for word-delimited languages.
- Keep the entire `headlineSummary` at 1200 characters or fewer. Before writing
  the JSON, count or conservatively estimate the final string length and
  shorten or merge lines until it fits. Prefer 900 characters or fewer when
  there are many sources.
- Summarize all candidate posts from that source together instead of listing each post.
- Use only facts already present in the candidate post summaries and metadata.
- Do not include raw URLs.'
WHERE "headlinePrompt" = '# Brief Headline Prompt

Write only `headlineSummary` for the candidate posts in the supplied FollowBrief context.

Use `context.language`. If `context.language` is `source`, write in the dominant language of the supplied candidate post summaries.

Write one line per source, even when that source has multiple candidate posts. Use this exact line format:

- Source name: one sentence summary

Rules:

- Include every source that has candidate posts.
- Keep each source summary to 50 characters or fewer for Chinese/Japanese/Korean output, or 50 words or fewer for word-delimited languages.
- Summarize all candidate posts from that source together instead of listing each post.
- Use only facts already present in the candidate post summaries and metadata.
- Do not include raw URLs.';

UPDATE "UserDigestConfig"
SET "headlinePrompt" = '# Brief Headline Prompt

Write only `headlineSummary` for the candidate posts in the supplied FollowBrief context.

Use `context.language`. If `context.language` is `source`, write in the dominant language of the supplied candidate post summaries.

Write compact headline lines covering all candidate sources. Prefer one line per
source, but if the headline would exceed the hard length limit, combine related
or lower-priority sources into one line. Use this exact line format:

- Source name: one sentence summary
- Source A and Source B: one sentence summary

Rules:

- Cover every source that has candidate posts. A source may be covered by a
  combined line such as `GitHub Trending and Product Hunt Top Products: ...`.
- Use the same source order as the brief: follow `context.digest.order` when provided; otherwise use Podcast RSS, YouTube, Blog, X/Twitter, GitHub Trending, Product Hunt Top Products, then Website. Within each source type, order sources by source name.
- Keep each source summary to 50 characters or fewer for Chinese/Japanese/Korean output, or 50 words or fewer for word-delimited languages.
- Keep the entire `headlineSummary` at 1200 characters or fewer. Before writing
  the JSON, count or conservatively estimate the final string length and
  shorten or merge lines until it fits. Prefer 900 characters or fewer when
  there are many sources.
- Summarize all candidate posts from that source together instead of listing each post.
- Use only facts already present in the candidate post summaries and metadata.
- Do not include raw URLs.'
WHERE "headlinePrompt" = '# Brief Headline Prompt

Write only `headlineSummary` for the candidate posts in the supplied FollowBrief context.

Use `context.language`. If `context.language` is `source`, write in the dominant language of the supplied candidate post summaries.

Write one line per source, even when that source has multiple candidate posts. Use this exact line format:

- Source name: one sentence summary

Rules:

- Include every source that has candidate posts.
- Keep each source summary to 50 characters or fewer for Chinese/Japanese/Korean output, or 50 words or fewer for word-delimited languages.
- Summarize all candidate posts from that source together instead of listing each post.
- Use only facts already present in the candidate post summaries and metadata.
- Do not include raw URLs.';
