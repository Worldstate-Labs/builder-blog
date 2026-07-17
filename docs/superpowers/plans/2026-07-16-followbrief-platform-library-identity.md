# FollowBrief Platform Library Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rename every user-visible platform-curated source library to FollowBrief source library and give it the approved BrandMark plus name identity without changing legacy database contracts.

**Architecture:** Keep `adminCommunityLibraryName` as the internal compatibility symbol but change its canonical display value and reuse it across server-rendered surfaces. UI components continue receiving the existing `isCommunity` boolean and interpret it as platform provenance, rendering a small decorative `BrandMark` beside the explicit FollowBrief text. User-shared libraries remain visually and verbally distinct.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, existing CSS design system, Node test runner, Storybook/Playwright.

---

### Task 1: Lock the platform naming contract

**Files:**
- Modify: `tests/performance-ux.test.ts`
- Modify: `tests/cloud-source-library.test.ts`
- Modify: `tests/user-journeys.test.ts`
- Modify: `tests/library-hub-tabs.test.ts`

- [x] **Step 1: Write failing assertions for the canonical name**

Assert that `adminCommunityLibraryName` is `FollowBrief source library`, language variants begin with `FollowBrief source library`, and no user-facing component literal contains `Community source library` or `FollowBrief community`.

- [x] **Step 2: Write failing assertions for platform identity**

Assert that `LibraryHubImportForm` imports and renders `BrandMark` for `library.isCommunity` in both the primary title and compact ownership metadata, the filter label is `FollowBrief`, and user-shared library bylines still use `UserName`.

- [x] **Step 3: Run the focused tests and verify failure**

Run:

```bash
npx tsx --test tests/performance-ux.test.ts tests/cloud-source-library.test.ts tests/user-journeys.test.ts tests/library-hub-tabs.test.ts
```

Expected: failures reference the old Community strings and missing BrandMark rendering.

### Task 2: Centralize FollowBrief platform copy

**Files:**
- Modify: `src/lib/library-hub.ts`
- Modify: `src/lib/builder-pool.ts`
- Modify: `src/lib/cloud-source-library.ts`
- Modify: `src/app/(workspace)/builder/[entityId]/page.tsx`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/components/LibraryVisibilityToggle.tsx`
- Modify: `src/components/LibraryHubImportForm.tsx`
- Modify: `src/lib/i18n-phrases.ts`

- [x] **Step 1: Change canonical display values**

Use these user-facing values:

```ts
export const adminCommunityLibraryName = "FollowBrief source library";
export const adminCommunityLibraryDescription =
  "Sources selected and maintained by FollowBrief.";
```

Keep the legacy symbol names so server queries, imports, and migration history do not change.

- [x] **Step 2: Update generated platform-library variants**

Return `FollowBrief source library - ${language}` from `cloudLanguageLibraryHubName`. Update source detail labels, Sources ownership copy, admin sharing state, Hub filter text, Hub empty text, and translations to use FollowBrief.

- [x] **Step 3: Preserve genuinely shared terminology**

Do not alter `Shared source libraries`, user owner names, import actions, or internal `community` filter keys and booleans. Only the visible label for that internal filter becomes FollowBrief.

- [x] **Step 4: Run naming tests**

Run the command from Task 1. Expected: naming assertions pass.

### Task 3: Render the approved platform lockup

**Files:**
- Modify: `src/components/LibraryHubImportForm.tsx`
- Modify: `src/app/(workspace)/builders/page.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/performance-ux.test.ts`

- [x] **Step 1: Reuse BrandMark in Hub cards**

For `library.isCommunity`, render a title group containing `<BrandMark>` and the full text `FollowBrief source library`. Keep the mark `aria-hidden` through the existing component and leave action controls unchanged.

- [x] **Step 2: Reuse BrandMark in the Sources imported-library heading**

Pass a platform-provenance flag into the imported section view and render the same compact lockup. Do not add a pill or nested card.

- [x] **Step 3: Render branded compact ownership metadata**

For the platform Hub card only, replace the plain `Curated by FollowBrief` string in the stats row with a compact decorative `BrandMark` followed by `FollowBrief`. Keep user-owned and user-shared bylines unchanged, including the existing `UserName` rendering.

- [x] **Step 4: Add scoped responsive styling**

Add stable mark dimensions, a flex title group, and mobile wrapping rules. The mark and title must not overlap import actions, counts, or chevrons at 390px.

- [x] **Step 5: Run focused tests, lint, and typecheck**

```bash
npx tsx --test tests/performance-ux.test.ts tests/cloud-source-library.test.ts tests/user-journeys.test.ts tests/library-hub-tabs.test.ts
npx eslint src/lib/library-hub.ts src/lib/builder-pool.ts src/lib/cloud-source-library.ts src/components/LibraryHubImportForm.tsx src/components/LibraryVisibilityToggle.tsx 'src/app/(workspace)/builders/page.tsx' 'src/app/(workspace)/builder/[entityId]/page.tsx'
npx tsc --noEmit --pretty false
```

Expected: all commands exit 0.

### Task 4: Verify the complete user-visible surface

**Files:**
- Modify if needed: `src/lib/i18n-phrases.ts`
- Generated evidence only: `output/playwright/`

- [x] **Step 1: Scan for stale user-facing Community copy**

```bash
rg -n 'Community source library|FollowBrief community|No community source libraries|label: "Community"' src --glob '*.{ts,tsx}'
```

Expected: no user-visible matches; legacy internal symbols and comments may remain.

- [x] **Step 2: Run mobile and desktop visual checks**

Start the local app or relevant Storybook fixture, then use the repository-standard Playwright CLI wrapper:

```bash
PWCLI="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" -s=platform-library open http://127.0.0.1:<port>/<route-or-fixture>
"$PWCLI" -s=platform-library resize 390 844
"$PWCLI" -s=platform-library screenshot --filename output/playwright/followbrief-library-mobile.png --hires
"$PWCLI" -s=platform-library resize 1440 1000
"$PWCLI" -s=platform-library screenshot --filename output/playwright/followbrief-library-desktop.png --hires
"$PWCLI" -s=platform-library close
```

Confirm the title lockup, compact ownership lockup, source avatars, counts, and actions fit without overlap.

- [x] **Step 3: Run production build and diff checks**

```bash
npm run build
git diff --check
```

Expected: build succeeds and diff check reports no whitespace errors.

- [x] **Step 4: Commit implementation**

Stage only files in this plan and commit with the repository Lore trailers, recording verification and any remaining authenticated-page visual gap.
