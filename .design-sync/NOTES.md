# design-sync notes — builder_blog (FollowBrief)

## Shape: storybook, via an extracted component-library package (path B)

`builder_blog` is a Next.js app, **not** a published DS library. The storybook
shape needs a built package with a `.d.ts` public-API entry (the "public
exports" gate reads `exportedNames` from `<entry>/index.d.ts`; a Next app has
none → 0 components). So we extracted one:

- **`design-system/`** — a real library that re-exports the decoupled
  presentational components from `src/components` and builds with **tsup** to
  `design-system/dist/{index.js,index.d.ts}`. `@/` is mapped to `../src` in
  `design-system/tsconfig.json`; react/react-dom are external; everything else
  (lucide, the pure `@/lib` utils, the components) is bundled.
- The converter points `--entry design-system/dist/index.js`; `PKG_DIR` becomes
  `design-system/dist`, so `exportedNames` reads `design-system/dist/index.d.ts`
  → components discovered.

## Re-sync steps (the converter is deterministic from config)

1. Refresh staged scripts: re-copy the skill's `package-build.mjs` etc. into `.ds-sync/`.
2. **Rebuild the package**: `npm --prefix design-system run build` (this is `cfg.buildCmd`). Without a fresh `dist/index.d.ts`, discovery breaks.
3. Rebuild the reference: `npm --prefix storybook-tools run build-storybook -- -o "$(git rev-parse --show-toplevel)/.design-sync/sb-reference"`.
4. Fetch anchor + run `resync.mjs` (or `package-build.mjs` → `package-validate.mjs` → `storybook/compare.mjs`).
5. Deps for a fresh clone: in `.ds-sync/` `npm i esbuild ts-morph @types/react playwright && npx playwright install chromium`; in `design-system/` `npm i`; in `storybook-tools/` `npm i`. Storybook/Vite intentionally live outside the root package so Vercel app builds do not install them.

## Re-sync risks / watch-list

- **Scope is currently 5 components** (BrandMark, EmptyState, PageHeader, SourceBadge, PostCardView) — `design-system/src/index.ts` is the entry. To expand, add re-exports there AND add `cfg.titleMap` for components whose **story title ≠ export name**: `AppNav→AppNavView`, `WorkspaceTopTabs→WorkspaceTopTabsView`, `SearchTypeTabs→SearchTypeTabsView`, `DigestContent→DigestContentView`, `DigestArchivePicker→DigestArchivePickerView`, `DigestPipelineSelector→DigestPipelineSelectorView`; and `Count→CountBadge` / `FeedState→FeedEmptyState` (multi-export files — pick the primary or split the story title).
- **Preview decorator did not bundle** (`! preview decorator bundle failed`) → `cfg.provider` is unset. Previews render the **light** default, which matched the storybook light default, so grades are valid for light mode. If dark-mode variants are ever graded, the theme shell (`<html data-theme>` from `.storybook/preview.tsx`) must be reproduced via `cfg.provider` or an owned preview.
- **STORY_CAP**: PostCardView (7 stories) and SourceBadge (7) were captured at the default 6 — `SourceBadge/Gallery` and `PostCardView/ReadState` tails were not individually graded. Raise `--max-stories 7` when those tails matter.
- Components are re-exports of **app** components: if an app component's props change, `npm --prefix design-system run build` must re-run so `dist/index.d.ts` (the API contract) stays accurate.
- `tokens/` reported 3 missing token references (below threshold) — cosmetic.
