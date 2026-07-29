# Blog Publish-Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generic blog fetching return the newest eligible posts by final publication time instead of the first links in listing-page DOM order.

**Architecture:** Keep the existing bounded discovery, robots, extraction, cutoff, deduplication, and quality gates. Remove the premature per-source slice, collect one ordered stream of deterministic items and agent fallbacks with their discovery indices, sort valid dates newest-first with stable unknown-date fallback, and apply the shared limit once at the end.

**Tech Stack:** Node.js, TypeScript node:test, `scripts/builder-digest.mjs`

---

### Task 1: Lock the pinned-old-article regression

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Reference: `scripts/builder-digest.mjs:4222-4313`

- [ ] **Step 1: Write the failing test**

Add a `fetchPersonalBlogBuilderForTest` case with a Claude Blog listing ordered
as two old pinned links followed by three recent links. Return article HTML with
JSON-LD `datePublished` values and substantial `.u-rich-text-blog` content.
Request `limit: 2` with a 30-day cutoff and assert:

```ts
assert.deepEqual(
  result.items.map((item: { url: string }) => item.url),
  [newestUrl, secondNewestUrl],
);
assert.equal(result.agentTasks.length, 0);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test --test-name-pattern="newest eligible articles" tests/builder-digest-cli.test.ts
```

Expected: FAIL because the old pinned links consume the current pre-extraction
limit and the result contains no items.

### Task 2: Sort resolved blog outcomes before limiting

**Files:**
- Modify: `scripts/builder-digest.mjs:4222-4313`
- Test: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Remove the premature candidate slice**

Keep bounded discovery and existing fetched-item filtering, but allow all
discovered article candidates through article-page inspection:

```js
const candidates = discoveredCandidates
  .filter((article) => isAfterCutoff(article.publishedAt, cutoff))
  .filter((article) => !fetchedItemKeys.has(
    personalItemKey(builder.id, "BLOG_POST", article.url),
  ));
```

- [ ] **Step 2: Collect outcomes with stable ordering metadata**

During the candidate loop, append either the deterministic item or agent
fallback to one internal collection containing:

```js
{
  type: "item" | "agentTask",
  value,
  publishedAt,
  discoveryIndex,
}
```

Preserve all existing early skips for robots, retention, final cutoff, and
already-fetched candidates.

- [ ] **Step 3: Sort and apply the shared limit**

Sort outcomes so valid dates are descending, unknown/invalid dates follow valid
dates, and `discoveryIndex` breaks ties. Slice once to `limit`, then partition
back into `{ items, agentTasks }`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx tsx --test --test-name-pattern="newest eligible articles" tests/builder-digest-cli.test.ts
```

Expected: PASS.

### Task 3: Protect the shared deterministic/fallback cap

**Files:**
- Modify: `tests/builder-digest-cli.test.ts`
- Verify: `scripts/builder-digest.mjs`

- [ ] **Step 1: Write a second failing/guard test**

Create three recent candidates where the newest article produces an agent
fallback because its body fails quality, while the next two produce
deterministic items. With `limit: 2`, assert that the combined count is two and
the oldest deterministic item is excluded:

```ts
assert.equal(result.items.length + result.agentTasks.length, 2);
assert.deepEqual(result.agentTasks.map((task) => task.item.url), [newestUrl]);
assert.deepEqual(result.items.map((item) => item.url), [secondNewestUrl]);
```

- [ ] **Step 2: Run the test**

Run:

```bash
npx tsx --test --test-name-pattern="shared newest-first limit" tests/builder-digest-cli.test.ts
```

Expected after Task 2: PASS. If it fails, minimally correct the shared outcome
selection rather than adding separate item/task limits.

### Task 4: Verify the complete change

**Files:**
- Verify: `scripts/builder-digest.mjs`
- Verify: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Run the focused test file**

```bash
npx tsx --test tests/builder-digest-cli.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run the full suite**

```bash
npm test
```

Expected: zero failures.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: exit 0 with no new errors.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: exit 0 and prompt-runtime trace verification passes.

- [ ] **Step 5: Review the final diff**

Confirm only the design/plan, generic blog fetcher, and its regression tests
changed. Preserve all unrelated untracked workspace files.
