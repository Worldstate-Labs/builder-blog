# Remove Hermes Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Hermes runtime support while failing closed for historical Hermes pins.

**Architecture:** Narrow the supported runtime contract at the UI and API boundaries, then remove Hermes-only execution code. Keep raw runtime validation ahead of normalization so unsupported historical pins cannot silently select another agent.

**Tech Stack:** Next.js, TypeScript, POSIX shell, Node.js test runner

---

### Task 1: Lock the supported runtime contract

**Files:**
- Modify: `tests/agent-prompt-links.test.ts`
- Modify: `tests/agent-prompt-renderer.test.ts`
- Modify: `tests/user-journeys.test.ts`
- Modify: `tests/agent-job-runs.test.ts`
- Modify: `tests/library-fetch-runs.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/i18n-phrases.test.ts`

- [x] Add assertions that UI, parser, renderer, CLI, and runner do not expose Hermes.
- [x] Add a route test proving `skill.md?runtime=hermes` returns HTTP 400.
- [x] Add runner assertions proving both an env-provided Hermes runtime and a
      persisted Hermes pin exit 78 instead of falling back.
- [x] Run focused tests and confirm they fail because Hermes support still exists.

### Task 2: Remove Hermes from web contracts

**Files:**
- Modify: `src/components/AdminCloudFetchRunActions.tsx`
- Modify: `src/components/SkillPromptActions.tsx`
- Modify: `src/lib/agent-prompt-links.ts`
- Modify: `src/lib/agent-prompt-renderer.ts`
- Modify: `src/app/api/skill/jobs/[job]/skill.md/route.ts`

- [x] Remove Hermes from runtime unions, arrays, labels, and allowlists.
- [x] Return HTTP 400 when the direct skill route receives any present runtime
      outside `claude|codex|openclaw`; keep an absent runtime valid.
- [x] Run prompt-link, renderer, UX, and journey tests.

### Task 3: Remove Hermes execution support

**Files:**
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `scripts/builder-digest.mjs`
- Modify: `skills/builder-blog-digest/jobs/library-cron-stop.md`
- Modify: `skills/builder-blog-digest/jobs/digest-cron-stop.md`

- [x] Remove Hermes interactive and unattended execution functions.
- [x] Remove Hermes discovery, usage/model detection, auth matching, cleanup, and process patterns.
- [x] Validate both `BUILDER_BLOG_AGENT_RUNTIME` and `read_runtime_pin()` raw
      values before deriving `PINNED_RUNTIME`, exporting
      `BUILDER_BLOG_RUNTIME`, or entering override/discovery dispatch.
- [x] Reject every non-empty unsupported raw runtime with exit 78.
- [x] Run shell syntax and runner/CLI contract tests.

### Task 4: Verify the removal

**Files:**
- Modify tests as required only to reflect the three-runtime contract.

- [x] Run `rg -n -i "hermes" src scripts skills README.md package.json` and
      require zero product-code hits. Test hits must be limited to explicit
      rejection/removal assertions. Separately verify that remaining
      tracked-file hits are limited to those tests, documentation (including
      this change's spec/plan), and transitive `hermes-parser` lockfile entries;
      ignore untracked capture/artifact directories such as `.playwright-cli`.
- [x] Run ESLint and `npx tsc --noEmit`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and review the final diff.
