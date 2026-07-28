# Stable Agent Skill Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every FollowBrief Fetch, Digest, and Cloud Fetch copied task install and refresh its local runtime through one validated, retryable bundle request.

**Architecture:** Centralize the public runtime file catalog, serve a deterministic JSON bundle, and use one dependency-free installer for initial bootstrap and recurring runner refreshes. Validate and stage the complete bundle before atomically replacing local runtime files, while preserving legacy single-file endpoints and runner upgrade compatibility.

**Tech Stack:** Next.js route handlers, Node.js/CommonJS, POSIX shell, SHA-256, Node test runner

---

### Task 1: Lock the bundle and installer contracts

**Files:**
- Create: `tests/agent-skill-bundle.test.ts`
- Modify: `tests/user-journeys.test.ts`
- Modify: `tests/agent-prompt-renderer.test.ts`

- [ ] Add failing tests for bundle schema, complete file coverage, deterministic hashes, and cache headers.
- [ ] Add failing installer tests for retry classification, exponential retry success, nested-cause diagnostics, corrupt bundle rejection, safe paths, staged installation, and rollback.
- [ ] Add failing contracts requiring bootstrap and runner refresh to use one bundle and requiring retry-aware prompt downloads.
- [ ] Run the focused tests and confirm they fail only because the bundle implementation is absent.

### Task 2: Centralize runtime file rendering and serve the bundle

**Files:**
- Create: `src/lib/agent-skill-files.ts`
- Create: `src/lib/agent-skill-bundle.ts`
- Create: `src/app/api/skill/bundle/route.ts`
- Modify: `src/app/api/skill/files/[file]/route.ts`

- [ ] Move the existing allowlist and rendering substitutions into the shared file service.
- [ ] Build deterministic bundle entries with safe installed targets, modes, base64 content, per-file SHA-256, and bundle id.
- [ ] Return the bundle with public CDN caching and `nosniff`.
- [ ] Run the focused server tests until green.

### Task 3: Implement transactional client installation

**Files:**
- Create: `scripts/install-agent-skill-bundle.cjs`
- Modify: `src/app/api/skill/bootstrap/route.ts`

- [ ] Implement retry classification, bounded exponential backoff, and nested-cause diagnostics.
- [ ] Validate the complete bundle before writing installed targets.
- [ ] Stage on the same filesystem, commit with per-file backups, and roll back on commit failure.
- [ ] Embed the exact installer source in the bootstrap response and remove fourteen per-file downloads.
- [ ] Run installer and bootstrap tests until green.

### Task 4: Use the bundle across recurring and copied task paths

**Files:**
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `skills/builder-blog-digest/jobs/_install-skill.md`
- Modify: `src/lib/agent-prompt-renderer.ts`

- [ ] Preserve the one-file legacy runner self-update, but strengthen its retry diagnostics.
- [ ] Bootstrap the installer once for upgraded legacy runners and use it for all runtime refreshes.
- [ ] Add bounded retry and nested-cause reporting to the copied bootstrap fetch and OpenClaw child-prompt fetch.
- [ ] Verify one-time Fetch, recurring Fetch, Digest, Cloud Fetch setup, and every stop prompt retain the shared installer.

### Task 5: Trace, build, and end-to-end verify

**Files:**
- Modify: `next.config.ts`
- Modify: `scripts/verify-prompt-runtime-traces.mjs`
- Modify: `tests/prompt-runtime-assets.test.ts`

- [ ] Add failing trace expectations for the bundle and bootstrap installer source.
- [ ] Include all bundle assets in both relevant route traces.
- [ ] Extend the post-build verifier to check route-specific complete asset sets.
- [ ] Run focused tests, the full suite, TypeScript, ESLint, shell syntax, and production build.
- [ ] Start the production server and install the public bundle into a temporary directory; compare every installed runtime file with the route output.
- [ ] Review the final diff for account isolation, backward compatibility, and secret-free diagnostics.
