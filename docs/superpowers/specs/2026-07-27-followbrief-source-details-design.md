# FollowBrief Source Details Disclosure

## Goal

Make the FollowBrief fetch-log summary behave like the Agent fetch-log summary: the compact status area should disclose the detailed source rows only when the user asks to see them.

## Accepted design

- Keep the existing two-column mobile metadata grid.
- Keep `Fetch frequency`, `Language`, and `FollowBrief sources` unchanged.
- Replace `On time sources` with `Status / log`.
- Show a pill button in that cell with:
  - the submitted source count (`1 source` or `x sources`);
  - the existing `Details` hint;
  - a down/up chevron reflecting the disclosure state.
- Reuse the Agent fetch-log `digest-status-toggle` visual treatment.
- Start with source details collapsed.
- Clicking the pill expands the existing per-source status rows below the metadata grid.
- Each source row remains independently expandable for its run and failure details.
- Preserve the existing five-row preview and `Show more` / `Show less` behavior inside the expanded section.
- Collapsing and reopening the top-level details preserves the currently expanded source row and the `Show more` state.
- When no source rows are available, show `0 sources` and `Details` in the same pill, but disable the control so it does not open an empty region.

## Interaction and accessibility

- The summary button exposes `aria-expanded` and `aria-controls`.
- The controlled details region has a stable ID.
- The chevron is decorative and hidden from assistive technology.
- The control remains keyboard operable through the native button element.
- The unavailable zero-source control uses the native disabled state.
- The source count updates from the current cloud-log data without changing the disclosure state.

## Data and backend impact

This is a presentation-only change. It does not alter fetch scheduling, source status calculation, API payloads, persistence, or logging.

## Verification

- Source-level regression tests cover the label, count, shared styling, accessibility attributes, default state, and conditional source-list rendering.
- Existing tests continue to cover per-source expansion and `Show more`.
- Run the complete test suite, lint, typecheck, and production build.
- Render the mobile state and compare it with the supplied screenshots for hierarchy, spacing, and responsive layout.

## Out of scope

- Changing the meaning or calculation of source deadline states.
- Automatically opening every source row when the summary is expanded.
- Redesigning the Agent fetch-log control.
