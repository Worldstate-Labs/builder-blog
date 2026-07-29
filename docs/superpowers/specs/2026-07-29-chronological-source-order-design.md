# Chronological Source Ordering Design

## Goal

Ensure every chronological FollowBrief source selects the newest eligible
content by resolved publication time before applying its per-source item limit.
Ranking sources must retain their ranking semantics.

## Current Problem

The blog fetcher now resolves candidate publication dates, sorts newest-first,
and only then applies `limit`. Other chronological fetchers still filter and
immediately slice the order returned by an upstream API, RSS document, page, or
external fetch command:

- YouTube
- Podcast
- X
- External/custom fetchers

Those upstream orders are commonly newest-first but are not a reliable
selection contract. A pinned, shuffled, or malformed feed can therefore use up
the item limit before newer content is considered.

Sorting later in the ready-task or digest pipeline cannot fix this because the
newer candidates have already been discarded.

## Source Semantics

### Chronological sources

The following sources use newest-first publication ordering:

- Blog
- YouTube
- Podcast
- X
- External/custom fetcher results

Candidates are first filtered for validity, cutoff eligibility, and prior-fetch
deduplication. The remaining candidates are then ordered and limited.

### Non-chronological sources

These sources keep their existing semantics:

- GitHub Trending: descending stars for the current trending day
- Product Hunt Top Products: leaderboard/page rank
- Website: one page produces at most one item, so ordering is not applicable

## Ordering Contract

Use one shared stable chronological selector:

1. A parseable `publishedAt` sorts before a missing or invalid date.
2. Parseable dates sort newest-first.
3. Equal dates preserve discovery order.
4. Missing or invalid dates preserve discovery order after dated candidates.
5. Apply `limit` only after this ordering.

The selector must not synthesize dates or use fetch time as publication time.
This avoids making undated content appear newer than genuinely dated content.

## Considered Approaches

### 1. Shared chronological selector (selected)

Introduce one small helper and use it at every chronological pre-limit boundary.
This provides one explicit contract, one set of edge-case tests, and consistent
behavior across regular Agent Fetch and Cloud Fetch because both use the same
builders.

### 2. Independent sort in each builder

This keeps changes physically close to each fetcher, but duplicates date
parsing, missing-date handling, and stable tie-breaking. The implementations
would likely drift.

### 3. Sort after all builders return

This is too late: each builder or external fetch path may already have applied
`limit`, so discarded newer candidates cannot be recovered. It would also risk
incorrectly replacing ranking semantics with chronological semantics.

## Implementation

Add a shared
`selectNewestChronologicalCandidates(candidates, limit, publishedAtForCandidate)`
selector in `scripts/builder-digest.mjs`. It accepts an array of arbitrary
candidate values, a numeric limit, and an optional accessor that defaults to
`candidate.publishedAt`. It decorates each candidate with its original index,
parses the accessor result, performs the ordering contract above, applies the
requested limit, and returns the unchanged original candidate values.

Apply it at these boundaries:

- Blog: replace the blog-specific outcome comparator/slice with the shared
  selector.
- YouTube: after cutoff and fetched-item filtering, before transcript work.
- Podcast: after feed parsing, cutoff, and fetched-item filtering, before
  show-note/transcription partitioning.
- X: after mapping and filtering API results, before returning items.
- External/custom fetchers: inside the existing filtered-item selection path,
  before its limit.

Do not change GitHub Trending, Product Hunt, or Website selection.

## Compatibility

No API, database, prompt, logging, or persisted-data shape changes are needed.
Both regular user Agent Fetch and Cloud Fetch inherit the behavior because they
share `buildFetchTasksForBuilders` and the same source fetchers. Digest
generation continues to consume already-synced posts.

## Testing

Add regression coverage that supplies deliberately shuffled candidates:

- Shared selector: dated, equal-date, missing-date, and invalid-date ordering.
- YouTube: shuffled feed entries select the newest eligible videos before
  `limit`.
- Podcast: shuffled RSS entries select the newest eligible episodes before
  `limit`.
- X: shuffled API results select the newest eligible tweets before `limit`.
- External/custom items: shuffled results are filtered, ordered, and limited.
- Existing blog newest-first tests remain green.
- Existing GitHub Trending and Product Hunt ordering tests remain green,
  proving ranking semantics were not changed.

Run the focused CLI tests, complete test suite, lint, typecheck, and production
build.
