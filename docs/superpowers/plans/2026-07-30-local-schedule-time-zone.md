# Local Schedule Time Zone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daily and weekly FollowBrief digest/fetch windows match the macOS or Linux local scheduler, starting only on the next calendar day/week after setup validation.

**Architecture:** Persist the local machine's validated IANA time zone on both cron-job records and expose it through every status serializer. The web app and installed CLI each use explicit-zone calendar arithmetic with the same DST disambiguation; legacy rows without a zone fall back to fixed intervals instead of the server wall clock. The local runner asks the CLI for a canonical due `expectedAt`, preserving existing last-fired deduplication on both launchd and cron.

**Tech Stack:** Next.js 16, TypeScript, Prisma/Postgres, Node.js ESM CLI, POSIX shell, macOS launchd, Linux cron, Node test runner.

---

### Task 1: Persist and transport the local schedule time zone

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/000090_local_cron_time_zone/migration.sql`
- Modify: `scripts/builder-digest.mjs`
- Modify: `src/app/api/skill/cron-jobs/route.ts`
- Modify: `src/app/api/skill/fetch-runs/route.ts`
- Modify: `src/lib/digest-runs.ts`
- Modify: `src/components/FetchLogPanel.tsx`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Test: `tests/cron-job-audit.test.ts`
- Test: `tests/library-fetch-runs.test.ts`

- [ ] **Step 1: Write failing persistence and transport tests**

Assert that both Prisma cron models and the migration contain nullable
`timeZone` fields; the CLI sends `x-machine-time-zone`; the cron endpoint
validates/stores/refreshes it; and digest/fetch serializers include it.

- [ ] **Step 2: Run the focused contract tests and confirm RED**

Run:

```bash
npx tsx --test tests/cron-job-audit.test.ts tests/library-fetch-runs.test.ts
```

Expected: failures for missing `timeZone` schema, header, route, and serializer
contracts.

- [ ] **Step 3: Add the schema migration and request metadata**

Add nullable `timeZone String?` to `LibraryCronJob` and `DigestCronJob`, with a
non-destructive migration. Add the resolved IANA zone to `MACHINE_HEADERS`.
Validate the header with `Intl.DateTimeFormat` before persisting it on active
cron status and guard heartbeats; ignore invalid values.

- [ ] **Step 4: Expose the field on all status surfaces**

Update the cron-jobs serializer, digest serializer/type, fetch-runs
serializer/type, `FetchLogPanel` type, and builders-page server serialization.

- [ ] **Step 5: Generate Prisma and confirm GREEN**

Run:

```bash
npm run db:generate
npx tsx --test tests/cron-job-audit.test.ts tests/library-fetch-runs.test.ts
```

Expected: both files pass.

### Task 2: Replace server-local clock calculations with explicit zoned windows

**Files:**
- Modify: `src/lib/schedule-timing.ts`
- Test: `tests/schedule-timing.test.ts`
- Test: `tests/digest-update-status.test.ts`

- [ ] **Step 1: Write production-shaped failing tests**

Add a Los Angeles daily schedule installed at
`2026-07-30T05:25:09Z` with `anchor:25 22 * * *`. Before
`2026-07-31T05:25:00Z`, assert:

- `firstExpectedSchedule` is the next local day;
- `buildDigestCronStatus` contains only the future waiting slot;
- no `missed` slot is fabricated.

Also add weekly, DST spring gap, DST fall fold, and zone-less legacy cases.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npx tsx --test tests/schedule-timing.test.ts tests/digest-update-status.test.ts
```

Expected: the first expected slot currently equals `startedAt`, and explicit
IANA-zone/DST expectations fail.

- [ ] **Step 3: Implement explicit-zone calendar conversion**

In `schedule-timing.ts`:

- validate IANA zones;
- parse daily/weekly cron anchors;
- map local calendar fields to UTC using `Intl.DateTimeFormat`;
- resolve spring gaps by shifting forward by the gap;
- resolve fall folds to the earlier instant;
- make the first recurring occurrence strictly later than `startedAt`;
- add/floor daily and weekly slots in the explicit zone;
- use fixed intervals for missing/invalid-zone legacy rows.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run:

```bash
npx tsx --test tests/schedule-timing.test.ts tests/digest-update-status.test.ts
```

Expected: all tests pass.

### Task 3: Align local audits and runner `expectedAt` on macOS and Linux

**Files:**
- Modify: `scripts/builder-digest.mjs`
- Modify: `scripts/builder-agent-runner.sh`
- Modify: `skills/builder-blog-digest/jobs/library-cron-setup.md`
- Modify: `skills/builder-blog-digest/jobs/digest-cron-setup.md`
- Test: `tests/builder-digest-cli.test.ts`
- Test: `tests/agent-job-runs.test.ts`
- Test: `tests/user-journeys.test.ts`

- [ ] **Step 1: Write failing CLI and setup-contract tests**

Cover:

- `schedule-spec` emits the resolved IANA zone;
- setup anchors are minute-normalized;
- both setup prompts retain timezone metadata for the runner;
- a CLI schedule-window helper produces the same Los Angeles daily/weekly and
  DST gap/fold instants as the server helper;
- `due_expected_at` delegates to that helper for daily/weekly schedules;
- the existing last-fired file still deduplicates one canonical `expectedAt`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npx tsx --test tests/builder-digest-cli.test.ts tests/agent-job-runs.test.ts tests/user-journeys.test.ts
```

Expected: failures for missing timezone output, minute-normalized anchors, and
zoned due-window command.

- [ ] **Step 3: Implement the local schedule-window helper**

Add the explicit-zone/DST window calculation to the standalone CLI. Use it for
`fetch-status-audit`, `digest-status-audit`, and a machine-readable
`schedule-due` command consumed by the runner.

- [ ] **Step 4: Preserve schedule metadata during installation**

Have `schedule-spec` write `timezone.txt`; update both setup prompts to retain
it next to `status.txt`. Normalize the captured anchor to minute precision.
Keep launchd `StartCalendarInterval` and Linux machine-local crontab syntax
unchanged.

- [ ] **Step 5: Switch the scheduled runner to canonical due windows**

For daily/weekly jobs, call the CLI `schedule-due` helper with the stored
anchor, cron schedule, and timezone. Preserve fixed-interval behavior for
hourly and legacy installs, the 65-minute DST tolerance, and the existing
last-fired dedupe.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run:

```bash
npx tsx --test tests/builder-digest-cli.test.ts tests/agent-job-runs.test.ts tests/user-journeys.test.ts
```

Expected: all tests pass.

### Task 4: Cross-surface verification and review

**Files:**
- Review all files changed in Tasks 1–3.

- [ ] **Step 1: Run schedule-focused regression tests**

```bash
npx tsx --test \
  tests/schedule-timing.test.ts \
  tests/digest-update-status.test.ts \
  tests/cron-job-audit.test.ts \
  tests/library-fetch-runs.test.ts \
  tests/builder-digest-cli.test.ts \
  tests/agent-job-runs.test.ts \
  tests/user-journeys.test.ts
```

- [ ] **Step 2: Run static checks**

```bash
npm run lint
npx tsc --noEmit
git diff --check
```

- [ ] **Step 3: Run the full test suite and production build**

```bash
npm test
npm run build
```

- [ ] **Step 4: Review the final diff against the spec**

Verify:

- setup validation never becomes a scheduled window;
- first Daily/Weekly window is next day/week;
- no server-local `Date#setHours` remains in daily/weekly status calculation;
- macOS and Linux use the same recorded IANA zone and canonical expectedAt;
- old rows and old clients remain compatible;
- unrelated fetch/digest execution behavior is unchanged.

- [ ] **Step 5: Commit the implementation using the Lore protocol**

Stage only the files listed by this plan and record exact focused/full/static
verification in the commit trailers.
