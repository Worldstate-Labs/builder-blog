# Cloud Source Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users submit their private source library to FollowBrief Cloud from the existing Fetch sources dialog, then let admin-controlled cloud owners fetch, summarize, sync, and publish those sources through the existing Hub/candidate-source surfaces.

**Architecture:** Each summary language has its own cloud owner user and its own normal source library. A cloud source in Chinese and the same cloud source in English are ordinary `Builder` rows owned by different users, with the same source URL/canonical key but different `ownerUserId`. This uses the existing `Builder.libraryKey = user:<ownerUserId>:<canonicalKey>` uniqueness model, existing `BuilderEntity` cross-owner canonical identity, existing `FeedItem.summary` storage, existing Hub source-library imports, and existing candidate-source dedupe. No language-suffixed source keys and no separate `CloudPostSummary` store are needed for v1.

**Tech Stack:** Next.js App Router, React, Prisma/Postgres, Zod, existing `scripts/builder-digest.mjs`, existing `scripts/builder-agent-runner.sh`, Node test runner via `tsx --test`.

---

## Current-State Map

- `Builder`
  - A source/channel row owned by one user.
  - `libraryKey` is globally unique but includes `ownerUserId`, so the same canonical source can exist once per owner.
  - `canonicalKey` / `entityId` stay language-neutral and can connect the same source across language owners.
- `FeedItem`
  - Stores one `summary` per `(builderId, kind, externalId)`.
  - This is correct if each language uses a different owner-owned `Builder`.
- `LibraryHubEntry` / `LibraryHubItem`
  - Already represent a shared source library owned by a user.
  - A language cloud owner can share its personal library directly as the Hub source library for that language.
- `BuilderPoolEntry`
  - Controls what appears in a user's private source library.
  - Cloud submission should read only the user's `PERSONAL_SYNC` sources, not imported Hub-only sources.
- `SourceCandidate`
  - Should dedupe by language-neutral `sourceKey` / `Builder.canonicalKey`, not by cloud owner or language.
- `src/lib/builders.ts`
  - `upsertBuilder()` already creates the right owner-scoped `Builder` and shared `BuilderEntity`.
  - Cloud ingestion should call this helper with the target language cloud owner id.
- `src/components/SkillPromptActions.tsx`
  - The current Fetch sources dialog owns frequency, runtime, language, lookback, force, and parallel worker state.
  - Cloud mode must bypass the Local Agent access-key requirement.
- `scripts/builder-digest.mjs` and `scripts/builder-agent-runner.sh`
  - Existing fetch planning, sharding, worker execution, validation, merge, checkpoint sync, and final sync should be reused.
  - Cloud jobs change source selection and sync destination owner, not worker task semantics.

## Data Model

Modify `prisma/schema.prisma` and add migration `prisma/migrations/000080_cloud_source_fetch/migration.sql`.

Create enums:

```prisma
enum CloudFetchFrequency {
  DAILY
  WEEKLY
}

enum CloudSourceTaskStatus {
  ACTIVE
  PAUSED
  ERROR
}

enum CloudFetchQueueStatus {
  QUEUED
  LEASED
  SUCCEEDED
  FAILED
  CANCELLED
}

enum CloudFetchRunStatus {
  RUNNING
  SUCCEEDED
  PARTIAL
  FAILED
}
```

Create models:

```prisma
model CloudFetchConfig {
  id                             String   @id @default("global")
  maxTasksPerHour                Int      @default(20)
  maxActiveLeases                Int      @default(20)
  workerSecondsPerHour           Int      @default(3600)
  defaultBatchSize               Int      @default(10)
  leaseTtlMinutes                Int      @default(60)
  schedulingLeadMinutes          Int      @default(120)
  planningHorizonHours           Int      @default(48)
  retryBaseMinutes               Int      @default(30)
  starvationReserveRatio         Float    @default(0.15)
  retryReserveRatio              Float    @default(0.10)
  failureCircuitBreakerThreshold Int      @default(5)
  canonicalCooldownMinutes       Int      @default(60)
  durationColdStartBufferRatio   Float    @default(0.50)
  updatedAt                      DateTime @updatedAt
  updatedByUserId                String?
}

model CloudLanguageLibrary {
  id              String            @id @default(cuid())
  summaryLanguage String            @unique
  ownerUserId     String            @unique
  hubEntryId      String?           @unique
  enabled         Boolean           @default(true)
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  owner           User              @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  hubEntry        LibraryHubEntry?  @relation(fields: [hubEntryId], references: [id], onDelete: SetNull)
  sourceTasks     CloudSourceTask[]

  @@index([enabled])
}

model CloudSourceSubmission {
  id              String              @id @default(cuid())
  userId          String
  userBuilderId   String?
  cloudBuilderId  String
  summaryLanguage String
  frequency       CloudFetchFrequency
  active          Boolean             @default(true)
  submittedAt     DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  user            User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  userBuilder     Builder?            @relation("CloudSubmissionUserBuilder", fields: [userBuilderId], references: [id], onDelete: SetNull)
  cloudBuilder    Builder             @relation("CloudSubmissionCloudBuilder", fields: [cloudBuilderId], references: [id], onDelete: Cascade)

  @@unique([userId, cloudBuilderId])
  @@index([cloudBuilderId, active])
  @@index([summaryLanguage, active])
}

model CloudSourceTask {
  id                     String                  @id @default(cuid())
  cloudLanguageLibraryId String
  builderId              String                  @unique
  summaryLanguage        String
  effectiveFrequency     CloudFetchFrequency
  status                 CloudSourceTaskStatus   @default(ACTIVE)
  lastQueuedAt           DateTime?
  lastStartedAt          DateTime?
  lastSuccessAt          DateTime?
  lastFailureAt          DateTime?
  lastFailureReason      String?
  consecutiveFailures    Int                     @default(0)
  consecutiveDeferrals   Int                     @default(0)
  lastDeferredAt         DateTime?
  estimatedDurationSeconds      Int?
  estimatedSuccessProbability   Float?
  durationP50Seconds            Int?
  durationP75Seconds            Int?
  durationP90Seconds            Int?
  durationSampleCount           Int              @default(0)
  successSampleCount            Int              @default(0)
  circuitBreakerUntil           DateTime?
  circuitBreakerReason          String?
  nextAttemptAt          DateTime?
  mustSucceedBy          DateTime?
  lastRunId              String?
  createdAt              DateTime                @default(now())
  updatedAt              DateTime                @updatedAt
  cloudLanguageLibrary   CloudLanguageLibrary    @relation(fields: [cloudLanguageLibraryId], references: [id], onDelete: Cascade)
  builder                Builder                 @relation(fields: [builderId], references: [id], onDelete: Cascade)
  queueItems             CloudFetchQueueItem[]
  runTasks               CloudFetchRunTask[]

  @@index([cloudLanguageLibraryId, status])
  @@index([status, nextAttemptAt])
  @@index([mustSucceedBy])
}

model CloudFetchQueueItem {
  id                String                @id @default(cuid())
  cloudSourceTaskId String
  status            CloudFetchQueueStatus @default(QUEUED)
  priorityScore     Float                 @default(0)
  dueAt             DateTime
  mustSucceedBy     DateTime
  leasedAt          DateTime?
  leaseExpiresAt    DateTime?
  leaseOwner        String?
  runId             String?
  attempts          Int                   @default(0)
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt
  cloudSourceTask   CloudSourceTask       @relation(fields: [cloudSourceTaskId], references: [id], onDelete: Cascade)
  run               CloudFetchRun?        @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@index([status, dueAt])
  @@index([leaseOwner, leaseExpiresAt])
  @@index([cloudSourceTaskId, status])
}

model CloudFetchRun {
  id              String              @id @default(cuid())
  leaseOwner      String
  startedAt       DateTime            @default(now())
  finishedAt      DateTime?
  status          CloudFetchRunStatus @default(RUNNING)
  requestedLimit  Int
  tasksClaimed    Int                 @default(0)
  tasksSucceeded  Int                 @default(0)
  tasksFailed     Int                 @default(0)
  usageTokens     Int?
  usageCostUsd    Decimal?            @db.Decimal(10, 4)
  summary         String?
  details         Json                @default("{}")
  createdByUserId String?
  queueItems      CloudFetchQueueItem[]
  tasks           CloudFetchRunTask[]

  @@index([startedAt(sort: Desc)])
  @@index([status])
}

model CloudFetchRunTask {
  id                String              @id @default(cuid())
  runId             String
  cloudSourceTaskId String
  builderId         String
  summaryLanguage   String
  status            CloudFetchRunStatus
  startedAt         DateTime?
  finishedAt        DateTime?
  plannedPosts      Int                 @default(0)
  syncedPosts       Int                 @default(0)
  failedPosts       Int                 @default(0)
  estimatedDurationSeconds    Int?
  actualDurationSeconds       Int?
  successProbabilitySnapshot  Float?
  failureReason     String?
  usageTokens       Int?
  usageCostUsd      Decimal?            @db.Decimal(10, 4)
  details           Json                @default("{}")
  run               CloudFetchRun       @relation(fields: [runId], references: [id], onDelete: Cascade)
  cloudSourceTask   CloudSourceTask     @relation(fields: [cloudSourceTaskId], references: [id], onDelete: Cascade)
  builder           Builder             @relation(fields: [builderId], references: [id], onDelete: Cascade)

  @@unique([runId, cloudSourceTaskId])
  @@index([cloudSourceTaskId, finishedAt])
  @@index([builderId, finishedAt])
}
```

Migration details:

- Add Prisma back-relations from `User`, `Builder`, and `LibraryHubEntry` if required by Prisma.
- Do not add `CloudPost`, `CloudPostSummary`, or language-suffixed source keys in v1.
- Existing `FeedItem` rows under the language cloud owner's `Builder` are the durable post/summary store.
- Add a raw SQL partial unique index to prevent duplicate active queue rows:

```sql
CREATE UNIQUE INDEX "CloudFetchQueueItem_active_task_key"
ON "CloudFetchQueueItem"("cloudSourceTaskId")
WHERE "status" IN ('QUEUED', 'LEASED');
```

## Cloud Identity Rules

- One language cloud owner owns one normal source library:
  - `zh` -> one configured cloud owner user -> one Hub source library.
  - `en` -> another configured cloud owner user -> another Hub source library.
- The same URL in `zh` and `en` is two normal `Builder` rows:
  - same `canonicalKey`
  - same `BuilderEntity`
  - different `ownerUserId`
  - different `builderId`
  - separate `FeedItem` rows and summaries.
- Cloud runner leases `CloudSourceTask` rows, where each task points to the ordinary language-owner `Builder`.
- Candidate recommendations use `SourceCandidate.sourceKey = Builder.canonicalKey`, so the same source appears once even if many language cloud libraries contain it.
- Hub/import UI can show language-specific cloud libraries. If a future product surface wants a single grouped view, group by `Builder.entityId` / `canonicalKey` at presentation time only.

## File Structure

Create:

- `src/lib/cloud-source-contracts.ts`
  - Zod schemas and TypeScript types shared by cloud submission, queue, lease, sync, and CLI code.
- `src/lib/cloud-source-library.ts`
  - Language owner resolution, user submission ingestion, source copy/upsert into the target language owner, frequency aggregation, Hub sharing, and candidate source upsert.
- `src/lib/cloud-source-scheduler.ts`
  - Queue generation, hourly budget calculation, due/priority scoring, lease acquisition, lease expiry handling, task progress updates.
- `src/lib/cloud-source-sync.ts`
  - Cloud sync helpers that reuse the existing builder feed-item storage rules.
- `src/app/api/cloud-library/source-submissions/route.ts`
  - Session-authenticated user submit endpoint.
- `src/app/api/admin/cloud-fetch/config/route.ts`
  - Admin-only GET/PATCH for queue tunables.
- `src/app/api/admin/cloud-fetch/language-libraries/route.ts`
  - Admin-only GET/PATCH to map summary languages to cloud owner users.
- `src/app/api/admin/cloud-fetch/queue/route.ts`
  - Admin-only POST to materialize due queue rows.
- `src/app/api/admin/cloud-fetch/lease/route.ts`
  - Admin-only POST to atomically lease up to N queued tasks.
- `src/app/api/admin/cloud-fetch/sync/route.ts`
  - Admin-only POST to sync cloud run output into language-owner `Builder` / `FeedItem` rows and update task/queue/run state.
- `src/components/AdminCloudFetchConfigForm.tsx`
  - Admin settings controls for fetch queue config and language owner mapping.
- `skills/builder-blog-digest/jobs/cloud-library-cron.md`
  - Admin-run script instructions if the command is copied/run by an agent.
- `scripts/followbrief-cloud-fetch-runner.sh`
  - Periodic admin script wrapper around the existing runner.
- `tests/cloud-source-library.test.ts`
- `tests/cloud-source-scheduler.test.ts`
- `tests/cloud-source-sync.test.ts`
- `tests/cloud-source-ui.test.ts`
- `tests/cloud-source-cli-contract.test.ts`

Modify:

- `prisma/schema.prisma`
- `src/components/SkillPromptActions.tsx`
- `src/app/(workspace)/builders/page.tsx`
- `src/app/(workspace)/settings/page.tsx`
- `src/app/api/skill/shared-post-reuse/route.ts`
- `src/app/api/skill/files/[file]/route.ts`
- `scripts/builder-digest.mjs`
- `scripts/builder-agent-runner.sh`
- `src/lib/source-candidate-library.ts`
- `src/lib/library-hub.ts`
- `tests/user-journeys.test.ts`
- `tests/performance-ux.test.ts`
- `tests/shared-post-reuse.test.ts`
- `tests/builder-digest-cli.test.ts`
- `tests/source-content-policy.test.ts`

## Scheduling Algorithm

Definitions:

- Cloud task = one language-owner `Builder` that needs fetching.
- Effective frequency = highest active submitted frequency for that `cloudBuilderId`. `DAILY` outranks `WEEKLY`.
- Interval = `24h` for daily, `7d` for weekly.
- `estimatedDurationSeconds` = conservative predicted wall-clock runtime for one full source task.
- `estimatedSuccessProbability` = predicted chance that the next run finishes successfully.
- `mustSucceedBy`:
  - If never successful: earliest active `submittedAt + interval`, but `nextAttemptAt = now` so new tasks are attempted quickly.
  - If successful: `lastSuccessAt + interval`.
- `targetStartAt = mustSucceedBy - schedulingLeadMinutes`.
- `releaseAt = max(now, targetStartAt, nextAttemptAt)`.
- A task is eligible for planning when:
  - status is `ACTIVE`
  - language cloud library is enabled
  - `circuitBreakerUntil` is null or elapsed
  - no active queued/leased item exists
  - `releaseAt` is within the planning horizon.

Duration and success estimation:

- Cold-start estimate comes from source-type priors, for example podcast / YouTube / RSS / X / website.
- After history exists, update task stats from the last N completed `CloudFetchRunTask` rows:
  - `durationP50Seconds`
  - `durationP75Seconds`
  - `durationP90Seconds`
  - `durationSampleCount`
  - `estimatedSuccessProbability`.
- Use a conservative estimate:

```text
estimatedDurationSeconds =
  max(sourceTypePriorP75, taskDurationP75 or taskDurationP90)
  * coldStartBuffer when sample count is small
```

- Cap estimates with sane min/max values per source type so one abnormal run does not permanently distort scheduling.
- Store `estimatedDurationSeconds` and `successProbabilitySnapshot` on each `CloudFetchRunTask` at lease time for audit/debugging.

Budget:

- `CloudFetchConfig.maxTasksPerHour` is the start-count budget X.
- Also enforce:
  - `maxActiveLeases`
  - `workerSecondsPerHour`
  - `defaultBatchSize`.
- Before leasing:
  - count `CloudFetchRunTask` rows with `startedAt >= now - 1 hour`
  - count active unexpired leases
  - sum estimated worker seconds already started in the current hour.
- Available count budget = `max(0, X - recentStartedTasks)`.
- Available worker-seconds budget = `max(0, workerSecondsPerHour - recentEstimatedSeconds)`.
- Lease limit is bounded by requested limit, default batch size, count budget, active lease budget, and worker-seconds budget.

Rolling-horizon admission control:

1. Load eligible tasks for the next `planningHorizonHours`.
2. Split the horizon into hour buckets.
3. Each bucket has:
   - task-count capacity: `maxTasksPerHour`
   - estimated-time capacity: `workerSecondsPerHour`.
4. Each task consumes:
   - count = 1
   - time = `estimatedDurationSeconds`.
5. A task can be placed only in buckets where:

```text
bucketStart >= releaseAt
bucketStart + estimatedDurationSeconds <= mustSucceedBy
```

6. Process tasks by earliest `mustSucceedBy`.
7. Tentatively place each task in the latest feasible bucket before its deadline, preserving earlier buckets for tighter tasks.
8. If a bucket exceeds capacity, evict the lowest scheduling score until both count and time capacity fit.
9. The lease endpoint returns only tasks assigned to the current hour bucket.

Scheduling score:

```text
baseValue = 1
submissionWeight = sqrt(activeSubmissionCount)
urgency = 1 / max(1 minute, mustSucceedBy - now)
aging = 1 + min(consecutiveDeferrals, 10) * 0.15
expectedValue = baseValue * submissionWeight * estimatedSuccessProbability * aging
score = expectedValue * urgency / max(estimatedDurationSeconds, minDuration)
```

- Eviction removes the lowest `score` first.
- Current-hour execution order uses least slack first:

```text
slack = mustSucceedBy - now - estimatedDurationSeconds
```

Fairness and overload protections:

- Reserve `starvationReserveRatio` of the current-hour count budget for oldest eligible tasks by `consecutiveDeferrals` / `lastDeferredAt`.
- Reserve `retryReserveRatio` of the current-hour count budget for retrying failed-but-not-circuit-broken tasks.
- If a task is not selected even though it is eligible, increment `consecutiveDeferrals` and set `lastDeferredAt`.
- If `consecutiveDeferrals` crosses a configured threshold, force the task into the starvation reserve lane before normal score-based tasks.
- If `now + estimatedDurationSeconds > mustSucceedBy`, the task cannot be on time. Do not let it displace on-time-feasible tasks; schedule it only through the catch-up/starvation reserve lane.
- If `consecutiveFailures >= failureCircuitBreakerThreshold`, set `circuitBreakerUntil` and exclude it from normal planning until the breaker expires or an admin resets it.
- Do not lease two tasks with the same `Builder.canonicalKey` at the same time across language owners. Apply a short canonical cooldown/mutex so the same external source is not fetched concurrently in multiple languages.
- Lease TTL should be `max(leaseTtlMinutes, estimatedDurationSeconds + buffer)`. Long-running workers should heartbeat to extend the lease; stale leases expire and become retryable.

Run result updates:

- A cloud task succeeds when source planning completed and every planned post task is either synced or intentionally accounted for without failed outcomes. A scan with zero new posts is a success.
- Any failed post task, source fetch failure, validation failure, or sync failure marks that cloud source task failed.
- On success:
  - `lastSuccessAt = now`
  - `consecutiveFailures = 0`
  - `consecutiveDeferrals = 0`
  - `mustSucceedBy = now + interval`
  - `nextAttemptAt = mustSucceedBy - schedulingLeadMinutes`
  - update duration and success stats from actual run output.
- On failure:
  - `lastFailureAt = now`
  - `lastFailureReason = normalized reason`
  - `consecutiveFailures += 1`
  - `nextAttemptAt = now + retryBaseMinutes * 2^(min(consecutiveFailures - 1, 5))`, capped so urgent tasks can retry before `mustSucceedBy`.
  - update duration, success, and failure-class stats.
  - apply circuit breaker when repeated failures exceed threshold.

## Implementation Tasks

### Task 1: Schema and Migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/000078_cloud_source_fetch/migration.sql`
- Create: `tests/cloud-source-schema.test.ts`

- [ ] Add cloud enums and models exactly as above.
- [ ] Add required Prisma back-relations.
- [ ] Add the partial unique queue index in raw SQL migration.
- [ ] Write schema test asserting:
  - all cloud models exist
  - `CloudLanguageLibrary.summaryLanguage` is unique
  - `CloudLanguageLibrary.ownerUserId` is unique
  - `CloudSourceTask.builderId` is unique
  - `CloudSourceTask` has duration/success estimate, deferral, and circuit-breaker fields
  - `CloudFetchConfig` has active-lease, worker-seconds, reserve-ratio, and canonical-cooldown fields
  - queue migration contains the partial active-task unique index.
- [ ] Run:

```bash
npx prisma validate
npx prisma generate
npx tsx --test tests/cloud-source-schema.test.ts
```

### Task 2: Cloud Source Domain Helpers

**Files:**

- Create: `src/lib/cloud-source-contracts.ts`
- Create: `src/lib/cloud-source-library.ts`
- Modify: `src/lib/source-candidate-library.ts`
- Modify: `src/lib/library-hub.ts`
- Create: `tests/cloud-source-library.test.ts`

- [ ] Add contract types:
  - `CloudFetchFrequencyInput = "day" | "week"`
  - normalized Prisma frequency mapping to `DAILY` / `WEEKLY`
  - cloud submission payload: `{ frequency, summaryLanguage }`
  - language library identity: `{ summaryLanguage, ownerUserId }`.
- [ ] Add `resolveCloudLanguageLibrary(summaryLanguage)`:
  - loads enabled `CloudLanguageLibrary`
  - verifies owner user exists
  - returns `{ summaryLanguage, ownerUserId, hubEntryId }`.
- [ ] Add `copyBuilderToCloudOwner({ userBuilder, cloudOwnerUserId })`:
  - calls existing `upsertBuilder()` with the target language owner
  - preserves source URL, fetch URL, kind, source type, handle, avatar, and bio
  - relies on existing owner-scoped `libraryKey`.
- [ ] Add `submitUserPrivateLibraryToCloud({ userId, frequency, summaryLanguage })`:
  - selects active `BuilderPoolEntry` rows where `origin = PERSONAL_SYNC`, `builder.ownerUserId = userId`, `removedAt = null`
  - excludes imported Hub-only sources to avoid submission feedback loops
  - resolves the language cloud owner
  - copies/upserts each source as a normal `Builder` under that owner
  - upserts one `CloudSourceSubmission` per user/cloud-builder
  - upserts/recomputes one `CloudSourceTask` per cloud-builder.
- [ ] Add `syncCloudLanguageLibraryHub(summaryLanguage)`:
  - shares the language owner personal source library via existing Hub semantics
  - stores/refreshes `CloudLanguageLibrary.hubEntryId`
  - uses language-specific names/descriptions, for example `Community source library - Chinese`.
- [ ] Add `upsertSourceCandidateFromCloudBuilder(builderId)`:
  - upserts `SourceCandidate` by `sourceKey = builder.canonicalKey`
  - uses `seededFrom = "cloud_source_library"`
  - does not overwrite curated/admin rows with different `seededFrom` unless the existing row was cloud-seeded.
- [ ] Test:
  - same URL submitted to `zh` and `en` creates two cloud-owner `Builder` rows with different owners and the same canonical key
  - same user submitting same source/language is idempotent
  - daily outranks weekly for a cloud builder
  - disabling/removing a daily submission downgrades to weekly when only weekly remains
  - language library Hub projection creates one Hub entry per language owner
  - candidate source upsert dedupes across languages by canonical source key.
- [ ] Run:

```bash
npx tsx --test tests/cloud-source-library.test.ts
```

### Task 3: User Submit API

**Files:**

- Create: `src/app/api/cloud-library/source-submissions/route.ts`
- Modify: `tests/user-journeys.test.ts`
- Create/modify: `tests/cloud-source-library.test.ts`

- [ ] Implement `POST` with session auth via `getCurrentSession()`.
- [ ] Validate:
  - `frequency` is `"day"` or `"week"`
  - `summaryLanguage` uses `normalizeSummaryLanguagePreference()`
  - requester has at least one private source
  - a cloud language library exists for the requested language.
- [ ] Call `submitUserPrivateLibraryToCloud`.
- [ ] Return:

```json
{
  "status": "ok",
  "sourcesSubmitted": 12,
  "tasksSubmitted": 12,
  "frequency": "day",
  "summaryLanguage": "zh"
}
```

- [ ] Rate-limit by user.
- [ ] Tests cover unauthorized, empty private library, unsupported language, invalid frequency, and aggregation success.
- [ ] Run:

```bash
npx tsx --test tests/cloud-source-library.test.ts tests/user-journeys.test.ts
```

### Task 4: Admin Cloud Fetch Config

**Files:**

- Create: `src/app/api/admin/cloud-fetch/config/route.ts`
- Create: `src/app/api/admin/cloud-fetch/language-libraries/route.ts`
- Create: `src/components/AdminCloudFetchConfigForm.tsx`
- Modify: `src/app/(workspace)/settings/page.tsx`
- Modify: `tests/performance-ux.test.ts`

- [ ] Add admin-only config `GET` and `PATCH` using `getCurrentSession()` + `isAdminEmail()`.
- [ ] Validate:
  - `maxTasksPerHour`: integer 1-500
  - `maxActiveLeases`: integer 1-500
  - `workerSecondsPerHour`: integer 60-86400
  - `defaultBatchSize`: integer 1-100
  - `leaseTtlMinutes`: integer 5-240
  - `schedulingLeadMinutes`: integer 0-1440
  - `planningHorizonHours`: integer 1-168
  - `retryBaseMinutes`: integer 5-720
  - `starvationReserveRatio`: number 0-0.5
  - `retryReserveRatio`: number 0-0.5
  - `failureCircuitBreakerThreshold`: integer 1-50
  - `canonicalCooldownMinutes`: integer 0-1440
  - `durationColdStartBufferRatio`: number 0-2.
- [ ] Add admin-only language library endpoint:
  - `summaryLanguage`
  - `ownerUserId` or owner email lookup
  - enabled/disabled.
- [ ] Add settings panel visible only to admins.
- [ ] Keep controls consistent with existing settings components.
- [ ] Tests assert non-admins cannot edit, admins can edit, and UI is admin-only.
- [ ] Run:

```bash
npx tsx --test tests/performance-ux.test.ts
```

### Task 5: Queue and Lease APIs

**Files:**

- Create: `src/lib/cloud-source-scheduler.ts`
- Create: `src/app/api/admin/cloud-fetch/queue/route.ts`
- Create: `src/app/api/admin/cloud-fetch/lease/route.ts`
- Create: `tests/cloud-source-scheduler.test.ts`

- [ ] Implement `materializeDueCloudFetchQueue({ now })`:
  - computes eligible active `CloudSourceTask` rows inside the planning horizon
  - calls `planCloudFetchWindow({ now })`
  - inserts queued rows only for tasks assigned to the current-hour bucket
  - honors the active queue partial unique index.
- [ ] Implement `estimateCloudSourceTaskRuntime(task)`:
  - uses source-type priors before history exists
  - uses task p75/p90 duration after history exists
  - applies cold-start buffer and min/max caps.
- [ ] Implement `planCloudFetchWindow({ now })`:
  - builds hour buckets for `planningHorizonHours`
  - enforces both `maxTasksPerHour` and `workerSecondsPerHour`
  - places tasks in the latest feasible bucket before deadline
  - evicts lowest score when a bucket is over capacity
  - records deferrals for eligible tasks not selected
  - applies starvation and retry reserve lanes.
  - returns the planned current-hour task set plus debug metadata explaining skipped/deferred tasks.
- [ ] Implement `leaseCloudFetchTasks({ limit, leaseOwner, now })`:
  - expires stale `LEASED` rows whose `leaseExpiresAt < now`
  - materializes due rows from the current-hour rolling-horizon plan
  - computes hourly count, active lease, and worker-seconds budgets
  - excludes tasks blocked by circuit breaker or canonical source cooldown
  - atomically leases up to budgeted limit inside a transaction
  - creates a `CloudFetchRun`
  - creates `CloudFetchRunTask` rows with estimated duration and success-probability snapshots
  - returns run metadata plus ordinary cloud-owner builder inputs.
- [ ] Admin `POST /api/admin/cloud-fetch/queue` materializes due queue and returns counts.
- [ ] Admin `POST /api/admin/cloud-fetch/lease` leases tasks and returns:

```json
{
  "status": "ok",
  "runId": "...",
  "tasks": [
    {
      "cloudSourceTaskId": "...",
      "builderId": "...",
      "summaryLanguage": "zh",
      "source": { "kind": "BLOG", "sourceType": "blog", "name": "...", "sourceUrl": "...", "fetchUrl": null }
    }
  ]
}
```

- [ ] Tests cover hourly count budget, worker-seconds budget, active lease budget, daily-vs-weekly deadlines, stale lease expiry, no duplicate active queue item, duration-aware planning, starvation reserve, retry reserve, canonical cooldown, circuit breaker, failure backoff.
- [ ] Run:

```bash
npx tsx --test tests/cloud-source-scheduler.test.ts
```

### Task 6: Cloud Fetch Planning CLI

**Files:**

- Modify: `scripts/builder-digest.mjs`
- Create: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/builder-digest-cli.test.ts`

- [ ] Factor the current `fetchPersonal` source-planning body into reusable helpers:
  - `buildFetchTasksForBuilders({ builders, context, force, days, limit, runStartedAt })`
  - preserve current `fetch-personal` output exactly.
- [ ] Add command `fetch-cloud-library`:
  - reads admin config/token with existing `readConfig()` and `requireLoggedIn()`
  - calls `/api/admin/cloud-fetch/lease`
  - builds a synthetic context using default/admin source configs and each task's `summaryLanguage`
  - maps each leased cloud-owner builder into the same builder object shape current fetchers expect
  - emits the same top-level shape as `fetch-personal`.
- [ ] Stamp every planned fetch task with:
  - `cloudRunId`
  - `cloudSourceTaskId`
  - `summaryLanguage`
  - `builderSync.builderId`
  - `builderSync.cloudSourceTaskId`.
- [ ] Keep `task.summaryInstructions.prompt` as the only worker-facing language instruction.
- [ ] Reuse `applySharedPostReuseToFetchTasks` so cloud runs can skip fetch or translate summaries when existing summaries are reusable.
- [ ] Add tests:
  - `fetch-personal` snapshots still pass
  - `fetch-cloud-library` emits regular `fetch_post` tasks usable by existing `library-worker.md`
  - task language differs when the batch includes multiple language-owner libraries
  - no user private-library builders are selected by cloud command.
- [ ] Run:

```bash
npx tsx --test tests/cloud-source-cli-contract.test.ts tests/builder-digest-cli.test.ts
```

### Task 7: Cloud Sync Endpoint and CLI

**Files:**

- Create: `src/lib/cloud-source-sync.ts`
- Create: `src/app/api/admin/cloud-fetch/sync/route.ts`
- Modify: `scripts/builder-digest.mjs`
- Create: `tests/cloud-source-sync.test.ts`
- Modify: `tests/source-content-policy.test.ts`

- [ ] Refactor the `FeedItem` storage portion of `src/app/api/skill/builders/route.ts` into a shared helper, for example `src/lib/builder-feed-sync.ts`.
- [ ] Implement cloud sync payload schema in `cloud-source-contracts.ts`:
  - accepts the existing merged sync payload shape plus `cloudRunId`
  - requires cloud task metadata on every item/outcome.
- [ ] Implement `POST /api/admin/cloud-fetch/sync`:
  - admin bearer auth via `getUserFromBearer()` + `isAdminEmail()`
  - validates all source URLs via `validatePublicHttpUrl()`
  - loads the task's language-owner `Builder`
  - writes/updates existing `FeedItem` rows for `builderId`
  - calls `prepareFeedItemStorage()` and `checkBodyContentQuality()`
  - requires non-empty summary always
  - allows empty stored body for `durableRawMode = "none"` and other policy-approved no-body cases
  - patches `CloudFetchRunTask`, `CloudSourceTask`, `CloudFetchQueueItem`, and `CloudFetchRun`
  - writes `actualDurationSeconds`, planned/synced/failed post counts, token/cost usage, and failure class
  - updates task duration p50/p75/p90, success probability, sample counts, and estimated duration
  - on source-level success, calls `syncCloudLanguageLibraryHub(summaryLanguage)` and `upsertSourceCandidateFromCloudBuilder(builderId)`.
- [ ] Add CLI command `sync-cloud-builders`:
  - parallels `sync-builders`
  - reads planned tasks
  - validates agent sync coverage using existing validation helpers
  - posts to `/api/admin/cloud-fetch/sync`
  - patches cloud run status even when payload has only outcomes.
- [ ] Tests:
  - successful item writes a `FeedItem` under the language-owner builder
  - same post URL in two languages writes to two different builders and does not overwrite either summary
  - empty body is accepted only when source content policy permits it
  - duration/success stats update after success and failure
  - failed outcomes update task failure/backoff
  - repeated failures trip circuit breaker
  - success updates candidate source and language Hub projection
  - non-admin bearer token is rejected.
- [ ] Run:

```bash
npx tsx --test tests/cloud-source-sync.test.ts tests/source-content-policy.test.ts
```

### Task 8: Runner Reuse for Cloud Jobs

**Files:**

- Modify: `scripts/builder-agent-runner.sh`
- Create: `scripts/followbrief-cloud-fetch-runner.sh`
- Create: `skills/builder-blog-digest/jobs/cloud-library-cron.md`
- Modify: `src/app/api/skill/files/[file]/route.ts`
- Modify: `tests/agent-job-runs.test.ts`
- Create/modify: `tests/cloud-source-cli-contract.test.ts`

- [ ] Factor `run_library_job()` into a parameterized function:
  - fetch command: `fetch-personal` or `fetch-cloud-library`
  - sync command: `sync-builders` or `sync-cloud-builders`
  - result basename: `library-fetch-result.json` or `cloud-fetch-result.json`
  - job label for logs.
- [ ] Keep worker execution unchanged:
  - discovery expansion
  - `shard-tasks`
  - existing `library-worker.md`
  - `merge-task-results`
  - checkpoint sync
  - final sync.
- [ ] Add lease heartbeat support for cloud runs:
  - extend active queue leases while a shard is still running
  - use estimated duration to choose initial TTL
  - expire stale leases only when heartbeat is absent.
- [ ] Prevent concurrent cloud fetches for the same canonical source:
  - the lease endpoint should not lease another language-owner task with the same `Builder.canonicalKey` while one is active
  - respect `canonicalCooldownMinutes` after a recent run for that canonical key.
- [ ] Add `cloud-library-cron` to runner accepted job names.
- [ ] For `cloud-library-cron`, set:
  - `BUILDER_BLOG_RUN_SOURCE=cloud`
  - `BUILDER_BLOG_FETCH_LIMIT` still controls per-source post limit
  - `BUILDER_BLOG_CLOUD_FETCH_LIMIT` controls number of leased cloud source tasks.
- [ ] Add `scripts/followbrief-cloud-fetch-runner.sh`.
- [ ] Add `cloud-library-cron.md` with exact setup/run instructions for an admin local agent.
- [ ] Add `/api/skill/files` mapping for the new prompt and runner script if needed.
- [ ] Tests assert:
  - runner knows `cloud-library-cron`
  - cloud job uses `fetch-cloud-library`
  - cloud job uses `sync-cloud-builders`
  - cloud job still uses `library-worker.md`.
  - cloud job heartbeats active leases
  - canonical source cooldown prevents duplicate concurrent fetches across languages.
- [ ] Run:

```bash
npx tsx --test tests/agent-job-runs.test.ts tests/cloud-source-cli-contract.test.ts
```

### Task 9: Fetch Sources Dialog UI

**Files:**

- Modify: `src/components/SkillPromptActions.tsx`
- Modify: `tests/user-journeys.test.ts`
- Modify: `tests/performance-ux.test.ts`
- Create: `tests/cloud-source-ui.test.ts`

- [ ] Add `RuntimeType = "cloud" | "local"`.
- [ ] In the library dialog, render the first field as `Runtime type` with options:
  - `Cloud`
  - `Your Local Agent`.
- [ ] For cloud mode:
  - frequency options only `Every day` and `Every week`
  - no Local Agent runtime select
  - no parallel tasks field
  - no lookback window
  - no re-fetch existing posts checkbox
  - keep Summary language
  - lower-right primary button says `Submit`
  - submit does not require an access key.
- [ ] For local mode:
  - preserve current behavior and copy prompt flow
  - access key requirement remains.
- [ ] Refactor token gating:
  - opening the dialog must not require a token
  - local-agent confirmation still requires token before copy/token picker.
- [ ] On cloud submit:
  - persist summary language
  - POST `/api/cloud-library/source-submissions`
  - show submitted source/task counts
  - close dialog only after success.
- [ ] Tests assert:
  - runtime type appears before frequency
  - cloud mode only shows day/week
  - cloud mode hides parallel/runtime/lookback/force
  - button text is Submit
  - no access key is required for cloud submit
  - local mode still copies prompt and includes `parallel`.
- [ ] Run:

```bash
npx tsx --test tests/cloud-source-ui.test.ts tests/user-journeys.test.ts tests/performance-ux.test.ts
```

### Task 10: Shared Post Reuse Across Language Libraries

**Files:**

- Modify: `src/app/api/skill/shared-post-reuse/route.ts`
- Modify: `scripts/builder-digest.mjs`
- Modify: `tests/shared-post-reuse.test.ts`

- [ ] Reuse existing `FeedItem` matching, but include language cloud-owner libraries as reusable sources.
- [ ] Prefer exact language matches from the cloud owner for the requested `summaryLanguage`.
- [ ] If another language owner has a summary for the same canonical post:
  - return enough metadata for the normal summarize step to translate the existing summary into the requested language.
  - do not expose a new outer task/status in logs; fetch-log display should still read as the existing read/summarize/sync flow.
  - do not require/fetch body.
- [ ] If a matching cloud `FeedItem` has body reusable under storage policy:
  - return body as reusable body.
- [ ] If a cloud `FeedItem` does not store body because policy forbids durable raw storage:
  - do not synthesize body from summary.
- [ ] Tests cover:
  - matching-language cloud summary copied
  - mismatched-language cloud summary uses the normal summarize step with an internal translate-only strategy
  - no-body cloud post is valid for summary reuse
  - existing Hub `FeedItem` fallback still works.
- [ ] Run:

```bash
npx tsx --test tests/shared-post-reuse.test.ts
```

### Task 11: Hub and Candidate Source Projection

**Files:**

- Modify: `src/lib/library-hub.ts`
- Modify: `src/lib/source-candidate-library.ts`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/components/LibraryHubImportForm.tsx`
- Modify: `tests/library-hub-tabs.test.ts`
- Modify: `tests/performance-ux.test.ts`

- [ ] Make each `CloudLanguageLibrary` appear on Hub as its own source library.
- [ ] Keep current admin-owned manually seeded sources available during migration by copying them into the default language owner.
- [ ] Ensure existing import/remove behavior still operates through `LibraryHubEntry` / `LibraryHubItem`.
- [ ] Ensure source candidate list includes cloud successful sources after the next success and dedupes by `Builder.canonicalKey`.
- [ ] Tests assert:
  - cloud language libraries appear on Hub as source libraries
  - importing one still creates `BuilderPoolEntry` rows with `HUB_IMPORT`
  - candidate list receives cloud successful sources once across languages
  - existing user private library sharing still works.
- [ ] Run:

```bash
npx tsx --test tests/library-hub-tabs.test.ts tests/performance-ux.test.ts
```

### Task 12: Backfill and Rollout Script

**Files:**

- Create: `scripts/backfill-cloud-language-library-from-admin-library.mts`
- Create: `tests/cloud-source-library.test.ts`

- [ ] Read the current featured/admin community source library.
- [ ] Resolve a target default language owner, initially `zh` unless configured otherwise.
- [ ] Copy each admin `Builder` into that language owner with existing `upsertBuilder()`.
- [ ] Create/update `CloudSourceTask` rows for copied builders only when configured by admin flag:
  - `--language zh`
  - `--frequency week`.
- [ ] Do not create `CloudSourceSubmission` rows for platform-owned seed sources.
- [ ] Print dry-run summary unless `--apply` is passed.
- [ ] Run against production only after schema migration and local dry run.

### Task 13: End-to-End Verification

**Files:** no new files beyond earlier tasks.

- [ ] Run focused tests:

```bash
npx tsx --test \
  tests/cloud-source-schema.test.ts \
  tests/cloud-source-library.test.ts \
  tests/cloud-source-scheduler.test.ts \
  tests/cloud-source-sync.test.ts \
  tests/cloud-source-ui.test.ts \
  tests/cloud-source-cli-contract.test.ts \
  tests/shared-post-reuse.test.ts \
  tests/agent-job-runs.test.ts
```

- [ ] Run existing broad tests likely affected:

```bash
npx tsx --test \
  tests/user-journeys.test.ts \
  tests/performance-ux.test.ts \
  tests/builder-digest-cli.test.ts \
  tests/library-hub-tabs.test.ts \
  tests/source-content-policy.test.ts
```

- [ ] Run lint:

```bash
npx eslint \
  src/components/SkillPromptActions.tsx \
  src/components/AdminCloudFetchConfigForm.tsx \
  src/app/api/cloud-library/source-submissions/route.ts \
  src/app/api/admin/cloud-fetch/config/route.ts \
  src/app/api/admin/cloud-fetch/language-libraries/route.ts \
  src/app/api/admin/cloud-fetch/queue/route.ts \
  src/app/api/admin/cloud-fetch/lease/route.ts \
  src/app/api/admin/cloud-fetch/sync/route.ts \
  src/lib/cloud-source-contracts.ts \
  src/lib/cloud-source-library.ts \
  src/lib/cloud-source-scheduler.ts \
  src/lib/cloud-source-sync.ts
```

- [ ] Run full build:

```bash
npm run build
```

- [ ] Manual smoke:
  - Log in as a non-admin with private sources.
  - Open Sources -> Source syncing -> Fetch sources dialog.
  - Select `Runtime type = Cloud`, frequency `Every day`, language `Chinese`, submit.
  - Confirm `CloudSourceSubmission` rows point to Builders owned by the Chinese cloud owner.
  - Confirm `CloudSourceTask` rows point to those same cloud-owner Builders.
  - Run one admin cloud fetch:

```bash
BUILDER_BLOG_ACCOUNT="jie@worldstatelabs.com" \
BUILDER_BLOG_AGENT_RUNTIME="codex" \
BUILDER_BLOG_CLOUD_FETCH_LIMIT="2" \
scripts/followbrief-cloud-fetch-runner.sh
```

  - Confirm synced posts are ordinary `FeedItem` rows under the language owner.
  - Confirm successful source was added/updated once in `SourceCandidate`.
  - Confirm Hub source library for that language includes the source.
  - Confirm a future local user fetch can reuse cloud summary/body via `/api/skill/shared-post-reuse`.

## Completion Checklist Against User Requirements

- Requirement 1: Fetch sources dialog includes first option `Runtime type`; cloud mode only day/week; hides parallel tasks; primary button says Submit.
- Requirement 2: User submit endpoint writes to the requested language cloud library; each language is a different owner; same URL across languages is multiple ordinary Builder ids.
- Requirement 3: Admin script periodically polls FollowBrief, leases a batch of cloud source tasks, reuses current fetch/summarize/sync mechanics, uses admin auth, and syncs back into language-owner `Builder` / `FeedItem` rows.
- Requirement 4: Queue allocation uses task state, prior run results, deadlines, retry backoff, and admin-configured X tasks/hour.
- Requirement 5: Successful cloud source fetch upserts into source candidate library with language-neutral de-dupe; each language cloud owner has its own shared Hub source library.

## Implementation Audit - 2026-06-27

Code-level implementation is complete through Task 13, with one operational smoke gap that requires a real authenticated account and configured production-like cloud language owner.

Verified:

```bash
npx prisma validate
sh -n scripts/builder-agent-runner.sh scripts/followbrief-cloud-fetch-runner.sh
git diff --check
npm run lint
npm test  # 431 tests
DATABASE_URL=postgresql://user:pass@localhost:5432/builder_blog npm run build
```

Additional focused lint was run on the touched cloud-source, builder sync, i18n, UI, and test files. Full repository lint now passes; the pre-existing Storybook hook-shape and `RelativeTime` effect lint findings were fixed with narrow behavior-preserving edits.

A read-only operational readiness check was added:

```bash
npx tsx scripts/check-cloud-source-fetch-readiness.mts --language zh
```

It is linked from `skills/builder-blog-digest/jobs/cloud-library-cron.md` and verified by `tests/cloud-source-cli-contract.test.ts` to check migration/table/index/language-owner/admin prerequisites without write APIs. Running it against the available Neon env from `/Users/jie/code/builder_blog/.env*` now reports `ready`.

A rollback-only DB smoke was also added:

```bash
npx tsx scripts/smoke-cloud-source-fetch-rollback.mts --language zh
```

It is linked from `skills/builder-blog-digest/jobs/cloud-library-cron.md` and verified by `tests/cloud-source-cli-contract.test.ts`. Once readiness reports `ready`, this smoke runs the real DB-backed chain inside a transaction and intentionally rolls back after verifying private source submission, language-owner builder copy, cloud task lease, FeedItem sync, run-task success accounting, SourceCandidate projection, and Hub library item projection. Against the current Neon env it passes with `status: "ok"` and `rolledBack: true`.

Operational setup performed against the available Neon env:

- Applied migration `000080_cloud_source_fetch`; `npx prisma migrate status` reports the database schema is up to date.
- Created/configured `cloud-zh@worldstatelabs.com` as the `zh` cloud language owner.
- Synced the `zh` cloud source library Hub entry.
- Backfilled 17 featured community source-library sources into the `zh` cloud owner without creating CloudSourceSubmission or CloudSourceTask rows.

Not verified locally:

- Manual browser smoke with a real non-admin account submitting private sources to Cloud.
- Production/admin cloud fetch runner against real configured cloud owners.

## Risk Notes

- The language-owner design depends on configured owner users existing for every supported summary language.
- Hub will contain one cloud source library per language. If product wants one combined display later, implement that as presentation grouping by `Builder.canonicalKey` / `Builder.entityId`, not as a storage change.
- Do not add language suffixes to source canonical keys. Owner separation already solves uniqueness while preserving existing canonical source identity.
- Do not add `CloudPostSummary` in v1. Existing `FeedItem.summary` is correct because each language uses a different `Builder`.
- The runner refactor should be kept mechanical. Worker prompts should not learn new cloud status labels; cloud metadata should live in task fields and sync endpoints.
- Cloud submit should not require a Local Agent access key. Current `SkillPromptActions` gates before opening the dialog, so that must move to the local-agent confirmation path.
