# Cloud Worker Task Clarity Design

## Goal

Make the Cloud fetch monitor readable at a glance and give its two task sections distinct responsibilities:

- **Post task queue** shows only tasks still waiting for a local worker assignment.
- **Worker lanes** shows only tasks assigned to a specific local worker.

Internal compound task IDs remain implementation details and are never the primary task label.

## Current Problem

`AdminCloudFetchLog` renders `workerHost.tasks` directly in Post task queue, including assigned and completed work. `buildWorkerShardGroups` then merges those same tasks with source-delivery outcomes and renders them again under Worker lanes. Unassigned tasks are grouped into a synthetic `No local worker assignment` lane.

When a task has no title or URL, `taskLabel` falls back to the complete internal ID:

```text
fetch_post:<source database id>:<content type>:<external id>
```

This makes both sections appear duplicative and exposes machine identifiers as the dominant UI text.

## Recommended Design

### Task ownership

Derive two mutually exclusive projections from the existing payload:

1. A task is **unassigned** when `workerId` is null or blank. Only unassigned tasks appear in Post task queue.
2. A task is **assigned** when `workerId` is non-empty. Only assigned tasks participate in Worker lanes.

Status does not override assignment. A planned task with a worker ID belongs to its lane; an unassigned task with any retained status remains in the queue until it receives a worker ID.

Source deliveries remain unchanged and continue to provide the historical batch and outcome view.

### Human-readable labels

Use the first available value in this order:

1. Non-empty task title.
2. A readable label derived from the task URL.
3. A readable label derived from the compound task ID.
4. `Untitled post task`.

For URL-backed tasks, parse the URL safely, remove credentials, query, hash, a
leading `www.`, and a trailing slash, then display `hostname/path`. If URL
parsing fails, continue to compound-ID parsing instead of rendering the raw URL.

Compound task IDs are parsed defensively. Expected fetch-post IDs have the shape:

```text
fetch_post:<source id>:<content type>:<external id>
```

The external ID may contain colons, so parsing preserves all segments after the content type. Percent-encoded values are decoded with a safe fallback when malformed.

Content-specific labels:

- `BLOG_POST`: remove a known provider prefix such as `github-trending:` and show the remaining repository or article identity, for example `vorukot/superfile`.
- `TWEET`: show `Tweet <short external id>`.
- `PODCAST_EPISODE`: show `Episode <short external id>`.
- Other types: convert the content type to title case and append a shortened external identity.

Shortening is deterministic: values of 18 characters or fewer remain intact;
longer values use the first 8 characters, a single ellipsis character, and the
last 6 characters. Readable blog identities may use up to 64 characters before
the same middle-shortening rule is applied. The existing builder/source metadata
remains below the label, so author and source context are not duplicated in the
title.

### Queue presentation

- Heading: `Waiting for assignment`
- Count: `<N> waiting`
- Empty state: `No tasks waiting for assignment.`
- Rows retain status, source metadata, relative update time, output statistics, and the existing message.
- Raw task IDs are not rendered as the row title.

### Worker lane presentation

- Heading remains `Worker lanes`.
- Supporting copy is `Each lane is one local worker slot. Assigned tasks appear here when a worker claims them.`
- The synthetic `No local worker assignment` lane is removed.
- Assigned running, completed, skipped, and failed tasks remain grouped by their real `workerId`.
- Existing lane status, progress summary, usage, timestamps, expansion behavior, and `TaskRow` details remain unchanged.

## Architecture

Keep the change in the client-side monitor boundary because assignment and display data already exist in `CloudWorkerHostTask`. Add small pure helpers near the existing `taskLabel` and `buildWorkerShardGroups` logic:

- assignment predicate
- safe compound-ID parser and formatter
- unassigned queue selector

This avoids changing the worker heartbeat payload, API serialization, or persisted records.

## Accessibility and Visual Treatment

Follow the existing restrained product UI:

- Preserve semantic headings and lists.
- Keep status text visible rather than encoding state through color alone.
- Use existing typography, spacing, status chips, and hairline separators.
- Do not add cards, modals, animation, or new color tokens.
- Ensure long labels wrap without forcing horizontal overflow.

## Error Handling

- Malformed percent escapes must not throw during rendering.
- Missing or malformed IDs use `Untitled post task`.
- Blank or whitespace-only worker IDs count as unassigned.
- Unknown content types get a generic readable label rather than exposing the full compound ID.

## Testing

Add regression coverage that proves:

- Queue selection includes only tasks without a usable worker ID.
- Worker lane grouping excludes unassigned tasks.
- GitHub Trending IDs render as repository names.
- Tweet and podcast IDs render as short content labels.
- Malformed encoded IDs do not throw and use a readable fallback.
- Existing titles and URLs take precedence over ID parsing.
- Queue heading, count, empty-state copy, and worker-lane explanatory copy match the new responsibilities.

Run the focused test files, then the repository lint, typecheck, full test suite, and static analysis commands defined by the project.

## Non-goals

- No worker protocol or API schema changes.
- No changes to task scheduling, assignment, retry, or synchronization behavior.
- No redesign of Source deliveries.
- No new dependency.
- No broad refactor of `AdminCloudFetchLog`.
