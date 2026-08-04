# User-Scoped Generated Data Reset Design

## Context

The Settings page currently exposes an `Admin maintenance` panel only to an
administrator. Its route calls a global reset helper that deletes generated
fetch, Cloud fetch, and AI Brief state for every account. The screenshot that
motivated this change shows the consequence directly: one click reset 139
sources across 12 users.

This is the wrong ownership boundary for an account settings action. A user
should be able to clear generated data for their own account without requiring
administrator access and without changing another account or shared Cloud
library state.

The current global reset fence is another important part of the problem. Merely
adding `userId` filters to deletes would allow a fetch or Brief job that started
before the reset to write the deleted data back afterward. Advancing the one
global fence for a personal reset would stop that stale job, but it would also
interrupt every other user and the shared Cloud worker. The fence therefore
needs the same ownership boundary as the data.

## Goals

- Show the reset option to every authenticated user.
- Reset only generated data owned by the authenticated user.
- Preserve accounts, sources, subscriptions, schedules, agent tokens, reads,
  favorites, settings, imports, and Hub sharing records.
- Preserve all shared Cloud library posts, source tasks, queues, runs, and Cloud
  worker records.
- Prevent a personal fetch or Brief job that started before the reset from
  recreating cleared state.
- Ensure one user's reset does not fence, delete, or modify another user's work.
- Remove the global, admin-facing web reset and remove the unsafe all-users
  behavior from the maintenance script.

## Non-goals

- Resetting the shared Cloud library or its scheduler.
- Deleting a user's account, source library, subscriptions, or local schedules.
- Revoking agent tokens or stopping future scheduled jobs.
- Clearing reads, favorites, recommendations, preferences, imports, or Hub
  sharing.
- Adding a database model or migration solely for personal reset fences.

## Ownership Rules

| State | Personal reset action |
| --- | --- |
| `FeedItem` rows attached to a `Builder` whose `ownerUserId` is the user | Delete |
| Personal `Builder` fetch counters/status | Reset |
| `LibraryFetchRun` where `userId` is the user | Delete |
| `Digest`, `DigestRun`, and `DigestedItem` where `userId` is the user | Delete |
| `AgentJobRun` where `userId` is the user and job type is `library-fetch` or `digest-build` | Delete |
| Personal sources, subscriptions, cron jobs, tokens, reads, favorites, settings, imports, Hub records | Keep |
| Shared Cloud builders and `FeedItem` rows | Keep |
| `CloudSourceSubmission` rows | Keep |
| `CloudSourceTask`, `CloudFetchQueueItem`, `CloudFetchRun`, and `CloudFetchRunTask` | Keep |
| `cloud-library-fetch` Agent job records | Keep |

Deleting a personal `FeedItem` must not delete reads or favorites. Existing
foreign keys already preserve those records by setting their optional
`feedItemId` provenance to null.

## UI Design

Rename `AdminMaintenancePanel` to `GeneratedDataResetPanel` and render it for
every authenticated Settings user, next to Account Data.

Use the following user-facing language through the existing translation
pipeline:

- Heading: `Generated data`
- Description: `Delete posts, fetch logs, AI Briefs, brief logs, and personal Agent run records generated for your account. Sources, subscriptions, schedules, reads, and favorites are kept.`
- Button: `Reset fetch and AI Brief data`
- Dialog heading: `Reset your generated data?`
- Dialog body: `This deletes generated posts, fetch logs, AI Briefs, brief logs, inclusion markers, and personal Agent run records for your account only. Sources, subscriptions, schedules, reads, and favorites are kept. Type RESET to continue.`

The existing typed `RESET` confirmation remains. On success, dispatch
`contentSyncStateChanged` so current client-owned content refreshes immediately.
The success message must contain only current-user counts, for example:

`Reset 8 sources. Deleted 21 posts, 2 briefs, and 5 logs.`

It must not mention a user count or shared Cloud work records.

## API Design

Replace the admin endpoint with:

`POST /api/account/generated-data/reset`

The handler must:

1. require an authenticated session;
2. obtain the target `userId` only from `session.user.id`;
3. reject any confirmation other than the exact trimmed value `RESET`;
4. call `resetUserFetchDigestState(session.user.id)`;
5. never accept a `userId`, email, owner ID, or scope from the request body;
6. return a user-scoped summary;
7. return generic errors without exposing database details.

The route module should contain only supported Next.js route exports. Put the
dependency-injectable handler factory in a library module so authentication,
confirmation, and session-derived scope receive behavior-level tests.

Delete the old `/api/admin/maintenance/fetch-digest-reset` route. It must no
longer provide an all-users web action, even to administrators.

## Reset Helper

Replace the global web helper with:

```ts
resetUserFetchDigestState(userId: string, client: PrismaClient = prisma)
```

All deletes and updates must be scoped explicitly:

- `feedItem.deleteMany({ where: { builder: { ownerUserId: userId } } })`
- `builder.updateMany({ where: { ownerUserId: userId }, ... })`
- run, digest, marker, and personal Agent job deletes use `where.userId`
- Agent job deletion also limits `jobType` to `library-fetch` and
  `digest-build`

The helper must not query, delete, or update Cloud source, queue, run, or task
tables. It must not count all users. Its summary contains only personal counts
and the reset timestamp.

## User-Scoped Reset Fence

Continue using the existing `ResetFence` table, whose string primary key can
represent multiple scopes. Keep the existing `global` row for shared Cloud
operations and introduce lazily initialized rows named `user:<userId>`.

Add a small scope helper so callers never construct fence IDs ad hoc. Fence
acquisition must ensure the requested row exists with an epoch timestamp, then
lock that row:

- personal reset: exclusive `FOR UPDATE` lock on `user:<userId>`;
- personal worker create/update: shared `FOR SHARE` lock on `user:<userId>`;
- shared Cloud scheduler, plan, lease, sync, and Cloud library reset: continue
  using the `global` row.

Personal routes that create or mutate generated fetch/Brief state must pass the
authenticated user's fence scope:

- Agent job runs for `library-fetch` and `digest-build`;
- library fetch run create and patch;
- personal builder/feed-item sync;
- AI Brief context preparation and digest sync.

The generic Agent job route must choose the fence by job type. A
`cloud-library-fetch` job continues to use the global fence and is not deleted
by personal reset. This prevents a normal user's reset from interrupting the
shared Cloud worker.

The existing lock ordering remains the concurrency guarantee:

- if a worker transaction wins the shared lock first, reset waits and then
  deletes its writes;
- if reset wins the exclusive lock first, the old worker later observes the
  newer timestamp and receives the non-retryable reset-fenced response;
- new jobs created after reset use a database timestamp newer than the personal
  fence and proceed normally.

Update the stale-worker message to say `latest reset` rather than `latest global
reset` because both personal and global scopes are now valid.

## Maintenance Script

Remove the all-users behavior from `scripts/clear-fetch-digest-state.mts`.
Replace it with a user-scoped script that requires exactly one explicit target,
such as `--user-id` or `--email`, resolves it to one user, and calls the same
user-scoped helper. Missing, ambiguous, or unknown targets must fail without
performing a reset.

## Error Handling and Security

- Unauthenticated requests return `401`.
- Invalid confirmation returns `400`.
- Reset failures return `500` and do not expose internal details.
- The transaction is atomic and retains the existing bounded transaction
  timeout.
- Request bodies cannot choose the target user.
- Every destructive query has a user ownership predicate.
- Shared Cloud tables are absent from the personal helper by construction.

## Testing Strategy

Use test-driven development and observe each new regression fail before changing
production code.

Behavior-level tests must prove:

1. every authenticated user sees `GeneratedDataResetPanel`;
2. the old admin-only rendering and old admin endpoint are gone;
3. the route uses the session user, ignores/rejects caller attempts to select a
   target, validates `RESET`, and reports failures safely;
4. reset helper calls include the expected `userId`/`ownerUserId` predicates;
5. the helper does not touch shared Cloud tables or `cloud-library-fetch` jobs;
6. user A reset leaves representative user B rows untouched;
7. personal fence IDs are stable, initialized safely, and independent;
8. a stale personal worker is rejected only by its own user's fence;
9. Cloud workers continue to use the global fence;
10. active personal fetch/Brief routes consistently use the personal fence;
11. success summaries have personal counts only;
12. the replacement script refuses to run without one explicit user.

Run focused reset, route, Settings, agent job, fetch, digest, and compliance
tests; then run lint, TypeScript, the full test suite, and a production build.

## Acceptance Criteria

- A non-admin user can open Settings and use the reset control.
- The action deletes only that authenticated user's generated personal fetch and
  AI Brief state.
- Another user's generated state is unchanged.
- Shared Cloud library state and Cloud workers are unchanged.
- Sources, subscriptions, schedules, tokens, reads, and favorites are unchanged.
- A personal job started before reset cannot recreate cleared state.
- A job for another user or the global Cloud worker is not fenced.
- No web or script path can accidentally reset every user.
