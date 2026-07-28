# Prompt Runtime Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every copied fetch, digest, and Cloud control prompt can render in Vercel and refresh its local skill files.

**Architecture:** Reuse one narrow prompt-asset glob list across every route that calls the shared filesystem renderer. Protect the deployment boundary with a source contract test and direct inspection of Next.js production trace manifests.

**Tech Stack:** Next.js 16, TypeScript, Node test runner, Vercel output file tracing

---

### Task 1: Lock the production tracing contract

**Files:**
- Modify: `tests/user-journeys.test.ts`

- [x] Add assertions that every renderer route is present in `outputFileTracingIncludes`.
- [x] Add assertions that the shared prompt glob covers future main templates and fragments.
- [x] Run the focused test and confirm it fails for the current missing configuration.

### Task 2: Share prompt runtime assets across routes

**Files:**
- Modify: `next.config.ts`

- [x] Define a shared prompt runtime trace list.
- [x] Apply it to `/p/[token]`, `/api/skill/jobs/[job]/skill.md`, and `/api/skill/files/[file]`.
- [x] Run the focused test and confirm it passes.

### Task 3: Verify the serverless artifact and repository

**Files:**
- Verify: `.next/server/app/p/[token]/route.js.nft.json`
- Verify: `.next/server/app/api/skill/jobs/[job]/skill.md/route.js.nft.json`
- Verify: `.next/server/app/api/skill/files/[file]/route.js.nft.json`

- [x] Run the full test suite.
- [x] Run TypeScript and ESLint.
- [x] Run a production build.
- [x] Assert each trace manifest contains `_install-skill.md` and all registered job Markdown files.
- [x] Run `git diff --check`.
