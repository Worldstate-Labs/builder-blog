# Remove Hourly Scheduling and Hide User Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit new recurring fetch and digest schedules to daily or weekly, and show monetary fetch/digest cost only when the authenticated server-side user is an admin.

**Architecture:** Treat frequency as a closed product contract at every creation boundary: UI selection, prompt-link parsing, prompt rendering, API validation, local installer validation, and local schedule generation. Treat cost visibility as an explicit, fail-closed rendering capability: server pages derive `isAdmin`, pass `showCost` down the fetch/digest component trees, and shared/inline cost renderers omit money unless the flag is true; usage data and token counts remain unchanged.

**Tech Stack:** Next.js App Router, React 19 server/client components, TypeScript, Node test runner through `tsx --test`, shell/Node scheduling helpers, ESLint.

---

## File map

Frequency contract:

- Modify `src/components/SkillPromptActions.tsx`: expose only One-time, Daily, and Weekly choices.
- Modify `src/lib/agent-prompt-links.ts`: accept only `daily | weekly` in prompt-link payloads.
- Modify `src/lib/agent-prompt-renderer.ts`: render only daily/weekly recurring metadata.
- Modify `src/app/api/skill/jobs/[job]/skill.md/route.ts`: reject an explicitly supplied unsupported `freq` instead of silently converting it to daily.
- Modify `src/app/api/skill/cron-jobs/route.ts`: remove hourly from the server cron-status whitelist.
- Modify `scripts/builder-library-cron-install.sh`: reject hourly resume contracts before any scheduling mutation.
- Modify `scripts/builder-digest.mjs`: reject hourly schedule generation and remove hourly schedule branches/help text.
- Modify `tests/agent-prompt-links.test.ts`, `tests/agent-prompt-renderer.test.ts`, `tests/user-journeys.test.ts`, and `tests/cron-job-audit.test.ts`: lock the public TypeScript/UI/API contract.
- Modify `tests/library-cron-install.test.ts` and `tests/builder-digest-cli.test.ts`: lock the local installer/CLI contract.

Cost visibility:

- Modify `src/components/RunUsageSummary.tsx`: make monetary rendering opt-in with `showCost?: boolean` defaulting to false.
- Modify `src/app/globals.css`: let the non-cost summary use three columns without changing the mobile two-column layout.
- Modify `src/components/FetchLogPanel.tsx`: gate both the top-level cost card and worker-group inline cost.
- Modify `src/components/DigestLogPanel.tsx`: gate the build-log cost card.
- Modify `src/components/SourceSyncLogTabs.tsx`: carry the admin-derived flag into the local fetch panel.
- Modify `src/app/(workspace)/builders/page.tsx`: derive/pass admin status for both fetch and digest trees.
- Modify `tests/library-fetch-runs.test.ts` and `tests/user-journeys.test.ts`: cover fail-closed rendering and server-to-client flag flow.

Intentional non-changes:

- Keep `src/lib/schedule-timing.ts` and its hourly fixtures as defensive readers of schedule metadata; they do not create schedules.
- Keep monetary fields in APIs, persistence, and usage parsing because the requested boundary is client rendering only.
- Keep `src/components/AdminCloudFetchLog.tsx` unchanged; it is already an admin-only surface.
- Do not add a migration or cleanup path because the user confirmed there are no installed hourly tasks.

### Task 1: Close the web and prompt frequency contract

**Files:**

- Modify: `tests/agent-prompt-links.test.ts:91-108`
- Modify: `tests/agent-prompt-renderer.test.ts:201-230,590-610`
- Modify: `tests/user-journeys.test.ts:954-966,1066-1088`
- Modify: `tests/cron-job-audit.test.ts:70-82`
- Modify: `src/components/SkillPromptActions.tsx:56-64,195-200`
- Modify: `src/lib/agent-prompt-links.ts:11-33`
- Modify: `src/lib/agent-prompt-renderer.ts:7-76`
- Modify: `src/app/api/skill/jobs/[job]/skill.md/route.ts:62-75`
- Modify: `src/app/api/skill/cron-jobs/route.ts:10-14`

- [ ] **Step 1: Write failing closed-set and route tests**

In `tests/agent-prompt-links.test.ts`, change the accepted recurring loop and add an explicit removed-value assertion:

```ts
for (const frequency of ["daily", "weekly"]) {
  assert.deepEqual(parseAgentPromptLinkOptions("library-cron-setup", { frequency }), { frequency });
}
assert.throws(
  () => parseAgentPromptLinkOptions("library-cron-setup", { frequency: "1h" }),
  /frequency/i,
);
```

In `tests/agent-prompt-renderer.test.ts`, render the existing digest setup case with `frequency: "daily"`, assert the expected Daily/1440 substitutions, and add an actual route test:

```ts
test("route GET rejects the removed hourly recurring frequency", async () => {
  const request = new Request(
    "https://followbrief.example/api/skill/jobs/library-cron-setup/skill.md?runtime=codex&freq=1h",
  );
  const response = await getSkillJobPromptRoute(request, "library-cron-setup");

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Frequency invalid" });
});
```

In `tests/user-journeys.test.ts`, replace the option-order assertion with One-time/Daily/Weekly and explicitly exclude Hourly/`id: "1h"`. Replace the route whitelist assertion with Daily/Weekly and explicitly exclude the hourly entry. In `tests/cron-job-audit.test.ts`, replace the positive hourly assertion with:

```ts
assert.doesNotMatch(cronJobsRoute, /"1h"|Hourly/);
assert.match(cronJobsRoute, /daily: \{ intervalMinutes: 1_440, label: "Daily" \}/);
assert.match(cronJobsRoute, /weekly: \{ intervalMinutes: 10_080, label: "Weekly" \}/);
```

- [ ] **Step 2: Run the focused tests and capture the expected RED result**

Run:

```bash
npx tsx --test tests/agent-prompt-links.test.ts tests/agent-prompt-renderer.test.ts tests/user-journeys.test.ts tests/cron-job-audit.test.ts
```

Expected: FAIL because `1h` is still accepted, Hourly is still rendered, and the skill route returns 200/defaults instead of returning `Frequency invalid`.

- [ ] **Step 3: Remove hourly from UI, prompt types, and server whitelists**

Use these exact closed sets:

```ts
// src/components/SkillPromptActions.tsx
type CronFrequency = "daily" | "weekly";

const FREQUENCY_CHOICES: { id: ScheduleFrequency; label: string }[] = [
  { id: "once", label: "One-time" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
];
```

```ts
// src/lib/agent-prompt-links.ts
export type Frequency = "daily" | "weekly";
const FREQUENCIES: Frequency[] = ["daily", "weekly"];
```

```ts
// src/lib/agent-prompt-renderer.ts
export type AgentPromptFrequency = "daily" | "weekly";

const cronFrequencies: Record<AgentPromptFrequency, { label: string }> = {
  daily: { label: "Daily" },
  weekly: { label: "Weekly" },
};

const cronIntervalMinutes: Record<AgentPromptFrequency, string> = {
  daily: "1440",
  weekly: "10080",
};
```

Remove the hourly member from both route-local `cronFrequencies` objects. In `src/app/api/skill/jobs/[job]/skill.md/route.ts`, validate an explicit query parameter before applying the daily default:

```ts
const defaultFreq: NormalizedAgentPromptRenderOptions["frequency"] = "daily";
const freqRaw = url.searchParams.get("freq");
if (
  freqRaw !== null &&
  !Object.prototype.hasOwnProperty.call(cronFrequencies, freqRaw)
) {
  return NextResponse.json({ error: "Frequency invalid" }, { status: 400 });
}
const freq = (freqRaw ?? defaultFreq) as NormalizedAgentPromptRenderOptions["frequency"];
```

This preserves the existing daily default only when `freq` is omitted; it must not silently reinterpret an explicitly removed value.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npx tsx --test tests/agent-prompt-links.test.ts tests/agent-prompt-renderer.test.ts tests/user-journeys.test.ts tests/cron-job-audit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the web/prompt contract**

```bash
git add tests/agent-prompt-links.test.ts tests/agent-prompt-renderer.test.ts tests/user-journeys.test.ts tests/cron-job-audit.test.ts src/components/SkillPromptActions.tsx src/lib/agent-prompt-links.ts src/lib/agent-prompt-renderer.ts 'src/app/api/skill/jobs/[job]/skill.md/route.ts' src/app/api/skill/cron-jobs/route.ts
git commit -m "Stop offering a cadence the product no longer supports" \
  -m "Recurring prompt and API boundaries now accept only daily or weekly, and explicitly reject a submitted hourly value instead of silently converting it." \
  -m "Constraint: One-time remains a separate action, not a recurring frequency." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: Keep all schedule-creation closed sets aligned when adding a future cadence." \
  -m "Tested: focused prompt link, renderer, journey, and cron audit tests"
```

### Task 2: Close the local installer and schedule-generator contract

**Files:**

- Modify: `tests/library-cron-install.test.ts:12-23,106-126,680-730`
- Modify: `tests/builder-digest-cli.test.ts:6678-6720`
- Modify: `scripts/builder-library-cron-install.sh:91-95`
- Modify: `scripts/builder-digest.mjs:1118-1120,13742-13760,13777-13794,14038-14051`

- [ ] **Step 1: Write failing tests for direct hourly contracts**

Narrow the test-only valid contract type in `tests/library-cron-install.test.ts`:

```ts
frequencyKey: "daily" | "weekly";
frequencyLabel: "Daily" | "Weekly";
intervalMinutes: 1440 | 10080;
```

Delete the hourly branch from both test schedule helpers. Add a test that forges an untyped external payload after the harness is prepared and verifies rejection occurs before mutation:

```ts
test("installer rejects removed hourly contracts before mutating schedules", async () => {
  const harness = await makeHarness({ verdictStatus: "ok" });
  try {
    const hourlyContract = {
      ...harness.contract,
      frequencyKey: "1h",
      frequencyLabel: "Hourly",
      intervalMinutes: 60,
    };
    await writeFile(harness.contractPath, `${JSON.stringify(hourlyContract, null, 2)}\n`, "utf8");

    const result = runInstaller(harness);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported frequencyKey/);
    assert.equal(await readMutationLog(harness.mutationLogPath), "");
  } finally {
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});
```

Replace `schedule-spec supports temporary hourly local schedules` in `tests/builder-digest-cli.test.ts` with a rejection test:

```ts
test("schedule-spec rejects the removed hourly frequency", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "followbrief-removed-hourly-schedule-spec-"));
  const anchorFile = join(tmp, "schedule-anchor-library-cron-user");
  await writeFile(anchorFile, "2026-06-21T13:15:22Z\n", "utf8");

  await assert.rejects(
    execFileAsync(process.execPath, [
      "scripts/builder-digest.mjs",
      "schedule-spec",
      "--freq",
      "1h",
      "--anchor-file",
      anchorFile,
    ], { cwd: process.cwd(), env: { ...process.env, TZ: "UTC" } }),
    (error: unknown) => {
      assert.match(String((error as { stderr?: string }).stderr), /Unsupported schedule frequency: 1h/);
      return true;
    },
  );
});
```

- [ ] **Step 2: Run the local scheduling tests and capture the expected RED result**

Run:

```bash
npx tsx --test tests/library-cron-install.test.ts tests/builder-digest-cli.test.ts
```

Expected: FAIL because the installer and `schedule-spec` still accept hourly.

- [ ] **Step 3: Reject hourly in both local execution boundaries**

Remove the hourly member from `frequencyMeta` in `scripts/builder-library-cron-install.sh`:

```js
const frequencyMeta = {
  daily: { label: "Daily", interval: 1440 },
  weekly: { label: "Weekly", interval: 10080 },
};
```

In `scripts/builder-digest.mjs`, update help text to `daily|weekly`, make invalid values explicit errors, and remove both hourly switch cases:

```js
function normalizeScheduleFrequency(value) {
  const key = String(value || "").trim();
  if (["daily", "weekly"].includes(key)) return key;
  throw new Error(`Unsupported schedule frequency: ${key || "(empty)"}`);
}
```

Keep only `daily` and `weekly` in `cronExpressionForAnchor` and `launchdScheduleForAnchor`. The default branches can continue producing daily output as unreachable defensive fallbacks, but the normalizer must reject `1h` before either generator runs.

- [ ] **Step 4: Run the local scheduling tests and verify GREEN**

Run:

```bash
npx tsx --test tests/library-cron-install.test.ts tests/builder-digest-cli.test.ts
```

Expected: PASS, including the mutation-log assertion for the rejected installer contract.

- [ ] **Step 5: Commit the local execution contract**

```bash
git add tests/library-cron-install.test.ts tests/builder-digest-cli.test.ts scripts/builder-library-cron-install.sh scripts/builder-digest.mjs
git commit -m "Prevent removed hourly schedules from reaching the host" \
  -m "Local installer validation and schedule generation now reject hourly even when callers bypass the web UI." \
  -m "Constraint: No installed hourly jobs require migration." \
  -m "Rejected: Preserve hourly as a hidden CLI feature | direct callers would bypass the product contract." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: installer harness and builder digest CLI tests"
```

### Task 3: Make monetary usage rendering fail closed

**Files:**

- Modify: `tests/library-fetch-runs.test.ts:1-18,300-316,1546-1555`
- Modify: `src/components/RunUsageSummary.tsx:1-27`
- Modify: `src/app/globals.css:7141-7150`
- Modify: `src/components/FetchLogPanel.tsx:1190-1220,1510-1525,2199-2233,2400-2648,2911-2958`
- Modify: `src/components/DigestLogPanel.tsx:145-163,348-368,625-634,1530-1571`

- [ ] **Step 1: Write failing render and propagation tests**

Import the shared component in `tests/library-fetch-runs.test.ts`:

```ts
import { RunUsageSummary } from "../src/components/RunUsageSummary";
```

Add a behavior test that proves the default is hidden and the explicit admin case is visible:

```ts
test("usage summary hides money by default and shows it only when requested", () => {
  const usage = {
    inputTokens: 2_796,
    outputTokens: 54,
    cachedInputTokens: null,
    reasoningTokens: null,
    totalTokens: 22_306,
    costUsd: 0.0127,
    costEstimated: true,
    currency: "USD",
    provider: null,
    model: null,
    source: null,
  };

  const regularMarkup = renderToStaticMarkup(createElement(RunUsageSummary, { usage }));
  assert.match(regularMarkup, />Tokens</);
  assert.match(regularMarkup, />Input</);
  assert.match(regularMarkup, />Output</);
  assert.doesNotMatch(regularMarkup, />Cost</);
  assert.doesNotMatch(regularMarkup, /\$/);

  const adminMarkup = renderToStaticMarkup(
    createElement(RunUsageSummary, { usage, showCost: true }),
  );
  assert.match(adminMarkup, />Cost</);
  assert.match(adminMarkup, /est\. \$0\.0127/);
});
```

Update the existing source assertions to require both dialogs to call:

```tsx
<RunUsageSummary showCost={showCost} usage={usage} />
```

Also require the fetch worker line to use `formatInlineUsage(workerGroup.usage, showCost)` and require the formatter to add `formatUsageCost(usage)` only inside `if (showCost && usage.costUsd !== null)`.

- [ ] **Step 2: Run the usage tests and capture the expected RED result**

Run:

```bash
npx tsx --test tests/library-fetch-runs.test.ts
```

Expected: FAIL because `RunUsageSummary` still renders Cost by default and panels do not accept/propagate `showCost`.

- [ ] **Step 3: Implement the shared fail-closed summary**

Change `src/components/RunUsageSummary.tsx` to:

```tsx
import { formatUsageCost, formatUsageTokens, type UsageSummary } from "@/lib/usage-summary";

export function RunUsageSummary({
  showCost = false,
  usage,
}: {
  showCost?: boolean;
  usage: UsageSummary | null;
}) {
  if (!usage) return null;

  return (
    <section
      aria-label="Task usage"
      className={`sync-panel-usage-summary${showCost ? "" : " is-cost-hidden"}`}
    >
      <div className="sync-panel-usage-summary-item">
        <span>Tokens</span>
        <strong>{formatUsageTokens(usage.totalTokens)}</strong>
      </div>
      <div className="sync-panel-usage-summary-item">
        <span>Input</span>
        <strong>{formatUsageTokens(usage.inputTokens)}</strong>
      </div>
      <div className="sync-panel-usage-summary-item">
        <span>Output</span>
        <strong>{formatUsageTokens(usage.outputTokens)}</strong>
      </div>
      {showCost ? (
        <div className="sync-panel-usage-summary-item">
          <span>Cost</span>
          <strong>{formatUsageCost(usage)}</strong>
        </div>
      ) : null}
    </section>
  );
}
```

Keep the existing four-column layout for admins and add a custom column count for regular users without defeating the existing mobile media query:

```css
.sync-panel-usage-summary {
  /* existing declarations */
  grid-template-columns: repeat(var(--sync-panel-usage-columns, 4), minmax(0, 1fr));
}

.sync-panel-usage-summary.is-cost-hidden {
  --sync-panel-usage-columns: 3;
}
```

- [ ] **Step 4: Thread `showCost` through every fetch monetary renderer**

Add `showCost?: boolean` to the public `FetchLogPanel` props and default it to false. Pass it into `FetchLogDialog`. Inside the dialog, pass it to the shared summary and to both `RunCard` and `JobRunCard`:

```tsx
<RunUsageSummary showCost={showCost} usage={usage} />
<RunCard {...existingProps} showCost={showCost} />
<JobRunCard {...existingProps} showCost={showCost} />
```

Add required `showCost: boolean` internal props along the two card paths:

```text
FetchLogDialog
  -> RunCard / JobRunCard
  -> RunCardTaskDetails
  -> DetailsBody
  -> formatInlineUsage
```

Use this formatter so tokens remain visible while money is gated:

```ts
function formatInlineUsage(usage: UsageSummary | null, showCost: boolean): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.totalTokens !== null) parts.push(`${formatUsageTokens(usage.totalTokens)} tokens`);
  if (showCost && usage.costUsd !== null) parts.push(formatUsageCost(usage));
  return parts.length > 0 ? parts.join(" · ") : null;
}
```

- [ ] **Step 5: Thread `showCost` through the digest modal**

Add `showCost?: boolean` to `DigestLogPanelProps`, default it to false in `DigestLogPanel`, pass it into `DigestLogDialog`, require a boolean inside the dialog, and render:

```tsx
<RunUsageSummary showCost={showCost} usage={usage} />
```

- [ ] **Step 6: Run the usage tests and verify GREEN**

Run:

```bash
npx tsx --test tests/library-fetch-runs.test.ts
```

Expected: PASS. The default markup contains token headings but no `Cost` or `$`; the explicit admin markup contains both.

- [ ] **Step 7: Commit the fail-closed renderers**

```bash
git add tests/library-fetch-runs.test.ts src/components/RunUsageSummary.tsx src/app/globals.css src/components/FetchLogPanel.tsx src/components/DigestLogPanel.tsx
git commit -m "Make monetary usage an explicit display capability" \
  -m "Shared summaries and fetch worker rows now hide money unless their caller supplies showCost=true, while retaining token counts." \
  -m "Constraint: Usage payloads and persisted cost data remain unchanged." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: New fetch or digest cost renderers must consume the same fail-closed showCost flag." \
  -m "Tested: server-rendered usage component behavior and panel source-contract tests"
```

### Task 4: Authorize cost display from the authenticated builders page

**Files:**

- Modify: `tests/user-journeys.test.ts` (add builders-page cost-flow assertions near related source-management tests)
- Modify: `src/components/SourceSyncLogTabs.tsx:31-58,230-250`
- Modify: `src/app/(workspace)/builders/page.tsx:192-220,241-300,838-850`

- [ ] **Step 1: Write failing server-to-client flow assertions**

In `tests/user-journeys.test.ts`, read the builders page, source tabs, digest wrapper, fetch panel, and digest panel sources and assert:

```ts
assert.match(buildersPage, /const isAdmin = isAdminEmail\(session\.user\.email\)/);
assert.match(buildersPage, /<SourceSyncLogTabs[\s\S]*showCost=\{data\.isAdmin\}/);
assert.match(buildersPage, /<OwnDigestPipelineUpdatesCard[\s\S]*showCost=\{data\.isAdmin\}/);
assert.match(sourceSyncLogTabs, /<FetchLogPanel[\s\S]*showCost=\{showCost\}/);
assert.match(digestWrapper, /<DigestLogPanel[\s\S]*\{\.\.\.logPanelProps\}/);
assert.match(fetchPanel, /showCost = false/);
assert.match(digestPanel, /showCost = false/);
```

Also assert no component derives admin status in the browser:

```ts
assert.doesNotMatch(`${sourceSyncLogTabs}\n${fetchPanel}\n${digestPanel}`, /isAdminEmail/);
```

- [ ] **Step 2: Run the journey test and capture the expected RED result**

Run:

```bash
npx tsx --test tests/user-journeys.test.ts
```

Expected: FAIL because the builders page and source tabs do not yet pass `showCost`.

- [ ] **Step 3: Pass the fetch authorization flag**

Add `showCost?: boolean` to `SourceSyncLogTabs`, default it to false, and pass it to `FetchLogPanel`:

```tsx
export function SourceSyncLogTabs({
  // existing props
  showCost = false,
  // existing props
}: {
  // existing props
  showCost?: boolean;
}) {
  // ...
  return (
    // ...
    <FetchLogPanel
      {...existingProps}
      showCost={showCost}
    />
  );
}
```

In the fetch section of `src/app/(workspace)/builders/page.tsx`, use the already returned `data.isAdmin`:

```tsx
<SourceSyncLogTabs
  {...existingProps}
  showCost={data.isAdmin}
/>
```

- [ ] **Step 4: Pass the digest authorization flag**

In `loadDigestSourcesPageData`, derive the flag only after authentication and return it:

```ts
const isAdmin = isAdminEmail(session.user.email);

return {
  // existing data
  isAdmin,
};
```

Pass it through the existing `OwnDigestPipelineUpdatesCard` prop spread:

```tsx
<OwnDigestPipelineUpdatesCard
  {...existingProps}
  showCost={data.isAdmin}
/>
```

No edit is required in `OwnDigestPipelineUpdatesCard.tsx`: its props are derived from `DigestLogPanelProps`, and `...logPanelProps` already forwards the new flag to `DigestLogPanel`.

- [ ] **Step 5: Run focused cost-flow tests and verify GREEN**

Run:

```bash
npx tsx --test tests/library-fetch-runs.test.ts tests/user-journeys.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit authenticated flag flow**

```bash
git add tests/user-journeys.test.ts src/components/SourceSyncLogTabs.tsx 'src/app/(workspace)/builders/page.tsx'
git commit -m "Let only authenticated admins reveal usage cost" \
  -m "The builders server page now supplies its existing admin decision to both fetch and digest log trees; client components cannot infer or elevate it." \
  -m "Constraint: This is display-only authorization; API payloads remain unchanged by request." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Directive: Do not replace the server-derived flag with a client email or local-state check." \
  -m "Tested: focused usage rendering and user journey tests"
```

### Task 5: Audit all surfaces and run full verification

**Files:**

- Modify only if verification exposes an omission.

- [ ] **Step 1: Audit hourly creation/acceptance surfaces**

Run:

```bash
rg -n '"1h"|\b1h\b|Hourly' src/components/SkillPromptActions.tsx src/lib/agent-prompt-links.ts src/lib/agent-prompt-renderer.ts src/app/api/skill/cron-jobs/route.ts 'src/app/api/skill/jobs/[job]/skill.md/route.ts' scripts/builder-library-cron-install.sh scripts/builder-digest.mjs
```

Expected: no matches. Repository-wide matches may remain only in generic elapsed-time text, defensive schedule readers, translation data used by those readers, and tests that prove rejection/legacy display parsing.

- [ ] **Step 2: Audit all monetary renderers**

Run:

```bash
rg -n 'formatUsageCost\(|>Cost<|costUsd' src/components src/app --glob '!src/components/AdminCloudFetchLog.tsx'
```

Expected: every fetch/digest monetary renderer is either inside `RunUsageSummary`'s `showCost` branch or `FetchLogPanel`'s `showCost`-guarded inline formatter. Token rendering remains unconditional. Admin-only cloud cost is intentionally excluded from this audit command.

- [ ] **Step 3: Run all targeted regression tests**

Run:

```bash
npx tsx --test tests/agent-prompt-links.test.ts tests/agent-prompt-renderer.test.ts tests/user-journeys.test.ts tests/cron-job-audit.test.ts tests/library-cron-install.test.ts tests/builder-digest-cli.test.ts tests/library-fetch-runs.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the complete unit suite**

Run:

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: exit 0 with no ESLint errors.

- [ ] **Step 6: Run the production build and prompt trace verification**

Run:

```bash
npm run build
```

Expected: Next.js production build succeeds and the chained `scripts/verify-prompt-runtime-traces.mjs` check passes.

- [ ] **Step 7: Inspect the final diff and working tree**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -8
```

Expected: `git diff --check` exits 0; only deliberate, reviewed changes are present; no generated or dependency files were added.

- [ ] **Step 8: Commit any verification-only corrections**

Only if Steps 1-7 required corrections:

```bash
git add -u
git commit -m "Close verification gaps in schedule and cost visibility" \
  -m "Final repository audits exposed and closed remaining contract drift before delivery." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: full unit suite, lint, production build, and prompt runtime traces"
```

Otherwise, do not create an empty commit.
