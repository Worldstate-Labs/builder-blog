# Chronological Source Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chronological source select newest eligible candidates by `publishedAt` before applying its item limit while preserving ranking-source semantics.

**Architecture:** Add one generic stable chronological selector in `scripts/builder-digest.mjs` and call it at each chronological pre-limit boundary. Keep builder-specific extraction and filtering unchanged; GitHub Trending, Product Hunt, and singleton Website selection remain untouched.

**Tech Stack:** Node.js, JavaScript ES modules, TypeScript Node test runner, Next.js repository tooling.

---

### Task 1: Shared chronological selection contract

**Files:**
- Modify: `scripts/builder-digest.mjs:4330-4365`
- Test: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Write the failing shared-selector test**

Add a test for the intended public helper:

```ts
test("chronological selector orders valid dates newest-first and keeps unknown dates stable", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const candidates = [
    { id: "unknown-a", publishedAt: null },
    { id: "older", publishedAt: "2026-07-20T00:00:00Z" },
    { id: "newest-a", publishedAt: "2026-07-28T00:00:00Z" },
    { id: "invalid", publishedAt: "not-a-date" },
    { id: "newest-b", publishedAt: "2026-07-28T00:00:00Z" },
    { id: "unknown-b" },
  ];

  assert.deepEqual(
    cli.selectNewestChronologicalCandidates(candidates, 5).map((item: { id: string }) => item.id),
    ["newest-a", "newest-b", "older", "unknown-a", "invalid"],
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx tsx --test --test-name-pattern="chronological selector" tests/builder-digest-cli.test.ts
```

Expected: FAIL because `selectNewestChronologicalCandidates` is not exported.

- [ ] **Step 3: Implement the minimal shared selector**

Add an exported helper that:

```js
export function selectNewestChronologicalCandidates(
  candidates,
  limit,
  publishedAtForCandidate = (candidate) => candidate?.publishedAt,
) {
  return candidates
    .map((candidate, discoveryIndex) => ({
      candidate,
      discoveryIndex,
      publishedAt: publishedAtForCandidate(candidate),
    }))
    .sort(compareChronologicalCandidates)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
```

The private comparator must order valid timestamps newest-first, valid before
invalid/missing, and use `discoveryIndex` as the final tie-breaker.

- [ ] **Step 4: Replace the blog-specific comparator with the helper**

Use the helper for the mixed blog outcome array. Preserve the existing shared
limit across ready items and agent fallback tasks.

- [ ] **Step 5: Run focused shared and blog tests**

Run:

```bash
npx tsx --test --test-name-pattern="chronological selector|newest eligible articles|shared newest-first limit" tests/builder-digest-cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit the shared helper, blog migration, and tests with a Lore-formatted
message that records the stable missing-date fallback.

### Task 2: YouTube and Podcast chronological selection

**Files:**
- Modify: `scripts/builder-digest.mjs:3709-3728`
- Modify: `scripts/builder-digest.mjs:4393-4418`
- Test: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Write a failing YouTube regression test**

Create a shuffled YouTube RSS fixture with old, newest, and second-newest
entries and `limit: 2`. Use the existing missing-command runner and
description-only fallback setup so the result is agent tasks. Assert the two
selected task URLs are newest then second-newest, not feed order.

- [ ] **Step 2: Verify the YouTube test is RED**

Run:

```bash
npx tsx --test --test-name-pattern="YouTube fetcher selects newest" tests/builder-digest-cli.test.ts
```

Expected: FAIL with old/feed-order URLs.

- [ ] **Step 3: Apply the shared selector to YouTube**

Keep cutoff and fetched-key filtering before selection. Replace direct
`.slice(0, limit)` with `selectNewestChronologicalCandidates(..., limit)`.

- [ ] **Step 4: Verify the YouTube test is GREEN**

Run the same command and expect PASS.

- [ ] **Step 5: Write a failing Podcast regression test**

Add and export `fetchPersonalPodcastBuilderForTest`, following the repository's
existing `ForTest` wrapper pattern. Supply shuffled RSS episodes with substantial
show notes and `limit: 2`; assert returned external IDs are newest then
second-newest.

- [ ] **Step 6: Verify the Podcast test is RED**

Run:

```bash
npx tsx --test --test-name-pattern="podcast fetcher selects newest" tests/builder-digest-cli.test.ts
```

Expected: FAIL with RSS/feed order.

- [ ] **Step 7: Apply the shared selector to Podcast**

Keep feed parsing, cutoff filtering, and fetched-key dedupe before selection.
Replace direct `.slice(0, limit)` with the shared selector.

- [ ] **Step 8: Verify both source tests are GREEN**

Run:

```bash
npx tsx --test --test-name-pattern="YouTube fetcher selects newest|podcast fetcher selects newest" tests/builder-digest-cli.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

Commit the YouTube and Podcast integrations and regression tests.

### Task 3: X and external/custom fetcher chronological selection

**Files:**
- Modify: `scripts/builder-digest.mjs:4987-5076`
- Modify: `scripts/builder-digest.mjs:5308-5314`
- Test: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Write a failing X regression test**

Set a temporary `X_BEARER_TOKEN`, stub the user lookup and tweet-list responses,
and deliberately return old, newest, and second-newest tweets in shuffled order
with `limit: 2`. Assert returned tweet IDs are newest then second-newest.

- [ ] **Step 2: Verify the X test is RED**

Run:

```bash
npx tsx --test --test-name-pattern="X fetcher selects newest" tests/builder-digest-cli.test.ts
```

Expected: FAIL with API-array order.

- [ ] **Step 3: Apply the shared selector to X**

Keep mapping, body validation, cutoff, and fetched-key dedupe before selection.
Replace direct `.slice(0, limit)` with the shared selector.

- [ ] **Step 4: Verify the X test is GREEN**

Run the same command and expect PASS.

- [ ] **Step 5: Write a failing external-item regression test**

Add a `filterFetchedItemsForTest` wrapper following existing test-export
conventions. Pass shuffled valid external items plus a duplicate/already-fetched
item, use `limit: 2`, and assert selection is newest then second-newest after
filtering.

- [ ] **Step 6: Verify the external-item test is RED**

Run:

```bash
npx tsx --test --test-name-pattern="external fetch items select newest" tests/builder-digest-cli.test.ts
```

Expected: FAIL with input order.

- [ ] **Step 7: Apply the shared selector to external items**

In `filterFetchedItems`, retain structural validation, cutoff, and fetched-key
dedupe, then call `selectNewestChronologicalCandidates(filtered, limit)`.

- [ ] **Step 8: Verify both tests are GREEN**

Run:

```bash
npx tsx --test --test-name-pattern="X fetcher selects newest|external fetch items select newest" tests/builder-digest-cli.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

Commit the X and external/custom fetcher integrations and tests.

### Task 4: Regression and production verification

**Files:**
- Verify: `scripts/builder-digest.mjs`
- Verify: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Run the full CLI test file**

```bash
npx tsx --test tests/builder-digest-cli.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run lint and typecheck**

```bash
npm run lint
npx tsc --noEmit
```

Expected: both exit zero.

- [ ] **Step 4: Run the production build**

Load the existing local database environment without printing secrets, then
run:

```bash
npm run build
```

Expected: Next.js compilation, TypeScript validation, page generation, and
runtime trace verification pass.

- [ ] **Step 5: Confirm ranking semantics remain unchanged**

Run:

```bash
npx tsx --test --test-name-pattern="GitHub Trending parser|Product Hunt parser" tests/builder-digest-cli.test.ts
```

Expected: GitHub remains stars-descending and Product Hunt remains page-order.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only scoped implementation, tests, spec, and
plan changes.

- [ ] **Step 7: Request independent code review**

Dispatch a reviewer to check date parsing, stable fallback ordering, limit
placement, unchanged ranking semantics, and test adequacy. Address blocking
findings and rerun affected verification.

- [ ] **Step 8: Commit final verification adjustments**

If review requires changes, commit them with verification evidence. Otherwise
leave the already verified task commits unchanged.
