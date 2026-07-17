# FollowBrief Platform Library Identity

## Goal

Make FollowBrief-provided source collections immediately recognizable as platform-curated content, while preserving a clear distinction from source libraries shared by users.

## Naming

- The canonical platform library is named **FollowBrief source library**.
- User-facing filters and empty states that refer specifically to the platform library use **FollowBrief**, not **Community**.
- Supporting copy uses **Curated by FollowBrief** or **Sources selected and maintained by FollowBrief**.
- Libraries published by users remain **Shared source libraries** and use the author's identity.
- Internal function names, database fields, migration history, and compatibility identifiers may retain `community`. They describe the legacy implementation contract and are not shown to users.

## Visual Identity

Use the approved option B: a small existing `BrandMark` followed by the platform name.

- Place the mark immediately before `FollowBrief source library` wherever the canonical library is presented as a primary title.
- In compact ownership metadata, use the mark with `FollowBrief` when space permits.
- Do not add a `Provided` pill. Existing status and action pills already carry operational meaning, so another badge would add noise.
- Keep the mark subordinate to source content: it identifies provenance and must not make the platform library look like a promotional card.
- On mobile, the mark and title may wrap as one title group, but neither may overlap actions or source counts.

## Implementation Boundary

- Centralize platform-library display copy and identity so Sources, Hub, source detail, admin views, and empty states cannot drift.
- Update persisted canonical library names when the existing ensure/sync path runs. Do not rewrite historical migrations.
- Keep booleans and internal symbols such as `isCommunity`, `findAdminCommunityLibrary`, and `ensureDefaultCommunityLibraryImport` unless a user-visible value depends on them.
- Do not rename genuinely community-authored or user-shared concepts to FollowBrief.

## Accessibility

- Treat the brand mark as decorative when adjacent text already says FollowBrief.
- The visible title remains complete text and does not rely on the `F` mark for meaning.
- Maintain existing heading hierarchy and action labels.

## Verification

- Repository scan finds no user-facing `Community source library` or community-filter copy for the platform collection.
- Tests cover the canonical name, FollowBrief filter copy, and the shared-user distinction.
- Mobile and desktop visual checks confirm the brand lockup fits existing library surfaces.
- TypeScript, ESLint, relevant tests, and production build pass.
