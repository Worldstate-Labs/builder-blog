# New Product Launches Shared Source Design

**Date:** 2026-08-01  
**Status:** Approved for implementation planning

## Goal

Add an opt-in `New Product Launches` source type that gives users five recent,
high-signal product launches per admin fetch run without requiring those users
to fetch the source themselves.

FollowBrief's current execution model remains intact: an admin-owned Builder is
fetched by the admin's regular library fetch job. The deployed Next.js app
continues to provide configuration, persistence, synchronization, and shared
reads; it does not become a crawler or a long-running worker.

## Confirmed Product Decisions

- The source type ID is `new_product_launches`; its display label is
  `New Product Launches`.
- Users add the source explicitly from the candidate source library. It is not
  part of the automatically imported FollowBrief source library.
- The admin owns and follows the canonical producer Builder. The admin's
  regular library fetch schedule determines when it runs.
- Frequency and lookback are fetch-job settings, not source-type settings.
- Each run emits at most five launch candidates. Five is a fixed product rule,
  not a setting.
- Discovery uses Show HN, DEV `#showdev`, Hugging Face Spaces, and Lobsters.
  Product Hunt is not used, and GitHub Trending remains a separate source.
- A non-admin user's fetch plan and logs retain the source row and label it
  `Maintained by FollowBrief`; no local or cloud fetch task is created for it.
- Settings use the existing source-type card only: Fetching instructions,
  Summarization instructions, and Quality gates. No provider, frequency,
  lookback, or per-run-count controls are added.

## Existing Architecture Constraints

The repository has no Vercel cron and no deployed background fetch worker.
Cloud queue APIs are a control plane for an admin-managed local
`cloud-library-host` process installed through macOS `launchd` or Linux
`systemd --user`. A prior server-side crawler was deliberately removed so that
fetching remains Agent-side.

The new source therefore follows the existing `github_trending` and
`product_hunt_top_products` admin-fetch-only pattern rather than the cloud
submission lifecycle. Cloud submission is driven by user demand, language
libraries, submitter deadlines, and zero-submitter cleanup; those semantics do
not fit a platform-maintained opt-in source.

## Source Identity and Ownership

### Registry and candidate library

Add `new_product_launches` to the static source registry as a WEBSITE source
producing BLOG_POST items and requiring Agent work. Add one curated candidate
entry with a fixed name, source value, icon, and canonical public URL so every
owner's Builder resolves to the same BuilderEntity.

The fixed source value is not an upstream fetch endpoint. The custom discovery
handler ignores the Builder URL and calls the four provider endpoints directly.
The fixed value exists only to provide stable input, deduplication, and entity
identity. It must be a public HTTPS URL that passes the existing source-add
validation and does not collide with another fixed source.

Add the same special-source handling used by GitHub Trending and Product Hunt
to source input resolution, placeholders, display labels, icons, and source
ordering. A user should be able to add the candidate without typing or editing
a URL.

### Admin producer

The admin adds and follows the source in the admin's personal library. The
admin's regular one-time or recurring library fetch includes the Builder and
writes FeedItems to that admin-owned Builder.

No migration may assume a production admin user ID. Registry/config defaults
and the candidate entry are seeded by code; creation of the producer Builder is
an explicit admin operation after deployment.

### Opt-in, not featured

Introduce an explicit opt-in platform-source classification containing
`new_product_launches`. Admin personal-library synchronization must exclude
this classification when it computes the featured FollowBrief source library's
items and expected item count. The Builder remains in the admin's private
library and remains eligible for the admin's regular fetch.

This exclusion is source-type-specific. Existing featured sources and existing
admin-fetch-only behavior must not change.

## Fetch Pipeline

### Discovery boundary

Add one deterministic discovery handler to the existing shared
`buildFetchTasksForBuilders` pipeline. Both one-time and recurring admin regular
fetches therefore use exactly the same implementation. The handler receives the
run's existing `days` value as its lookback and always caps its final output at
five candidates.

Provider adapters return one normalized launch-candidate contract:

- provider and provider item ID;
- title and short provider description;
- provider discussion URL;
- official product/repository URL when supplied by the provider;
- author or maker;
- published timestamp;
- provider engagement facts such as points, reactions, comments, likes, or
  trending score;
- tags and the original structured provider payload required for audit.

The adapters use public structured interfaces:

- Hacker News official API `showstories` plus item endpoints;
- Forem/DEV public articles API filtered to `showdev`;
- Hugging Face public Spaces API ordered by recent creation;
- Lobsters public `show` and `announce` RSS feeds.

Provider HTTP and parsing logic must accept an injected fetcher so tests use
fixtures rather than live services.

### Eligibility, deduplication, and ranking

Discard candidates outside the run lookback or without a usable title and
public destination/discussion URL. Normalize tracking parameters and derive a
dedup key from the official product or repository URL when available; otherwise
use the provider plus provider item ID. Merge cross-provider duplicates while
retaining every provider URL and the strongest available metadata.

Rank deterministically using provider-relative engagement, freshness within the
run lookback, and a corroboration boost for launches found on multiple
providers. Cap the final list to two items from any single provider when other
eligible providers have candidates, then select the top five. Stable URL and ID
tie-breakers make repeated runs reproducible.

The resulting FeedItem external ID is derived from the normalized product/repo
URL when available and otherwise from the provider item identity. This keeps
the existing `(builderId, kind, externalId)` upsert idempotent across runs.

### Per-launch Agent task

Each selected candidate becomes one existing-format post task. The task carries
the normalized provider facts, all supporting URLs, rank evidence, and the
source-config snapshot.

The source's Fetching prompt is provider-neutral. It instructs the Agent to use
the supplied structured facts, inspect the official product page when one is
available, and follow at most one directly linked supporting page. It must not
attempt to browse Product Hunt or perform open-ended product research.

The source's Summarization prompt produces a concise product brief containing
the product name, what it does, intended user, why it is notable based on
evidence, launch source links, and date. The run language remains authoritative.
The existing Quality gates validate the fetched primary content before sync.

## Shared Read Model

Add `new_product_launches` to the admin-fetch-only source list. Non-admin
library context must never put it in `libraryFetchBuilders`, even when the user
owns the logical Builder and that Builder has zero local FeedItems. Personal
sync must continue rejecting uploaded FeedItems for this source type.

Extend the central user-content Builder resolver so that, for a logical
admin-fetch-only Builder, it includes matching admin-owned Builders with the
same BuilderEntity and source type. Authorization remains opt-in: admin-owned
content is added only when the user already has the logical Builder in their
pool/subscriptions.

This single resolver must make shared admin posts available consistently to:

- Following and recommendation snapshots;
- AI Brief candidate selection;
- source search and feed-item APIs;
- source detail and source-list counts.

Existing cloud-linked Builder resolution remains unchanged and composes with
the new admin-owned resolution. FeedItems are not copied to each user.

Removing the source deletes or deactivates only the user's own pool,
subscription, and channel state. It never deletes the admin Builder or shared
FeedItems.

## Fetch Plan and Log UX

The source remains visible in a non-admin user's library and fetch planning UI.
It is rendered as `Maintained by FollowBrief` and is excluded from planned,
running, synced, failed, and deadline counts for work owned by that user.

If the admin producer has not fetched any posts yet, the user sees an empty
source with the same maintenance label. The UI must not suggest running a local
or cloud fetch to fill it.

The admin sees normal source planning, tasks, results, and failures because the
admin regular fetch is the producer.

## Cloud Submission Isolation

Platform-maintained sources are ineligible for FollowBrief cloud submission.
The cloud submission chooser shows the source as maintained and disables its
checkbox. Submit-all calculations, the 20-source limit, and server-side
submission selection count only eligible sources.

The server rejects an explicitly submitted platform-maintained Builder with a
stable validation reason instead of silently creating a CloudSourceSubmission,
CloudSourceTask, or language-library copy. Existing cloud source scheduling,
leases, submitter accounting, and zero-submitter cleanup are untouched.

## Settings

Seed the new source into the existing SourceTypeConfig and
UserSourceTypeConfig flow. Its Settings card has the same three sections shown
for Product Hunt Top Products:

1. Fetching: optional source-specific per-launch extraction instructions.
2. Summarization: the per-launch output contract; run prompt sets language.
3. Quality gates: existing minimum content and quality controls.

Do not add source-specific database fields or UI controls. The handler consumes
the existing source-config snapshot. Frequency and lookback continue to come
from the admin library fetch task, and the handler's final candidate cap is the
constant five.

## Error Handling and Observability

- Fetch providers independently with bounded timeouts and settle them
  independently. One provider failure does not fail the source when another
  provider yields valid candidates.
- Record provider, HTTP/parsing failure category, and concise reason in the
  discovery result/log without storing credentials or full response bodies.
- If every provider fails, mark source discovery failed and create no post
  tasks. The regular fetch run surfaces the source failure normally.
- If providers succeed but produce no eligible new candidates, complete the
  source as no update rather than failure.
- Existing post-task timeout, validation, checkpoint, sync, and retry behavior
  remains authoritative after discovery.
- Repeated discovery and sync are idempotent through stable external IDs and the
  existing FeedItem unique key.

## Testing and Acceptance Criteria

### Deterministic discovery tests

- Parse fixtures for all four providers.
- Apply the fetch job's lookback and reject malformed/private URLs.
- Deduplicate the same launch across providers while preserving provenance.
- Rank reproducibly, enforce provider diversity when possible, and return no
  more than five candidates.
- Continue after one or more provider failures; fail only when every provider
  fails; treat a successful empty result as no update.

### Pipeline and configuration tests

- One-time and recurring admin regular fetches reach the same handler.
- The handler uses the run `days` value and fixed cap of five.
- Fetching, Summarization, and Quality-gate settings are seeded, rendered, sent
  through skill context, and consumed by generated tasks.
- Sync is idempotent across repeated runs.

### Ownership and visibility tests

- Admin can fetch and sync this source.
- A non-admin who adds it receives no local fetch task and sees
  `Maintained by FollowBrief` in plans/logs.
- Following, AI Brief, search, feed API, detail, and source counts all expose the
  matching admin FeedItems after opt-in.
- A user without the source cannot gain access through the shared resolver.
- Removing a user's source does not affect the producer Builder or another
  user.
- The source is absent from default FollowBrief source-library imports even
  after admin personal-library synchronization.
- Cloud submit-all and selected-submit paths exclude or reject it and create no
  cloud task rows.

### Regression and visual verification

- Existing GitHub Trending, Product Hunt, normal personal sources, featured
  FollowBrief source-library imports, and cloud submissions retain their
  behavior.
- Run focused unit/integration suites plus lint, typecheck/build, and the full
  test suite.
- Verify desktop and mobile source-add, source-list, fetch-plan/log, Settings,
  Following, and source-detail states with browser screenshots. Text, counts,
  icons, and maintenance labels must not overlap or imply user-owned fetching.

## Rollout

1. Deploy registry, config seed, candidate, pipeline, resolver, UI, and cloud
   isolation changes.
2. As admin, add and follow `New Product Launches` from the candidate library.
3. Run an admin one-time regular fetch and verify five or fewer validated posts.
4. Confirm the admin recurring library schedule is active at the desired
   library frequency.
5. Add the source as a non-admin test user and verify immediate shared posts,
   maintenance labeling, no local/cloud work, and AI Brief/Following access.

No production data backfill or destructive migration is required.
