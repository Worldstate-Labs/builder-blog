# Original Summary Language Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Original-language summary reuse resolve and persist concrete body and summary languages, so existing summaries are copied or translated correctly without unnecessary source fetches.

**Architecture:** Add nullable actual-language fields to `FeedItem`, centralize concrete target resolution in the shared-post reuse API, carry an explicit reuse plan into `builder-digest.mjs`, and validate language consistency at the sync boundary. Roll out with dual-read compatibility, a conservative backfill, and targeted repair tasks.

**Tech Stack:** Prisma/Postgres, Next.js route handlers, TypeScript, Node.js ESM runner, Zod, Node test runner.

---

### Task 1: Define and persist concrete language metadata

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_feed_item_content_languages/migration.sql`
- Create: `src/lib/content-language.ts`
- Modify: `tests/summary-language-options.test.ts`
- Create: `tests/content-language.test.ts`
- Modify: `tests/cloud-source-schema.test.ts`

- [ ] **Step 1: Write failing schema and normalization tests**

Require nullable `FeedItem.contentLanguage` and `FeedItem.summaryContentLanguage`, the compound index, BCP-47 normalization, Original-alias rejection for concrete fields, strict actual-language comparison, and high-confidence script-family detection.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx tsx --test tests/content-language.test.ts tests/summary-language-options.test.ts tests/cloud-source-schema.test.ts
```

- [ ] **Step 3: Add the nullable migration and pure language helpers**

Implement helpers for request-mode normalization, concrete-language normalization, actual-language matching, body-language evidence, and mismatch checks. Reuse existing script heuristics instead of adding a dependency.

- [ ] **Step 4: Regenerate Prisma and verify focused tests GREEN**

```bash
npx prisma generate
npx tsx --test tests/content-language.test.ts tests/summary-language-options.test.ts tests/cloud-source-schema.test.ts
```

### Task 2: Extend the sync contract and reject poisoned language metadata

**Files:**
- Modify: `src/lib/skill-contracts.ts`
- Modify: `src/lib/builder-feed-sync.ts`
- Modify: `tests/builder-feed-sync.test.ts`
- Modify: `tests/fetch-worker-output-boundary.test.ts`

- [ ] **Step 1: Write failing contract and sync tests**

Cover concrete language fields, fixed-language inference for legacy payloads, Original inference from retained body, rejection of Original aliases in concrete fields, and `summary_language_mismatch` without a database write.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx tsx --test tests/builder-feed-sync.test.ts tests/fetch-worker-output-boundary.test.ts
```

- [ ] **Step 3: Implement additive contract and dual-read/write behavior**

Stop creating ambiguous new `rawJson.summaryLanguage` values. Persist `requestedSummaryLanguage` as provenance and write the two first-class columns. Keep legacy payload acceptance conservative so active runners are not broken.

- [ ] **Step 4: Run focused tests and verify GREEN**

### Task 3: Move reuse language decisions into the API

**Files:**
- Modify: `src/app/api/skill/shared-post-reuse/route.ts`
- Create: `src/lib/shared-post-reuse-plan.ts`
- Modify: `tests/shared-post-reuse.test.ts`

- [ ] **Step 1: Add the complete failing reuse matrix**

Require versioned plans for copy, fixed translation, Original translation, reused-body summarization, and no reuse. Replace the existing expectation that an Original target becomes literal `source`.

- [ ] **Step 2: Run the reuse suite and verify RED**

```bash
npx tsx --test tests/shared-post-reuse.test.ts
```

- [ ] **Step 3: Implement the pure reuse planner and API response**

Select `contentLanguage` and `summaryContentLanguage` directly from `FeedItem`, use legacy metadata only as a conservative fallback, calculate a concrete target, and return both `reusePlan` v2 and transitional legacy fields.

- [ ] **Step 4: Run the reuse suite and verify GREEN**

### Task 4: Execute Original translations without refetching

**Files:**
- Modify: `scripts/builder-digest.mjs`
- Modify: `tests/shared-post-reuse.test.ts`
- Modify: `tests/fetch-log-panel-status.test.ts`
- Modify: `tests/builder-feed-sync.test.ts`

- [ ] **Step 1: Write failing runner task and prompt tests**

Assert that `C=en, S=zh-CN, R=source` creates `translate_summary_to_content_language`, carries target `en`, permits only bounded body-language evidence, emits both concrete language fields, and never contains `translate ... into source`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx tsx --test tests/shared-post-reuse.test.ts tests/fetch-log-panel-status.test.ts tests/builder-feed-sync.test.ts
```

- [ ] **Step 3: Consume `reusePlan` and implement the new work type**

Keep `translate_summary_only` for fixed targets, add the Original-specific translation path, update task budget/readiness helpers, preserve reused bodies, and propagate language metadata into every sync payload.

- [ ] **Step 4: Run focused tests and verify GREEN**

### Task 5: Backfill and quarantine legacy records

**Files:**
- Create: `scripts/backfill-feed-item-languages.mts`
- Create: `tests/feed-item-language-backfill.test.ts`
- Modify: `package.json` only if the repository already exposes comparable maintenance scripts there

- [ ] **Step 1: Write failing backfill classification tests**

Cover trusted fixed metadata, legacy Original aliases, detectable English/Chinese bodies and summaries, ambiguous rows, fixed-language derivatives, and Original mismatches requiring repair.

- [ ] **Step 2: Implement dry-run-first backfill**

The script must default to dry-run, report counts and row ids, require an explicit apply flag, never overwrite non-null trusted values without a repair flag, and emit a machine-readable mismatch manifest.

- [ ] **Step 3: Add repair-task generation**

Generate translation-only repair inputs for known Original mismatches. Do not delete rows, fetch source URLs, or modify valid fixed-language user summaries.

- [ ] **Step 4: Verify dry-run idempotence and focused tests**

### Task 6: Verify both fetch paths and rollout safety

**Files:**
- Modify: relevant regular-fetch and cloud-fetch integration tests
- Verify: all task-owned files

- [ ] **Step 1: Add regular and cloud integration regressions**

Both paths must produce the same concrete reuse plan, avoid source network access for the Andrej case, sync English output, and preserve scheduler, lease, stop, discovery, and admin-only behavior.

- [ ] **Step 2: Run related suites**

```bash
npx tsx --test \
  tests/content-language.test.ts \
  tests/shared-post-reuse.test.ts \
  tests/builder-feed-sync.test.ts \
  tests/fetch-worker-output-boundary.test.ts \
  tests/cloud-source-cli-contract.test.ts \
  tests/cloud-source-sync.test.ts \
  tests/library-fetch-runs.test.ts
```

- [ ] **Step 3: Run repository quality gates**

```bash
npm test
npm run lint
npm run build
git diff --check
```

- [ ] **Step 4: Stage rollout with production-safe evidence**

Apply the nullable migration, deploy dual-read/write code, run the backfill in dry-run mode, inspect mismatch counts, apply the backfill, enqueue targeted repairs, and verify one regular and one cloud Original fetch before removing any legacy fallback.

- [ ] **Step 5: Review and commit only task-owned changes**

Use a Lore-format commit. Document migration results, repair counts, production verification, and any remaining null-language rows.
