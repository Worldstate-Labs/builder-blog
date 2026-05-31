# Digest Pipeline Imports Design

## Summary

Users can share their continuously updated digest pipeline to Hub, import
other users' shared digest pipelines, and switch between their own pipeline and
imported pipelines from the Home Digest tab. A digest pipeline means the
owner's latest non-empty digest plus that owner's digest archive. Imported
pipelines are read-only views; only the viewer's own pipeline exposes build,
prompt, cron, and diagnostic controls.

Terminology:
- Use `share` for making a user's own digest pipeline available in Hub.
- Use `import` for adding either a source library or another user's digest
  pipeline to the current user's workspace.
- Source library imports copy source membership into the user's builder pool.
- Digest pipeline imports are read-only references to another user's latest
  digest plus archive; they do not copy digest rows.

## Goals

- Let a user publish their digest stream as a first-class Hub object.
- Let another user import that stream without copying digest rows.
- Let Home > Digest switch between "My Digest" and imported pipelines.
- Preserve the current full digest authoring experience for "My Digest".
- Render imported pipelines as read-only digest results: latest digest and
  archive only.
- Include imported pipeline digests in search results.
- Give every pipeline a meaningful title so users can choose quickly.

## Non-Goals

- Do not copy another user's digest rows into the importer's account.
- Do not let importers build, regenerate, edit prompts, or configure cron for
  another user's pipeline.
- Do not make digest pipeline import behave like source library import: source
  libraries copy source membership, while digest pipelines stay read-only
  references.
- Do not add per-digest collaboration, comments, or permission tiers beyond
  public shared pipelines.

## Data Model

Add `DigestPipelineShare`:

- `id`
- `ownerUserId`
- `slug`
- `title`
- `description`
- `isPublic`
- `importCount`
- `viewCount`
- `createdAt`
- `updatedAt`

Add `DigestPipelineImport`:

- `userId`
- `pipelineId`
- `createdAt`

Relations:
- `DigestPipelineShare.ownerUserId` points to `User.id`.
- `DigestPipelineImport.pipelineId` points to `DigestPipelineShare.id`.
- Digests stay owned by the pipeline owner through existing `Digest.userId`.

Indexes and constraints:
- Unique `DigestPipelineShare.slug`.
- Unique `DigestPipelineShare.ownerUserId` for the first version: one shared
  digest pipeline per user.
- Composite primary key on `DigestPipelineImport(userId, pipelineId)`.
- Index imports by `pipelineId`.

## Pipeline Titles

Default title rules:
- Current user's own selector label: `My AI Builder Digest`.
- Shared title default: `<Owner name>'s AI Builder Digest`.
- If no name exists, use the email local part or `FollowBrief user's AI Builder Digest`.
- If the owner customizes the share title, use that title everywhere.

Selector detail text:
- Own pipeline: `Private workspace` plus latest update information when present.
- Imported pipeline: `Shared by <owner> · <N> archived digests · updated <date time>`.

Hub card detail text:
- `Latest: <itemCount> items · Updated <date time> · <archiveCount> archived digests`.
- Empty pipeline: `No synced digests yet`.

## Hub Experience

Library Hub becomes a broader Hub with two sections or tabs:
- Source Libraries: existing library import flow and language stays unchanged.
- Digest Pipelines: shared digest pipeline cards with import/remove actions.

Each digest pipeline card shows:
- Title.
- Owner label.
- Description if present.
- Latest digest metadata.
- Archive count.
- Import count and view count.
- Import button if not owner and not already imported.
- Imported status with a remove action if already imported.
- Owner card action to manage sharing.

The existing "Share my library" action remains for source libraries. Add a
separate "Share my digest" action for the user's digest pipeline.

## Home Digest Tab

Add a pipeline selector above the digest content:
- Option 1: `My Digest`.
- Additional options: each imported digest pipeline by title.

URL state:
- `/dashboard?tab=ai-digest` selects the viewer's own pipeline.
- `/dashboard?tab=ai-digest&pipeline=<pipelineId>` selects an imported pipeline.
- Invalid, private, missing, or unimported pipeline ids fall back to the
  viewer's own pipeline.

Own pipeline view:
- Render `SkillPromptActions`.
- Render latest digest.
- Render archive.
- Render digest log.
- Empty state stays action-oriented: the user's agent can sync a digest.

Imported pipeline view:
- Do not render `SkillPromptActions`.
- Do not render digest log.
- Render read-only pipeline header with owner and update metadata.
- Render the owner's latest non-empty digest.
- Render the owner's archive.
- Empty state: `This shared pipeline has no digests yet.`

Archive pagination applies to the selected pipeline. Pagination URLs preserve
the selected `pipeline` query parameter.

## Search

Search should include:
- The current user's own digests.
- Digests from every public pipeline the user imports.

Search result attribution:
- Own digest source label remains `<itemCount> items · <language>`.
- Imported digest source label should include the pipeline title, for example
  `Jie's Frontier AI Brief · 7 items · zh`.

Search result URL:
- Own digest: `/dashboard?tab=ai-digest#<digestId>`.
- Imported digest: `/dashboard?tab=ai-digest&pipeline=<pipelineId>#<digestId>`.

Access rules:
- The digest search query must not expose arbitrary users' digests. It may only
  include digests where `Digest.userId` is the viewer, or where the digest owner
  owns a public pipeline that the viewer has imported.

## API And Permissions

Add API routes for digest pipeline imports:
- `POST /api/digest-pipelines/share` to create/update the current user's shared
  digest pipeline.
- `DELETE /api/digest-pipelines/share` to unshare it.
- `POST /api/digest-pipelines/imports` with `pipelineId`.
- `DELETE /api/digest-pipelines/imports/[pipelineId]`.

All routes require a logged-in session.

Permissions:
- Owners can share/unshare only their own pipeline.
- Users cannot import their own pipeline.
- Users can import only public pipelines.
- Imported views read digest rows from the owner, but never expose owner
  controls or token/prompt configuration.

## Testing Strategy

Use TDD for implementation.

Minimum tests:
- Prisma schema declares `DigestPipelineShare` and `DigestPipelineImport`
  with owner, public, importer, and uniqueness constraints.
- Hub page renders digest pipeline cards with import language.
- Home Digest tab renders a pipeline selector.
- Own pipeline view includes `SkillPromptActions` and `DigestLogPanel`.
- Imported pipeline view does not include `SkillPromptActions` or
  `DigestLogPanel`.
- Imported pipeline archive URLs preserve `pipeline=<pipelineId>`.
- Search includes imported digest pipeline content and produces URLs with the
  selected pipeline id.
- Search does not include unshared or unimported users' digest rows.

## Open Decisions Resolved

- Use `import` for digest pipelines and source libraries; distinguish behavior
  in copy and implementation.
- Include imported pipeline digests in search results.
- Keep digest rows owned by the original pipeline owner; importers read by
  reference.
