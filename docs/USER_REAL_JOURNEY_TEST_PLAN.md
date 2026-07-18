# FollowBrief Real User Journey Test Plan

## Objective

Validate FollowBrief as users and operators experience it, not only as isolated
functions. Every journey must gather evidence from all applicable layers:

1. Browser behavior and responsive UI screenshots.
2. HTTP requests, responses, redirects, and authorization boundaries.
3. Server-side state transitions and runtime logs.
4. Database rows and invariants before and after the action.
5. Cleanup or transaction rollback proving the test did not leave accidental data.

The fetch chain is release-critical and may not be skipped.

## Actors and environments

| Actor | Purpose |
| --- | --- |
| Anonymous visitor | Landing, login, legal pages, redirects, localization, responsive layout |
| New authenticated user | Empty states, default imports/token, source onboarding, settings |
| Established authenticated user | Feed, Following, search, favorites/read state, Brief history |
| Local Agent | Exchange code, context, one-time fetch, recurring schedule, sync, stop |
| Cloud submitter | Cloud source selection, deadline, overwrite, stop, user fetch log |
| Cloud worker/admin | Queue, lease, heartbeat, sync, reset, config, library membership, live logs |
| Account owner | Export and delete against a disposable test account |

Primary runtime is the current local worktree against the configured Neon
database, using a uniquely named disposable account. Public and deployment-only
checks also run against `https://builder-blog.worldstatelabs.com`.

## Evidence standard

Each case records:

- `UI`: desktop 1440x900 and mobile 390x844 screenshots when visual.
- `HTTP`: status, redirect target, relevant response fields, and failed requests.
- `DB`: exact model counts/keys changed, ownership scope, and terminal state.
- `Runtime`: CLI/server log stage and failure reason where a worker is involved.
- `Cleanup`: deleted test account/data or verified transaction rollback.

A case is not passed when only a source-code regex test is green.

## Journey matrix

### A. Public, authentication, and access control

| ID | Journey | Required assertions |
| --- | --- | --- |
| A01 | Landing desktop/mobile | Product identity is first-viewport; CTA, locale, theme, no overlap/overflow |
| A02 | Login desktop/mobile | Google/GitHub/Apple actions visible and usable; legal links; no clipped controls |
| A03 | Terms and Privacy | Public 200, navigation works, legal contact correct, readable responsive typography |
| A04 | Anonymous workspace access | Workspace pages redirect to `/login`; protected API returns 401/redirect, never data |
| A05 | Authenticated landing/login | Existing session redirects to `/dashboard` |
| A06 | Role boundary | Normal user cannot open admin Cloud page or admin APIs; admin can |
| A07 | Unknown routes | Public and workspace 404 are coherent and navigable |

### B. New-user and workspace navigation

| ID | Journey | Required assertions |
| --- | --- | --- |
| B01 | First dashboard | Stable empty state, no server error, default tabs/navigation present |
| B02 | Mobile navigation | Bottom navigation, header actions, safe-area spacing, no horizontal overflow |
| B03 | Locale and theme | Locale persists; theme persists; controls remain legible in both themes |
| B04 | Redirect aliases | `/history`, `/recommendations`, recommendation item, X builder alias resolve correctly |

### C. Source library lifecycle

| ID | Journey | Required assertions |
| --- | --- | --- |
| C01 | Add supported source | Probe succeeds; Builder/Entity/Pool/Subscription created once; candidate backup dedupes |
| C02 | Invalid/private URL | Validation and SSRF guard reject safely; no DB row created |
| C03 | Duplicate add | Idempotent result; no duplicate Builder/Pool/Subscription |
| C04 | Edit source | User-editable identity updates; fetched posts clear only when identity changed |
| C05 | Follow/unfollow | Subscription changes, UI count/state refreshes, no other user's row changes |
| C06 | Source detail/posts | Correct entity/channel resolution, deduped posts, external source links |
| C07 | Remove personal source | Personal builder/posts removed, preferences rebound, unrelated sources retained |
| C08 | Import/remove Hub library | Reachability, pool origin, hidden state, import count, re-import behavior |
| C09 | More than 30 sources | Cloud submit picker scrolls, selects at most 30, server rejects forged oversized IDs |

### D. Local Agent fetch chain (mandatory)

| ID | Journey | Required assertions |
| --- | --- | --- |
| D01 | Access key creation/revocation | Plain token shown once; encrypted/hash DB fields; revoked token rejected |
| D02 | Exchange code | Single use, expiry, uniform invalid response, token/machine identity attached |
| D03 | One-time prompt | Correct runtime/days/parallel/language parameters and account token |
| D04 | Context planning | Only reachable user sources; imported/admin-only semantics; exact fetch task IDs |
| D05 | Agent task completion | Every planned task synced or terminal outcome with evidence; omissions rejected |
| D06 | Feed sync | Body/summary quality, dedup, raw provenance, builder fetch state, LibraryFetchRun |
| D07 | Fetch log UI | Running/partial/failed/success/action-needed map to correct rows and details |
| D08 | Recurring schedule setup | Existing local/server schedule detection, confirmation, initial run before activation |
| D09 | Ownership replacement | New owner activates only after initial success; old owner self-removes on guard check |
| D10 | Server stop | Web stop marks server stopped; next guard removes local schedule; UI converges |
| D11 | Failure recovery | Timeout, missing summary, short content, skipped evidence, stale run and retry behavior |
| D12 | macOS/Linux contract | launchd and systemd rendered instructions have equivalent guard/install/stop behavior |

### E. Cloud fetch chain (mandatory)

| ID | Journey | Required assertions |
| --- | --- | --- |
| E01 | Cloud submit <=30 | Submission/task/library rows created; immediate Stop UI; per-user deadline correct |
| E02 | Cloud submit >30 | Scrollable source picker; selected IDs only; ownership and limit enforced server-side |
| E03 | Shared source demand | Effective frequency is fastest active demand; shared task deadline and user deadline remain distinct |
| E04 | Queue materialization | Only ACTIVE tasks with active submitters; canonical cooldown, budget, release and urgency respected |
| E05 | Lease | Exclusive QUEUED->LEASED transition; run/task rows and fetched keys correct |
| E06 | Heartbeat | Lease extends only for matching owner/run; live worker state updates |
| E07 | Worker fetch and sync | Primary content/summary persisted; run/task/source states converge; candidate and Hub update |
| E08 | Zero-post and partial outcomes | Running zero-count is not falsely complete; skipped is terminal but not failed |
| E09 | User deadline UI | WAITING/RUNNING/ON TIME/MISSED/FAILED computed from submitter's own window |
| E10 | Overwrite/language switch | Old submissions deactivate only after new path succeeds; old tasks pause; both Hubs resync |
| E11 | Stop | Last submitter removal pauses task, cancels queue, removes active library/Hub membership |
| E12 | Orphan repair | ACTIVE + zero submitters self-heals; reset cannot reactivate orphan task |
| E13 | Lease expiry/restart | Expired lease fails/requeues consistently; run status and logs reconcile |
| E14 | Admin live UI | Worker host, queue, run progress, source submitters/posts update without contradictory status |
| E15 | Transactional smoke | Submit -> copy -> task -> lease -> sync -> candidate/Hub passes then fully rolls back |

### F. Brief, feed, search, and content state

| ID | Journey | Required assertions |
| --- | --- | --- |
| F01 | Following feed | Default most-recent ordering, pagination, entity dedup, source links |
| F02 | Read/favorite | Optimistic UI matches FeedRead/FeedFavorite; survives refresh; cross-channel identity works |
| F03 | Search | Exact, semantic, hybrid, operators, suggestions, source and post results, no cross-user leakage |
| F04 | Build Brief | Candidate age/dedup, source prompts, cited output, language, Digest/DigestedItem/DigestRun rows |
| F05 | Regenerate | Same-day replacement and marker handling; no accidental permanent exclusion |
| F06 | Brief collection/import | Own/imported collections, visibility/share/import/remove, source links and counts |
| F07 | Empty/error/loading states | Stable skeletons, retry/error copy, no layout shift or inaccessible controls |

### G. Settings, data rights, and resilience

| ID | Journey | Required assertions |
| --- | --- | --- |
| G01 | Summary language/lookback | Persisted once, reflected in fetch/Brief prompts and UI |
| G02 | Per-source prompts | User override isolation, validation, reset/default behavior |
| G03 | Account export | Auth scoped; exported categories/counts match DB and contain no other user data |
| G04 | Account delete | Disposable account and owned data removed/cascaded; shared canonical data remains valid |
| G05 | Rate limits/invalid payloads | Correct 4xx, no partial writes, no sensitive error leakage |
| G06 | Accessibility | Keyboard path, focus visibility, labels, dialog escape/cancel, touch target sizes |
| G07 | Responsive matrix | 390x844, 768x1024, 1440x900; no overlap, clipping, hidden commands, or horizontal scroll |
| G08 | Production health | Public pages and auth redirect healthy; no console errors or failed first-party requests |

## Execution order and gates

1. Baseline: migrations, build, unit/contract suite, DB counts, production health.
2. Read-only public and authorization journeys.
3. Transactional Cloud smoke and fetch invariants.
4. Create isolated browser test user/session and capture baseline DB state.
5. Execute mutable source, feed, search, settings, Local Agent, and Cloud journeys.
6. Execute destructive export/delete only against the disposable account.
7. Fix discovered defects, rerun affected cases, then rerun build and regression suite.
8. Publish an evidence report with screenshots, commands, DB deltas, defects, and gaps.

## Completion criteria

- Every matrix row is Pass, Fail with a filed/fixed defect and rerun, or Blocked with concrete external dependency evidence.
- D01-D12 and E01-E15 have server, DB, and UI evidence where applicable.
- Desktop and mobile screenshots exist for every primary page and modal workflow.
- The disposable account and its data are removed, and baseline counts reconcile.
- Production build and the complete automated suite pass after fixes.
