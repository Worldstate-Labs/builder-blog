# Digest Pipeline Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users share their own digest pipeline to Hub, import other users' shared digest pipelines, switch Home > Digest between own and imported pipelines, and search imported pipeline digests.

**Architecture:** Add a first-class digest pipeline share/import data model beside the existing source-library hub models. Keep `Digest` rows owned by their original user; imported pipeline views and search read owner digests through authorized `DigestPipelineImport` rows. Reuse `DigestDetails` for rendering digest results, and gate authoring controls by selected pipeline ownership.

**Tech Stack:** Next.js App Router server components and route handlers, Prisma/Postgres, React client islands, existing node:test source-level tests, ESLint, TypeScript.

---

### Task 1: Data Model And Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/000038_digest_pipeline_imports/migration.sql`
- Test: `tests/performance-ux.test.ts`

- [ ] **Step 1: Write the failing schema test**

Add assertions to `tests/performance-ux.test.ts` under the existing hub test:

```ts
  assert.match(schema, /model DigestPipelineShare \{/);
  assert.match(schema, /ownerUserId\s+String/);
  assert.match(schema, /importCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /@@unique\(\[ownerUserId\]\)/);
  assert.match(schema, /model DigestPipelineImport \{/);
  assert.match(schema, /@@id\(\[userId, pipelineId\]\)/);
```

- [ ] **Step 2: Run the failing test**

Run: `npm test -- tests/performance-ux.test.ts`

Expected: FAIL because the schema does not yet declare the digest pipeline models.

- [ ] **Step 3: Implement schema and SQL migration**

Add `digestPipelineShares` and `digestPipelineImports` relations to `User`, then add `DigestPipelineShare` and `DigestPipelineImport` models. Create SQL tables with cascades, unique owner, unique slug, and import indexes.

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/performance-ux.test.ts`

Expected: PASS.

### Task 2: Pipeline Hub Domain Helpers And Routes

**Files:**
- Modify: `src/lib/library-hub.ts`
- Create: `src/app/api/digest-pipelines/share/route.ts`
- Create: `src/app/api/digest-pipelines/imports/route.ts`
- Create: `src/app/api/digest-pipelines/imports/[pipelineId]/route.ts`
- Test: `tests/performance-ux.test.ts`

- [ ] **Step 1: Write failing tests for helpers/routes**

Assert `library-hub.ts` exports `shareDigestPipelineToHub`, `unshareDigestPipelineFromHub`, `importDigestPipelineFromHub`, `removeDigestPipelineImportFromHub`, and `digestPipelineTitle`. Assert the three route files call those helpers and use import language.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/performance-ux.test.ts`

Expected: FAIL because helpers/routes do not exist.

- [ ] **Step 3: Implement helpers and routes**

Helpers:
- Upsert one public `DigestPipelineShare` per owner.
- Default title to owner name/email local part.
- Prevent importing own pipeline.
- Import only public pipelines.
- Increment `importCount` only on first import.
- Remove import without touching digests.

Routes:
- `POST /api/digest-pipelines/share`
- `DELETE /api/digest-pipelines/share`
- `POST /api/digest-pipelines/imports`
- `DELETE /api/digest-pipelines/imports/[pipelineId]`

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/performance-ux.test.ts`

Expected: PASS.

### Task 3: Hub UI For Digest Pipelines

**Files:**
- Modify: `src/app/(workspace)/library-hub/page.tsx`
- Create: `src/components/DigestPipelineImportForm.tsx`
- Test: `tests/performance-ux.test.ts`

- [ ] **Step 1: Write failing Hub UI tests**

Assert the Hub page loads digest pipeline shares, renders `DigestPipelineImportForm`, and the form calls `/api/digest-pipelines/imports`. Assert copy uses "Digest Pipelines", "Import", and "Remove".

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/performance-ux.test.ts`

Expected: FAIL because the UI component and data query do not exist.

- [ ] **Step 3: Implement minimal Hub UI**

Add a second section below source libraries for digest pipeline cards. Cards show title, owner, description, latest digest metadata, archive count, import count, view count, import/remove controls, and owner status.

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/performance-ux.test.ts`

Expected: PASS.

### Task 4: Dashboard Pipeline Selector And Read-Only Imported Views

**Files:**
- Modify: `src/app/(workspace)/dashboard/page.tsx`
- Test: `tests/performance-ux.test.ts`

- [ ] **Step 1: Write failing dashboard tests**

Assert the dashboard accepts `pipeline` search params, queries `digestPipelineImport`, renders a pipeline selector, preserves `pipeline=` in archive links, renders `SkillPromptActions` and `DigestLogPanel` only for own pipeline, and has imported-pipeline empty copy.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/performance-ux.test.ts`

Expected: FAIL because dashboard only supports the current user's own digests.

- [ ] **Step 3: Implement dashboard selector**

Load own pipeline plus imported public pipelines. Determine selected pipeline from URL. Query digests by selected owner. Keep authoring controls and digest log only when selected pipeline is own. Preserve `pipeline` in pagination links.

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/performance-ux.test.ts`

Expected: PASS.

### Task 5: Search Imported Pipeline Digests

**Files:**
- Modify: `src/lib/user-search.ts`
- Test: `tests/user-journeys.test.ts`

- [ ] **Step 1: Write failing search tests**

Add source-level tests asserting `searchUserLibrary` queries `digestPipelineImport`, includes imported public pipeline owner ids, labels imported digest results with pipeline title, and routes them to `/dashboard?tab=ai-digest&pipeline=<pipelineId>#<digestId>`.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/user-journeys.test.ts`

Expected: FAIL because search only filters `Digest.userId` by the viewer.

- [ ] **Step 3: Implement search expansion**

Fetch imported public pipelines, include their owner ids in digest search, and map owner user ids back to pipeline metadata for labels and URLs.

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/user-journeys.test.ts`

Expected: PASS.

### Task 6: Full Verification

**Files:**
- All touched files.

- [ ] **Step 1: Generate Prisma client if needed**

Run: `npm run db:generate`

Expected: Prisma client generated without errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Final audit**

Check that every spec requirement is represented in schema, routes, dashboard UI, hub UI, and search tests. Confirm no product copy says `subscribe` for digest pipelines.
