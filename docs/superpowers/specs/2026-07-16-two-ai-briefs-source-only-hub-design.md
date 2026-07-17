# Two AI Briefs and Source-Only Hub Design

## Goal

Make AI Brief a fixed two-publication experience: every user sees `Your AI Brief` and the curated `FollowBrief AI Brief`. Remove user-managed Brief titles, Brief sharing, Brief imports, and Brief browsing from Hub.

## Product Model

- `Your AI Brief` is the user's private, writable Brief. Its display title is fixed and cannot be edited.
- `FollowBrief AI Brief` is the single curated, read-only Brief supplied by FollowBrief.
- Historical `DigestPipelineShare` and `DigestPipelineImport` rows remain in storage for compatibility. They no longer determine visible user options, except for the canonical FollowBrief Brief.
- Source library sharing and importing remain unchanged.

## AI Brief Page

The AI Brief tab renders a flat stack of two Brief cards without collection-level wrappers:

1. `Your AI Brief`, with build/stop controls, schedule status, logs, latest issue, and issue count.
2. `FollowBrief AI Brief`, read-only, with its current status, latest issue, and issue count.

Remove the collection headings, descriptions, title editor, visibility toggle, import controls, and import counts. The cards remain visually distinct because they are the actual repeated content units; no card is nested in another card.

## Hub

Hub becomes a single source-library page. It no longer renders the `Source libraries` / `AI Brief collections` tab strip, does not parse `?tab=ai-digests`, and does not query Brief shares or imports. Existing source library cards and import behavior remain unchanged.

## API Compatibility

User-facing Brief share, rename, import, and remove-import endpoints return `404` so stale clients cannot create new relationships. Internal helpers remain available for maintaining the canonical FollowBrief Brief and its default relationship.

## Other Surfaces

The dashboard Brief selector contains only `Your AI Brief` and `FollowBrief AI Brief`. Old imported community Briefs are not shown. Direct historical data remains stored, but there is no navigation or mutation entry point for it.

User-visible navigation, selector, loading, empty, and authorization copy uses `AI Brief` rather than the obsolete `AI Brief collection` model.

Legal and UI copy must stop claiming that users can share AI Brief collections to Hub. Source library sharing language remains unchanged.

## Verification

- Contract tests pin the fixed titles, two-card page, missing share/import controls, source-only Hub, closed mutation routes, and legal copy.
- Targeted ESLint and TypeScript checks cover touched files.
- A production build verifies route removal and server/client boundaries.
- Desktop and mobile screenshots verify the flat hierarchy, two visible Briefs, and absence of Hub tabs.
