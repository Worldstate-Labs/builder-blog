# New Product Launches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `New Product Launches` source whose admin-owned producer discovers and publishes at most five recent launches while non-admin users consume the shared posts without running local or cloud fetch work.

**Architecture:** Extend the existing static source registry and admin-fetch-only boundary with a narrower platform-maintained classification. A focused, fetch-injected discovery module normalizes four public providers and feeds the existing `buildFetchTasksForBuilders` pipeline; the central content resolver adds matching admin-owned Builders only for reachable platform-maintained channels. Existing personal-library sharing, default FollowBrief source-library import, task execution, sync, and cloud scheduling remain the authority around those additions.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL, Node.js ESM CLI, built-in `node:test` via `tsx`, Lucide React.

---

## File Structure

- Create `src/lib/platform-maintained-sources.ts`: canonical classification and normalization helpers for source types whose content is produced by FollowBrief.
- Create `scripts/new-product-launches.mjs`: pure provider adapters, normalization, deduplication, deterministic ranking, and a single discovery entry point with an injected fetcher.
- Create `tests/new-product-launches.test.ts`: fixture-driven unit coverage for all provider and ranking behavior; no live network calls.
- Modify `config/sources.json`: register the new WEBSITE/BLOG_POST source immediately after Product Hunt.
- Modify source identity/display modules under `src/lib/`: fixed value, candidate, resolver, detection, label, icon, quality policy, prompts, and source ordering.
- Modify `scripts/builder-digest.mjs`: register the discovery handler, produce normal post tasks for the admin, and retain non-admin platform-maintained rows as observational builder stats.
- Modify `src/app/api/skill/context/route.ts`: separate fetchable Builders from platform-maintained observational Builders without changing existing admin-fetch-only semantics.
- Modify `src/lib/user-content-builders.ts`: add matching admin-owned content Builders only for reachable platform-maintained logical channels.
- Modify `src/lib/cloud-source-library.ts`, the source-submission API, and `src/components/SkillPromptActions.tsx`: enforce cloud ineligibility server-side and communicate it in the chooser.
- Modify source-list/log components only where needed to render `Maintained by FollowBrief` without counting it as user-owned work.
- Extend focused contract, integration, and regression tests in `tests/`; do not add dependencies or a database migration.

### Task 1: Register the platform-maintained source contract

**Files:**
- Create: `src/lib/platform-maintained-sources.ts`
- Modify: `src/lib/admin-fetch-only-sources.ts`
- Modify: `config/sources.json`
- Modify: `src/lib/source-inputs.ts`
- Modify: `src/lib/source-value-detect.ts`
- Modify: `src/lib/personal-builder-input.ts`
- Modify: `src/lib/source-display.ts`
- Modify: `src/lib/source-icons.ts`
- Modify: `src/lib/source-candidate-library.ts`
- Modify: `src/lib/source-config-seed.ts`
- Modify: `src/lib/digest-prompts.ts`
- Modify: `src/lib/source-content-policy.ts`
- Modify: `scripts/builder-digest.mjs` (source order and section label only in this task)
- Modify: `src/components/DigestHeadlineSummary.tsx`
- Modify: `src/components/BuilderLibraryList.tsx`
- Modify: `src/components/LibraryHubImportForm.tsx`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/user-journeys.test.ts`
- Test: `tests/performance-ux.test.ts`
- Test: `tests/source-content-policy.test.ts`
- Test: `tests/source-candidate-library.test.ts`
- Test: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Write failing source-contract tests**

Add assertions that `new_product_launches` is the sole platform-maintained source, is also admin-fetch-only, resolves as a WEBSITE source producing BLOG_POST items, and uses this exact fixed tuple:

```ts
assert.deepEqual(PLATFORM_MAINTAINED_SOURCE_TYPE_IDS, ["new_product_launches"]);
assert.equal(isPlatformMaintainedSourceType("New-Product-Launches"), true);
assert.equal(isAdminFetchOnlySourceType("new_product_launches"), true);
assert.equal(FIXED_SOURCE_VALUE_BY_ID.new_product_launches,
  "https://followbrief.worldstatelabs.com/?source=new-product-launches");
assert.equal(sourceLabelForType("new_product_launches"), "New Product Launches");
```

Also assert the fixed resolver returns `name: "New Product Launches"`, `handle: null`, `fetchUrl: null`, and that every hard-coded source order places it immediately after `product_hunt_top_products` without changing existing relative order.

Add a candidate regression proving the fixed FollowBrief URL is detected as `new_product_launches` before the generic HTTP URL fallback, so `crossTypeWarning("new_product_launches", fixedUrl)` returns `null` and the curated candidate can be added without a “Switch source type?” warning.

- [ ] **Step 2: Run the focused tests and confirm the new contract is missing**

Run: `node --import tsx --test tests/user-journeys.test.ts tests/performance-ux.test.ts tests/source-content-policy.test.ts tests/source-candidate-library.test.ts tests/builder-digest-cli.test.ts`

Expected: FAIL because the source ID, fixed resolver, prompt/config, icon, CSS treatment, and ordering do not exist.

- [ ] **Step 3: Add the minimal canonical classification**

Create `src/lib/platform-maintained-sources.ts`:

```ts
export const PLATFORM_MAINTAINED_SOURCE_TYPE_IDS = ["new_product_launches"] as const;

const PLATFORM_MAINTAINED_SOURCE_TYPE_SET = new Set<string>(
  PLATFORM_MAINTAINED_SOURCE_TYPE_IDS,
);

export function normalizePlatformMaintainedSourceType(
  sourceType: string | null | undefined,
) {
  return sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}

export function isPlatformMaintainedSourceType(
  sourceType: string | null | undefined,
) {
  return PLATFORM_MAINTAINED_SOURCE_TYPE_SET.has(
    normalizePlatformMaintainedSourceType(sourceType),
  );
}
```

Add only `new_product_launches` to `ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS`; do not classify Product Hunt or GitHub Trending as platform-maintained. In `detectSourceTypeFromValue`, match the exact `followbrief.worldstatelabs.com/?source=new-product-launches` identity before the generic website fallback.

- [ ] **Step 4: Register identity, display, settings defaults, and prompts**

Insert the source immediately after Product Hunt in `config/sources.json` with `builderKind: "WEBSITE"`, `feedItemKinds: ["BLOG_POST"]`, `agentDefaultStatus: "requires_agent"`, and the exact FollowBrief URL pattern. Add its fixed URL/placeholder/resolver/candidate row, `PackageOpen` icon, label, CSS badge color, and source-content policy.

Add provider-neutral seed prompts:

```ts
fetchNewProductLaunch: `# New Product Launch Fetch Prompt

Use the structured launch facts supplied in task.item.rawJson. Inspect the official
product or repository URL when present and at most one directly linked supporting page.
Return primary product content with source URLs. Do not browse Product Hunt and do not
perform open-ended product research.`,

summarizeNewProductLaunch: `# New Product Launch Summary Prompt

Summarize one supplied launch in the run-selected language. Include product name, what
it does, intended user, why it is notable based on supplied evidence, launch links, and
date. Separate confirmed facts from inference and preserve direct URLs.`
```

Wire those defaults through `source-config-seed.ts`; retain the existing `defaultFetchDays` and `defaultFetchLimit` fields because they are part of the generic schema, but do not add source-specific controls or treat them as the run schedule/cap.

Update `scripts/builder-digest.mjs` source presentation only: place the ID after Product Hunt in `DEFAULT_DIGEST_SOURCE_ORDER` and return `New Product Launches` from `digestSectionLabel`. Fetch-handler registration remains Task 3.

- [ ] **Step 5: Run source-contract tests**

Run: `node --import tsx --test tests/user-journeys.test.ts tests/performance-ux.test.ts tests/source-content-policy.test.ts tests/source-candidate-library.test.ts tests/builder-digest-cli.test.ts`

Expected: PASS, including existing GitHub Trending and Product Hunt assertions.

- [ ] **Step 6: Commit the source contract**

```bash
git add config/sources.json src/lib/platform-maintained-sources.ts src/lib/admin-fetch-only-sources.ts src/lib/source-inputs.ts src/lib/source-value-detect.ts src/lib/personal-builder-input.ts src/lib/source-display.ts src/lib/source-icons.ts src/lib/source-candidate-library.ts src/lib/source-config-seed.ts src/lib/digest-prompts.ts src/lib/source-content-policy.ts src/components/DigestHeadlineSummary.tsx src/components/BuilderLibraryList.tsx src/components/LibraryHubImportForm.tsx 'src/app/(workspace)/builders/page.tsx' src/app/globals.css scripts/builder-digest.mjs tests/user-journeys.test.ts tests/performance-ux.test.ts tests/source-content-policy.test.ts tests/source-candidate-library.test.ts tests/builder-digest-cli.test.ts
git commit -m "Make platform launch discovery a first-class source" -m "Constraint: Existing source ordering and admin-fetch-only behavior must remain unchanged.\nConfidence: high\nScope-risk: moderate\nTested: focused source contract and policy tests"
```

### Task 2: Build deterministic multi-provider launch discovery

**Files:**
- Create: `scripts/new-product-launches.mjs`
- Create: `tests/new-product-launches.test.ts`

- [ ] **Step 1: Write failing provider fixture tests**

Use an injected `fetcher(url)` returning fixture `Response` objects. Cover:

```ts
test("parses Show HN, DEV showdev, Hugging Face Spaces, and Lobsters", async () => {});
test("drops candidates outside lookback and malformed or private destinations", async () => {});
test("merges one launch found by multiple providers and retains provenance", async () => {});
test("ranks stably, caps each provider at two when alternatives exist, and returns five", async () => {});
test("continues after partial provider failure", async () => {});
test("throws a typed discovery error only when all providers fail", async () => {});
test("returns an empty successful result when providers succeed with no eligible launch", async () => {});
```

The fixtures must include URL tracking parameters, duplicate official URLs, equal-score ties, a future timestamp, and one non-public destination.

- [ ] **Step 2: Run tests and verify the module is absent**

Run: `node --import tsx --test tests/new-product-launches.test.ts`

Expected: FAIL with module-not-found for `scripts/new-product-launches.mjs`.

- [ ] **Step 3: Define the normalized candidate boundary**

Export a JSDoc-typed contract containing `provider`, `providerItemId`, `title`, `description`, `discussionUrl`, `officialUrl`, `author`, `publishedAt`, `engagement`, `tags`, `providerUrls`, `providerPayloads`, `dedupKey`, and `rankEvidence`.

Keep parsing/provider functions focused and export only the functions used by tests plus:

```js
export async function discoverNewProductLaunches({
  fetcher = fetch,
  now = new Date(),
  lookbackDays,
  limit = 5,
  timeoutMs = 8_000,
} = {}) {}
```

Validate `lookbackDays >= 1`, clamp `limit` to the fixed maximum five, and never log/store full response bodies or credentials.

- [ ] **Step 4: Implement the four adapters with isolated failures**

Use:

- Hacker News official `showstories.json`, then bounded item requests.
- DEV public `/api/articles?tag=showdev` results.
- Hugging Face `/api/spaces` with recent-creation sorting and bounded pagination/query parameters supported by its public endpoint.
- Lobsters `show.rss` and `announce.rss`, parsed with small structured XML helpers already compatible with the CLI's no-dependency approach.

Wrap each provider in a timeout/AbortController and collect with `Promise.allSettled`. Return concise failure records `{ provider, category, reason }`. Throw `NewProductLaunchDiscoveryError` only if every provider rejects; successful empty provider responses make the overall result successful.

- [ ] **Step 5: Implement eligibility, deduplication, and deterministic ranking**

Normalize public HTTP(S) URLs by removing fragments and tracking parameters and sorting retained query parameters. Use official URL/repository URL as the primary dedup identity, otherwise `${provider}:${providerItemId}`. Merge provider links and strongest fields.

Rank using a documented pure score composed of provider-relative engagement percentile, freshness within the supplied lookback, and corroboration count. Break ties with normalized URL then provider item ID. Apply a two-per-primary-provider diversity pass only while candidates from other providers remain, then backfill to five.

- [ ] **Step 6: Run discovery tests twice to prove determinism**

Run: `node --import tsx --test tests/new-product-launches.test.ts && node --import tsx --test tests/new-product-launches.test.ts`

Expected: both runs PASS with identical ordering assertions.

- [ ] **Step 7: Commit discovery module**

```bash
git add scripts/new-product-launches.mjs tests/new-product-launches.test.ts
git commit -m "Make shared launch discovery resilient to provider churn" -m "Constraint: Discovery uses public unauthenticated interfaces and a fixed five-item cap.\nRejected: Product Hunt scraping | its access controls caused unreliable fetches\nConfidence: high\nScope-risk: narrow\nTested: deterministic fixture tests for all four providers and failure modes\nNot-tested: live provider availability"
```

### Task 3: Route admin one-time and recurring fetches through the same handler

**Files:**
- Modify: `scripts/builder-digest.mjs`
- Modify: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Add a Builder with `sourceType: "new_product_launches"` to `buildFetchTasksForBuilders`. Inject the discovery fetcher/module seam and assert:

- the handler receives the run `days` value;
- it requests a fixed maximum of five regardless of generic source default limit;
- each selected launch becomes a normal existing-format BLOG_POST post task with stable external ID, structured provider facts, settings snapshot, and `requires_agent` content status;
- an empty successful discovery yields zero tasks and no error;
- all-provider failure sets the builder error and run partial state;
- calling the same task builder from manual and cron run-source contexts does not select a different handler.

- [ ] **Step 2: Run the focused CLI tests**

Run: `node --import tsx --test tests/builder-digest-cli.test.ts`

Expected: FAIL because the handler is not registered.

- [ ] **Step 3: Register the source fetcher and task conversion**

Import `discoverNewProductLaunches` into `scripts/builder-digest.mjs`, add it to the personal source handler map, and convert candidates to the same normalized `{ items, agentTasks }` result used by existing special sources. Set:

```js
{
  kind: "BLOG_POST",
  externalId: stableLaunchExternalId(candidate),
  url: candidate.officialUrl ?? candidate.discussionUrl,
  rawJson: {
    ...auditableNormalizedFacts,
    providers: candidate.providerUrls,
    rankEvidence: candidate.rankEvidence,
  },
}
```

Do not branch on run source; manual one-time and cron already share `fetchPersonal` and `buildFetchTasksForBuilders`.

- [ ] **Step 4: Preserve existing post execution and sync contracts**

Reuse existing `fetchTaskFromAgentTask`, quality snapshot, task-outcome, validation, timeout, checkpoint, and `(builderId, kind, externalId)` sync paths. Do not introduce a source-specific sync endpoint or write FeedItems directly from discovery.

- [ ] **Step 5: Run pipeline tests**

Run: `node --import tsx --test tests/new-product-launches.test.ts tests/builder-digest-cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit pipeline wiring**

```bash
git add scripts/builder-digest.mjs tests/builder-digest-cli.test.ts
git commit -m "Let the admin fetch shared launches through the normal pipeline" -m "Constraint: One-time and recurring runs must share the same task builder.\nConfidence: high\nScope-risk: moderate\nDirective: Do not bypass existing task validation or sync for launch posts.\nTested: CLI task construction, empty discovery, and provider failure cases"
```

### Task 4: Resolve shared admin content through reachable user channels

**Files:**
- Modify: `src/lib/user-content-builders.ts`
- Modify: `src/lib/builder-channel-resolver.ts` only if the existing dedup key needs a type-safe input extension
- Test: `tests/user-content-builders.test.ts`
- Test: `tests/recommendation-snapshots.test.ts`
- Test: `tests/user-content-read-surfaces.test.ts`
- Test: `tests/user-journeys.test.ts`

- [ ] **Step 1: Write failing reachability and dedup tests**

Cover these database/query contracts with mocked Prisma where existing test patterns require it:

1. Imported admin channel reaches the admin producer FeedItems.
2. Private user channel with the same entity/source type reaches the same admin producer.
3. Imported plus private channels coexist but one canonical post appears once.
4. No imported/private logical channel means no admin content Builder is returned.
5. A different entity or source type is never joined.
6. Existing cloud-linked Builder expansion still composes unchanged.
7. Following/recommendation, AI Brief candidate reads, search/feed API, detail, and counts use the central resolver result rather than owner-only FeedItems.

- [ ] **Step 2: Run the focused read-model tests**

Run: `node --import tsx --test tests/user-content-builders.test.ts tests/recommendation-snapshots.test.ts tests/user-content-read-surfaces.test.ts tests/user-journeys.test.ts`

Expected: FAIL because user content resolution does not include matching admin producers.

- [ ] **Step 3: Add the platform-maintained resolver expansion**

After collecting the user's reachable logical Builders, identify those for which `isPlatformMaintainedSourceType(sourceType)` is true. Query admin-owned Builders matching both `entityId` and normalized `sourceType`, using the repository's existing admin-email ownership helper rather than a hard-coded user ID. Add those physical Builders to the content Builder set only; do not add them to the user's logical channel list, pool, or subscriptions.

Keep existing cloud-linked expansion and deduplicate Builder IDs before FeedItem reads. Rely on the established `(entityId, kind, externalId)` canonical item dedup in `builder-channel-resolver.ts`.

- [ ] **Step 4: Verify remove and authorization behavior**

Add assertions that removing the user's private/imported channel removes reachability but does not delete or mutate the admin Builder/FeedItems, and another user remains unaffected.

- [ ] **Step 5: Run read-model tests**

Run: `node --import tsx --test tests/user-content-builders.test.ts tests/recommendation-snapshots.test.ts tests/user-content-read-surfaces.test.ts tests/user-journeys.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit shared reads**

```bash
git add src/lib/user-content-builders.ts src/lib/builder-channel-resolver.ts tests/user-content-builders.test.ts tests/recommendation-snapshots.test.ts tests/user-content-read-surfaces.test.ts tests/user-journeys.test.ts
git commit -m "Let reachable launch channels read the shared producer" -m "Constraint: Shared content is authorized by an existing imported or private logical channel.\nConfidence: high\nScope-risk: moderate\nDirective: Never expose admin FeedItems without a reachable platform-maintained channel.\nTested: reachability, private/imported coexistence, dedup, search, recommendations, and removal"
```

### Task 5: Represent platform maintenance in local fetch plans and logs

**Files:**
- Modify: `src/app/api/skill/context/route.ts`
- Modify: `scripts/builder-digest.mjs`
- Modify: `src/components/FetchLogPanel.tsx`
- Modify: `src/components/BuilderLibraryList.tsx`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/lib/i18n-phrases.ts` if the phrase table requires explicit entries
- Test: `tests/user-journeys.test.ts`
- Test: `tests/builder-digest-cli.test.ts`
- Test: `tests/fetch-log-panel-status.test.ts`
- Test: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Write failing context and log tests**

Assert that for non-admin users:

- `libraryFetchBuilders` excludes `new_product_launches`;
- `libraryBuilders` retains it with `fetchDisabledReason: "platform_maintained_source"` rather than the generic admin-only reason;
- context exposes the retained Builder to the CLI as observational state without leaking another owner's ID;
- the resulting `details.perBuilder` entry has `maintenance: "followbrief"`, zero work counters, and no error/fallback/task;
- source totals, planned/running/synced/skipped/failed/deadline counts exclude maintenance rows;
- UI renders `Maintained by FollowBrief` for imported and private rows and does not suggest a local/cloud fetch.

Assert the admin receives the source in `libraryFetchBuilders` and sees normal task/run status.

- [ ] **Step 2: Run focused plan/log tests**

Run: `node --import tsx --test tests/user-journeys.test.ts tests/builder-digest-cli.test.ts tests/fetch-log-panel-status.test.ts tests/library-fetch-runs.test.ts`

Expected: FAIL because maintained observational stats do not exist.

- [ ] **Step 3: Add a typed observational Builder channel**

Return `platformMaintainedBuilders` from skill context for non-admin reachable rows. In `fetchPersonal`, seed `perBuilder` with:

```js
{
  builderId,
  name,
  sourceType: "new_product_launches",
  maintenance: "followbrief",
  itemsFetched: 0,
  tasksGenerated: 0,
  discoveryTasksGenerated: 0,
}
```

Do not pass these Builders into `buildFetchTasksForBuilders`, increment `buildersAttempted`, emit `source_checked`, or count them in run success/partial/error calculations. This is an observational row, not a fake skipped task.

- [ ] **Step 4: Render maintenance state without work semantics**

Extend `PerBuilder` and source-row view models with the optional maintenance field. Show `Maintained by FollowBrief` as subdued platform provenance. Exclude those rows before all user-owned run/deadline aggregate calculations; never label them skipped, stopped, idle, late, failed, or action-needed solely because they have no local task.

- [ ] **Step 5: Run plan/log tests**

Run: `node --import tsx --test tests/user-journeys.test.ts tests/builder-digest-cli.test.ts tests/fetch-log-panel-status.test.ts tests/library-fetch-runs.test.ts`

Expected: PASS for non-admin maintenance state and admin normal-work state.

- [ ] **Step 6: Commit maintenance UX**

```bash
git add src/app/api/skill/context/route.ts scripts/builder-digest.mjs src/components/FetchLogPanel.tsx src/components/BuilderLibraryList.tsx 'src/app/(workspace)/builders/page.tsx' src/lib/i18n-phrases.ts tests/user-journeys.test.ts tests/builder-digest-cli.test.ts tests/fetch-log-panel-status.test.ts tests/library-fetch-runs.test.ts
git commit -m "Make FollowBrief maintenance visible without inventing user work" -m "Constraint: Maintained sources must remain visible but must not affect local run or deadline counts.\nRejected: Fake skipped post tasks | they misrepresent ownership and distort run totals\nConfidence: high\nScope-risk: moderate\nTested: context, CLI run details, source rows, and fetch-log aggregates"
```

### Task 6: Exclude platform-maintained sources from cloud submission

**Files:**
- Modify: `src/lib/cloud-source-library.ts`
- Modify: `src/app/api/cloud-library/source-submissions/route.ts`
- Modify: `src/components/SkillPromptActions.tsx`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Test: `tests/cloud-source-api.test.ts`
- Test: `tests/user-journeys.test.ts`
- Test: `tests/cloud-source-cli-contract.test.ts`

- [ ] **Step 1: Write failing server and chooser tests**

Cover both submit-all and selected-submit paths:

- platform-maintained rows remain visible but their checkboxes are disabled with `Maintained by FollowBrief`;
- they are absent from initial selected IDs and do not count toward the existing submission limit;
- submit-all filters them before submission creation;
- explicitly selected maintained Builder IDs return HTTP 400 with:

```json
{
  "error": "FollowBrief already maintains this source.",
  "code": "platform_managed_source"
}
```

- no `CloudSourceSubmission`, `CloudSourceTask`, or language-library row is created on rejection;
- ordinary, GitHub Trending, and Product Hunt cloud behavior remains unchanged.

- [ ] **Step 2: Run cloud submission tests**

Run: `node --import tsx --test tests/cloud-source-api.test.ts tests/user-journeys.test.ts tests/cloud-source-cli-contract.test.ts`

Expected: FAIL because all personal sources are currently eligible.

- [ ] **Step 3: Enforce the server-side contract**

Validate requested Builder IDs against the user's owned personal Builders before any transaction writes. If any explicitly selected row is platform-maintained, throw a typed `CloudSourceSubmissionError` carrying `status: 400` and `code: "platform_managed_source"`; serialize the code in the API route. In submit-all mode, filter maintained sources from the eligible set. Preserve all existing cloud lease, language, deadline, submitter, and zero-submitter behavior.

- [ ] **Step 4: Disable maintained rows in the chooser**

Include a boolean `platformMaintained` in the server-to-client source option model. Disable its checkbox, keep it visible, show the maintenance phrase, omit it from initial selection and submit-all IDs, and compute the current existing submission limit only from eligible sources. Do not change the limit value as part of this feature.

- [ ] **Step 5: Run cloud tests**

Run: `node --import tsx --test tests/cloud-source-api.test.ts tests/user-journeys.test.ts tests/cloud-source-cli-contract.test.ts`

Expected: PASS with no regression for existing source types.

- [ ] **Step 6: Commit cloud isolation**

```bash
git add src/lib/cloud-source-library.ts src/app/api/cloud-library/source-submissions/route.ts src/components/SkillPromptActions.tsx 'src/app/(workspace)/builders/page.tsx' tests/cloud-source-api.test.ts tests/user-journeys.test.ts tests/cloud-source-cli-contract.test.ts
git commit -m "Keep platform-maintained launches out of cloud submissions" -m "Constraint: Explicit stale-client submissions must fail before any cloud rows are written.\nConfidence: high\nScope-risk: moderate\nDirective: Preserve existing cloud scheduling and submitter cleanup semantics.\nTested: chooser eligibility, submit-all filtering, explicit rejection, and zero-write behavior"
```

### Task 7: Verify settings, end-to-end behavior, and regressions

**Files:**
- Modify: only files required by failures found during verification
- Test: `tests/performance-ux.test.ts`
- Test: `tests/user-journeys.test.ts`
- Test: full `tests/**/*.test.ts`

- [ ] **Step 1: Add/extend the settings rendering contract test**

Assert the new seeded source appears through the existing source-type manager with exactly the current Fetching, Summarization, and Quality gates sections. Assert there is no provider selector, frequency field, lookback field, or max-launches field. Confirm UserSourceTypeConfig lazy materialization includes the new row without overwriting existing user edits.

- [ ] **Step 2: Run focused end-to-end contract tests**

Run:

```bash
node --import tsx --test \
  tests/new-product-launches.test.ts \
  tests/builder-digest-cli.test.ts \
  tests/user-content-builders.test.ts \
  tests/recommendation-snapshots.test.ts \
  tests/user-content-read-surfaces.test.ts \
  tests/user-journeys.test.ts \
  tests/fetch-log-panel-status.test.ts \
  tests/library-fetch-runs.test.ts \
  tests/cloud-source-api.test.ts \
  tests/cloud-source-cli-contract.test.ts \
  tests/source-content-policy.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run static verification**

Run: `npx tsc --noEmit`

Expected: PASS with zero type errors.

Run: `npm run lint`

Expected: PASS with zero ESLint errors.

- [ ] **Step 4: Run the complete test suite and production build**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS, including prompt runtime trace verification.

- [ ] **Step 5: Start the app and perform desktop/mobile visual verification**

Start a free-port development server, then use Playwright at desktop and mobile widths. Verify:

- Add Source offers `New Product Launches` with `PackageOpen` and fixed non-editable value.
- Admin Settings uses the existing three-section source card.
- Admin private library shows ordinary fetch actions and normal logs.
- Non-admin imported and private rows both show `Maintained by FollowBrief` without local/cloud action affordances.
- Cloud chooser shows a disabled maintained row.
- Following, AI Brief, search, and detail show one deduped shared post when both channels exist.
- Removing the private row leaves imported access; removing all reachable channels removes access.
- Text, icons, badges, counts, and dialogs do not overlap at mobile width.

Save screenshots under `output/new-product-launches/` and run the required visual verdict after each corrective UI iteration.

- [ ] **Step 6: Review the final diff for scope containment**

Run: `git diff --check && git status --short && git diff --stat origin/main...HEAD`

Expected: no whitespace errors; no unrelated untracked files are staged; existing Product Hunt, GitHub Trending, default FollowBrief library import, private duplicate handling, and cloud logic are changed only by explicit new-type branches.

- [ ] **Step 7: Commit verification fixes, if any**

```bash
git add <only files changed by verification>
git commit -m "Verify shared launch discovery across user workflows" -m "Confidence: high\nScope-risk: moderate\nTested: focused suites, full suite, TypeScript, ESLint, production build, desktop and mobile Playwright\nNot-tested: production admin bootstrap operation"
```

## Rollout Checklist

- [ ] Deploy the code and allow source-config seeding to create the new default/user rows.
- [ ] As an admin, add and follow `New Product Launches` from the candidate library.
- [ ] Confirm normal admin personal-library sharing publishes it into the FollowBrief source library.
- [ ] Run one admin one-time regular fetch and confirm zero to five validated posts.
- [ ] Confirm the admin recurring library schedule uses the desired library frequency.
- [ ] Verify a non-admin default import receives shared posts without local or cloud tasks.
- [ ] Verify the same non-admin can add a private duplicate channel and still sees each shared post once.
