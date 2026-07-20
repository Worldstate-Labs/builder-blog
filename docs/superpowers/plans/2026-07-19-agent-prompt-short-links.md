# Agent Prompt Short Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every copied Local Agent prompt URL containing exchange-code query parameters with a same-origin opaque `/p/<token>` URL that directly serves the existing Markdown prompt without redirecting.

**Architecture:** Add a one-to-one `AgentPromptLink` capability record whose raw path token is returned once and only its SHA-256 hash is persisted. A shared validation module owns the closed job/option contract, and a shared renderer owns all existing prompt generation. The authenticated creation endpoint atomically creates an exchange code plus prompt link; the public GET/HEAD route validates the opaque link and calls the renderer directly; existing query URLs remain temporarily compatible but are no longer emitted by either UI.

**Tech Stack:** Next.js 16 Route Handlers, React 19, Prisma 7/PostgreSQL, TypeScript, Node `crypto`, Node test runner through `tsx`.

---

### Task 1: Lock the prompt-link data contract and option validation

**Files:**
- Create: `src/lib/agent-prompt-links.ts`
- Create: `tests/agent-prompt-links.test.ts`

- [ ] **Step 1: Write failing unit tests for the public contract**

  Cover the exposed job allowlist, accepted option keys per job family, runtime/frequency closed sets, integer bounds, rejection of unknown keys, URL-token shape, deterministic SHA-256 hashing, ten-minute expiry, and privacy headers. Use the desired API directly:

  ```ts
  const options = parseAgentPromptLinkOptions("library-cron-setup", {
    runtime: "codex",
    frequency: "daily",
    force: true,
    fetchDays: 30,
    parallelWorkers: 10,
  });
  assert.deepEqual(options, { runtime: "codex", frequency: "daily", force: true, fetchDays: 30, parallelWorkers: 10 });
  assert.throws(() => parseAgentPromptLinkOptions("library-cron-stop", { runtime: "codex" }));
  ```

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `npx tsx --test tests/agent-prompt-links.test.ts`

  Expected: FAIL because `src/lib/agent-prompt-links.ts` does not exist.

- [ ] **Step 3: Implement the minimal shared contract**

  Export:

  ```ts
  export const AGENT_PROMPT_LINK_TTL_MS = 10 * 60 * 1000;
  export const AGENT_PROMPT_LINK_TOKEN_PATTERN = /^fbp_[A-Za-z0-9_-]{22,128}$/;
  export type AgentPromptRenderOptions = { runtime?: Runtime; frequency?: Frequency; force?: boolean; fetchDays?: number; parallelWorkers?: number };
  export function parseAgentPromptLinkOptions(job: ExposedPromptJob, input: unknown): AgentPromptRenderOptions;
  export function createAgentPromptLinkToken(): string;
  export function hashAgentPromptLinkToken(raw: string): string;
  export const AGENT_PROMPT_LINK_PRIVACY_HEADERS: Readonly<Record<string, string>>;
  ```

  Keep the accepted jobs exactly aligned with the design. Reject non-object bodies, arrays, unknown keys, non-applicable options, invalid enum values, booleans encoded as strings, and non-integer/out-of-range values. Do not accept a destination URL, raw prompt, token ID, or exchange code from the request body.

- [ ] **Step 4: Run focused tests and verify GREEN**

  Run: `npx tsx --test tests/agent-prompt-links.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the contract**

  Commit only the module and tests with a Lore-formatted message documenting the closed-option security boundary.

### Task 2: Persist hashed prompt-link capabilities with cascade deletion

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/000089_agent_prompt_links/migration.sql`
- Modify: `tests/agent-prompt-links.test.ts`

- [ ] **Step 1: Add failing schema and migration contract tests**

  Assert that `AgentPromptLink` contains `tokenHash @unique`, `exchangeCodeId @unique`, `job`, `options Json`, `expiresAt`, `createdAt`, and a relation to `ExchangeCode` with `onDelete: Cascade`; assert the reverse optional relation exists on `ExchangeCode`. Verify migration SQL creates both unique indexes and the cascading foreign key.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `npx tsx --test tests/agent-prompt-links.test.ts`

  Expected: FAIL because the model and migration do not exist.

- [ ] **Step 3: Add the Prisma model and idempotent migration**

  Use a dedicated table; never persist the raw path token. Keep `expiresAt` duplicated from the exchange code so expiry queries remain direct and auditable. Use `ON DELETE CASCADE` from `AgentPromptLink.exchangeCodeId` to `ExchangeCode.id`.

- [ ] **Step 4: Regenerate Prisma and verify GREEN**

  Run: `npx prisma generate && npx tsx --test tests/agent-prompt-links.test.ts`

  Expected: Prisma generation succeeds and focused tests pass.

- [ ] **Step 5: Commit the persistence layer**

  Commit schema, migration, generated-client-compatible code, and tests with a Lore-formatted message.

### Task 3: Extract one shared Markdown renderer without changing legacy behavior

**Files:**
- Create: `src/lib/agent-prompt-renderer.ts`
- Modify: `src/app/api/skill/jobs/[job]/skill.md/route.ts`
- Create: `tests/agent-prompt-renderer.test.ts`
- Modify: `tests/user-journeys.test.ts`
- Modify: `tests/cloud-admin-page.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`

- [ ] **Step 1: Write failing renderer parity tests**

  Define typed renderer inputs containing the whitelisted job, normalized options, optional validated exchange context, OpenClaw child context, and request origin. Cover library one-time, recurring, stop, digest, cloud host setup/stop, and OpenClaw parent/child generation. Assert the legacy route is a thin adapter that parses legacy query parameters and calls the shared renderer. Move renderer-specific assertions currently reading route source in `tests/cloud-source-cli-contract.test.ts` into behavioral renderer tests; retain only adapter delegation and public-route contracts in the old test.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `npx tsx --test tests/agent-prompt-renderer.test.ts tests/user-journeys.test.ts tests/cloud-admin-page.test.ts`

  Expected: FAIL because the shared renderer is missing and the route still owns rendering.

- [ ] **Step 3: Move rendering logic into the shared module**

  Preserve every existing behavior: include expansion, timeout placeholders, force/regenerate mapping, runtime labels, account resolution, credential prep, active-schedule warning, exchange step placement, account substitution, bash-block rewriting, and OpenClaw child URL generation. The renderer must receive trusted typed inputs and must not read arbitrary URL query keys.

  Export a canonical OpenClaw child URL builder that takes `origin`, `job`, normalized render options, and resolved account. It must construct the compatibility job route directly:

  ```text
  <origin>/api/skill/jobs/<job>/skill.md?openclaw_setup_child=1&setup_account=<account>&runtime=openclaw&...
  ```

  It preserves only the renderer options needed by the child and explicitly excludes `ec` and the `/p/<token>` capability. Both the legacy adapter and short-link route use this builder, so the queued child remains readable after successful exchange cascades away the parent prompt link.

- [ ] **Step 4: Make the legacy route a compatibility adapter**

  Keep `/api/skill/jobs/[job]/skill.md?...` functional for already-copied links and internal OpenClaw child URLs. Validate the exchange code exactly as before, normalize legacy query parameters, then return the renderer result. Preserve existing response content type and no-store behavior.

- [ ] **Step 5: Run focused and existing route tests until GREEN**

  Run: `npx tsx --test tests/agent-prompt-renderer.test.ts tests/user-journeys.test.ts tests/cloud-admin-page.test.ts tests/cloud-source-cli-contract.test.ts`

  Expected: PASS with renderer parity across old entry points.

- [ ] **Step 6: Commit the renderer boundary**

  Commit the extraction separately so any behavior drift is reviewable.

### Task 4: Add the authenticated prompt-link creation endpoint

**Files:**
- Create: `src/app/api/settings/tokens/[tokenId]/prompt-links/route.ts`
- Create: `tests/agent-prompt-link-api.test.ts`
- Modify: `src/lib/rate-limit.ts` only if an existing authenticated creation limiter cannot be reused

- [ ] **Step 1: Write failing endpoint tests**

  Cover unauthenticated `401`, non-owned/revoked/missing token uniform `404`, malformed JSON and invalid job/options `400`, correct same-origin URL, aligned ten-minute expiries, raw-token-not-persisted, SHA-256 hash persistence, and transaction atomicity. Assert the endpoint takes `tokenId` only from the authenticated path and creates exchange code plus prompt link in one `$transaction` callback.

- [ ] **Step 2: Run endpoint tests and verify RED**

  Run: `npx tsx --test tests/agent-prompt-link-api.test.ts`

  Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Implement authenticated atomic creation**

  Generate independent cryptographic exchange and path tokens, validate request body before opening the transaction, create both rows with one `expiresAt`, and return only `{ url, expiresAt }`. Opportunistically delete expired prompt-link rows only if it does not complicate correctness. Never return the exchange code and never log the raw path token.

- [ ] **Step 4: Run endpoint tests and verify GREEN**

  Run: `npx tsx --test tests/agent-prompt-link-api.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the creation endpoint**

  Use a Lore-formatted commit recording the atomicity and secret-storage constraints.

### Task 5: Serve valid prompt links directly through GET and HEAD

**Files:**
- Create: `src/app/p/[token]/route.ts`
- Modify: `tests/agent-prompt-link-api.test.ts`
- Modify: `src/app/api/skill/exchange/route.ts` only if explicit cleanup is required beyond the database cascade

- [ ] **Step 1: Write failing read-route tests**

  Cover token-shape rejection before database access; uniform `404` text for missing, expired, redeemed, and revoked links; required privacy headers on success and failure; Markdown content type on success; plain text on failure; no redirect; repeated GET; HEAD with identical status/headers and empty body; and defensive revalidation of persisted job/options.

- [ ] **Step 2: Run endpoint tests and verify RED**

  Run: `npx tsx --test tests/agent-prompt-link-api.test.ts`

  Expected: FAIL because `/p/[token]` does not exist.

- [ ] **Step 3: Implement shared lookup and direct rendering**

  Hash the raw path token, query by `tokenHash`, include exchange code, agent token, and user context, then call the shared renderer directly. Do not redirect to the legacy route. Pass the renderer a canonical OpenClaw child continuation URL produced from origin, stored job/options, and resolved account—not from the incoming `/p/<token>` URL—so child setup never depends on the parent capability after exchange. GET and HEAD must share lookup/validation; HEAD must skip Markdown rendering and return no body. Both success and failure use `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, nofollow, noarchive`.

- [ ] **Step 4: Verify exchange invalidation**

  Add an integration contract proving successful `/api/skill/exchange` deletion cascades to the prompt link and that concurrent exchange remains single-use. Repeated reads before exchange remain valid.

- [ ] **Step 5: Run focused tests and verify GREEN**

  Run: `npx tsx --test tests/agent-prompt-link-api.test.ts tests/http-sync-contract.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit the read route**

  Record that readers can preflight/re-read links while exchange remains the consumption boundary.

### Task 6: Migrate every Copy prompt surface to the short-link API

**Files:**
- Modify: `src/components/SkillPromptActions.tsx`
- Modify: `src/components/AdminCloudFetchRunActions.tsx`
- Modify: `tests/cloud-admin-page.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/performance-ux.test.ts`
- Modify: `tests/recommendation-snapshots.test.ts` if snapshot contracts include generated prompt text
- Modify: `tests/user-journeys.test.ts`

- [ ] **Step 1: Replace old UI assertions with failing short-link assertions**

  Require both components to POST `{ job, options }` to `/api/settings/tokens/[tokenId]/prompt-links`, consume `{ url }`, and copy exactly `Open <url> and follow the instructions.` Assert neither component references `/exchange-code`, creates `URLSearchParams` for prompt credentials, assembles `/api/skill/jobs/`, exposes `ec`, nor copies `Read <signed-url>`. Update the existing `tests/user-journeys.test.ts` copy-flow source assertions separately from its Task 3 renderer coverage: they must now expect the prompt-links endpoint and `Open <short-url>` instruction instead of the legacy job URL.

- [ ] **Step 2: Run UI contract tests and verify RED**

  Run: `npx tsx --test tests/cloud-admin-page.test.ts tests/cloud-source-cli-contract.test.ts tests/performance-ux.test.ts tests/recommendation-snapshots.test.ts tests/user-journeys.test.ts`

  Expected: FAIL against the current query-URL implementation.

- [ ] **Step 3: Implement one typed client helper in each existing component boundary**

  Preserve the current controls, manual-copy fallback, busy states, token picker, runtime/frequency/lookback/parallel selections, force behavior, and ten-minute status text. Map `freq` to `frequency`, `days` to `fetchDays`, and `parallel` to `parallelWorkers`. Stop exposing exchange codes to browser component state.

- [ ] **Step 4: Run UI contract tests and verify GREEN**

  Run the same focused UI test command and confirm every job family and all four runtimes use short links.

- [ ] **Step 5: Commit the UI migration**

  Keep this commit limited to client usage and its tests.

### Task 7: Security review, regression suite, and production verification

**Files:**
- Modify only files required by review findings

- [ ] **Step 1: Run focused security checks**

  Verify no raw prompt-link token is persisted or logged, no arbitrary destination/options can be stored, invalid states are indistinguishable, privacy headers are complete, legacy URLs are not emitted by UI, and short-link GET does not consume credentials.

- [ ] **Step 2: Run the complete automated suite**

  Run: `npm test`

  Expected: all tests pass with zero failures.

- [ ] **Step 3: Run static and production checks**

  Run:

  ```bash
  npx prisma validate
  npx tsc --noEmit --pretty false
  npm run lint
  git diff --check origin/main...HEAD
  DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/builder_blog' npm run build
  ```

  Expected: every command exits 0.

- [ ] **Step 4: Verify migration deployability**

  Run Prisma migration/schema validation against an isolated PostgreSQL database when available. If no database is available, record that gap explicitly; static migration contract tests do not substitute for a live apply.

- [ ] **Step 5: Perform focused code and security review**

  Review the full `origin/main...HEAD` diff against the design, fix all blocking findings, rerun affected focused tests, then rerun the complete suite.

- [ ] **Step 6: Confirm final repository state**

  Verify `git status --short` is empty and summarize commits, changed files, checks, and any external-runtime gaps before asking for push authorization.
