# Cleanup Candidates

These items were surfaced by an adversarial, **assume-used-first** audit: each candidate was treated as if it were correct/used until evidence proved otherwise. Only items that survived that confirmation step (`confirmed == true`) appear below. The `keep` verdict from the audit (skill/builders `itemResults`) is intentionally excluded — it was confirmed to be load-bearing.

**Still sanity-check before deleting or editing.** Confirmation here means the audit found supporting evidence (grep across the tree, git history, schema/route cross-reads), not that it executed the code. Re-grep on the current HEAD, run the type-checker and tests, and confirm no dynamic/string-based references before acting — especially for schema enums and exported types.

Items are ordered within each group by blast radius, safest first.

---

## Remove (8)

Dead code / unreachable values. Removing these should be inert.

1. **`src/lib/builder-entities.ts:290-292` — `SubscriptionWithBuilder` type** (dead)
   - Why: exported type with zero references anywhere.
   - Evidence: full-tree scan (excluding `node_modules`) found it only at its definition — no imports, tests, declaration files, or string/dynamic references. The sibling `BuilderEntityWithChannels` in the same file is also unused, suggesting both are legacy exports.
   - Action: delete the `SubscriptionWithBuilder` type (and review/remove `BuilderEntityWithChannels` while there).

2. **`src/lib/feed-preferences.ts` — `defaultDigestMaxPostAgeDays` constant** (dead)
   - Why: exported constant never imported or used.
   - Evidence: grep across all `.ts`/`.tsx` found zero references outside the definition. Git history: it was a fallback param in `digestMaxPostAgeDays()` (commit `2400ada`), removed in `82291b5` when the function switched to returning `null` for unset preferences. Comment confirms "The old mandatory 90-day cap is gone." No barrel/dynamic/string lookups.
   - Action: delete the constant.

3. **`prisma/schema.prisma:172` — `UserLibraryVisibility.hidden` `@default(true)`** (dead)
   - Why: the default value is unreachable; every writer sets `hidden` explicitly.
   - Evidence: both record-creating paths (`setLibraryHidden` upsert lines 65-73, `removeLibraryImportFromHub` upsert lines 239-249) always provide `hidden` in the create clause. All 5 query sites checked; none rely on the implicit default.
   - Action: drop the `@default(true)` (keep the column). Generate a migration; verify no implicit-create path is added later.

4. **`prisma/schema.prisma` — `DigestStatus.GENERATED` enum value** (dead)
   - Why: enum value never written or queried.
   - Evidence: `GENERATED` appears only in the enum definition. `SYNCED` is the only value ever written (`src/app/api/skill/digests/route.ts:73`). The `status` field is never selected in any explicit `select`, never filtered in a `where`, never updated. Both values landed together in `000001_init`; `GENERATED` has been unused since. No fixtures/seeds reference it.
   - Action: remove `GENERATED` from the enum via migration. CAUTION: this is a schema enum change — confirm no historical rows in production hold `GENERATED` before migrating.

5. **`src/lib/library-hub.ts:52-58` — `isLibraryHidden()`** (dead)
   - Why: function never called.
   - Evidence: grep found zero references outside the definition — no imports, dynamic refs, or tests. The companion visibility check in `builders/page.tsx:157-162` inlines `prisma.userLibraryVisibility.findUnique` directly. The sibling `setLibraryHidden` is used once (line 173); `isLibraryHidden` is not.
   - Action: delete the function.

6. **`src/lib/builder-keys.ts:41-51` — kind-inference function** (dead)
   - Why: defined and re-exported but never invoked.
   - Evidence: defined at `builder-keys.ts:41`, re-exported from `builders.ts` (lines 6, 17), but grep found only those 3 references (definition + 2 re-exports) and no call sites. Git history: last used by the deleted `/api/admin/builders` route (removed in `7d4ffba`). Current creation flows use `resolvePersonalBuilderInput()`, which sets `kind` via explicit per-source resolvers.
   - Action: delete the function and its two re-exports in `builders.ts`.

7. **`src/lib/digest-library.ts` — subscribed-builder-ids helper** (dead/inlinable)
   - Why: trivial 7-line function with a single caller feeding a backward-compat field nobody reads.
   - Evidence: only called from `context/route.ts:166` to populate `subscribedBuilderIds` (marked "backward-compat", line 164). The CLI (`builder-digest.mjs`) does NOT read `context.subscribedBuilderIds` — it builds its own Set from `context.subscriptions`. No skill prompts or other code reference the field. Modern code uses `subscribedEntityIds`.
   - Action: remove the function and the `subscribedBuilderIds` response field (or inline if a consumer is later found). Confirm no external/skill consumer relies on the field before dropping it from the API response.

8. **`src/lib/source-config-store.ts:71-92` — `getDigestConfig()` fallback `create()` path** (dead)
   - Why: defensive create branch that cannot trigger under normal operation.
   - Evidence: `getDigestConfig()` is called only via `getUserDigestConfig()` (line 257). The fallback create (lines 80-89) only fires if the `DigestConfig` row vanishes between `ensureSeededOnce()` and `findUnique()`. No app path deletes `digestConfig` (only `userDigestConfig` is deleted); seeding uses `createMany(..., skipDuplicates: true)` (idempotent); no migration deletes `DigestConfig`; no test exercises the path.
   - Action: remove the fallback create branch (let a missing row surface as an explicit error). Higher blast radius than the others — verify seeding ordering guarantees the row exists before removing the safety net.

---

## Fix (17)

Confirmed-wrong behavior. Ordered roughly low-to-high risk of the change itself.

1. **`src/app/(workspace)/builders/page.tsx:540-553` — `builderSort` comment** (wrong / misleading comment)
   - Why: comment claims an Add "lands somewhere immediately visible after the next refresh," but sort is kind-first.
   - Evidence: sort orders by kind (alphabetical), then `createdAt` desc, then name. Builders are grouped by kind (BLOG < PODCAST < WEBSITE < X), so a newly added builder lands at the top of its KIND group, not the top of the page. Behavior is deterministic and correct as coded; only the comment overpromises.
   - Action: rewrite the comment to describe the actual kind-grouped ordering (no code change needed).

2. **`src/lib/builder-pool.ts:53` — stale `adminCommunityLibraryHidden` comment** (outdated reference)
   - Why: comment references a field removed in a completed refactor.
   - Evidence: commit `9f311746` removed `adminCommunityLibraryHidden` from `UserFeedPreference` and replaced it with the `UserLibraryVisibility` model. The schema has no such field; this comment is its only remaining reference. The replacement model is correctly used at lines 54-60.
   - Action: update/remove the comment to reference `UserLibraryVisibility`.

3. **`src/lib/recommendations.ts:926 — `compareDates`** (wrong sort direction)
   - Why: produces oldest-first ordering, contradicting the descending primary sort and UX.
   - Evidence: `compareDates` returns `a.time - b.time`; called as `compareDates(b.item, a.item)` (line 606) it yields `b.time - a.time`, which in a JS comparator sorts older posts before newer. Conflicts with the `b.score - a.score` primary sort and the `bT - aT` newest-first pattern at line 512. Used in both "for-you" and "subscription" flows; no unit tests cover sort behavior.
   - Action: fix the comparator/call so newer posts sort first; add a unit test pinning the direction.

4. **`src/lib/search.ts:406-429 — `searchHighlightTerms`** (wrong: drops wildcard OR phrases)
   - Why: wildcard phrases in `orPhrases` are filtered out, so valid matches aren't highlighted.
   - Evidence: lines 408-410 strip wildcard phrases from all phrase sources including `orPhrases`. For `"agent * memory" OR "retrieval quality"`, `parsed.orPhrases` is `["agent * memory", "retrieval quality"]` but the function returns `['retrieval quality','memory','agent']`, dropping the full phrase. `phraseMatches` (1013-1031) handles wildcards correctly, confirming they're valid in phrases. Consumed by `HighlightText` (`page.tsx:806`).
   - Action: keep wildcard phrases in the highlight-term output (let `phraseMatches`-style logic handle matching); add a test for wildcard-in-OR highlighting.

5. **`src/components/ForYouRecommendationSection.tsx` — empty vs error conflation** (wrong UX)
   - Why: "no recommendations available" renders identically to a network failure.
   - Evidence: the timeline API returns HTTP 200 with `snapshots: []` when nothing is available (`recommendations.ts` lines 384, 610 return `snapshot: null`). The component sets `status='ready'` on success regardless, but line 78 treats empty identically to errors, both rendering `ForYouUnavailable` ("not ready yet"). `DigestDetails.tsx:146-158` shows the correct separate-messaging pattern.
   - Action: distinguish empty-but-ready from fetch-error states with separate messaging.

6. **`src/app/api/skill/fetch-runs/route.ts` — `FetchRunInputSchema` missing cross-field validation** (wrong / weak validation)
   - Why: schema accepts logically impossible combinations (e.g. `status='ok'` with `errorCount=100`).
   - Evidence: CLI enforces the invariant (`partial` iff `errorCount>0`; `ok` iff `errorCount=0`; `failed` implies `errorCount>=1`), but the schema (lines 15-32) validates fields independently. No Prisma constraint enforces it. The route is bearer-token accessible and undefended against direct invalid POSTs (CLI POSTs at `builder-digest.mjs` 441, 585-610, 619-630; UI GET at `FetchLogPanel.tsx:222`).
   - Action: add a Zod `.refine()`/`.superRefine()` enforcing the status↔errorCount invariant; add tests for rejected combinations.

7. **`src/app/api/settings/tokens/[tokenId]/exchange-code/route.ts:24` — enumeration-oracle inconsistency** (wrong)
   - Why: distinguishable 410 (revoked) vs 404 (missing/unauthorized) responses violate the uniform-error pattern used by `/api/skill/exchange`.
   - Evidence: this endpoint returns 410 for revoked (lines 24-25) and 404 for missing/unauthorized (line 22). `/api/skill/exchange` (lines 12-18) deliberately returns uniform 400s "so the endpoint cannot be used as an enumeration oracle." The client (`SkillPromptActions.tsx:211-219`) treats any non-ok response as failure, so unifying is safe. Risk is mitigated (authenticated, own-tokens only) but it's a defense-in-depth gap.
   - Action: return a uniform failure status across not-found/expired/used/revoked, matching `/api/skill/exchange`.

8. **`src/app/api/skill/context/route.ts` (via `builder-digest.mjs`) — `item.fetchTool` attribution** (wrong)
   - Why: agent-produced items lacking `item.fetchTool` get the payload default (`DEFAULT_AGENT_MODEL`) instead of the real agent runtime.
   - Evidence: the agent contract (`_fetch-task-contract.md`) tells agents to set `rawJson.agentRuntime/agentModel`, NOT `item.fetchTool`. `sync-builders` (line 2784) unconditionally sets `payload.fetchTool` to "manual JSON sync (model DEFAULT_AGENT_MODEL)" when missing. Server route `builders/route.ts:187` falls back to `payload.fetchTool` when `item.fetchTool` is absent — so agent attribution is lost.
   - Action: derive per-item `fetchTool` from `rawJson.agentRuntime/agentModel` when present, before applying the manual-sync default.

9. **`scripts/builder-digest.mjs` — embedded `loadSourcesConfig()` fallback diverges from server `sources.json`** (wrong / silent divergence)
   - Why: the hardcoded fallback embeds fields the canonical config lacks, and never auto-refreshes.
   - Evidence: `loadSourcesConfig()` (54-102) returns embedded defaults (60-99) when `~/.builder-blog/sources.json` is unreadable. The runner (`builder-agent-runner.sh:55`) curls `sources.json` each run. But `config/sources.json` is MISSING `primaryContentOnly` and `disallowedPrimarySources`, which the fallback hardcodes; `source-config-seed.ts` documents those two as intentionally fixed in prompts/CLI. If the server file changes the shared fields (minChars/minWords/minUniqueWordRatio/maxTimestampWordRatio) or source set, a CLI run before the next runner refresh uses stale values. Deployed `~/.builder-blog/sources.json` already diverges from `config/sources.json`. No test covers the fallback path.
   - Action: reconcile the embedded fallback with the canonical schema (keep the two fixed-rule fields documented, but stop embedding stale shared values), and add a freshness/validation check plus a test for the fallback path.

10. **`src/app/api/skill/digests/route.ts:51-55` — regenerate misses null-`digestId` `DigestedItem` markers** (wrong)
    - Why: orphaned markers (`digestId=null`) are never cleared on regenerate, blocking re-presentation.
    - Evidence: deletion only matches `digestId` in same-day digest IDs. Schema marks `digestId` nullable ("survives digest deletion"). `loadDigestedContentKeys` loads ALL `DigestedItem`s for a user regardless of `digestId`, so orphaned null-`digestId` records keep blocking candidates during regenerate. Comment states the intent is to reset today's markers.
    - Action: clear today's markers by `digestedAt` date window (which exists in the schema), not solely by `digestId`. (Overlaps with the next item — fix together.)

11. **`src/app/api/skill/digests/route.ts` — regenerate only deletes `DigestedItem` when same-day digests exist** (wrong)
    - Why: a gap if digests are deleted outside the regenerate flow, leaving orphaned markers.
    - Evidence: deletion is gated on `if (sameDayDigestIds.length > 0)` (line 51). `DigestedItem.digestId` is nullable with no FK to `Digest` (schema line 329: "Nullable: survives digest deletion"). The code's own comment (39-45) acknowledges the orphaning risk. No test covers pre-deleted digests before regenerate.
    - Action: delete `DigestedItem`s by `digestedAt` window rather than by `digestId` existence; add a regression test. (Same root cause as item 10.)

12. **`src/lib/recommendations.ts:360 — `unreadRemaining` semantic mismatch across scopes** (wrong)
    - Why: same field means different things in 'for-you' vs 'subscription' scope.
    - Evidence: 'for-you' (line 360) sets `unreadRemaining = dedupGroups.size` (post-dedup). 'subscription' (line 423) sets it to a raw `feedItem.count()` (pre-dedup), then dedups at 450-460 without updating it. `unreadCandidateCount()` (636-677) shows the same divergence.
    - Action: compute `unreadRemaining` post-dedup in both scopes for a consistent contract; add coverage.

13. **`src/app/(workspace)/library-hub/page.tsx:69-72 — hardcoded `take: 200` truncation** (wrong)
    - Why: `_count.items` reports the true total but `library.items` is capped at 200, silently truncating.
    - Evidence: the query fetches `_count.items` separately while capping `library.items` at 200. `LibraryHubImportForm.tsx:331` renders all fetched items without pagination. A 201+ item library shows the correct total but only 200 rows, with no pagination to fetch the rest.
    - Action: add pagination (or fetch-all) so the rendered list matches the reported count, or surface a "showing N of M" truncation notice.

14. **`src/app/api/settings/tokens/[tokenId]/route.ts` — hard-delete instead of soft-delete (`revokedAt`)** (wrong)
    - Why: `deleteMany()` contradicts the soft-delete model the rest of the system assumes.
    - Evidence: the `AgentToken` schema defines `revokedAt DateTime?` for soft-delete; multiple paths (exchange-code, skill/exchange, `lib/tokens.ts`) validate via `revokedAt`; UI labels say "Revoke" and render "Revoked [date]" (requires `revokedAt` to persist); settings/dashboard pages filter `revokedAt: null`. Hard-delete causes data loss (no audit trail), breaks the "Revoked [date]" status, and is semantically inconsistent with the "Revoke" labeling. (The test at `performance-ux.test.ts:603` asserts `deleteMany` usage but doesn't validate correctness — update it too.)
    - Action: replace `deleteMany()` with an `update` setting `revokedAt = now()`; update the test to assert soft-delete. Verify UI revoked-state rendering end to end.

15. **`src/lib/builder-pool.ts` — `ensureDefaultCommunityLibraryImport` overwrites `PERSONAL_SYNC` origin** (wrong)
    - Why: the `updateMany` (lines 69-75) flips existing pool entries from `PERSONAL_SYNC` to `HUB_IMPORT`, with observable consequences.
    - Evidence: a user-added builder later appearing in the featured library has its origin overwritten to `HUB_IMPORT`. Then `/builders/[builderId]/library/route.ts:27` blocks deletion of `HUB_IMPORT` builders (403), and `builders/page.tsx:202-209` filters the private section to `PERSONAL_SYNC` only — so the builder disappears from the private library and becomes non-removable.
    - Action: don't overwrite an existing `PERSONAL_SYNC` origin when adding featured items (skip/guard on existing origin). Closely related to item 16 (`addBuilderToPool` upsert) — fix the origin-overwrite behavior holistically.

16. **`src/lib/library-hub.ts:217-224 — `removeLibraryImportFromHub` soft-deletes user-owned builders** (wrong)
    - Why: an origin overwrite during import lets library removal soft-delete a user's own builder + subscription.
    - Evidence: import (148-152) calls `addBuilderToPool()` with `origin: HUB_IMPORT` for all builders without checking ownership; `addBuilderToPool()` upserts and OVERWRITES origin (`builder-pool.ts:18`). So a `PERSONAL_SYNC` builder becomes `HUB_IMPORT`. Removal (line 222) filters on `origin: HUB_IMPORT`, soft-deleting the user's own pool entry and subscription (line 232). The secondary `UserChannelPreference` orphaning claim is NOT confirmed (`orphanEntityIds` is empty since `ownBuilders` are in `remainingEntityIds`).
    - Action: don't overwrite `PERSONAL_SYNC` origin on import (guard the upsert), or scope removal so it never touches user-owned entries. Higher blast radius — touches pool-origin semantics shared with item 15; fix and test together.

17. **`src/lib/builder-entities.ts:reachableBuilderIdsForUser()` — redundant/confused reachability sources** (wrong / design)
    - Why: three overlapping queries unioned, masking whether the pool or direct queries are authoritative.
    - Evidence: it unions `ownBuilders`, `importedHubItems`, and `ownPoolEntries`. Imports add every hub item to the pool (`importLibrariesFromHub` 148-152; `ensureDefaultCommunityLibraryImport` 69-82), so hub items appear in both `importedHubItems` and `ownPoolEntries`. Personal builders are also added to the pool on creation (`/api/skill/builders:102`, `/api/builders/personal:143`), so `ownBuilders` overlaps `ownPoolEntries`. `activePoolBuilderIds()` is the canonical reachable-pool function. The Set dedup hides the overlap but the function neither queries the pool alone nor treats direct queries as the source of truth.
    - Action: pick one authority — ideally query the pool (`activePoolBuilderIds()`) as the single source of truth — and remove the redundant query paths. HIGHEST blast radius: reachability gates content visibility across the app. Plan carefully, add tests, and verify against items 15/16 (pool-origin fixes) before changing.

---

## Update (4)

Stale comments / soft-deprecated code paths. Low risk; correctness/clarity only.

1. **`src/lib/recommendations.ts:67-68 — stale cache comment** (outdated)
   - Why: comment describes a caching layer that no longer exists.
   - Evidence: commit `ea8c8f4` added "Cached For-You candidate fetch — 2-minute TTL, per-user cache tag" with an `unstable_cache` (120s TTL). Commit `b8e174b` removed the `unstable_cache` wrapper (stale-cache production bug) but left the comment. HEAD (`3736e14`) is a plain async function — no `unstable_cache`, no `'use cache'`, no fetch cache headers; it runs the Prisma query every call.
   - Action: update the comment to reflect the uncached behavior (or re-introduce caching deliberately if desired).

2. **`scripts/builder-digest.mjs:381-383 — misleading `--regenerate` comment** (outdated)
   - Why: comment conflates two distinct gating mechanisms.
   - Evidence: the comment says regenerate makes the context route "ignore the last-digest cutoff so the full window is re-covered." In reality `regenerate=true` only affects `excludeDigestedForUserId` (set to `null` instead of `user.id`, `route.ts:196`), bypassing the `DigestedItem` marker gate. The time-based lookback floor (`publishedAfter: lookbackCutoff`, `route.ts:194`) still applies. The accurate description is in `route.ts:25-29`.
   - Action: rewrite the CLI comment to say regenerate bypasses only the per-user `DigestedItem` marker gate, not the time-based lookback floor.

3. **`src/app/api/skill/context/route.ts:118-129 — `legacyPrompts` soft-deprecation** (outdated)
   - Why: still built and served, but all modern callers have migrated off it.
   - Evidence: `legacyPrompts` (122-129) is returned when `includePrompts=1` (line 271). The fetch-task contract (`_fetch-task-contract.md:28`) tells agents NOT to fetch `context.prompts`/`summaryPrompt`/`commonSummaryRules` separately; modern prompts (`digest-once.md` 555-559) use `context.sources.x.summaryPrompt.body`; tests (`user-journeys.test.ts:479`) verify the contract steers agents away from `context.prompts`. `FetchLogPanel` reads it only for UI display (438-441). The CLI still requests `?includePrompts=1`.
   - Action: plan removal — migrate `FetchLogPanel` off `details.prompts`, confirm the CLI no longer needs `includePrompts=1`, then stop building/serving `legacyPrompts`. Until then, mark clearly as deprecated.

4. **`src/app/api/skill/context/route.ts — `legacyPrompts` hardcodes 3 of 6 source IDs** (outdated)
   - Why: hardcodes `x`/`podcast`/`blog` with direct field access while the system now has 6 source types.
   - Evidence: `sources.json` defines 6 types (x, blog, youtube, podcast, pdf, website); `legacyPrompts` (122-129) covers only 3, so new sources are invisible to it. The modern path `context.sources[id].summaryPrompt` (85-108) iterates all sources dynamically. The CLI still calls `includePrompts=1` (`builder-digest.mjs:386`) but tests confirm the CLI summary logic does NOT use `context.prompts` (`user-journeys.test.ts:984-985`); `FetchLogPanel` displays `details.prompts` only for UI (439-440).
   - Action: same remediation as item 3 — retire `legacyPrompts` in favor of the dynamic `context.sources[id].summaryPrompt`. (These two `legacyPrompts` items share a fix.)

---

## Summary

| Group  | Count |
|--------|-------|
| Remove | 8     |
| Fix    | 17    |
| Update | 4     |
| **Total** | **29** |

Excluded: 1 audited item with a `keep` verdict (`src/app/api/skill/builders/route.ts` `itemResults`, confirmed load-bearing).
