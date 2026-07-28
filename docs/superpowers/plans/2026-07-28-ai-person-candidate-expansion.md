# AI Person Candidate Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit 12 approved AI people with FollowBrief's production-equivalent X pipeline and add only the passing accounts to the curated candidate library.

**Architecture:** Preserve the immutable July 27 proposal/report batch and add a distinct July 28 proposal/report batch. Reuse `runAuditCli({ proposals })` for the live audit, then make the reviewed manifest equal the union of accepted reports while retaining global canonical-key uniqueness.

**Tech Stack:** TypeScript, Node test runner, tsx, existing FollowBrief X fetcher and source-candidate seeding code.

---

### Task 1: Lock the Incremental Proposal Contract

**Files:**
- Modify: `tests/ai-source-candidate-review.test.ts`
- Modify: `src/lib/ai-source-candidate-review.ts`

- [ ] **Step 1: Write the failing proposal test**

Import `AI_PERSON_SOURCE_REVIEW_PROPOSALS`, assert it contains exactly the 12
approved names and exact handles from the design, and apply the existing HTTPS,
source-type, and `sourceUrl === https://x.com/<handle>` checks.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
```

Expected: FAIL because `AI_PERSON_SOURCE_REVIEW_PROPOSALS` is not exported.

- [ ] **Step 3: Add the minimal proposal batch**

Export a readonly 12-entry `AI_PERSON_SOURCE_REVIEW_PROPOSALS` array from
`src/lib/ai-source-candidate-review.ts`. Do not alter the historical
`AI_SOURCE_REVIEW_PROPOSALS` array.

- [ ] **Step 4: Re-run the focused test and verify GREEN**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
```

Expected: PASS.

### Task 2: Run and Inspect the Production-Equivalent Audit

**Files:**
- Create: `/tmp/followbrief-ai-person-candidate-audit.json`
- Create later from sanitized output: `docs/superpowers/reports/2026-07-28-ai-person-candidate-audit.json`

- [ ] **Step 1: Verify credentials without exposing them**

Use a Node presence check for `X_BEARER_TOKEN` in the environment or
`~/.builder-blog/secrets.json`. Print booleans only. If both are absent, pull the
production Vercel environment into a temporary file outside the repository and
pass that file to the `tsx` audit process with `--env-file-if-exists`. Delete the
temporary environment file in an unconditional cleanup step after the audit,
including when the audit command fails.

- [ ] **Step 2: Run only the 12-entry batch**

Use `tsx -e` to import `AI_PERSON_SOURCE_REVIEW_PROPOSALS` and invoke the existing
`runAuditCli({ proposals })`, redirecting stdout to the temporary JSON report.
Do not print credentials, headers, or response bodies.

- [ ] **Step 3: Validate the report structure**

Assert `complete === true`, `proposalCount === resultCount === 12`, and verify the
serialized output contains no token names, authorization headers, data URLs,
database URLs, HTML bodies, or local paths.

- [ ] **Step 4: Inspect every decision**

For each pass, confirm exact handle match, accepted token, recent item count at
least one, and a downloaded safe icon. For each rejection, preserve its exact
reason and do not weaken the evaluator.

### Task 3: Lock Report-to-Manifest Correspondence

**Files:**
- Modify: `tests/ai-source-candidate-review.test.ts`
- Create: `docs/superpowers/reports/2026-07-28-ai-person-candidate-audit.json`
- Modify: `src/lib/source-candidate-library.ts`

- [ ] **Step 1: Save sanitized audit evidence**

Copy the already-sanitized audit JSON into
`docs/superpowers/reports/2026-07-28-ai-person-candidate-audit.json`. Verify it
contains no secrets or local paths.

- [ ] **Step 2: Write the failing incremental report test**

Load both the immutable July 27 report and the new July 28 report. Assert the new
report contains 12 complete results and that `REVIEWED_AI_SOURCE_CANDIDATES`
exactly matches the union of accepted names from both reports. For each new pass,
assert the manifest's source type, URL, handle, fetch URL, and avatar URL exactly
match its audit evidence. Retain supported-type, HTTPS, icon, and global
canonical-key uniqueness checks.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts
```

Expected: FAIL because the new accepted candidates are not in the reviewed
manifest.

- [ ] **Step 4: Add only accepted candidates**

Append one `CuratedSourceCandidate` record per accepted July 28 result to
`REVIEWED_AI_SOURCE_CANDIDATES`, using the exact audited source URL, handle, and
icon URL. Do not add rejected accounts or change existing records.

- [ ] **Step 5: Re-run the focused test and verify GREEN**

Run:

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts tests/source-candidate-library.test.ts tests/avatar-persistence.test.ts
```

Expected: PASS.

### Task 4: Verify and Record the Change

**Files:**
- Modify: `src/lib/ai-source-candidate-review.ts`
- Modify: `src/lib/source-candidate-library.ts`
- Modify: `tests/ai-source-candidate-review.test.ts`
- Create: `docs/superpowers/reports/2026-07-28-ai-person-candidate-audit.json`

- [ ] **Step 1: Run focused source-candidate verification**

```bash
npx tsx --test tests/ai-source-candidate-review.test.ts tests/reviewed-ai-source-candidate-sync.test.ts tests/source-candidate-library.test.ts tests/avatar-persistence.test.ts
```

- [ ] **Step 2: Run full static and behavioral verification**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

All commands must exit successfully before completion is claimed.

- [ ] **Step 3: Review the final diff**

Confirm no unrelated user files are staged, no old reviewed candidate was
removed, every new manifest row has accepted evidence, and the temporary audit
file contains no secret.

- [ ] **Step 4: Commit with Lore context**

Commit only the proposal contract, accepted manifest entries, report, tests, and
this plan. Record accepted/excluded counts, the live audit command, pass criteria,
and known network-verification limitations in Lore trailers.
