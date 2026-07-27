# Reviewed AI source candidate expansion

## Goal

Expand the primary `SourceCandidate` library with the AI influencers, builders,
labs, and independent evaluators approved on 2026-07-27. Every inserted candidate
must have a canonical name, a usable icon, a supported source type, and evidence
that the existing FollowBrief fetch path can acquire current content.

## Scope

Review these 34 requested sources:

1. One Useful Thing
2. Chip Huyen
3. Hamel Husain
4. Eugene Yan
5. Sam Altman
6. Fei-Fei Li
7. François Chollet
8. SemiAnalysis
9. AI Snake Oil
10. fast.ai
11. 宝玉
12. Georgi Gerganov
13. World Labs
14. Thinking Machines Lab
15. Apple Machine Learning Research
16. NVIDIA Research
17. xAI News
18. Qwen Blog
19. DeepSeek Updates
20. Ai2 News
21. Sakana AI
22. Nous Research
23. Unsloth
24. Perplexity Blog
25. Artificial Analysis
26. Epoch AI
27. METR
28. ARC Prize
29. Demis Hassabis
30. Yann LeCun
31. Jim Fan
32. Thomas Wolf
33. Ilya Sutskever
34. Dario Amodei

The existing candidate library is the comparison baseline. Exact canonical-key
duplicates must be updated rather than inserted, and an existing equivalent
publication must not be duplicated under a second name.

## Persistence

The reviewed sources belong in `CURATED_AI_SOURCE_CANDIDATES` in
`src/lib/source-candidate-library.ts`. This is the authoritative seed used by
`ensureSourceCandidateSeeded`; a production-only insert is not acceptable because
the curated seeder deletes stale rows for its seed namespace.

After code verification, apply the same reviewed records to production in one
idempotent upsert transaction. Deploying the committed seed and writing production
must converge to identical rows.

## Review rules

### Name

- Prefer the official publication, organization, or profile display name.
- Add a channel suffix only where it disambiguates the same publisher across
  source types, such as `on X`, `Blog`, or `Research`.
- Do not inherit noisy HTML title suffixes such as navigation labels or slogans.

### Source type and fetch URL

Use only the supported source types from `config/sources.json`.

- `blog`: Prefer a public RSS/Atom feed that returns valid XML and at least one
  recent entry. Keep the human-readable homepage in `sourceUrl` and the feed in
  `fetchUrl`.
- `blog` without RSS: Accept only when the official index is publicly reachable,
  exposes distinct recent article links, and the existing agent-scraping path can
  fetch those articles.
- `website`: Use for research/news indexes that do not represent a conventional
  blog but expose stable, dated content pages. These use the existing
  `requires_agent` path.
- `x`: Accept only an official profile whose handle resolves through the
  configured production X API. X candidates depend on `X_BEARER_TOKEN`; a public
  profile page alone is not proof of fetchability.

Do not add GitHub profiles as generic websites: the current source registry has no
repository/profile source type, and `github_trending` is intentionally limited to
the GitHub Trending page. For Georgi Gerganov, use a verified X profile or omit the
candidate until a supported GitHub source type exists.

### Icon

- X: use the profile image returned by X API v2.
- HTML source: prefer a safe official OpenGraph image or icon discovered by the
  existing enrichment probe.
- Feed-only source: use the publication's official domain favicon.
- Persist a safe `avatarUrl` and materialize `avatarDataUrl` using
  `resolveAvatarDataUrl`. A candidate may not ship with both fields null.
- Reject unrelated hero images that do not identify the source.

### Fetchability evidence

For every accepted candidate, record and verify:

- final `sourceUrl` and optional `fetchUrl`;
- HTTP status and final redirect target;
- RSS/Atom parse result or, for HTML, discovery of dated article links;
- source type selected by the existing resolver;
- probe result, including discovered feed and metadata;
- icon download result;
- for X, API handle lookup result.

Transient 403/429 responses are not sufficient for acceptance unless the
configured local-agent method has a separately verified retrieval path. Dead,
private, empty, or login-only sources are excluded and reported.

## Implementation

1. Build a temporary audit manifest for the 34 requested sources.
2. Discover official canonical pages and RSS/Atom endpoints.
3. Exercise `resolvePersonalBuilderInput` and `probeAndEnrichSource` against every
   manifest entry using production-equivalent environment capabilities.
4. Resolve and cache icons.
5. Keep only entries that meet the review rules, recording exclusions and
   fallbacks.
6. Add accepted entries to `CURATED_AI_SOURCE_CANDIDATES`.
7. Add regression tests that assert the reviewed source names, canonical endpoints,
   supported types, non-null icon configuration, and duplicate-free canonical
   keys.
8. Run focused tests, the full relevant test suite, lint, and typecheck.
9. Commit and push `main`.
10. Upsert the reviewed rows into production and independently verify candidate
    count, field values, icon cache presence, and seed idempotence.

## Failure handling

- A failed candidate does not abort the entire batch.
- The final report lists every exclusion with the exact failed check.
- Production writes occur only after the complete reviewed code manifest passes
  tests.
- The production upsert is transactional and verifies that unrelated candidates
  are unchanged.
- Temporary production environment files are deleted after verification.

## Acceptance criteria

- Every accepted requested source has reviewed `name`, `sourceType`, `sourceUrl`,
  `fetchUrl`, and icon data.
- Every accepted source is reachable through an existing FollowBrief fetch path.
- No unsupported source type or canonical-key duplicate is introduced.
- Curated seeding is idempotent and does not remove the new entries.
- Production and source-controlled curated records agree.
- Excluded sources and reasons are explicitly reported.
