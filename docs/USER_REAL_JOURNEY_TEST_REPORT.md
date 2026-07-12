# FollowBrief Real User Journey Test Report

Run date: 2026-07-11
Status: Complete, with explicit non-live coverage limits
Plan: `docs/USER_REAL_JOURNEY_TEST_PLAN.md`

## Executive result

The release-critical user path works end to end:

1. A disposable user added and edited sources.
2. The UI generated a one-time Local Agent fetch instruction.
3. A real Codex run fetched and synced six posts from two sources.
4. Following, Favorites, read state, post detail, and search reflected those rows.
5. The UI generated a one-time AI Brief instruction.
6. A real Codex run built and synced a six-item cited Brief.
7. Cloud submit, deadline, status, and stop were verified in the UI and database.
8. Export produced a scoped, secret-free JSON file.
9. Account deletion removed all owned data and invalidated the browser session.
10. Admin candidate libraries and Cloud libraries were inspected with a temporary admin session.

Twelve defects were found and fixed. The final automated suite, typecheck, and
production build pass. Repository-wide lint still fails on pre-existing generated
and unrelated files; all files changed by this run pass targeted lint.

## Environment and baseline

- App: local worktree on `127.0.0.1:3100`, configured Neon database.
- Database baseline: 11 users, 211 builders, 313 pool entries, 173 subscriptions,
  300 feed items, 44 Cloud submissions, 38 Cloud tasks, and 17 Cloud queue rows.
- Production public health: `/`, `/privacy`, and `/terms` each returned HTTP 200.
- Browser sizes exercised: desktop, 390x844 mobile, and normal in-app viewport.
- Test data used unique `codex-e2e-*` accounts and an isolated agent directory at
  `/tmp/followbrief-e2e-agent`.

## Journey evidence

### Public, authentication, and responsive UI

- Landing, login, privacy, terms, workspace 404, empty dashboard, Sources, source
  detail, and dialogs were inspected on desktop and mobile.
- Product identity, CTA, legal links, locale controls, mobile bottom navigation,
  and protected-route behavior were present and usable.
- Legal pages displayed `legal@worldstatelabs.com` and remained readable on mobile.
- External OAuth provider callbacks were not completed because that would require
  third-party account interaction. Authenticated journeys used isolated database
  sessions; anonymous and role boundaries were still exercised.

### Source lifecycle

- Added GitHub Blog and a custom NASA feed. Builder, entity, pool, subscription,
  and backup-candidate behavior were checked at database boundaries.
- Duplicate and invalid add paths returned 409/400 without duplicate writes.
- Edit, identity-sensitive clear confirmation, follow/unfollow, source detail,
  and personal source cleanup were exercised.
- A custom source now keeps the user's display name instead of being overwritten
  by probe enrichment.
- Sources page local load improved from roughly 42 seconds to 9.4 seconds after
  removing avoidable enrichment work. Remote Neon latency remains visible.

### Local Agent fetch chain

- The copied instruction bootstrapped into an isolated agent directory.
- Exchange code was single-use; the second exchange was rejected.
- The account token file was created only under the isolated directory with mode 0600.
- Real run IDs: fetch run `cmrgnputq01sf4ki5khg9r3pj`; agent job
  `cmrgnpces01se4ki5leu1g4tv`.
- Two sources produced six planned tasks and six synced FeedItems, three per source.
- Checkpoint sync was observed before the full worker process ended.
- Final job state: succeeded, exit 0, model `gpt-5.4-mini`, 295,542 tokens,
  estimated cost $0.1534.
- UI moved from running to `6/6 synced`; Following showed all six posts in
  most-recent order.

### Cloud fetch chain

- Submitted two owned sources at Daily / English.
- Both user deadlines were exactly 24 hours after submission.
- UI immediately showed 2 submitted, 0 on time, and WAITING rows.
- Stop Fetching disabled the inactive Local Agent choice, selected FollowBrief,
  and described server-side deactivation without requiring a copied stop prompt.
- Stop deactivated both submissions and paused/cancelled their Cloud work.
- Internal Cloud task tombstones remained for history, but the admin snapshot
  omitted every task with zero active submitters.
- Transactional smoke passed submit -> task -> lease -> sync -> SourceCandidate /
  Hub update, then rolled all marker data back.
- Current admin state showed no zero-submitter source rows. `ACTIVE` rows all had
  active submitters. The user Cloud log owns the `On time sources` statistic;
  the admin Cloud library uses fetch state, frequency, submitters, and post count.

### Feed, search, and AI Brief

- Following defaulted to Most recent.
- Favorite and read actions persisted as one FeedFavorite and one FeedRead row.
- Post detail preserved return context, original link, source, summary, and body.
- Search for `ECF 2025 Awards` kept the typed query, returned the exact post first,
  and no longer let the suggestion layer cover or hijack the Search button.
- Autocomplete now uses exact recall while the result page retains hybrid search.
- Real Brief run `cmrgpt5am033j4ki5gsejdsep` prepared six candidates, included all
  six, and synced digest `cmrgpxi9j033k4ki5031l1z20`.
- Final Brief job succeeded with `gpt-5.4-mini`, 247,774 tokens, and estimated
  cost $0.1403. UI rendered Brief #1 with two source sections, headlines, cited
  post links, and six post summaries.

### Settings, export, deletion, and admin

- Settings showed the real connected Local Agent access key and machine identity.
- Export downloaded JSON with 2 subscriptions, 2 source libraries, 1 favorite,
  1 read, 1 Brief, 1 Brief run, 2 agent jobs, and 1 fetch run.
- Exported token/session objects omitted token values and OAuth secrets.
- Delete required typing `DELETE`. The original implementation deleted Session
  rows and then called NextAuth sign-out, which tried to delete the same row again.
  The fixed path expires auth cookies in the delete response and redirects directly.
- After deletion, User, Session, AgentToken, Subscription, Digest, DigestRun,
  AgentJobRun, LibraryFetchRun, FeedFavorite, FeedRead, owned Builders, and owned
  FeedItems all counted zero.
- Chinese Settings was rerun after the i18n fix: Account data rendered in Chinese
  with zero hydration errors.
- Admin Settings exposed 146 primary candidates and 0 backup candidates. The
  backup tab and empty state worked.
- Admin Cloud management showed three language libraries. English had zero
  sources; all visible sources in the other libraries had at least one submitter.

## Coverage disposition

| Plan area | Disposition |
| --- | --- |
| A01-A07 | Live except third-party OAuth callback completion; auth and admin boundaries otherwise verified |
| B01-B04 | Live UI/navigation plus route contracts |
| C01-C08 | Live source lifecycle; Hub import edge variants covered by automated contracts |
| C09 | Picker/server limit covered by contracts; a 21-source live account was not retained |
| D01-D07 | Real Local Agent fetch, runtime, DB, and UI evidence |
| D08-D12 | Scheduler/ownership/stop/macOS/Linux contracts and tests; no persistent host cron was installed during this run |
| E01, E09, E11, E14, E15 | Live submit/deadline/stop/admin and transactional DB smoke |
| E02-E08, E10, E12-E13 | Automated queue, ownership, lease, heartbeat, retry, and orphan contracts; destructive shared queue scenarios were not run against live data |
| F01-F04, F07 | Live feed/search/Brief and UI states |
| F05-F06 | Regenerate/import/share contracts; no public Hub artifact was left behind |
| G01-G07 | Live settings/export/delete/i18n plus automated validation and responsive checks |
| G08 | Production public pages HTTP 200; authenticated production mutation was not performed |

## Defects fixed

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| JRN-001 | Medium | Optional Cloud `builderIds` was emitted as explicit `undefined`. | Preserve true optional shape. |
| JRN-002 | High | Cloud rollback smoke missed headline and could lease unrelated shared work. | Add required headline and lease the exact marker task. |
| JRN-003 | Low | Shared-summary test expected removed `summarizing` label. | Align assertion to queued semantics. |
| JRN-004 | High | Sources page performed avoidable global enrichment and took about 42s. | Narrow and reuse pool/enrichment data. |
| JRN-005 | Medium | Probe enrichment overwrote a user's custom source name. | Prefer channel Builder name at display boundaries. |
| JRN-006 | High | CLI account/config paths ignored `BUILDER_BLOG_AGENT_DIR`. | Resolve accounts and sources dynamically from the isolated agent directory. |
| JRN-007 | High | Fetch logs reported the configured model, duplicated encoded task IDs, showed 6/7, and retained a syncing terminal stage. | Record actual runtime model, canonicalize IDs, compact progress, and finalize completed stage. |
| JRN-008 | High | Search suggestions covered the submit controls and could replace the submitted query. | Put page suggestions in document flow and use exact autocomplete recall. |
| JRN-009 | High | Account deletion double-deleted Session and could leave the browser loading `/dashboard`. | Expire session cookies in the delete response and replace location directly. |
| JRN-010 | Medium | DOM translation raced hydration in Account data under Suspense. | Render this client component from locale-aware React text and add missing status translations. |
| JRN-011 | Medium | One-time Brief computed its temp slug before the account was available, using `default_*`. | Bake account into `ACCT` before slug and runner environment construction. |
| JRN-012 | Low | Several static tests still asserted superseded paths/timestamps/DOM details. | Update contracts to the corrected semantics. |

## Operational observations

- Admin Cloud monitor showed one source delivery still running without a worker
  heartbeat. The UI surfaces the contradiction clearly; this run did not mutate
  shared operational history.
- Postgres emitted the upcoming `sslmode=require` compatibility warning. Pin
  `sslmode=verify-full` before the next pg major upgrade to preserve current checks.
- Local Codex emitted plugin/config warnings, but both real runs completed and
  reported terminal usage and cost.
- The full lint baseline includes generated `ds-bundle` files and an unrelated
  `PromoVideo` hooks error. This prevents repository-wide lint from being green.

## Verification

- `npm test`: 629 passed, 0 failed.
- `npx tsc --noEmit --pretty false`: passed.
- Targeted ESLint for every changed TypeScript/TSX test and source file: passed.
- `npm run build`: passed; 46 static pages generated and all dynamic routes traced.
- `npm run lint`: failed on the pre-existing repository baseline (418 errors,
  primarily generated `ds-bundle` plus existing `PromoVideo`).
- `git diff --check`: passed.

## Visual evidence

- `/tmp/followbrief-A01-landing-desktop.png`
- `/tmp/followbrief-A01-landing-mobile.png`
- `/tmp/followbrief-A02-login-desktop.png`
- `/tmp/followbrief-A02-login-mobile.png`
- `/tmp/followbrief-A03-privacy-desktop.png`
- `/tmp/followbrief-A03-terms-desktop.png`
- `/tmp/followbrief-A03-terms-mobile.png`
- `/tmp/followbrief-A07-404-mobile.png`
- `/tmp/followbrief-B01-new-user-dashboard-mobile.png`
- `/tmp/followbrief-B01-sources-mobile.png`
- `/tmp/followbrief-C01-add-source-form.png`
- `/tmp/followbrief-C04-edit-source-dialog.png`
- `/tmp/followbrief-D04-local-fetch-running.png`

## Cleanup

- All disposable normal, deletion-verification, i18n-verification, and admin users
  were removed with zero remaining Session rows.
- Test-owned Builders, FeedItems, subscriptions, fetch/Brief logs, favorites,
  reads, Cloud submissions, and the NASA backup candidate were removed.
- Shared Cloud history and canonical production-like data were not modified.
