# Reviewed AI source candidate expansion

## Goal

Expand the primary `SourceCandidate` library with the AI influencers, builders,
labs, and independent evaluators approved on 2026-07-27. Every inserted candidate
must have a canonical name, a usable icon, a supported source type, and evidence
that the existing FollowBrief fetch path can acquire current content.

## Scope

Review these 41 requested sources:

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
35. Thibault Sottiaux
36. Nan Yu
37. Madhu Guru
38. Amjad Masad
39. Guillermo Rauch
40. Aaron Levie
41. Matt Turck

The seven additions from 35–41 are X candidates with proposed official handles
`thsottiaux`, `thenanyu`, `realmadhuguru`, `amasad`, `rauchg`, `levie`, and
`mattturck`. The user-supplied posts are identity/activity evidence only; the
candidate URLs remain the profile URLs and must still pass authenticated API
lookup plus the real timeline fetch.

The existing candidate library is the comparison baseline. Exact canonical-key
duplicates must be updated rather than inserted, and an existing equivalent
publication must not be duplicated under a second name.

## Persistence

The reviewed sources belong in `CURATED_AI_SOURCE_CANDIDATES` in
`src/lib/source-candidate-library.ts`. This is the authoritative seed used by
`ensureSourceCandidateSeeded`; a production-only insert is not acceptable because
the curated seeder deletes stale rows for its seed namespace.

The source-controlled manifest owns the structural fields (`name`, `sourceType`,
`sourceUrl`, `fetchUrl`, `handle`, and `avatarUrl`). `avatarDataUrl` is a derived
production cache and is populated after seeding with the existing avatar backfill
path. The committed manifest and production must agree on structural fields; the
production acceptance check additionally requires a materialized icon cache.

After code verification, `scripts/sync-reviewed-ai-source-candidates.ts` applies
the accepted manifest subset to production in one idempotent Prisma transaction.
The script uses the same canonical-key and seed-record builders as the application,
sets `seededFrom` to `curated_ai_sources`, upserts by `sourceKey`, and never deletes
or updates unrelated candidates. A failed upsert rolls back the complete batch.
Deploying the committed seed and running the production sync must converge to the
same structural rows.

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
- `blog` without RSS: Accept only when the official index is publicly reachable
  and the real blog fetcher discovers and acquires at least one recent article.
- `website`: Do not use for any reviewed news or research index in this batch. The
  current website fetcher reads only the supplied page and does not traverse child
  article links, so a successful metadata probe would not prove useful ingestion.
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
- Commit a safe `avatarUrl`, then run `npm run avatars:backfill` against production
  to materialize `avatarDataUrl` through `resolveAvatarDataUrl`.
- Production verification rejects any accepted candidate whose `avatarUrl` or
  `avatarDataUrl` remains null after backfill.
- Reject unrelated hero images that do not identify the source.

### Fetchability evidence

Metadata resolution is diagnostic only and is not sufficient for acceptance.
For every accepted candidate, the audit harness records and verifies:

- final `sourceUrl` and optional `fetchUrl`;
- HTTP status and final redirect target;
- RSS/Atom parse result or discovery of dated article links;
- source type selected by the existing resolver;
- probe result, including discovered feed and metadata;
- icon download result;
- execution of the same deterministic source fetcher used by
  `scripts/builder-digest.mjs`;
- for X, an authenticated API handle lookup and timeline fetch using a valid
  `X_BEARER_TOKEN`.

A blog passes only when `fetchPersonalBlogBuilderForTest` returns at least one
recent item or at least one actionable agent task produced from a discovered
recent article, without a robots denial or hard index/article fetch error. The
audit uses a 90-day cutoff so an obsolete archive cannot pass merely because it
contains old posts.

An X source passes only when the production-equivalent bearer token positively
resolves the exact handle and `fetchPersonalXBuilderForTest` returns at least one
post within the 90-day audit window. If the token is absent or invalid, the X
entry is not accepted; public profile HTML is not a fallback.

Transient 403/429 responses are not sufficient for acceptance unless the
configured local-agent method has a separately verified retrieval path. Dead,
private, empty, or login-only sources are excluded and reported.

## Implementation

1. Add the 41 requested sources to a review manifest consumed by
   `scripts/audit-ai-source-candidates.ts`; each entry contains the proposed
   canonical name, source URL, optional fetch URL/handle, and expected type.
2. Discover official canonical pages and RSS/Atom endpoints.
3. Exercise `resolvePersonalBuilderInput`, `probeAndEnrichSource`, and the real
   type-specific fetcher against every entry with production-equivalent
   credentials. The audit emits a JSON report containing outcomes and exact
   exclusion reasons.
4. Keep only passing entries in the exported
   `CURATED_AI_SOURCE_CANDIDATES` manifest, with an explicit official icon URL.
5. Add regression tests that assert the reviewed source names, canonical endpoints,
   supported types, non-null icon URL, duplicate-free canonical keys, and audit
   pass semantics.
6. Add `scripts/sync-reviewed-ai-source-candidates.ts`, which imports the reviewed
   manifest and shared seed helpers instead of duplicating canonical-key logic.
7. Run focused tests, the relevant full suite, lint, and typecheck.
8. Commit and push `main`, then confirm the production deployment is healthy.
9. Pull the production environment to a temporary file; record the total candidate
   count and a stable snapshot of all unrelated `sourceKey`/structural fields.
10. Run the transactional sync twice, proving idempotence and identical target
    rows, then run `npm run avatars:backfill`.
11. Verify every accepted target row and its icon cache, compare the unrelated
    snapshot byte-for-byte, and delete the temporary environment file.

## Failure handling

- A failed candidate does not abort the entire batch.
- The final report lists every exclusion with the exact failed check.
- Production writes occur only after the complete reviewed code manifest passes
  tests.
- The production upsert is transactional and verifies that unrelated candidates
  are unchanged.
- Avatar backfill is deliberately outside the database transaction because it
  performs network I/O. A backfill failure leaves the idempotently seeded rows in
  place, fails the release check, reports the affected candidates, and can be
  retried safely without another insert.
- Temporary production environment files are deleted after verification.

## Acceptance criteria

- Every accepted requested source has reviewed `name`, `sourceType`, `sourceUrl`,
  `fetchUrl`, and a committed official `avatarUrl`.
- Every accepted source produces current content through the real existing
  FollowBrief fetcher in the audit environment; a metadata-only probe never passes.
- No unsupported source type or canonical-key duplicate is introduced.
- Curated seeding is idempotent and does not remove the new entries.
- Production and source-controlled curated structural records agree, and every
  accepted production row has a non-null `avatarDataUrl`.
- The before/after production snapshot proves unrelated candidates are unchanged.
- Excluded sources and reasons are explicitly reported.
