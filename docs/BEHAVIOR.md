# FollowBrief — System Behavior Specification

> **Status:** Authoritative behavioral spec. This document describes how the system *should* behave today. Where the analysis surfaced contradictions between code paths or stale comments, this document states the *intended* behavior and flags the discrepancy inline as **[Discrepancy]**. When code and this document disagree, treat this document as the source of truth and reconcile the code.

---

## System Overview

FollowBrief is a personal content-digest platform. Knowledge workers register **content sources** ("builders" — an X account, blog, podcast, YouTube channel, website, or PDF feed), and a **local CLI agent** (the `builder-blog-digest` skill, driven by `scripts/builder-digest.mjs`) periodically fetches new posts, summarizes them, and assembles a cited daily/weekly **digest** in the user's chosen language.

The platform is a Next.js application (note: a heavily modified Next.js — always consult `node_modules/next/dist/docs/` before writing framework code) backed by PostgreSQL via Prisma (`prisma/schema.prisma`). It exposes two API surfaces:

- **Web routes** (`/api/settings/*`, `/api/builders/*`, `/api/recommendations/*`, `/api/library-hub/*`, `/api/search/*`) — authenticated by browser session cookie (NextAuth).
- **Skill routes** (`/api/skill/*`) — authenticated by long-lived bearer **agent tokens** used by the CLI.

A small number of unifying concepts run through every subsystem; they are detailed in **Cross-cutting invariants** and referenced throughout:

- **Canonical entity identity.** A creator is modeled once as a `BuilderEntity`. Each channel they publish on is a `Builder` (a *channel variant*). All read/digest/dedup state is keyed at the **entity** level — the tuple `(userId, entityId, kind, externalId)` — so an action on one channel applies across every variant of that post.
- **Per-user scoping.** Every query is scoped by `userId`. No subsystem may leak another user's data.
- **The agent fetch/summarize/skip contract.** Every planned fetch task must end in exactly one accounted-for outcome: synced as an item (with body + summary), or reported as `skipped`/`failed`/`blocked` with a reason and evidence. Silent omissions are validation failures.
- **Content-quality gating.** No `FeedItem` is persisted unless it passes the server-side content-quality floor (non-empty body meeting `minChars`/`minWords`, plus a non-empty summary).
- **Digest dedup.** `DigestedItem` markers prevent a post from appearing in more than one digest per user, unless an explicit `regenerate` override is set.

---

## 1. Authentication & User Management

**Purpose.** Sign users in via GitHub/Google OAuth, manage browser sessions, and issue long-lived agent tokens that the CLI uses to call `/api/skill/*`. Bootstrap CLI tokens via one-time exchange codes, and track best-effort machine identity for the Settings UI.

**Key entities** (`prisma/schema.prisma`):
- `User` — core identity (cuid `id`, email, name, image). Owns `Account`, `Session`, `AgentToken`, `ExchangeCode`.
- `Account` — OAuth provider link, unique per `(provider, providerAccountId)`.
- `Session` — browser session token + expiry.
- `AgentToken` — long-lived CLI token: `tokenHash` (unique SHA-256), `tokenCiphertext` (AES-256-GCM, `iv.tag.ciphertext`), legacy `tokenValue` (read-only, never written for new tokens), `name`, `lastUsedAt`, machine fields (`lastIp`, `lastUserAgent`, `lastHostname`, `lastPlatform`, `lastUser`), `revokedAt`.
- `ExchangeCode` — one-shot bootstrap code (`bb_ec_*`), 10-min expiry, `usedAt`, `agentTokenId` FK; hard-deleted after use.

**Data flow.** Login on `/login` → NextAuth `/api/auth/[...nextauth]` → `PrismaAdapter` creates/links `User` + `Account` → `Session` row + cookie. Web pages call `getCurrentSession()` (wrapping `getServerSession(authOptions)`) and redirect to `/login` if absent. CLI tokens are created at `POST /api/settings/tokens`, bootstrapped via `POST /api/settings/tokens/{tokenId}/exchange-code` → `POST /api/skill/exchange`, and verified on every skill request by `getUserFromBearer()` (`src/lib/tokens.ts`).

**Key files:** `src/lib/auth.ts`, `src/lib/tokens.ts`, `src/lib/token-encryption.ts`, `src/lib/rate-limit.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/settings/tokens/**`, `src/app/api/skill/exchange/route.ts`, `src/types/next-auth.d.ts`.

**Behavior rules:**

1. Sessions use the NextAuth database strategy; the authenticated user is always retrieved via `getServerSession()`. The session callback injects `user.id` into `session.user`, so client code can always read it.
2. Google OAuth sets `allowDangerousEmailAccountLinking: true` (safe — Google verifies email; recovers accounts when the `Account` row was deleted). GitHub keeps it `false` (GitHub email is user-claimed). Any future provider must justify this flag explicitly.
3. New agent tokens have format `bb_<32-byte-base64url>`. The server stores: SHA-256 `tokenHash` (for lookup) and AES-256-GCM `tokenCiphertext`. Plaintext is returned to the caller exactly once and never persisted. `tokenValue` is legacy-read-only.
4. The token encryption key is derived from `NEXTAUTH_SECRET` via `scryptSync` with salt `fb-agent-token-v1`. A database dump alone cannot recover any token.
5. `getUserFromBearer()` extracts the `Authorization: Bearer` token, looks it up by SHA-256 hash, returns `null` (→ 401) if missing or if `revokedAt` is set, and otherwise updates `lastUsedAt` plus machine-identity fields on every use.
6. `readAgentTokenValue()` decrypts `tokenCiphertext` first, falls back to legacy `tokenValue` for pre-migration rows, and returns `null` if neither resolves.
7. Exchange codes (`bb_ec_<16-byte-base64url>`) expire in 10 minutes, are single-use, and are **hard-deleted** on successful redemption.
8. Exchange-code validation returns a **uniform** error for every failure mode (malformed / missing / expired / already-used / revoked-token) so it cannot act as an enumeration oracle. **[Intended behavior]** Invalid attempts must hard-delete the candidate code *before* returning the uniform error — including expired codes — to eliminate the race where an attacker retries an expired-but-undeleted code. **[Discrepancy]** Current code only burns codes that are present and unused; expired codes are not burned. Fix to delete-then-respond unconditionally.
9. Token revocation (`DELETE /api/settings/tokens/{tokenId}`) hard-deletes the `AgentToken` row; cascading FK deletes its pending `ExchangeCode`s; in-flight requests get 401 on the next bearer lookup. **[Discrepancy]** The schema carries `revokedAt`, and other paths check it, but revocation hard-deletes rather than soft-deletes — losing audit trail. Intended behavior going forward: prefer soft-delete via `revokedAt` for consistency and auditability; until that change lands, hard-delete remains the documented behavior.
10. Token creation is rate-limited to **5 per user / 5 minutes**; the exchange endpoint to **10 per IP / 60 seconds**. **[Discrepancy]** `src/lib/rate-limit.ts` is an in-process limiter and is bypassable across serverless instances. It is a speed-bump only; hard quotas require a distributed limiter (Upstash/Vercel Firewall). Production security must not depend solely on it.
11. Machine-identity fields are clamped (`lastHostname`/`lastPlatform`/`lastUser` → 120/120/80 chars). They are trust-on-first-use, attacker-fakeable, and used **only** for human recognition in the Settings UI — never as an auth signal. No access-control decision may consult them.
12. All `/api/skill/*` endpoints require a valid bearer token; there is no unauthenticated skill endpoint.
13. The `exchange-code` endpoint should return a uniform `404`/`400` for missing **and** revoked tokens. **[Discrepancy]** It currently returns `410 Gone` for a revoked token, leaking token existence. Intended: uniform not-found response.

---

## 2. Builders & Entities (Source Identity)

**Purpose.** Model the canonical creator (`BuilderEntity`) and its per-user channel facets (`Builder`), enabling dedup across channel variants, upstream enrichment (avatars, RSS discovery), and per-user primary-channel selection.

**Key entities:**
- `BuilderEntity` — canonical creator, unique per `(kind, canonicalKey)`. Immutable after creation (read-only).
- `Builder` — user-owned channel facet; unique `libraryKey`; always has `ownerUserId`, `kind`, `sourceType`, `entityId`.
- `UserChannelPreference` — per `(userId, entityId)`: `primaryBuilderId` + `pinnedByUser`.

**Data flow.** Add (`POST /api/builders/personal`): `resolvePersonalBuilderInput` (validate URL/handle, detect type, pre-resolve podcasts via iTunes) → `probeAndEnrichSource` (4-second probe through the shared SSRF guard) → `upsertBuilder` → `ensureBuilderEntity` → `addBuilderToPool` + subscribe + `UserChannelPreference` (primary) → `syncPersonalLibraryHub`. Feed read (`GET /api/builders/:builderId/feed-items`): `resolveBuilderToEntity` → `fetchDedupedFeedForEntities` → `dedupeFeedItemsByEntity`.

**Key files:** `src/lib/builder-entities.ts`, `src/lib/builders.ts`, `src/lib/builder-enrichment.ts`, `src/lib/builder-keys.ts`, `src/lib/builder-channel-resolver.ts`, `src/lib/builder-channel-picker.ts`, `src/lib/source-value-detect.ts`, `src/lib/personal-builder-input.ts`, `src/app/api/builders/personal/route.ts`, `src/app/api/builders/[builderId]/feed-items/route.ts`.

**Behavior rules:**

1. A `BuilderEntity` is created once per unique `(kind, canonicalKey)` and never mutated thereafter — only read.
2. `canonicalKey` is `kind:normalizedValue`, where `normalizedValue` derives from handle (X only), then `sourceUrl`, then `name`, in that precedence.
3. `upsertBuilder` always requires `ownerUserId` and upserts on the unique `libraryKey`.
4. Multiple channels of the same creator (X / Blog / Podcast) link to one `BuilderEntity`. `dedupeFeedItemsByEntity` groups feed items by `(entityId, kind, externalId)` and returns exactly one variant per group.
5. **Channel-variant selection order:** (1) user-pinned primary (`UserChannelPreference.primaryBuilderId`); (2) the user's own channel (`ownerUserId` match); (3) most recent by `lastFetchedAt`, then `publishedAt`, then `createdAt`. This single ordering is shared by `pickPrimaryVariant` (`src/lib/builder-channel-picker.ts`) and must be reused everywhere a variant is chosen. **[Discrepancy]** `src/lib/recommendations.ts` reimplements this logic locally (`pickPrimaryVariants`) instead of reusing the exported helper; consolidate to one implementation.
6. Enrichment runs once per add/edit with a 4-second timeout via the shared SSRF guard. The X API lookup is gated on `X_BEARER_TOKEN`.
7. `FeedRead` and `DigestedItem` are keyed at entity level `(userId, entityId, kind, externalId)`. Reading or digesting any one channel variant marks the post read/digested across all variants.
8. Avatar and enrichment URLs must pass `validatePublicHttpUrl` before persistence (SSRF / private-network prevention).
9. Blogs with no discoverable RSS feed return `requiresConfirmation=true`; the user must re-submit with `confirmedWarning=true`.
10. Podcast detection rejects hardcoded unsupported platforms (Spotify, 小宇宙, 喜马拉雅, 网易云) with concrete user-facing reasons.
11. Builder kind is set authoritatively by the source-specific resolvers inside `resolvePersonalBuilderInput`, not by the heuristic `inferBuilderKind`. **[Discrepancy]** `inferBuilderKind` (substring matching, e.g. `youtube.com`) is exported but never called on the live path; it is fragile and effectively dead. Do not rely on it.
12. On library removal, `computeEntityReachabilityAfterRemoval` + `rebindPrimaryChannels` clean up: orphaned entities (no reachable channel) have their `UserChannelPreference` deleted; surviving entities rebind their primary to a reachable channel (own first, then by fetch/publish date).
13. **[Discrepancy / dead code]** `SubscriptionWithBuilder` type and `getEntityWithChannels` in `src/lib/builder-entities.ts` are exported but unused; treat as removable.
14. `upsertBuilder` avatar handling is asymmetric: the update branch preserves the prior avatar when the param is `undefined` (`=== undefined` check), while the create branch coerces `undefined → null`. Intended behavior: passing an explicit `null` should clear the avatar on update; verify enrichment never sends `null` where it means "no change."

---

## 3. Personal Content Library (Builder Pool)

**Purpose.** Manage each user's active roster of followed sources, unified across personally-added sources and hub-imported sources, with lifecycle (add/remove/toggle), origin tracking, and soft-delete for imports.

**Key entities:**
- `BuilderPoolEntry` — `(userId, builderId)` unique; `origin` (`PERSONAL_SYNC` | `HUB_IMPORT`); `removedAt` (soft-delete).
- `LibraryImport`, `UserLibraryVisibility` (`hidden` flag), `LibraryHubEntry`/`LibraryHubItem`.

**Data flow.** Active roster comes from `activePoolBuilderIds()`, which first runs `ensureDefaultCommunityLibraryImport()` then returns all pool entries with `removedAt IS NULL`. Adds go through `addBuilderToPool`. Removal branches on origin (see rules). Reachability/rebinding flows through `reachableBuilderIdsForUser` and `rebindPrimaryChannels`.

**Key files:** `src/lib/builder-pool.ts`, `src/lib/library-hub.ts`, `src/lib/builder-entities.ts`, `src/lib/personal-builder-input.ts`, `src/app/api/builders/personal/route.ts`, `src/app/api/builders/subscriptions/route.ts`, `src/app/api/builders/[builderId]/library/route.ts`, `src/app/api/skill/builders/route.ts`.

**Behavior rules:**

1. The active pool (`removedAt IS NULL`) includes **both** `PERSONAL_SYNC` and `HUB_IMPORT` origins in a single result set.
2. `addBuilderToPool()` is idempotent (upsert on `(userId, builderId)`): re-adding only updates origin and clears `removedAt`.
3. `ensureDefaultCommunityLibraryImport()` must check `UserLibraryVisibility.hidden` first; if hidden, return `{imported: false}` and import nothing. Admins are excluded via `isAdminEmail()`.
4. Exactly one featured library (`isFeatured=true`) exists at any time; it is the single source of truth for the community library.
5. **Origin is immutable per builder.** A builder is either personal or imported, never both. **[Discrepancy]** `ensureDefaultCommunityLibraryImport()` currently `updateMany`s existing entries to `HUB_IMPORT` and clears `removedAt`, which can overwrite a user's `PERSONAL_SYNC` origin if the same builder is also in the featured library. Intended behavior: only `createMany` for genuinely new builders; never rewrite the origin of an existing entry.
6. Soft-delete (`removedAt`) applies only to `HUB_IMPORT` entries. `PERSONAL_SYNC` entries are **hard-deleted** when the user removes their own builder (cascade-deletes the `Builder` and its `FeedItem`s, then rebinds preferences).
7. A user's own builders (`ownerUserId == userId`) cannot be removed via the `HUB_IMPORT` path — only via direct hard-delete.
8. Removing a library import computes reachability so that builders the user still reaches via another import or owns personally are **not** removed. Only `HUB_IMPORT`-origin entries for now-unreachable builders are soft-deleted.
9. `UserChannelPreference.primaryBuilderId` must always point to a reachable channel; otherwise the preference row is deleted (see §2 rule 12).
10. Pool entry creation does **not** auto-create a `Subscription`; subscription is a separate explicit upsert.
11. **[Discrepancy / import accounting]** When importing multiple libraries, builders are added to the pool *before* the `LibraryImport` create that can throw and be swallowed; this can leave the pool ahead of the import count, and the returned `builders` count can exceed actual additions. Intended: wrap each library's pool additions and import record in the same try, and only count builders that were actually recorded.
12. **[Dead code]** `isLibraryHidden` (`src/lib/library-hub.ts`) is unused; callers query `UserLibraryVisibility` inline.

---

## 4. Library Hub & Content Sharing

**Purpose.** Let users share and import curated builder collections; let admins designate a featured community library; track import/view analytics; keep pool membership, entity reachability, and preferences consistent on import/removal.

**Key entities:** `LibraryHubEntry` (slug, `isFeatured`, `importCount`, `viewCount`), `LibraryHubItem`, `LibraryImport` (`(userId, hubEntryId)`), `UserLibraryVisibility` (`hidden`), plus shared `BuilderPoolEntry` / `BuilderEntity` / `UserChannelPreference`.

**Data flow.** Import: `POST /api/library-hub/imports` → `importLibrariesFromHub` (loop builders → `addBuilderToPool(HUB_IMPORT)`, create `LibraryImport`, `importCount++`, un-hide). Removal: `DELETE /api/library-hub/imports` → `removeLibraryImportFromHub` (reachability → transaction: soft-delete entries, delete `LibraryImport` + `Subscription`s, delete orphaned preferences, mark hidden → rebind). Visibility: `PATCH /api/library-hub/personal-availability` (`sharePersonalLibraryToHub` / `unsharePersonalLibraryFromHub`). Auto-import: `ensureDefaultCommunityLibraryImport` on page load.

**Key files:** `src/lib/library-hub.ts`, `src/lib/builder-pool.ts`, `src/lib/builder-entities.ts`, `src/app/api/library-hub/**`, `src/app/(workspace)/library-hub/page.tsx`, `src/app/(workspace)/builders/page.tsx`.

**Behavior rules:**

1. A user cannot import their own library; `importLibrariesFromHub` skips entries where `ownerUserId === userId`. **[Discrepancy]** The skip is silent (returns `{libraries:0, builders:0}` with no signal). Intended: surface an explicit warning so the user understands nothing was imported.
2. Importing a previously hidden library re-unhides it (`setLibraryHidden(false)`).
3. Re-importing does not double-count `importCount`; the duplicate `LibraryImport` create is caught. (See §3 rule 11 for the accounting fix.)
4. On import removal, only builders that become completely unreachable (not in another import and not owned) are soft-deleted.
5. Primary-channel rebinding occurs only when the current primary is in the removed library **and** no longer reachable.
6. `UserLibraryVisibility.hidden` is always set explicitly via upsert; code never relies on the schema default. **[Discrepancy]** The schema default is `true`, which is semantically backwards for a "hidden" flag and is unreachable in practice; the field would be clearer named `isHidden` with default `false`.
7. Orphaned entities (no reachable builder) have their `UserChannelPreference` deleted; surviving entities keep theirs if rebindable. **[Discrepancy]** A builder a user owns *and* that is also in a removed import can wrongly appear in `removedBuilderIds`, risking deletion of a still-valid preference. Reachability must treat owned builders as always reachable.
8. The featured community library auto-imports for non-admin users on first page load unless hidden.
9. Admin emails (`isAdminEmail`) get `isFeatured=true` on their personal library and manage the community library via `ensureAdminCommunityLibrary`. **[Discrepancy]** The admin sync overwrites the entry with hardcoded admin name/description and keys off `PERSONAL_SYNC` counts; this can clobber an admin's customized library and can mis-detect drift. Intended: sync from the admin-curated set and preserve explicit customizations.
10. Hub item lists are capped at `take: 200` to bound payload. **[Discrepancy]** Libraries with 201+ sources are silently truncated in the hub preview; either raise the cap or paginate.
11. Import/remove revalidates `/builders`, `/dashboard`, `/library-hub`, and the `user:${userId}:recs` tag.

---

## 5. Source Registry & Configuration

**Purpose.** Define static source types (X, Blog, Podcast, YouTube, PDF, Website) and couple them with DB-backed, editable runtime config that drives fetch behavior, content-quality gating, and digest assembly — globally (template) and per-user (override).

**Key entities:**
- `SOURCE_DEFINITIONS` — frozen, built at module load from `config/sources.json`; code-bound fields only (`id`, `builderKind`, `feedItemKinds`, `urlPatterns`, `staticLabel`).
- `SourceTypeConfig` — global editable template per source type; `DigestConfig` — global singleton `id='global'`.
- `UserSourceTypeConfig`, `UserDigestConfig` — per-user materialized copies.
- `MergedSourceDefinition` — static def merged with config.

**Data flow.** `ensureSourceConfigsSeeded` seeds `SourceTypeConfig` + `DigestConfig` once per boot (idempotent `createMany`, preserving admin edits). Requests merge static + DB config via `mergeDefinition`. `ensureUserSourceConfigs` / per-user digest upsert lazily materialize per-user rows on first touch. `/api/skill/context` returns merged per-source rules; `/api/skill/builders` validates content quality via `checkBodyContentQuality`.

**Key files:** `src/lib/source-registry.ts`, `src/lib/source-config-store.ts`, `src/lib/source-config-seed.ts`, `config/sources.json`, `src/lib/digest-prompts.ts`, `src/lib/content-quality.ts`, `src/app/api/settings/source-types/route.ts`, `src/app/api/settings/digest-config/route.ts`, `src/app/api/skill/context/route.ts`.

**Behavior rules:**

1. `SourceTypeConfig` and the `DigestConfig` singleton are seeded once at first boot and never dropped; seeding is idempotent and preserves prior admin edits across deploys.
2. `SOURCE_DEFINITIONS` is synchronous, frozen, and contains only code-bound fields. All editable fields (`label`, `contentQuality`, `summaryPromptBody`, `fetchPromptBody`, `summaryStyle`, `summaryLanguage`, `summaryLengthHint`) live in the DB. `staticLabel` is a fallback for synchronous code paths only — the DB `label` is the runtime truth.
3. Per-user source configs are materialized lazily by `ensureUserSourceConfigs`, copying every field from the global template, then read (uncached) on every request. Per-user digest config is materialized via upsert.
4. **Account-wide language override.** `UserFeedPreference.summaryLanguage`, when set, overrides every source's per-type `summaryLanguage` so all of a user's summaries share one language; `null` falls back to per-source default.
5. Content-quality validation (`minChars`, `minWords`, and source-specific rules) is enforced server-side in `/api/skill/builders` via `checkBodyContentQuality` before persistence, using the user's `SourceTypeConfig.contentQuality`. Failures are logged as `content_missing` / `content_too_short`.
6. `fetchPromptBody` is optional per-source agent guidance for fallback fetch tasks. `null` means deterministic CLI behavior only; a non-empty prompt tells the agent *how* to acquire content. **[Discrepancy]** `fetchPromptBodyForSourceId` only returns a prompt for podcasts and `null` for all others; the design is meant to support per-source fetch prompts generally, so this hardcoded restriction should be lifted as other sources need agent fetch guidance.
7. `DigestConfig.digestOrder` is a `string[]` of source IDs controlling section order; the validator requires every ID to be a `SEEDED_SOURCE_ID`.
8. `SourceTypeConfig`/`DigestConfig` are cached in-process and explicitly invalidated on write (`invalidateSourceConfigsCache` / `invalidateDigestConfigCache`). Per-user configs are **not** cached.
9. **Source-type resolution for a builder:** explicit `sourceType` wins; else match by `builderKind` + optional `urlPatterns` regex; else fall back to that kind's default source; else synthesize a `WEBSITE` source with a title-cased label.
10. Any logged-in user can read/edit **their own** `UserSourceTypeConfig` and `UserDigestConfig` via the settings endpoints; there is no admin API gate — global defaults are the seeded template only.
11. `DEFAULT_COMMON_SUMMARY_RULES` seeds `DigestConfig.commonSummaryRules`, mirroring migration `000024_common_summary_rules`, so existing rows backfill identically.
12. **[Discrepancy]** `source-types` PATCH validates `sourceId ∈ SEEDED_SOURCE_IDS` (derived from `config/sources.json`) but a new source added to JSON before the seeder runs would pass the gate yet fail downstream with "SourceTypeConfig row missing." Intended: validate against rows actually present in the DB, or guarantee the seeder ran.

---

## 6. CLI Agent Skill Contract & Job Management

**Purpose.** Define the end-to-end contract for the local CLI agent to fetch personal sources and generate digests, with per-task outcome tracking, Zod-validated sync payloads, and fetch-run logging (CLI version, hostname, platform, model).

**Key entities / schemas (`src/lib/skill-contracts.ts`):**
- `SkillBuilderSchema`, `SkillFeedItemSchema` (body required 1..100KB; `externalId` ≤512 chars), `SkillTaskOutcomeSchema` (status `skipped|failed|blocked`, reason 1..400, evidence for `skipped`), `SkillBuilderSyncSchema` (`force`, `fetchTool`, builders 1..50, taskOutcomes 0..500), `SkillDigestSchema`, `SkillDigestedItemSchema`.
- `LibraryFetchRun` — one CLI run (timestamps, `status`, `source` manual|cron, `cliVersion`, `hostname`, `platform`, aggregate counts, `details` JSON ≤50KB).
- `fetchTask` — internal planned-task shape with `contentStatus` (`ready|requires_agent`), `id`, `minimumContentQuality`, instructions.

**Data flow.** `fetch-personal` → `GET /api/skill/context` → CLI local fetchers emit `fetchTasks` → agent completes tasks (writes body/summary/`rawJson`) → `validate-agent-sync` → `sync-builders` `POST /api/skill/builders` (validate, upsert, classify, return `itemResults`) → CLI `PATCH /api/skill/fetch-runs/{id}` merging stage-1 fetch facts with stage-2 agent facts. Digest: `prepare` → agent generates → `sync` `POST /api/skill/digests`.

**Key files:** `src/lib/skill-contracts.ts`, `src/lib/skill-includes.ts`, `src/app/api/skill/context/route.ts`, `src/app/api/skill/builders/route.ts`, `src/app/api/skill/digests/route.ts`, `src/app/api/skill/fetch-runs/**`, `scripts/builder-digest.mjs`, `skills/builder-blog-digest/SKILL.md`.

**Behavior rules:**

1. `fetch-personal` emits exactly the `fetchTasks` planned by the CLI's local fetchers. The agent completes **only** those task IDs — it must not add new sources or URLs.
2. **Every planned task is accounted for**: either synced as an item (body + summary non-empty) **or** reported in `taskOutcomes` with a status, reason, and (for `skipped`) per-task evidence. Bare omissions are validation failures.
3. For `contentStatus=ready` items the agent preserves `task.item.body`. For `requires_agent` items the agent must obtain real primary content first, then summarize, meeting `task.minimumContentQuality`.
4. YouTube primary content must come from captions/transcripts/agent transcription; title/description/metadata must never be synced as item body.
5. Skipped tasks require per-task evidence (e.g. `{meanVolumeDb, hasCaptions}`), preventing bulk-skip on one assumption. **[Discrepancy]** `SkillTaskOutcomeSchema` marks `evidence` optional; the evidence-for-`skipped` rule is only enforced in app logic. Intended: enforce it at the schema level via `.superRefine()` so a Zod-valid skipped outcome cannot bypass the gate.
6. `rawJson.fetchTaskId` MUST equal the planned task ID — it is the authoritative link binding a synced item to its fetch-log record for per-task outcome tracking.
7. For `requires_agent` tasks, `rawJson` MUST include `fetchTaskId`, `agentRuntime`, `agentModel` (if known), `agentCompletedAt` (ISO), and `agentExecutionProof`.
8. Items are gated by content quality (`minChars`, `minWords`, disallowed primary sources). Failing items are recorded as failed tasks — never silently dropped.
9. A summary is required for every synced item; posts without summaries are failed tasks (`summary_missing`), not persisted.
10. `LibraryFetchRun` records exactly one run with aggregate stats; per-task detail lives in `details.fetchTasks`.
11. `PATCH /api/skill/fetch-runs/{id}` merges per-task outcomes onto planned tasks by `fetchTaskId`; only defined values overwrite stage-1 facts; unmatched outcomes are ignored.
12. **Per-task classification** when the server returned no `itemResult`: prefer the server result (synced/failed, using the server reason); else infer from payload presence (`summaryChars > 0` → synced, else `summary_missing`); else use the agent outcome (`skipped`/`blocked`/`failed`); else `failed (not_summarized)`. **[Discrepancy]** A task neither synced nor reported should be distinguishable as an agent omission. Intended: use reason `not_accounted_for` for that case rather than conflating it with content failure.
13. User-action tasks (`agentWorkType=x_token_missing`, IDs prefixed `user_action_`) map to `status=action_needed`, not failures.
14. `cliVersion` is reported on every run for traceability and bumps when the run shape/behavior changes. Machine identity (hostname/platform/username) is best-effort metadata, **never** an auth signal (see §1 rule 11).
15. `--regenerate` deletes same-day digest(s) **and** their `DigestedItem` markers so posts can reappear; markers have no FK to the digest and must be cleared explicitly (see §8/§9).
16. `DigestedItem` is keyed `(userId, entityId, kind, externalId)` so marking one channel covers every variant.
17. The context route annotates `libraryBuilders` with `scope=PERSONAL` for user-owned sources and strips `ownerUserId` for imported builders.
18. `personalFetchStates` (per builder: `lastFetchedAt`, `lastForcedAt`, `itemCount`, `status`, `lastError`) lets the agent skip already-fetched builders. **[Discrepancy]** It must include **only** builders where `ownerUserId === user.id`; do not expose fetch state for imported builders.
19. **[Discrepancy / naming]** `skippedFeedItems` is incremented for both rejections and in-place re-summaries (which `itemResults` correctly records as `synced`). The counter name is misleading; treat it as "not newly inserted," and prefer renaming to clarify re-summary vs rejection.
20. **[Discrepancy / redundancy]** The `itemResults` array in the 200 response is not consumed by the CLI (which reconstructs outcomes for `patchFetchRunOutcomes`); it is recorded only in `details.fetchTasks`. Either consume it or remove the response field.
21. **[Discrepancy / stale]** `legacyPrompts` (returned only when `includePrompts=1`) is deprecated and hardcodes three source names (`summarizeTweets`/`summarizeBlogs`/`summarizePodcast`); modern callers read `context.sources[id].summaryPrompt`. Remove on a major version bump.

---

## 7. Feed Item Sync & Library Fetch Pipeline

**Purpose.** Persist agent-fetched content into `FeedItem` rows with dedup, content-quality validation, raw-JSON provenance, and per-builder fetch-state tracking, and record the run in `LibraryFetchRun`.

**Key entities:** `FeedItem` (unique `(builderId, kind, externalId)`; `body`, `summary`, `url`, `publishedAt`, `rawJson`, `fetchTool`), `LibraryFetchRun`, `Builder` fetch-state fields (`lastFetchedAt`, `lastForcedAt`, `itemCount`, `status` IDLE/RUNNING/OK/ERROR/STALE, `lastError`).

**Data flow.** See §6; persistence happens in `/api/skill/builders` (`src/app/api/skill/builders/route.ts`), candidate read-back via `fetchDedupedFeedForEntities`.

**Key files:** `scripts/builder-digest.mjs`, `src/lib/content-quality.ts`, `src/app/api/skill/builders/route.ts`, `src/app/api/skill/fetch-runs/route.ts`, `src/app/api/skill/context/route.ts`.

**Behavior rules:**

1. A `FeedItem` is unique by `(builderId, kind, externalId)`. The same `externalId` may exist across different builders without collision.
2. Before persisting, the server enforces the content-quality floor (`minChars`/`minWords` per `SourceTypeConfig.contentQuality`); rejections are recorded as `itemResults` with a reason.
3. A non-empty trimmed `summary` is required; missing summary → failed `itemResult` (`summary_missing`).
4. A non-empty `body` is required (`checkBodyContentQuality`); `content_missing`/`content_too_short` are rejected and recorded.
5. `rawJson` stores full fetch context, including `fetchTaskId` (the authoritative binding), `agentRuntime`, `agentExecutionProof`, `agentCompletedAt`, transcript source, and source metadata.
6. `publishedAt` falls back to `createdAt` (now) if no source date is given, so every post has a sortable timestamp.
7. **Dedup ordering:** within-payload duplicates are caught first via `payloadItemKeys`; cross-run duplicates via `existingFeedItemKeys` (a pre-loop DB query). When `force=false`, an existing item is updated in place (new summary + `rawJson`); when `force=true`, existing items are treated as fresh inserts.
8. **[Discrepancy]** The `fetchTool` update for existing items uses two sequential `updateMany` calls (the second additionally filtering `fetchTool` null/legacy), which is racy and confusing. Intended: a single conditional update that sets `fetchTool` only when it was missing or legacy.
9. YouTube content uses `youtubeContentQuality()` — transcript source, minimum length, `minUniqueWordRatio`, `maxTimestampWordRatio`, and near-duplicate detection against title/description.
10. `LibraryFetchRun` records start/finish, `status` (`ok`/`partial`/`failed`), `source` (`manual`/`cron`), and a `details` JSON (`perBuilder`, `userActions`, `cliFlags`, `fetchTasks`, `prompts`) capped at 50KB. **[Discrepancy]** The `fetch-runs` POST schema only accepts terminal statuses `ok|partial|failed`; intermediate states (`pending`/`running`) cannot be logged. This is acceptable for terminal logging; if mid-run logging is ever needed, widen the enum. Consider a `.refine()` enforcing semantic invariants (e.g. `failed`/`partial` ⇒ `errorCount ≥ 1`).
11. Per-builder fetch state is stored inline on `Builder`.
12. The context route's `personalFetchedItems` returns all `FeedItem`s for the user's personal builders; `latestPersonalFetchedItems` is deduped by `entityId`.
13. The three-phase flow (fetch-personal → agent → sync-builders, then PATCH outcomes) ensures every planned task is accounted for (cross-ref §6 rule 2).
14. `fetchTool` identifies the fetcher/runtime/method (e.g. `Claude Code FollowBrief skill fetcher (model claude-opus)`, `YouTube RSS`, `X API v2`).
15. `sourceConfigFor()` resolves `builder.sourceType` per §5 rule 9; ambiguous/missing → `website`.
16. **[Discrepancy]** The CLI embeds a hardcoded fallback copy of `sources.json` (used before the real config downloads). This can drift from the server's `SourceTypeConfig`. Intended: download/refresh `config/sources.json` during setup so the CLI's view matches the server.

---

## 8. Digest Generation Pipeline

**Purpose.** Generate, store, and sync daily/weekly AI digests in the user's language by assembling deduped candidate items from followed entities, applying source-specific prompts, and recording dedup markers.

**Key entities:** `Digest` (userId, title, content, language, period, `status`, `itemCount`), `DigestedItem`, `DigestConfig`/`UserDigestConfig`, `SourceTypeConfig`/`UserSourceTypeConfig`, `UserFeedPreference`.

**Data flow.** `prepare` → `GET /api/skill/context` loads subscriptions → entityIds, library builders, feed/digest config, per-user source configs, and digest candidates via `fetchDedupedFeedForEntities` (dedup by entity, exclude already-digested unless `regenerate`, apply age floor). Agent groups by source type, applies `summaryPrompt`s, assembles with `digestIntro`, translates. `POST /api/skill/digests` resolves language, optionally clears same-day digests + markers, creates `Digest` (`status=SYNCED`), upserts `DigestedItem`s.

**Key files:** `src/lib/digest-prompts.ts`, `src/lib/digest-library.ts`, `src/lib/source-config-store.ts`, `src/lib/feed-preferences.ts`, `src/lib/builder-channel-resolver.ts`, `src/app/api/skill/context/route.ts`, `src/app/api/skill/digests/route.ts`, `scripts/builder-digest.mjs`, `skills/builder-blog-digest/jobs/digest-*.md`.

**Behavior rules:**

1. The context endpoint returns everything needed to generate a digest: subscriptions, library builders, candidates, source configs, and prompts.
2. Candidates exclude posts already digested (`DigestedItem` markers) unless `regenerate=true`, which passes `excludeDigestedForUserId=null`.
3. `DigestedItem` is keyed by canonical identity `(userId, entityId, kind, externalId)` so dedup spans channel variants.
4. The digest payload carries `title`, `content`, `language`, period bounds, `itemCount`, `regenerate`, and `digestedItems[]`.
5. **Regenerate** deletes the user's existing same-day digests **and** their `DigestedItem` markers before creating the new digest, so the rebuilt digest re-marks the posts it actually presents. **[Discrepancy]** The marker deletion is conditioned on same-day digest rows existing and matches by `digestId`; markers with `digestId=null` (from already-deleted digests) are not cleared and will keep blocking re-presentation. Intended: always delete the user's `DigestedItem` rows within the same-day window on regenerate, regardless of whether digest rows or `digestId` links survive.
6. `DigestedItem` upsert is atomic; on override it refreshes `feedItemId` and `digestId` but **preserves the original `digestedAt`**. **[Discrepancy]** The update clause relies on Prisma's implicit behavior rather than explicitly omitting `digestedAt`; make the omission explicit so the first-digested timestamp is provably preserved.
7. Digest language is the account-wide `UserFeedPreference.summaryLanguage` if set, else the payload `language` (cross-ref §5 rule 4).
8. Section content uses source-specific prompts (`summarizeTweets` for X, `summarizePodcast` for podcasts/YouTube, `summarizeBlogs` for blogs), assembled with `digestIntro`, then translated.
9. Candidates are deduped across channels by entity, picking the user's pinned primary variant (§2 rule 5).
10. The optional age floor `digestMaxPostAgeDays` (`null` = no floor) gates candidate age; with no floor, repeats are prevented solely by `DigestedItem` markers.
11. Default frequency is daily; weekly or custom day counts are supported (custom clamped 1..365).
12. Payload limits: ≤200KB content, ≤5000 `digestedItems`, ≤180-char title.
13. Digests created via `/api/skill/digests` always have `status=SYNCED`. **[Stale]** `DigestStatus.GENERATED` is a legacy value never written or queried; treat as dead.
14. The regenerate flag flows through job markdown templates (`{{DIGEST_REGENERATE}}`, `{{DIGEST_REGENERATE_FLAG}}`).
15. `commonSummaryRules` apply to every single-post summary: no fabrication, source-link requirements, body-only content.
16. `DigestedItem.digestId` is nullable and provenance-only; deleting a `Digest` does not orphan markers — they persist as permanent "was shown" records.
17. **[Stale comment]** `--regenerate` ignores the `DigestedItem` marker gate, **not** the `digestMaxPostAgeDays` age floor; the two windows are distinct.

---

## 9. Digested Item Tracking & Content Dedup

**Purpose.** Prevent duplicate digest presentation per user, keyed at canonical content identity so channel variants count as one; survive `FeedItem` and `Digest` deletion.

**Key entities:** `DigestedItem` (unique `(userId, entityId, kind, externalId)`; nullable `feedItemId`, nullable `digestId`, `digestedAt`).

**Behavior rules:**

1. `DigestedItem` is keyed by `(userId, entityId, kind, externalId)` — all channel variants count as one record per user.
2. Every item presented to a digest is upserted into `DigestedItem` with the composite key, recording `feedItemId` (nullable), `digestId` (nullable), `digestedAt`.
3. On idempotent re-run, the update refreshes `feedItemId`/`digestId` but must **not** change `digestedAt` (see §8 rule 6 for the explicit-omit fix).
4. Candidate selection excludes posts with an existing `DigestedItem` unless `regenerate=true` (passes `excludeDigestedForUserId=null`).
5. On `regenerate=true`, same-day markers are cleared so the rebuilt digest re-marks its actual content (see §8 rule 5 for the `digestId=null` edge-case fix — this is the highest-confidence bug in the dedup path).
6. `feedItemId` is nullable so the marker survives `FeedItem` deletion and keeps deduping by canonical identity.
7. `digestId` is nullable so the marker survives `Digest` deletion as a permanent presentation record.
8. `entityId` references `BuilderEntity`, so markers persist across channel switches and builder deactivation.
9. A marker for one user never affects another; all queries are `userId`-scoped.
10. The optional per-user lookback floor (`digestMaxPostAgeDays`, nullable) is independent of markers; with no floor, markers alone gate repeats.

---

## 10. Recommendations & Feed (Timeline)

**Purpose.** Compute and persist personalized, ranked, deduped feed snapshots in two scopes: **for-you** (owned + hub items) and **subscription** (subscribed builders only).

**Key entities:** `RecommendationSnapshot`, `RecommendationSnapshotItem` (`rank`, `score`, JSON `reasons`), `FeedRead`, plus internal `RecommendationCandidate`/`RecommendationSignals`/`RecommendationResult`.

**Data flow.** `GET /api/recommendations/timeline` or `/api/recommendations` → `createRecommendationSnapshot`: load prefs/subscriptions/read history/existing snapshot items in parallel → fetch candidates (for-you: 90-day owned + hub; subscription: subscribed builders) → dedup by `entityId:kind:externalId`, excluding already-read and already-snapshotted → pick primary variant → build signals → score → sort → persist top N. Mark-read via `POST /api/recommendations` → `FeedRead`.

**Key files:** `src/lib/recommendations.ts`, `src/lib/recommendation-view-model.ts`, `src/lib/builder-channel-picker.ts`, `src/app/api/recommendations/**`, `src/components/RecommendationFeed.tsx`, `src/components/ForYouRecommendationSection.tsx`.

**Behavior rules:**

1. Dedup is by canonical key `entityId:kind:externalId` across channel variants; reading one channel marks the post read everywhere (`FeedRead`, keyed at entity level).
2. Variant selection uses the shared ordering of §2 rule 5 (pin → ownership → recency). **[Discrepancy]** This subsystem reimplements the picker locally instead of reusing `pickPrimaryVariant`; consolidate.
3. **For-you** fetches candidates owned-by-user OR in hub items, within 90 days, limited to 1000, deduped against read + snapshotted. **Subscription** fetches only subscribed builders within 90 days, same exclusions.
4. **[Discrepancy]** `unreadRemaining` should be the count of distinct unread canonical keys after dedup. For-you computes this correctly (`dedupGroups.size`); the subscription scope sets it from a pre-dedup `feedItem.count()`. Intended: both scopes count distinct unread canonical keys.
5. Snapshots are created on demand and persisted; subsequent timeline requests return the most recent snapshot without regenerating unless new unread items arrive.
6. **Ranking:** sort by `score` descending; tie-break by `originalPostTime` so that, on equal score, **newer posts come first**. **[Discrepancy — high confidence]** `compareDates` returns `a.time - b.time`, sorting oldest-first on ties; it should return `b.time - a.time`.
7. **Score components:** term matching (3× profile text, 2× subscriptions, 1× reads); subscription signal +18; read-builder signal +10; source-type affinity (≤10); hub popularity (≤8, logarithmic); kind affinity (≤10); recency (≤14 for posts ≤14 days old); body-length bonus +2 for >800 chars.
8. The timeline endpoint returns `{snapshots, unreadRemaining, strategy}`; the feed endpoint returns `{snapshot, unreadRemaining, candidateCount}`.
9. Snapshot `reason` is prefixed `subscription:` for subscription scope and unprefixed for for-you, preserving scope when filtering snapshots.
10. **[Discrepancy]** The documented 2-minute per-user candidate cache is not implemented (`getForYouCandidates` queries Prisma every call). Either implement the cache (`revalidateTag`) or drop the claim.

---

## 11. User Feed Preferences & Settings

**Purpose.** Manage per-user digest cadence, lookback window, account-wide summary language, per-entity primary-channel pinning, recommendation profile, and read history.

**Key entities:** `UserFeedPreference` (`digestFrequency`, `digestCustomFrequencyDays`, `digestMaxPostAgeDays`, `recommendationProfile`, `summaryLanguage`), `UserChannelPreference` (`primaryBuilderId`, `pinnedByUser`), `FeedRead`, `DigestedItem`.

**Key files:** `src/lib/feed-preferences.ts`, `src/lib/mark-read.ts`, `src/lib/builder-channel-resolver.ts`, `src/app/api/settings/feed-preferences/route.ts`, `src/app/api/settings/summary-language/route.ts`, `src/app/api/builders/channel-preference/route.ts`, `src/components/FeedPreferenceForm.tsx`, `src/components/ChannelPreferenceToggle.tsx`.

**Behavior rules:**

1. `digestFrequency` defaults to `DAILY`; custom frequencies clamp to `[1, 365]` days.
2. `digestMaxPostAgeDays = null` means no time floor (markers alone gate repeats); when set, clamp to `[1, 365]`.
3. Frequency determines the fallback window: DAILY=1, WEEKLY=7, CUSTOM=`digestCustomFrequencyDays`.
4. Account-wide `summaryLanguage` (`null` = per-source default) overrides every `SourceTypeConfig.summaryLanguage` in `/api/skill/context` (cross-ref §5 rule 4, §8 rule 7).
5. `UserChannelPreference.primaryBuilderId` + `pinnedByUser` track the preferred channel per entity; `pinnedByUser=true` means explicit (star toggle), `false` means auto-selected (on subscribe/import).
6. `FeedRead` and `DigestedItem` are keyed `(userId, entityId, kind, externalId)` — entity-level (cross-ref §2 rule 7, §9 rule 1).
7. Channel dedup in recommendations and feed lists picks one variant per `(entityId, kind, externalId)` via §2 rule 5.
8. `recommendationProfile` is free-form text (≤4000 chars) tokenized into recommendation signals.
9. `/api/skill/context` candidate selection excludes already-digested posts (unless regenerate), respects the lookback floor if set, and caps at 80 items per request (self-draining — only returned items get marked digested).
10. Subscriptions are per-channel (`Builder`), but subscription-scope recommendations derive entity IDs from all subscribed builders and return deduped items.
11. On import removal, `UserChannelPreference` rebinds per §2 rule 12 / §4 rule 7.
12. **[Discrepancy — high confidence]** Recommendation candidate windows are hardcoded to 90 days in three places in `src/lib/recommendations.ts`, independent of `digestMaxPostAgeDays`. `digestMaxPostAgeDays` governs **digest** candidates only; the 90-day recommendation window is a separate, fixed bound. This is intended for now but the divergence must be documented so it is not mistaken for a single shared setting.
13. **[Dead code]** `defaultDigestMaxPostAgeDays = 90` in `src/lib/feed-preferences.ts` is exported but unused (the mandatory 90-day cap was removed); logic uses `digestMaxPostAgeDays(preference)` which returns `null` when unset.
14. **[Discrepancy]** On the Settings page, a new user's `digestCustomFrequencyDays` initial form value falls back to `digestFrequencyDays(preference)` (1 for DAILY) rather than the saved custom value; intended `preference?.digestCustomFrequencyDays ?? 1`.

---

## 12. Search & Discovery

**Purpose.** Full-text search and autocomplete across the user's library — builders, feed items, and digests — with advanced query syntax, exact/semantic/hybrid modes, sorting, and time filtering.

**Key entities:** `SearchDocument` (type `builder|feed|digest`), `SearchResult` (+ score, snippet), `ParsedSearchQuery`, `SearchProximityPair`.

**Data flow.** `SearchForm` → `/api/search/suggest` (autocomplete) → `/search` page → `searchUserLibrary` (Prisma queries scoped to active pool) → `rankSearchDocuments` (`parseSearchQuery` → scoring lanes → filtering) → ranked `SearchResult[]`.

**Key files:** `src/lib/search.ts`, `src/lib/user-search.ts`, `src/app/api/search/suggest/route.ts`, `src/app/(workspace)/search/page.tsx`, `src/components/SearchForm.tsx`.

**Behavior rules:**

1. Mode defaults to `hybrid` (`exact`|`semantic`|`hybrid`); sort defaults to `relevance` (`newest` = date descending); time defaults to `any` (`day`/`week`/`month`/`year`).
2. Query parsing supports: `site:`/`-site:`, `type:`/`filetype:`/negations, `title:`/`intitle:`/`allintitle:`, `text:`/`intext:`/`allintext:`, `url:`/`inurl:`/`allinurl:`, `after:`/`before:`, `+term`, `-term`, `"phrase"`, `-"phrase"`, `term OR term`, `around(N)`, and parenthesized OR.
3. Common typos are auto-corrected with "Did you mean" suggestions.
4. **Exact** matches only explicit phrases and OR alternatives (no semantic scoring). **Semantic** uses only semantic scoring (synonym expansion). **Hybrid** combines exact and semantic 50/50, then promotes a top-4 priority group (top-2 exact leaders + top-2 semantic leaders), followed by the rest by hybrid score.
5. Filter-only queries (operators, no term text) return results with `score=1`.
6. Results are scoped to the user's active builder pool (`activePoolBuilderIds`); hub items are also accessible.
7. Three document types are indexed: `builder`, `feed`, `digest`; builder docs rank with type priority `digest < feed < builder`.
8. Snippets prioritize exact matches over token matches, truncated to ~120 chars with ellipsis; highlight terms exclude wildcards and sort longest-first.
9. Recent searches are stored in `localStorage` (`builder-blog-searches`, max 5, deduped by normalized form).
10. Autocomplete merges recent + live server + related suggestions across four kinds (`recent`, `query`, `entity`, `result`); ordering depends on query state.
11. `after:`/`before:` accept ISO `YYYY-MM-DD` and override time-range filters. `site:` supports partial path matching with hostname normalization (strip `www.`/protocol).
12. Phrase wildcard `*` allows a one-token gap with stem matching; `around(N)` matches within N tokens; `allin*` variants require all scoped terms present; OR contexts require at least one alternative to match.
13. DB queries use case-insensitive `LIKE` on candidate terms. Per-type fetch limits: builders 200, feed 800, digests 350; all candidates are ranked, top 40 returned.
14. The URL `type` param and the in-query `type:` operator are independent and both applied.
15. **[Dead code]** `mergeSearchSuggestions` (`src/lib/search.ts`) is exported but unused; `SearchForm` merges inline.
16. **[Discrepancy]** `searchHighlightTerms` drops phrases containing `*`, losing highlights for intentional wildcard phrases (e.g. `agent * memory`); intended to still highlight the non-wildcard components.
17. **[Discrepancy]** `around(N)` accepts up to 99-token gaps; intended to cap at a reasonable bound (≈10–20). Hybrid-mode candidates are initialized `score=0` then overwritten by `applyHybridScores`; the initial assignment is inert.
18. **[Discrepancy]** The search page calls `didYouMeanSearch` / `relatedSearchSuggestions` unconditionally; intended to gate these on a non-empty query.

---

## 13. Frontend Workspace Pages & Layout

**Purpose.** Provide the authenticated workspace UI: dashboard (recommendations, digests, for-you/subscription tabs), source management (library, hub, detail), builder profiles with deduped feeds, search, settings, and digest history.

**Data flow.** Auth → `AppShell` layout wraps all workspace pages → each page queries Prisma in parallel for session context, active builders, imports, subscriptions, channel preferences, and feed metadata → dedup feed by `(entityId, kind, externalId)` → render.

**Key files:** `src/app/(workspace)/layout.tsx`, `src/app/(workspace)/{dashboard,builders,builder/[entityId],library-hub,settings,search}/page.tsx`, `src/app/history/page.tsx`, `src/components/{ForYouRecommendationSection,RecommendationFeed,PostCard,RecentPostsList}.tsx`.

**Behavior rules:**

1. The workspace layout's auth guard redirects to `/login` when the session is missing.
2. Active builder lists include only `removedAt IS NULL` pool entries (cross-ref §3 rule 1).
3. The featured community library auto-imports for non-admin users unless hidden; admins see their own private builders labeled "Community library" instead (cross-ref §4 rules 8–9).
4. Entity dedup: two `FeedItem`s are the same content iff `(entityId, kind, externalId)` match, regardless of source channel.
5. Deduped feed selection uses `pickPrimaryVariant` per §2 rule 5; `excludeDigestedForUserId`, when set, filters **after** variant selection.
6. Reading on any channel marks the canonical key read (`FeedRead`), covering all variants.
7. The subscription toggle on a builder detail is "any channel subscribed" — the entity is followed if at least one channel has a subscription.
8. Builder sort: by kind (alphabetic), then `createdAt` (newest first within kind), tie-break by name. **[Discrepancy]** Pools are loaded `createdAt asc` but re-sorted kind-first; a newly added builder sinks below existing sources of its kind rather than appearing at the top, contradicting the "immediately visible after refresh" intent. Document the kind-first ordering as authoritative and adjust expectations.
9. The private library contents are rebuilt to match the user's pool whenever composition changes.
10. Channel-preference rebinding after import removal follows §2 rule 12 / §4 rule 7.
11. Search is bounded by per-type limits (builder 200 / feed 800 / digest 350) before ranking and is scoped to the user's followed sources (cross-ref §12 rules 6, 13).
12. The builders page computes `latestPostCreatedAt` per source via `groupBy publishedAt`.
13. The recommendation detail page validates access (builder in active pool or imported library) before rendering and marks reads with `source='recommendation-detail'`.
14. `DashboardHomeTabs` renders `ai-digest | for-you | subscription` and handles archive pagination.
15. The digest archive shows today's digest (`itemCount > 0`, created today) first, then older digests excluding today. **[Discrepancy]** A same-day retry that creates a second digest with `itemCount=0` can shadow an earlier non-empty same-day digest; intended to prefer the non-empty same-day digest.
16. The entity detail header count (`countDedupedItemsForEntity`, distinct by `kind+externalId`) must match the count shown by `RecentPostsList` (`fetchDedupedFeedForEntities`); keep them synchronized.
17. **[Discrepancy]** `fetchDedupedFeedForEntities` overscans `limit*3` when `excludeDigested=false` but applies **no** take cap when `excludeDigested=true`; intended to apply an upper bound even when excluding digested items.
18. **[Discrepancy / dead route]** `/recommendations` redirects to `/dashboard?tab=for-you` and is effectively unreachable; it is a migration artifact (recommendations → dashboard consolidation).
19. **[Discrepancy / UX]** `ForYouRecommendationSection` shows the same "not ready yet" message for both error and empty states; intended to distinguish a network error (with retry guidance) from genuinely-empty recommendations.

---

## Cross-cutting Invariants

These rules span multiple subsystems and take precedence over any single subsystem's local description.

### A. Authentication & authorization
1. **Two auth surfaces, no overlap.** Web routes authenticate via NextAuth session cookie (`getCurrentSession()`); `/api/skill/*` routes authenticate via bearer agent token (`getUserFromBearer()`). Every `/api/skill/*` endpoint requires a valid, non-revoked token — there is no unauthenticated skill endpoint (§1.5, §1.12).
2. **Secrets at rest.** Agent tokens are stored as SHA-256 hash + AES-256-GCM ciphertext keyed off `NEXTAUTH_SECRET`; a DB dump alone recovers nothing (§1.3–§1.4). One-time exchange codes are single-use and hard-deleted on use or on any invalid attempt (§1.7–§1.8).
3. **Uniform failure responses.** Token/exchange-code validation must never act as an enumeration oracle: missing, expired, revoked, and malformed must return the same response (§1.8, §1.13).
4. **Machine identity is never an auth signal.** Hostname/platform/username headers are best-effort, user-fakeable, and used only for Settings-UI recognition. No access-control decision may consult them (§1.11, §6.14, §7).
5. **Rate limiting is a speed-bump, not a quota.** The in-process limiter does not survive across serverless instances; hard quotas require a distributed limiter (§1.10).

### B. Per-user scoping
6. **Every query is `userId`-scoped.** Pool membership, subscriptions, reads, digests, recommendations, search, and fetch state are all per-user. A marker, snapshot, or read for one user never affects another (§9.9, §11.6).
7. **No cross-user leakage of internal IDs or state.** The context route strips `ownerUserId` for imported builders (§6.17) and must expose `personalFetchStates` only for builders the requester owns (§6.18 — flagged discrepancy). Search and recommendation detail enforce pool/import access before rendering (§12.6, §13.13).

### C. Canonical entity identity (unifies §2, §9, §10, §11, §13)
8. **One creator, one entity, many channels.** A `BuilderEntity` is created once per `(kind, canonicalKey)` and never mutated. Each `Builder` is a channel variant linked to it.
9. **Entity-level keying everywhere.** `FeedRead`, `DigestedItem`, and feed/recommendation dedup are all keyed `(userId, entityId, kind, externalId)`. Acting on one channel variant (read, digest, dedup) applies across every variant.
10. **One variant-selection ordering.** Pinned primary → user's own channel → most recent (`lastFetchedAt`, then `publishedAt`, then `createdAt`). This must be a single shared implementation (`pickPrimaryVariant`), reused by builder detail, deduped feeds, digests, and recommendations (§2.5 — flagged duplication in §10.2).
11. **Preferences point only to reachable channels.** `UserChannelPreference.primaryBuilderId` must always reference a reachable channel; on library removal it rebinds (own first, then most-recent imported) or the preference is deleted (§2.12, §3.9, §4.7, §11.11).

### D. The agent fetch/summarize/skip contract (unifies §6, §7)
12. **Plan is authoritative.** The agent completes exactly the `fetchTasks` the CLI planned — no new sources or URLs (§6.1).
13. **Total accountability.** Every planned task ends in exactly one outcome: synced item (body + summary) **or** a `taskOutcome` of `skipped`/`failed`/`blocked` with a reason; `skipped` requires per-task evidence. Silent omissions are validation failures (§6.2, §6.5, §7.13). Schema-level enforcement of evidence-for-`skipped` is the intended state (§6.5 discrepancy).
14. **`fetchTaskId` is the spine.** It binds a synced item's `rawJson` to its planned task and to the fetch-log outcome record; it must equal the planned task ID (§6.6, §7.5).
15. **Real primary content only.** `requires_agent` tasks must obtain genuine primary content (e.g. YouTube transcripts, never metadata) before summarizing (§6.3–§6.4).

### E. Content-quality gating (unifies §5, §6, §7)
16. **Server is the gate.** No `FeedItem` is persisted unless its body meets `minChars`/`minWords` (per the user's `SourceTypeConfig.contentQuality`, with YouTube-specific ratios) **and** it has a non-empty summary. Failures are recorded as `itemResults`/`taskOutcomes`, never silently dropped (§5.5, §6.8–§6.9, §7.2–§7.4, §7.9).
17. **Config drives gating.** Quality floors and prompts come from DB config (global template + per-user override), not hardcoded values; the account-wide language override applies on top (§5.1–§5.4).

### F. Digest dedup (unifies §8, §9, §11)
18. **Markers prevent repeats.** A post appears in at most one digest per user; `DigestedItem` (keyed by canonical identity) gates candidate selection. The 80-item context cap is self-draining because only returned items get marked (§8.2–§8.3, §9.1–§9.4, §11.9).
19. **Markers are durable.** They survive `FeedItem` and `Digest` deletion (nullable FKs) and persist `digestedAt` across re-runs (§8.16, §9.3, §9.6–§9.7).
20. **Regenerate is the only override.** `regenerate=true` bypasses the marker gate and must clear the user's same-day markers so the rebuilt digest re-marks its actual content — including markers with `digestId=null` (§8.5 — the highest-confidence dedup bug; intended fix: delete by user + same-day window unconditionally).

### G. Configuration & seeding (unifies §5, §8)
21. **Seed once, never drop, edit freely.** `SourceTypeConfig` and the `DigestConfig` singleton are idempotently seeded at first boot and preserve admin edits across deploys. Per-user configs are materialized lazily from the global template on first touch, then edited per-user.
22. **Static vs. dynamic split.** Code-bound source fields live in frozen `SOURCE_DEFINITIONS`; all editable fields live in the DB, which is the runtime truth (static labels are synchronous-path fallbacks only) (§5.1–§5.2).

### H. Caching & revalidation
23. **In-process config caches are explicitly invalidated on write** (`invalidateSourceConfigsCache`, `invalidateDigestConfigCache`); per-user configs are read uncached every request (§5.8). Library import/removal revalidates `/builders`, `/dashboard`, `/library-hub`, and `user:${userId}:recs` (§4.11).
