# Skill File Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every filesystem asset served by `/api/skill/files/[file]` is included in the Vercel serverless bundle so bootstrap and stop prompts cannot fail with deployment-only HTTP 500 errors.

**Architecture:** Keep the existing dynamic file route and explicit Next.js tracing configuration. Turn the route registry into the test oracle: every declared `path` must be present in the files-route `outputFileTracingIncludes` block.

**Tech Stack:** Next.js 16, TypeScript, Node test runner, Vercel output file tracing

---

### Task 1: Enforce and repair skill asset tracing

**Files:**
- Modify: `tests/user-journeys.test.ts`
- Modify: `next.config.ts`

- [ ] **Step 1: Write the failing deployment-contract test**

Extend the existing skill tracing test after it extracts `tracingForFilesRoute`:

```ts
const registeredSkillFilePaths = [
  ...skillFileRoute.matchAll(/path: "([^"]+)"/g),
].map((match) => match[1]);
assert.ok(registeredSkillFilePaths.length >= 10, "expected skillFiles to parse");
for (const file of registeredSkillFilePaths) {
  assert.ok(
    tracingForFilesRoute.includes(`"./${file}"`),
    `next.config.ts outputFileTracingIncludes for the files route is missing ${file} — that asset will 500 (ENOENT) on Vercel`,
  );
}
```

Keep the existing fragment loop for `_fetch-task-discovery.md`,
`_fetch-task-core.md`, `_fetch-task-syncing.md`, and
`_digest-task-contract.md`. The new registry-derived loop supplements that
indirect-dependency coverage; it does not replace it.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --import tsx --test-name-pattern='web app serves the agent skill and setup command' tests/user-journeys.test.ts
```

Expected: FAIL naming `scripts/cloud-shard-budget.mjs` as absent from files-route tracing.

- [ ] **Step 3: Add the minimal tracing entries**

Add these exact entries under `outputFileTracingIncludes["/api/skill/files/[file]"]` in `next.config.ts`:

```ts
"./scripts/cloud-shard-budget.mjs",
"./config/sources.json",
```

- [ ] **Step 4: Verify GREEN and the broader contract**

Run:

```bash
node --test --import tsx tests/user-journeys.test.ts tests/cloud-source-cli-contract.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run repository verification**

Run:

```bash
npm test
npm run lint
npx tsc --noEmit --pretty false
DATABASE_URL='postgresql://build:build@127.0.0.1:5432/build' npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit with the repository Lore protocol**

Commit `next.config.ts` and `tests/user-journeys.test.ts` with an intent-first
message explaining the Vercel dynamic-file tracing constraint. Keep the design
and plan documentation in a separate preceding commit.
