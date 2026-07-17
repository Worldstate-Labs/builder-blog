# Imported source library metadata design

## Goal

Show each imported source library's current fetch cadence and summary language in both Hub and Sources without adding visible field labels or making the card visually heavier.

## Card anatomy

- Row 1 contains only the source library title.
- Row 2 contains two quiet metadata items on the left and the existing import-removal action on the right.
- The cadence item uses the app's Lucide icon vocabulary:
  - `Clock3` plus the stored frequency label while the owner library schedule is active.
  - `CircleStop` plus `Stopped` when the schedule is absent or not active.
- The language item uses Lucide's standard `Languages` icon plus the display-normalized language value, such as `Chinese`, `English`, or `Original`.
- Icons are decorative. Each metadata item exposes an accessible label such as `Build frequency: Every day`, `Build status: Stopped`, or `Language: Chinese` without rendering those labels visually.
- Metadata uses the existing muted text color and compact UI typography. It is inline metadata, not a bordered chip.
- On narrow screens, row 2 may wrap; the metadata group stays readable and the action does not shrink.

## Hub behavior

- Imported Hub source-library cards move their remove action from the title row into the new metadata row.
- The imported action's visible label becomes `Remove import`, matching Sources. Existing confirmation behavior remains unchanged.
- Unimported and owned Hub cards retain their current action placement and behavior; this change is scoped to imported cards.

## Sources behavior

- Every card under `Imported source libraries` receives the same shared metadata presentation.
- The existing `LibraryImportRemoveButton` remains the removal control and moves into the second row alongside the metadata.
- The expandable source summary remains below these two rows and is otherwise unchanged.

## Data contract

- Metadata belongs to the source-library owner, not to the importing user.
- Load metadata for all relevant owner IDs in batched queries:
  - `LibraryCronJob.status` and `frequencyLabel` determine cadence.
  - `UserFeedPreference.summaryLanguage` determines language.
- No per-card database query is allowed.
- Format configured languages through the existing `displayLanguagePreference` source of truth. A missing preference displays `Original`, matching the source-library setup UI's unset-language presentation.
- Only the exact cron status `active` displays `frequencyLabel`. A missing cron row, `stopped`, or any other status displays `Stopped`.
- Both Hub and Sources consume one shared serializable metadata shape so status and language formatting cannot drift.

## Summary language choices

- Fetch sources and AI Brief dialogs use one shared language option contract.
- Fixed-language choices are derived from the app's `uiLocaleOptions`, plus `Original` as the first choice. The supported choices are therefore English, Simplified Chinese, Traditional Chinese, Japanese, Korean, and Spanish, plus Original.
- The stored fixed-language values use the corresponding locale codes (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`). Existing stored legacy values remain displayable and selectable for that account, but unsupported legacy choices are not offered for new selection.
- Move the locale list into a small locale-contract module and re-export it from `i18n.ts`; summary-language code must not duplicate the list or import the full phrase catalog merely to obtain locale metadata.
- `displayLanguagePreference` resolves both locale codes and existing legacy values to stable user-facing labels.

## Components and styling

- Add a small shared presentational component for the two icon-value metadata items.
- Reuse existing `fb-btn light compact` removal styling and existing Lucide icons.
- Add only shared card-metadata layout classes; do not create a new button variant or inline styles.
- Preserve dark-mode behavior by using existing semantic color tokens.

## Verification

- Data tests cover active, stopped, missing-schedule, configured-language, and missing-language cases.
- Language contract tests prove that Fetch sources and AI Brief use exactly `Original` plus the current i18n locale set, while preserving an existing custom or legacy value.
- UI contract tests assert that both Hub and Sources render the shared metadata and keep titles separate from row 2.
- Tests assert that Hub's imported action says `Remove import` while its import action remains unchanged.
- Run targeted tests, ESLint, TypeScript, and `git diff --check`.
- Inspect both Hub and Sources at desktop and narrow viewport widths.

## Out of scope

- Editing cadence or language from these cards.
- Changing source-list expansion, import confirmation, or removal API behavior.
- Adding metadata to unimported Hub cards.
