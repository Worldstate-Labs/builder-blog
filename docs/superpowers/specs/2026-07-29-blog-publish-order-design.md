# Blog Fetch Publish-Order Design

## Problem

The generic blog fetcher currently preserves listing-page DOM order and applies
the per-source post limit before article pages reveal their publication dates.
Pinned or featured older articles can therefore consume the limit, be rejected
by the lookback cutoff later, and hide newer articles that appeared farther down
the listing. Claude Blog reproduced this with a five-post cloud limit.

## Decision

Use a bounded candidate scan, resolve article metadata, then select posts in
publication order:

1. Discover and deduplicate a bounded set of article candidates.
2. Retain both listing-dated and unknown-date candidates in that bounded set.
3. Fetch candidate article pages until the bounded candidate set is exhausted
   so final article metadata, rather than listing order, drives selection.
4. Apply retention policy, extraction, final publication-date cutoff, fetched
   item deduplication, and content-quality classification.
5. Sort deterministic items and agent fallback tasks together internally by
   final `publishedAt` descending before splitting them into the existing
   separate return arrays. Downstream consumers keep their existing array
   ordering; this change guarantees only newest-first selection and a shared
   count limit inside the blog fetcher.
6. Put candidates without a valid publication date after dated candidates and
   preserve discovery order as the deterministic tie breaker.
7. Apply the requested post limit only after sorting.

The change belongs to the generic blog fetcher. Claude-specific parsing remains
responsible only for extracting links and article content.

## Alternatives Considered

### Parse and sort only listing-page dates

Rejected because generic listings and the current Claude link parser frequently
do not associate a date with each link. It would still miss posts when dates are
available only on article pages.

### Increase the pre-extraction limit

Rejected because a larger arbitrary limit reduces but does not remove the
ordering bug. It also makes selection depend on page layout and can still return
older posts ahead of newer ones.

### Resolve all bounded candidates, then sort

Selected because it is layout-independent, preserves the existing safety cap,
and makes the final per-source limit mean “newest eligible posts.”

## Scope

- Change `fetchPersonalBlogBuilder` in `scripts/builder-digest.mjs`.
- Add regression coverage in `tests/builder-digest-cli.test.ts`.
- Do not change X, YouTube, podcast, website, digest selection, cloud leasing,
  synchronization, robots handling, retention handling, or content-quality
  thresholds.

## Error and Edge-Case Behavior

- A candidate that is older than the cutoff does not consume the final limit.
- A fetched item already present in `fetchedItemKeys` does not consume the final
  limit.
- Known dates sort newest first.
- Invalid or missing dates sort after valid dates.
- Equal dates and unknown dates retain discovery order for stable results.
- Deterministic items and agent fallback tasks share the same ordering and one
  combined limit so the fetcher cannot plan more than requested.
- Existing HTTP and policy behavior remains unchanged.

## Verification

Add a regression test whose listing starts with pinned old articles and places
new articles later. With a limit of two and a 30-day cutoff, the fetcher must:

- inspect beyond the first two listing links;
- return the two newest eligible articles in descending publication order;
- omit the pinned old articles; and
- return no more than two combined deterministic/fallback results.

Add a second regression test where the newest eligible article becomes an agent
fallback and the next eligible article becomes a deterministic item. Assert that
those two newest outcomes are selected, their combined count equals the limit,
and an older eligible deterministic article is excluded.

Run the focused CLI test file, the full test suite, lint, and production build.
