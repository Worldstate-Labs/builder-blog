# Remove Hourly Scheduling and Hide User Cost Design

## Goal

Remove hourly as a selectable or accepted recurring frequency for both fetch and digest setup. Hide monetary fetch and digest cost from every non-admin UI while preserving token, input, and output usage. Admin users retain the current monetary cost display.

## Decisions

- There are no installed hourly schedules to migrate or preserve.
- Monetary cost remains present in existing database records and API responses. This change controls client rendering only.
- Token counts remain visible to all users.
- Admin status continues to use the existing server-side `isAdminEmail` result. The client never chooses its own admin state.
- Cost rendering defaults to hidden when a caller does not provide an explicit admin-derived flag.

## Hourly Frequency Contract

The public product contract will contain only `daily` and `weekly` for recurring fetch and digest setup; `once` remains a separate one-time action.

Remove `1h` from:

- the `SkillPromptActions` frequency type and option list;
- prompt-link frequency types and closed-set parsing;
- prompt rendering frequency types, labels, and interval substitutions;
- cron-job create/update route frequency validation;
- downloadable skill-job route frequency validation and labels;
- tests and user-journey assertions that advertise hourly.

Requests that submit `frequency: "1h"` must fail validation. Generic schedule-reading helpers may retain defensive support for arbitrary existing cron data because they are not user-selectable creation paths.

## Cost Visibility Contract

`RunUsageSummary` gains an explicit `showCost` boolean with a secure default of `false`. It always renders Tokens, Input, and Output when usage exists, and renders the Cost item only when `showCost` is true.

`FetchLogPanel` and `DigestLogPanel` gain `showCost` props, also defaulting to false. They pass the flag to `RunUsageSummary`. Fetch worker-group inline usage formatting receives the same flag so a non-admin never sees a `$...` amount outside the summary card.

The server-rendered builders page already computes `isAdmin` with `isAdminEmail`. It will pass that value through:

- `SourceSyncLogTabs` to `FetchLogPanel`;
- `OwnDigestPipelineUpdatesCard` to `DigestLogPanel`.

Admin-only cloud-fetch views continue using their existing cost UI and admin route protection. Ordinary user cloud-fetch logs currently do not render cost and need no display change.

## Data Flow

1. The server authenticates the user and computes `isAdmin`.
2. The server passes `showCost={isAdmin}` into the fetch and digest log component trees.
3. Usage parsing remains unchanged, so token counts and cost data remain available to existing admin views.
4. Non-admin component trees omit every monetary cost element and inline monetary string.

## Error Handling and Compatibility

- Missing `showCost` fails closed: cost is hidden.
- Invalid hourly prompt-link or cron API requests are rejected by the existing validation paths.
- No database migration or schedule cleanup is required.
- No API response or persisted usage shape changes.

## Test Strategy

Use test-first changes with explicit RED/GREEN evidence:

1. Frequency tests assert that UI options and every public closed set exclude `1h`, while `1h` submissions are rejected.
2. Component rendering tests verify that non-admin usage shows Tokens/Input/Output without Cost or `$`, and admin rendering includes Cost.
3. Fetch log tests cover both the top usage summary and worker-group inline usage.
4. Digest log tests cover the build-log usage summary.
5. User-journey tests verify that the builders page derives and threads `isAdmin` into both log trees.
6. Run the full unit suite, lint, production build, and prompt runtime trace verification.

## Out of Scope

- Removing cost fields from APIs or database records.
- Changing token accounting, cost calculation, or admin cloud-fetch budgeting.
- Migrating or stopping existing hourly schedules.
