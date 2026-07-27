# Reviewed AI Source Candidate Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the 34 approved AI sources through FollowBrief's real fetch paths, add every passing source to the durable curated candidate library, materialize its production icon cache, and prove unrelated production candidates are unchanged.

**Architecture:** A review manifest records all proposed sources, while a reusable audit core evaluates real blog/X fetch results and a CLI supplies network and credential access. Only sources with a passing audit report are copied into the exported reviewed curated manifest. A separate transactional sync CLI imports the same seed builder as application seeding, then production verification and avatar backfill complete the rollout.

**Tech Stack:** TypeScript, Node test runner, `tsx`, Prisma 7/Postgres, existing `builder-digest.mjs` fetchers, Vercel production environment, X API v2.

---

## File structure

- Create `src/lib/ai-source-candidate-review.ts`: review types, the 34 proposed sources, deterministic audit pass/fail evaluation, and conversion to fetcher inputs.
- Create `scripts/audit-ai-source-candidates.ts`: production-equivalent network audit CLI; calls resolver/probe, the real blog/X fetchers, and icon download logic; emits JSON.
- Create `scripts/sync-reviewed-ai-source-candidates.ts`: transactional, idempotent production upsert and unrelated-row snapshot verification.
- Modify `src/lib/source-candidate-library.ts`: export the curated candidate type, reviewed manifest, seed namespace, and shared seed builder; include only audit-passing records.
- Create `tests/ai-source-candidate-review.test.ts`: manifest completeness, audit semantics, source-type, canonical-key, icon, and duplicate regression tests.
- Create `tests/reviewed-ai-source-candidate-sync.test.ts`: transaction, idempotence, avatar-cache preservation, and unrelated-row protection tests.
- Modify `package.json`: add stable audit and sync commands.
- Create `docs/superpowers/reports/2026-07-27-ai-source-candidate-audit.json`: sanitized evidence for all 34 requested sources, including exclusions.

### Task 1: Lock the 34-source review contract

**Files:**
- Create: `tests/ai-source-candidate-review.test.ts`
- Create: `src/lib/ai-source-candidate-review.ts`

- [ ] **Step 1: Write the failing manifest tests**

Create tests that import `AI_SOURCE_REVIEW_PROPOSALS` and assert:

```ts
assert.equal(AI_SOURCE_REVIEW_PROPOSALS.length, 34);
assert.deepEqual(
  new Set(AI_SOURCE_REVIEW_PROPOSALS.map((candidate) => candidate.name)),
  new Set([
    "One Useful Thing",
    "Chip Huyen",
    "Hamel Husain",
    "Eugene Yan",
    "Sam Altman",
    "Fei-Fei Li",
    "François Chollet",
    "SemiAnalysis",
    "AI Snake Oil",
    "fast.ai",
    "宝玉",
    "Georgi Gerganov",
    "World Labs",
    "Thinking Machines Lab",
    "Apple Machine Learning Research",
    "NVIDIA Research",
    "xAI News",
    "Qwen Blog",
    "DeepSeek Updates",
    "Ai2 News",
    "Sakana AI",
    "Nous Research",
    "Unsloth",
    "Perplexity Blog",
    "Artificial Analysis",
    "Epoch AI",
    "METR",
    "ARC Prize",
    "Demis Hassabis",
    "Yann LeCun",
    "Jim Fan",
    "Thomas Wolf",
    "Ilya Sutskever",
    "Dario Amodei",
  ]),
);
for (const candidate of AI_SOURCE_REVIEW_PROPOSALS) {
  assert.ok(candidate.sourceType === "blog" || candidate.sourceType === "x");
  assert.match(candidate.sourceUrl, /^https:\/\//);
  if (candidate.sourceType === "x") assert.ok(candidate.handle);
}
```

Also assert there are no `website` or generic GitHub-profile proposals.

- [ ] **Step 2: Run the test and confirm the module is missing**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
```

Expected: FAIL because `src/lib/ai-source-candidate-review.ts` does not exist.

- [ ] **Step 3: Add the typed review manifest**

Implement:

```ts
export type AiSourceReviewProposal = {
  name: string;
  sourceType: "blog" | "x";
  sourceUrl: string;
  fetchUrl?: string;
  handle?: string;
  avatarDomain?: string;
  avatarUrl?: string;
};

export const AI_SOURCE_REVIEW_PROPOSALS = [
  // Exactly the 34 approved names, each with its proposed official canonical URL.
] as const satisfies readonly AiSourceReviewProposal[];
```

Use an official publication/index URL for blogs and an exact official handle for X. Use `blog`, not `website`, for dated news/research indexes because the website fetcher does not traverse child pages.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the review contract**

```bash
git add src/lib/ai-source-candidate-review.ts tests/ai-source-candidate-review.test.ts
git commit
```

Use a Lore-format commit explaining why all proposed sources remain visible even when some are later excluded.

### Task 2: Define real-fetch audit semantics with TDD

**Files:**
- Modify: `src/lib/ai-source-candidate-review.ts`
- Modify: `tests/ai-source-candidate-review.test.ts`

- [ ] **Step 1: Write failing evaluator tests**

Cover these exact cases through an exported `evaluateAiSourceAudit`:

```ts
assert.equal(evaluateAiSourceAudit(blogWithItems).accepted, true);
assert.equal(evaluateAiSourceAudit(blogWithArticleAgentTask).accepted, true);
assert.equal(evaluateAiSourceAudit(blogWithOnlyMetadata).accepted, false);
assert.equal(evaluateAiSourceAudit(blogBlockedByRobots).reason, "robots_denied");
assert.equal(evaluateAiSourceAudit(xWithResolvedUserAndRecentPost).accepted, true);
assert.equal(evaluateAiSourceAudit(xWithMissingToken).reason, "x_token_missing");
assert.equal(evaluateAiSourceAudit(xWithInvalidToken).reason, "x_token_invalid");
assert.equal(evaluateAiSourceAudit(xWithNoRecentPosts).reason, "no_recent_content");
assert.equal(evaluateAiSourceAudit(iconDownloadFailure).reason, "icon_unavailable");
```

The input/result contract must preserve the proposed source, redirect/status evidence, resolver/probe evidence, real fetcher counts, icon result, and an exact machine-readable exclusion reason.

- [ ] **Step 2: Run the tests and observe missing evaluator failures**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
```

Expected: FAIL because `evaluateAiSourceAudit` and its result types do not exist.

- [ ] **Step 3: Implement the minimal evaluator**

Pass rules:

- Blog: resolver/probe succeeded, index did not hard-fail or deny robots, real fetch returned at least one item or a `blog_article_fetch` task for content dated within the 90-day cutoff, and an icon resolved/downloaded.
- X: token was positively accepted, the exact handle resolved, the real X fetch returned at least one recent post, and the returned profile image resolved/downloaded.
- Metadata-only results, user-action tasks, `website`, login walls, empty archives, and icon failures are rejected.

Return one stable reason code and a human-readable detail for every rejection.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit audit semantics**

```bash
git add src/lib/ai-source-candidate-review.ts tests/ai-source-candidate-review.test.ts
git commit
```

Use a Lore-format commit recording that metadata probes were rejected as acceptance evidence.

### Task 3: Build the production-equivalent audit CLI

**Files:**
- Create: `scripts/audit-ai-source-candidates.ts`
- Modify: `package.json`
- Modify: `tests/ai-source-candidate-review.test.ts`

- [ ] **Step 1: Write the failing CLI contract test**

Assert the CLI source imports:

- `AI_SOURCE_REVIEW_PROPOSALS`;
- `resolvePersonalBuilderInput` and `probeAndEnrichSource`;
- `resolveAvatarDataUrl`;
- `fetchPersonalBlogBuilderForTest` and `fetchPersonalXBuilderForTest`;
- `evaluateAiSourceAudit`.

Assert it uses a 90-day cutoff, never prints `X_BEARER_TOKEN`, emits JSON, and sets a non-zero exit code only for an audit runtime failure—not merely because individual candidates are excluded.

- [ ] **Step 2: Run the test and confirm the CLI is missing**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
```

Expected: FAIL because the audit script/package command is absent.

- [ ] **Step 3: Implement the CLI**

For every proposal:

1. Normalize it with `resolvePersonalBuilderInput`.
2. Probe it with `probeAndEnrichSource`.
3. Build a temporary builder with `kind: "BLOG"` or `kind: "X"`. The resolver
   owns the normalized `sourceUrl`, `handle`, and kind. When the proposal has an
   explicitly audited `fetchUrl`, merge it over the resolver's inferred
   `fetchUrl` before probing and fetching; this preserves known RSS/Atom
   endpoints while still exercising the real input resolver.
4. Call the real builder-digest fetcher with:

```ts
{
  cutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
  limit: 3,
  agentModel: "candidate-audit",
  fetchedItemKeys: new Set(),
  sources: {},
}
```

Passing `sources: {}` intentionally uses `builder-digest.mjs`'
`sourceConfigFor(sourceId)` fallback, which loads the same keyed per-source
content-quality rules used by the runtime. Do not pass the raw
`config/sources.json` `sources` array, because the fetcher option expects an
object keyed by source id.

5. Resolve the official icon and call `resolveAvatarDataUrl` to prove it downloads.
6. Pass the collected evidence to `evaluateAiSourceAudit`.
7. Emit a sanitized array with no authorization headers, tokens, response bodies, or data URLs.

For X, abort the X portion with explicit `x_token_missing` results when `X_BEARER_TOKEN` is unavailable; never treat public profile HTML as a pass.

Add package command:

```json
"sources:audit-ai-candidates": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/audit-ai-source-candidates.ts"
```

- [ ] **Step 4: Run contract tests and typecheck**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit the audit CLI**

```bash
git add package.json scripts/audit-ai-source-candidates.ts tests/ai-source-candidate-review.test.ts
git commit
```

Use a Lore-format commit explaining why the audit invokes production fetchers rather than duplicating retrieval logic.

### Task 4: Run the real audit and finalize accepted candidates

**Files:**
- Modify: `src/lib/source-candidate-library.ts`
- Modify: `tests/ai-source-candidate-review.test.ts`
- Create: `docs/superpowers/reports/2026-07-27-ai-source-candidate-audit.json`

- [ ] **Step 1: Verify audit credentials without exposing them**

Check only whether `X_BEARER_TOKEN` exists in the current environment or `~/.builder-blog/secrets.json`. If absent, pull production environment variables into a temporary ignored file with:

```bash
vercel env pull /tmp/followbrief-ai-source-audit.env --environment=production --yes
```

Never print the token value.

- [ ] **Step 2: Run the network audit for all 34 proposals**

Run with a production-equivalent environment:

```bash
npx tsx --env-file-if-exists=/tmp/followbrief-ai-source-audit.env scripts/audit-ai-source-candidates.ts > /tmp/ai-source-candidate-audit.json
```

Expected: valid JSON with exactly 34 results and a deterministic accepted/excluded outcome for each source.

- [ ] **Step 3: Manually inspect every result**

For each accepted source verify:

- official name and final redirect;
- official source type;
- feed/index discovery;
- at least one real recent item or actionable article fetch task;
- official identifying icon;
- no duplicate canonical key against the existing curated arrays.

For each excluded source preserve its exact reason in the report. Do not weaken pass criteria to increase the accepted count.

- [ ] **Step 4: Write failing curated-manifest tests**

Add tests that load the sanitized audit report and assert:

```ts
assert.equal(report.results.length, 34);
assert.deepEqual(
  new Set(REVIEWED_AI_SOURCE_CANDIDATES.map(({ name }) => name)),
  new Set(report.results.filter(({ accepted }) => accepted).map(({ name }) => name)),
);
```

Also calculate canonical keys across all curated AI entries and assert uniqueness, supported source types, HTTPS URLs, and non-null computed icon URLs.

- [ ] **Step 5: Export shared curated seed contracts and add accepted rows**

In `src/lib/source-candidate-library.ts`:

```ts
export const CURATED_AI_SOURCE_CANDIDATE_SEED = "curated_ai_sources";
export type CuratedSourceCandidate = { /* existing fields */ };
export const REVIEWED_AI_SOURCE_CANDIDATES: CuratedSourceCandidate[] = [
  // Only entries whose audit result is accepted.
];
export const CURATED_AI_SOURCE_CANDIDATES = [
  // existing entries
  ...REVIEWED_AI_SOURCE_CANDIDATES,
];
export function seedFromCuratedCandidate(/* existing signature */) { /* existing logic */ }
export function sourceKeyForCuratedCandidate(/* existing signature */) { /* existing logic */ }
```

Every accepted row gets an explicit `avatarUrl` verified by the audit. Preserve current cache-preservation behavior during seeding.

- [ ] **Step 6: Save only sanitized evidence**

Copy the audit result to `docs/superpowers/reports/2026-07-27-ai-source-candidate-audit.json`, removing response bodies, data URLs, tokens, headers, local paths, and secrets.

Delete `/tmp/followbrief-ai-source-audit.env` with a Node `fs.unlinkSync` command even when the audit fails.

- [ ] **Step 7: Run focused regression tests**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts tests/source-candidate-library.test.ts tests/avatar-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit accepted candidates and audit evidence**

```bash
git add src/lib/source-candidate-library.ts tests/ai-source-candidate-review.test.ts docs/superpowers/reports/2026-07-27-ai-source-candidate-audit.json
git commit
```

Use a Lore-format commit listing the number accepted/excluded and the real-fetch audit command.

### Task 5: Add transactional production sync

**Files:**
- Create: `tests/reviewed-ai-source-candidate-sync.test.ts`
- Create: `scripts/sync-reviewed-ai-source-candidates.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing sync tests with a fake Prisma client**

Test that the exported sync function:

- calls `$transaction`;
- upserts only `REVIEWED_AI_SOURCE_CANDIDATES`;
- uses `sourceKey` and `seededFrom: "curated_ai_sources"`;
- preserves existing `avatarDataUrl`;
- rolls back the entire batch on one upsert failure;
- can run twice without inserts/duplicates;
- rejects when any unrelated row changes;
- reports target before/after counts without leaking `DATABASE_URL`.

- [ ] **Step 2: Run the test and confirm the sync module is missing**

Run:

```bash
npx tsx --test tests/reviewed-ai-source-candidate-sync.test.ts
```

Expected: FAIL because the sync script does not exist.

- [ ] **Step 3: Implement transactional sync**

Export `syncReviewedAiSourceCandidates(prismaClient)` for tests and guard CLI execution with an `isMain` check. Inside one interactive transaction:

1. Select all unrelated rows' stable structural fields ordered by `sourceKey`.
2. Select existing target rows to preserve `avatarDataUrl`.
3. Upsert each seed returned by `seedFromCuratedCandidate`.
4. Re-read target rows and unrelated rows.
5. Throw if target structure differs from seeds or unrelated structure differs from the pre-transaction snapshot.

Do not call `deleteMany`. Do not run avatar network I/O inside the transaction.

Add package command:

```json
"sources:sync-reviewed-ai-candidates": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/sync-reviewed-ai-source-candidates.ts"
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npx tsx --test tests/reviewed-ai-source-candidate-sync.test.ts tests/ai-source-candidate-review.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit the sync path**

```bash
git add package.json scripts/sync-reviewed-ai-source-candidates.ts tests/reviewed-ai-source-candidate-sync.test.ts
git commit
```

Use a Lore-format commit documenting that avatar backfill remains outside the transaction.

### Task 6: Full verification and review

**Files:**
- Modify only if verification reveals defects.

- [ ] **Step 1: Run focused tests**

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts tests/reviewed-ai-source-candidate-sync.test.ts tests/source-candidate-library.test.ts tests/avatar-persistence.test.ts tests/builder-digest-cli.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full static verification**

```bash
npm run lint
npx tsc --noEmit
```

Expected: PASS with no new warnings/errors.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run a production build**

```bash
npm run build
```

Expected: successful Next.js production build.

- [ ] **Step 5: Request a code review**

Use `superpowers:requesting-code-review` against the complete diff. Fix every blocking correctness, security, data-loss, or test-coverage issue, then repeat the relevant verification.

- [ ] **Step 6: Commit verification fixes**

If fixes were needed, commit them in Lore format with exact tests in the `Tested:` trailer.

### Task 7: Push, deploy, and sync production

**Files:**
- No source changes expected.

- [ ] **Step 1: Merge the implementation branch into local `main`**

Confirm the worktree is clean, merge without discarding existing local-main commits, and verify the reviewed commits are ancestors of `main`.

- [ ] **Step 2: Push `main`**

```bash
git push origin main
```

Expected: push succeeds with no force.

- [ ] **Step 3: Confirm production deployment**

Use the repository's existing Vercel project linkage to wait until the pushed commit is deployed and healthy. Do not mutate production data before the deployment is healthy.

- [ ] **Step 4: Pull production environment securely**

```bash
vercel env pull /tmp/followbrief-reviewed-ai-sync.env --environment=production --yes
```

Record only variable presence, never values.

- [ ] **Step 5: Run transactional sync twice**

```bash
npx tsx --env-file-if-exists=/tmp/followbrief-reviewed-ai-sync.env scripts/sync-reviewed-ai-source-candidates.ts
npx tsx --env-file-if-exists=/tmp/followbrief-reviewed-ai-sync.env scripts/sync-reviewed-ai-source-candidates.ts
```

Expected: both runs report the same target count and unchanged unrelated snapshot.

- [ ] **Step 6: Materialize icon caches**

```bash
AVATAR_BACKFILL_BATCH_SIZE=300 npx tsx --env-file-if-exists=/tmp/followbrief-reviewed-ai-sync.env scripts/backfill-avatar-cache.ts
```

Expected: every reviewed target has both `avatarUrl` and `avatarDataUrl`.

- [ ] **Step 7: Verify production state**

Run a read-only verification using the sync module:

- every accepted source exists exactly once by `sourceKey`;
- structural fields equal the committed seed;
- `avatarDataUrl` is non-null;
- excluded sources were not inserted by this batch;
- unrelated rows match the pre-sync snapshot;
- the total count changed only by newly inserted accepted keys.

- [ ] **Step 8: Delete temporary credentials**

Use Node, not shell deletion:

```bash
node -e 'const fs=require("node:fs"); const p="/tmp/followbrief-reviewed-ai-sync.env"; if(fs.existsSync(p)) fs.unlinkSync(p)'
```

Confirm the file no longer exists.

- [ ] **Step 9: Report exact outcomes**

Report:

- accepted and excluded source names;
- exclusion reason for each failure;
- production candidate count before/after;
- production icon-cache completeness;
- pushed commit and production deployment status;
- tests/build evidence and any residual risk.
