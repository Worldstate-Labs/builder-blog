# Imported Source Library Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show cadence and language on imported source-library cards in Hub and Sources, and make Fetch sources and AI Brief language choices equal to Original plus the app's supported i18n locales.

**Architecture:** Extract the lightweight locale catalog from the phrase module, then derive the summary-language options and display labels from that shared catalog. Load source-library owner schedule/language metadata in two batched queries, resolve it through one pure formatter, and render it with one shared icon-value component on both surfaces.

**Tech Stack:** Next.js 16 App Router server/client components, React 19, TypeScript, Prisma, Lucide React, Node test runner via `tsx`.

---

## File structure

- Create `src/lib/ui-locales.ts`: small locale catalog and `UiLocale` type, independent of the phrase table.
- Modify `src/lib/i18n.ts`: re-export the locale catalog while retaining the current public import contract.
- Create `src/lib/summary-language-options.ts`: derive select options from `uiLocaleOptions`, prepend Original, and preserve an existing legacy/custom value.
- Modify `src/lib/language-preference.ts`: format locale codes and legacy values through the same locale catalog.
- Modify `src/components/settings/SettingsFields.tsx`: re-export the shared summary-language option helpers instead of owning a second list.
- Create `src/lib/source-library-metadata.ts`: batched Prisma loader plus pure status/language resolver.
- Create `src/components/SourceLibraryMetadata.tsx`: shared `Clock3` / `CircleStop` / `Languages` icon-value presentation.
- Modify `src/app/(workspace)/library-hub/page.tsx` and `src/components/LibraryHubImportForm.tsx`: attach and render owner metadata on imported Hub cards.
- Modify `src/app/(workspace)/builders/page.tsx`: attach metadata and place it with `LibraryImportRemoveButton` on row 2.
- Modify `src/app/globals.css`: shared metadata row and responsive layout.
- Create `tests/summary-language-options.test.ts` and `tests/source-library-metadata.test.ts`; update `tests/performance-ux.test.ts` for integration contracts.

### Task 1: Unify locale and summary-language choices

**Files:**
- Create: `src/lib/ui-locales.ts`
- Create: `src/lib/summary-language-options.ts`
- Modify: `src/lib/i18n.ts`
- Modify: `src/lib/language-preference.ts`
- Modify: `src/components/settings/SettingsFields.tsx`
- Create: `tests/summary-language-options.test.ts`

- [ ] **Step 1: Write the failing language contract tests**

Assert that options are exactly:

```ts
[
  { value: "source", label: "original" },
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
]
```

Also assert that `languageOptions("Français")` and `languageOptions("Deutsch")` each append the existing legacy value without offering either value to a new account. Assert that `displayLanguagePreference` formats all six locale codes plus every previously shipped fixed-language value: `zh`, `English`, `日本語`, `한국어`, `Español`, `Français`, and `Deutsch`. French and German must retain their stable title-case/native labels rather than falling through to uppercase formatting.

- [ ] **Step 2: Run the new test and verify RED**

Run: `npx tsx --test tests/summary-language-options.test.ts`

Expected: FAIL because the shared modules and locale-derived option list do not exist.

- [ ] **Step 3: Read the relevant Next.js component boundary guide**

Read: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`

Confirm that the shared locale and option modules contain only serializable data and can be consumed by both server and client components.

- [ ] **Step 4: Implement the shared locale and language contracts**

Move the existing `uiLocaleOptions` value and `UiLocale` type into `ui-locales.ts`; import and re-export them from `i18n.ts`. Derive the summary choices in `summary-language-options.ts`:

```ts
export const SUMMARY_LANGUAGE_OPTIONS = [
  { value: ORIGINAL_CONTENT_LANGUAGE_VALUE, label: ORIGINAL_CONTENT_LANGUAGE_LABEL },
  ...uiLocaleOptions.map(({ code, label }) => ({ value: code, label })),
] as const;
```

Keep `languageOptions(current)` compatibility behavior for any saved custom value. Replace the list in `SettingsFields.tsx` with re-exports. Extend `displayLanguagePreference` to resolve locale codes through `uiLocaleOptions`, explicitly preserve all previously shipped fixed-language values (including `Français` and `Deutsch`), then fall back for unknown custom values.

- [ ] **Step 5: Run the language tests and verify GREEN**

Run: `npx tsx --test tests/summary-language-options.test.ts tests/i18n-phrases.test.ts tests/user-journeys.test.ts tests/cloud-source-library.test.ts tests/library-fetch-runs.test.ts tests/performance-ux.test.ts`

Expected: all pass, including the existing cloud-library naming, Fetch Log formatting, and shared UI consumers of `displayLanguagePreference`.

- [ ] **Step 6: Commit the language contract**

Stage only the files in Task 1 and commit with the Lore protocol.

### Task 2: Add the source-library metadata contract and component

**Files:**
- Create: `src/lib/source-library-metadata.ts`
- Create: `src/components/SourceLibraryMetadata.tsx`
- Create: `tests/source-library-metadata.test.ts`

- [ ] **Step 1: Write failing resolver and rendered-markup tests**

Test these cases:

```ts
resolveSourceLibraryMetadata({
  cronJob: { status: "active", frequencyLabel: "Every day" },
  summaryLanguage: "zh-TW",
})
// => { cadence: "Every day", cadenceState: "active", language: "繁體中文" }

resolveSourceLibraryMetadata({
  cronJob: { status: "stopped", frequencyLabel: "Every day" },
  summaryLanguage: "ja",
})
// => { cadence: "Stopped", cadenceState: "stopped", language: "日本語" }
```

Cover missing cron and missing language (`Stopped`, `original`). Render the component and assert accessible labels plus `Clock3`, `CircleStop`, and `Languages` SVG markup without visible `Build frequency` or `Language` labels.

- [ ] **Step 2: Run the metadata test and verify RED**

Run: `npx tsx --test tests/source-library-metadata.test.ts`

Expected: FAIL because the resolver/component do not exist.

- [ ] **Step 3: Implement the pure resolver and batched loader**

Export a serializable metadata type, `resolveSourceLibraryMetadata`, and `getSourceLibraryMetadataByOwnerIds`. The loader deduplicates owner IDs and performs exactly two `findMany` calls in `Promise.all`: `libraryCronJob` and `userFeedPreference`. Map the rows by `userId`, then resolve each owner.

- [ ] **Step 4: Implement the shared metadata presentation**

Render two icon-value spans. Use `Clock3` only for active cadence, `CircleStop` otherwise, and `Languages` for language. Mark SVGs `aria-hidden`; put the field meaning in wrapper `aria-label`s.

- [ ] **Step 5: Run the metadata tests and verify GREEN**

Run: `npx tsx --test tests/source-library-metadata.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit the metadata contract**

Stage only Task 2 files and commit with the Lore protocol.

### Task 3: Render metadata in Hub imported cards

**Files:**
- Modify: `src/app/(workspace)/library-hub/page.tsx`
- Modify: `src/components/LibraryHubImportForm.tsx`
- Modify: `tests/performance-ux.test.ts`

- [ ] **Step 1: Add failing Hub integration assertions**

Assert that the page batches owner metadata and adds it to every `HubLibrary`. Assert that an imported `HubCard` renders row 1 with title only, then `SourceLibraryMetadata` and the remove action on row 2. Assert the button uses `Trash2` and visible `Remove import`; the unimported action remains `Import` in the existing header.

- [ ] **Step 2: Run the focused integration test and verify RED**

Run: `npx tsx --test --test-name-pattern="library hub exposes share and multi-import flows|imported source library metadata" tests/performance-ux.test.ts`

Expected: FAIL on missing metadata loader/component usage.

- [ ] **Step 3: Implement Hub data and layout**

Load owner metadata after the batched Hub query, add it to `HubLibrary`, replace the imported check icon with `Trash2`, and render imported metadata/action in a dedicated second-row wrapper. Do not move or alter owned/unimported Hub actions.

- [ ] **Step 4: Run the Hub integration test and verify GREEN**

Run the Step 2 command again; expected all selected tests pass.

- [ ] **Step 5: Commit the Hub integration**

Stage only the Hub files and relevant test hunk; commit with the Lore protocol.

### Task 4: Render metadata in Sources imported cards and style both surfaces

**Files:**
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/performance-ux.test.ts`

- [ ] **Step 1: Add failing Sources and responsive-layout assertions**

Assert that imported library owner metadata is batched, passed to `SourceLibraryMetadata`, and placed in the same `library-section-meta` row as `LibraryImportRemoveButton`. Assert CSS defines three imported-card rows (`title`, metadata/action, source toggle), shared icon sizing, muted values, non-shrinking action, and narrow wrapping.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx tsx --test --test-name-pattern="imported source library metadata|library hub exposes share and multi-import flows|list actions use compact controls" tests/performance-ux.test.ts`

Expected: FAIL on the new Sources and CSS assertions.

- [ ] **Step 3: Implement Sources data/layout and shared CSS**

Batch owner metadata for imported sections. Pass `SourceLibraryMetadata` before `LibraryImportRemoveButton` inside the full-width second row. Change imported card grid areas to title, metadata/action, then toggle. Add shared styles using existing semantic tokens; at mobile widths wrap the second row and preserve button width.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command again; expected all selected tests pass.

- [ ] **Step 5: Commit the Sources and style integration**

Stage only Task 4 files and the relevant test hunk; commit with the Lore protocol.

### Task 5: Verify visually, publish main, and verify production

**Files:**
- Verify all files changed in Tasks 1-4.

- [ ] **Step 1: Run complete targeted verification**

```bash
npx tsx --test \
  tests/summary-language-options.test.ts \
  tests/source-library-metadata.test.ts \
  tests/i18n-phrases.test.ts \
  tests/user-journeys.test.ts \
  tests/cloud-source-library.test.ts \
  tests/library-fetch-runs.test.ts \
  tests/performance-ux.test.ts
npx eslint \
  src/lib/ui-locales.ts \
  src/lib/summary-language-options.ts \
  src/lib/language-preference.ts \
  src/lib/source-library-metadata.ts \
  src/components/settings/SettingsFields.tsx \
  src/components/SourceLibraryMetadata.tsx \
  src/components/LibraryHubImportForm.tsx \
  'src/app/(workspace)/library-hub/page.tsx' \
  'src/app/(workspace)/builders/page.tsx'
npx tsc --noEmit --pretty false
git diff --check origin/main...HEAD
npm run build
```

Expected: zero failures/errors and build exit 0.

- [ ] **Step 2: Inspect desktop and narrow layouts**

Use a real browser against the local app. Verify Hub imported and Sources imported cards at desktop and mobile widths, including active frequency, stopped state, Traditional Chinese/Japanese labels, expansion, and removal confirmation. Check console for new errors.

- [ ] **Step 3: Review the final diff boundary**

Confirm only the spec, plan, shared contracts/component, two page integrations, CSS, and targeted tests are included. Preserve every unrelated change in `/Users/jie/code/builder_blog`.

- [ ] **Step 4: Push the isolated branch to main**

Refresh `origin/main`. If it moved, rebase or cherry-pick the verified commits onto a fresh `origin/main` worktree and rerun affected verification. Push with `git push origin HEAD:main`.

- [ ] **Step 5: Verify remote parity and production deployment**

Compare `HEAD`, `origin/main`, and `git ls-remote origin refs/heads/main`. Inspect the production deployment and perform the smallest authenticated live check available for Hub/Sources. Report any gap honestly.
