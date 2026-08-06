# OpenClaw Preflight Output Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept the exact OpenClaw readiness marker inside a decorated, pretty-printed JSON envelope without accepting malformed or ambiguous evidence.

**Architecture:** Keep preflight policy in `run_openclaw_library_preflight` unchanged and replace only its marker detector's text-oriented parsing with balanced JSON candidate extraction plus recursive semantic validation. Lock the observed production output shape and negative cases in the existing shell-function regression test harness.

**Tech Stack:** POSIX shell, embedded Node.js, Node test runner, TypeScript.

---

### Task 1: Lock the decorated-output regression

**Files:**
- Modify: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Add a failing production-shape test**

Extend the OpenClaw preflight detector test to write output shaped like:

```text
[state-migrations] Legacy state migration notes:
- Left plugin install index in place.
{
  "runId": "run_test",
  "status": "ok",
  "result": {
    "payloads": [
      {
        "text": "{\"followbriefRuntimePreflight\":\"ok\",\"runtimeReady\":true}"
      }
    ]
  }
}
```

Invoke the extracted shell detector and assert that it exits successfully.

- [ ] **Step 2: Add fail-closed cases**

Use the same detector harness and assert failure for:

```json
{"followbriefRuntimePreflight":"ok","runtimeReady":false}
```

```text
{"followbriefRuntimePreflight":"ok"}
{"runtimeReady":true}
```

```text
[state-migrations] notes
{
  "result": {"payloads":[{"text":"{\"followbriefRuntimePreflight\":\"ok\",\"runtimeReady\":true}"}]}
```

Also reject diagnostic-only text that merely names or shows example readiness
fields without containing a complete parsed JSON object.

- [ ] **Step 3: Run the focused test and verify the new positive case fails**

Run:

```bash
npx tsx --test --test-name-pattern="OpenClaw preflight marker" tests/library-fetch-runs.test.ts
```

Expected: the decorated pretty-JSON positive case fails with the current
detector. The split-fields-across-objects negative case also exposes the current
independent-grep false positive. The other negative cases remain rejected.

### Task 2: Implement semantic JSON candidate extraction

**Files:**
- Modify: `scripts/builder-agent-runner.sh:807`
- Test: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Replace raw text acceptance with exact object validation**

Keep `hasMarker` recursive traversal but accept success only at this object check:

```js
value.followbriefRuntimePreflight === "ok" && value.runtimeReady === true
```

Nested string values may be parsed recursively only when the full trimmed value is valid JSON.

- [ ] **Step 2: Extract complete JSON candidates from decorated text**

Add an embedded Node helper that scans each `{` or `[` candidate while tracking:

```js
let inString = false;
let escaped = false;
const stack = [];
```

Ignore braces inside JSON strings, require matching bracket types, and yield a candidate only when the stack returns to zero. Parse each candidate with `JSON.parse`; skip parse failures.

- [ ] **Step 3: Preserve direct JSON and JSONL support**

Feed the whole output through the same candidate extractor. Direct JSON, one-line JSONL documents, pretty JSON, and JSON embedded after diagnostics should all produce complete candidates without separate regular-expression success paths.

- [ ] **Step 4: Run focused tests and shell syntax validation**

Run:

```bash
sh -n scripts/builder-agent-runner.sh
npx tsx --test --test-name-pattern="OpenClaw preflight marker" tests/library-fetch-runs.test.ts
```

Expected: both commands pass.

### Task 3: Verify and publish

**Files:**
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `tests/library-fetch-runs.test.ts`
- Add: `docs/superpowers/plans/2026-08-06-openclaw-preflight-output-parsing.md`

- [ ] **Step 1: Run the complete related test file**

```bash
npx tsx --test tests/library-fetch-runs.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run lint and repository integrity checks**

```bash
npx eslint tests/library-fetch-runs.test.ts
git diff --check
```

Expected: no errors.

- [ ] **Step 3: Run the broader test suite**

```bash
npm test
```

Expected: all tests pass. If an unrelated pre-existing failure occurs, record it explicitly and verify the focused suite remains green.

- [ ] **Step 4: Commit with a Lore decision record**

Stage only the runner, its regression test, and this plan. Commit the reason for accepting decorated structured output while preserving exact semantic readiness validation.

- [ ] **Step 5: Push `main`**

```bash
git push origin main
```

Expected: `origin/main` advances to the implementation commit.
