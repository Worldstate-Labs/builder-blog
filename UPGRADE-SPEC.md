# FollowBrief UI Upgrade Spec — Refine & Elevate

## Executive summary

FollowBrief already has the right soul: editorial paper-and-ink, a disciplined oklch token system, and a serif/sans/mono type triad. This spec does **not** redraw that identity. It pushes craft to a Linear/Stratechery ceiling by fixing correctness defects first, then tightening type and vertical rhythm, formalizing a restrained elevation system, and bringing every interaction state (hover/focus/active/disabled) to parity in both light and dark mode.

The work is sequenced so **P0 correctness and accessibility defects lead** — a UI cannot be "elevated" while two components silently render broken backgrounds and focus is not guaranteed AA. Everything downstream (rhythm, depth, motion) is layered on a corrected foundation.

All ten dimensions are represented: **Color/Tokens, Typography, Spacing & Rhythm, Elevation/Depth, Interaction States, Motion, Accessibility, Dark-mode Parity, Component Polish, and Iconography.** Every move names an exact token/selector/file with before→after values.

The single hard defect: `--soft` is consumed at `globals.css:630` and `globals.css:1499` but **never defined** in `:root` or any dark-mode block — both backgrounds silently fall back to transparent in both themes. This is the lead P0.

---

## Design north star

> A daily brief that reads like printed paper and behaves like Linear. Hierarchy comes from type and whitespace, never chrome. Color is meaning, not decoration. Motion is a whisper. Depth is a hairline and a breath of shadow, never a card-stack. Light and dark are the same document under two lamps.

Guardrails for every move below:
- No new hue, no gradient-as-decoration, no glassmorphism, no sparkle, no emoji.
- Density via typography/rhythm, not borders.
- One signal at a time: `--accent` = interactive, `--signal` = live/success, `--warm`/`--danger` = literal only.
- Motion 120–180ms ease; all motion gated by `prefers-reduced-motion`.
- Every state change must hold WCAG 2.2 AA+ in both themes.

---

## Foundational layer first

Two things must be true before any elevation/rhythm work, because everything else inherits from them:

1. **Token completeness.** No `var()` may resolve to nothing. The `--soft` defect (P0-1) plus the `--success` alias and any other consumed-but-undefined tokens must be closed so the cascade is deterministic.
2. **Focus-visible floor.** A single global `:focus-visible` ring must exist and meet AA non-text contrast (3:1) against `--paper` and `--rail` in both themes, before per-component states are tuned (P0-2).

These are not aesthetic choices; they are the substrate the rest of the spec stands on.

---

## Prioritized moves

### P0 — Correctness & accessibility defects (block everything else)

---

**P0-1 · Define the missing `--soft` token (broken background in two components)**
- Dimension: Color/Tokens, Dark-mode parity
- File: `src/app/globals.css`
- Problem: `var(--soft)` is consumed at line 630 (`.user-menu-item:hover`) and line 1499 (`.library-visibility-toggle`) but `--soft` is never declared. Both rules resolve to an invalid value → effectively transparent in light **and** dark. The user-menu hover affordance is invisible; the visibility toggle has no fill.
- Intended semantics: a paper-level "quiet fill" for hover/resting surfaces. The codebase already has the correct token for this: `--rail` (line 6 `oklch(0.955 0.01 238)` light; line 53/31 `oklch(0.245 0.025 248)` dark). `--rail` is the established one-step-off-paper surface.
- Fix (preferred — reuse existing token, no new surface invented):
  - `globals.css:630` — `background: var(--soft);` → `background: var(--rail);`
  - `globals.css:1499` — `background: var(--soft);` → `background: var(--rail);`
- Alternative (if a distinct token is genuinely wanted): add to `:root` (after line 6) `--soft: var(--rail);` and mirror in the dark blocks (after line 53 and inside `@media (prefers-color-scheme: dark)` after line 31). Aliasing to `--rail` keeps a single source of truth. Do **not** introduce a new oklch value — that would add an undefined surface step.
- Verify: `.user-menu-item:hover` shows a one-step-off-paper fill; `.library-visibility-toggle` reads as a pill against paper, in both themes.

---

**P0-2 · Guarantee a global `:focus-visible` ring at AA non-text contrast**
- Dimension: Accessibility, Interaction states, Dark-mode parity
- File: `src/app/globals.css`
- Problem: focus reliance on per-component styling risks gaps; WCAG 2.2 (2.4.11 Focus Not Obscured, 2.4.13 Focus Appearance) requires a clearly visible, sufficiently-contrasting focus indicator on every interactive element.
- Fix: add a single global rule in `:root` scope:
  ```css
  :where(a, button, input, select, textarea, [tabindex]):focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: inherit;
  }
  ```
  Light `--accent` is `oklch(0.5 0.15 252)` against `--paper` `oklch(0.982 …)` — passes ≥3:1 non-text contrast. Dark `--accent` `oklch(0.74 0.13 252)` against `--paper` `oklch(0.18 …)` — passes. The 2px offset prevents the ring from being clipped by tight `border-radius` pills (e.g. the visibility toggle at 999px).
- Note: use `:where()` so specificity stays 0 and components can still opt into a richer ring without `!important`.
- Verify: keyboard-tab through nav, user menu, toggles, links in a brief — every stop shows the ring in both themes; no focus is fully obscured.

---

**P0-3 · Replace any `outline: none` that is not paired with a visible substitute**
- Dimension: Accessibility, Interaction states
- File: `src/app/globals.css` (audit pass)
- Problem: removing the default outline without a replacement is the most common AA focus regression.
- Fix: grep `outline: none` / `outline: 0`; for each, confirm a `:focus-visible` substitute exists (P0-2 covers the global floor). Where a component sets `outline: none` on `:focus` only, scope it to `:focus:not(:focus-visible)` so mouse focus is quiet but keyboard focus is preserved.
- Verify: no interactive element loses its keyboard ring.

---

### P1 — Typographic & rhythm foundation

---

**P1-1 · Lock a modular type scale on the display serif**
- Dimension: Typography
- File: `src/app/globals.css` (`@theme inline` / `:root` type tokens)
- Problem: ad-hoc `font-size` values (e.g. `0.92rem`, `0.95rem`, `0.78rem` seen at lines 623/1494/1505) drift; a Stratechery-grade reading view needs a single ratio.
- Fix: define a 1.2 (minor-third) scale anchored at a 17px body and expose as tokens:
  ```css
  --text-xs: 0.78rem;   /* metadata, mono labels */
  --text-sm: 0.875rem;  /* secondary UI */
  --text-base: 1.0625rem; /* 17px body, reading */
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-2xl: 1.875rem;
  --text-3xl: 2.25rem;  /* brief titles, Newsreader opsz */
  ```
  Then replace one-off sizes: `globals.css:623` `0.92rem` → `var(--text-sm)`; `globals.css:1494` `0.95rem` → `var(--text-sm)`; `globals.css:1505` `0.78rem` → `var(--text-xs)`. Apply `font-optical-sizing: auto` to all Newsreader display headings so opsz tracks size.
- Verify: every `font-size` in the file references a `--text-*` token; visual hierarchy reads cleanly at the three brief breakpoints.

---

**P1-2 · Constrain reading measure to 62–72ch**
- Dimension: Typography, Accessibility (long reading)
- File: `src/app/globals.css`
- Fix: add `--measure: 68ch;` to `:root` and apply `max-width: var(--measure);` to the brief body container (the prose column). Body line-height `1.6`, paragraph spacing `0.9em`.
- Verify: brief body text wraps at 62–72ch on wide viewports; no full-bleed paragraphs.

---

**P1-3 · Establish an 8px vertical rhythm spine**
- Dimension: Spacing & rhythm
- File: `src/app/globals.css`
- Problem: paddings like `0.55rem` / `0.65rem` (lines 622/626) are off-grid, producing subtle rhythm jitter.
- Fix: define a space scale and snap to it:
  ```css
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem;
  --space-4: 1rem; --space-6: 1.5rem; --space-8: 2rem;
  ```
  `globals.css:622` `gap: 0.65rem` → `gap: var(--space-2)`; `globals.css:626` `padding: 0.55rem` → `padding: var(--space-2)`; `globals.css:1507` `gap: 0.55rem` → `gap: var(--space-2)`. Keep `min-height` values (2.6rem/2.35rem) — they are deliberate touch targets ≥44px-adjacent and are fine.
- Verify: paddings/gaps reference `--space-*`; rhythm is visually even down a brief.

---

**P1-4 · Normalize `font-weight` to a 3-stop palette**
- Dimension: Typography, Component polish
- File: `src/app/globals.css`
- Problem: weights `700` (line 624), `850` (1506), and likely others are inconsistent and `850` is a Geist-specific value that reads heavy for an editorial UI.
- Fix: standardize UI weights to `--fw-regular: 450`, `--fw-medium: 550`, `--fw-bold: 650`. `globals.css:624` `font-weight: 700` → `var(--fw-bold)`; `globals.css:1506` `font-weight: 850` → `var(--fw-bold)`. Reserve true `700`+ for Newsreader display only. This pulls the UI back toward Linear restraint.
- Verify: no UI weight exceeds 650; display headings retain their serif weight.

---

### P2 — Elevation, interaction states, motion

---

**P2-1 · Formalize a 3-tier elevation system (hairline-first)**
- Dimension: Elevation/Depth
- File: `src/app/globals.css`
- Problem: only a single `--shadow` exists; depth is ad hoc. An editorial product should express elevation primarily through `--line` hairlines and surface steps (`--paper` → `--rail` → `--paper-strong`), with shadow as a faint last resort.
- Fix: add explicit tiers:
  ```css
  --elev-0: none;                                   /* flat on paper, hairline only */
  --elev-1: 0 1px 2px var(--shadow);                /* resting raised: menus, toggles */
  --elev-2: 0 4px 12px var(--shadow);               /* transient: popovers, dropdowns */
  ```
  Dark mode already darkens `--shadow` to `color-mix(in oklch, black 55%, transparent)` (line 46/68), so tiers translate without neon glow. Rule: cards in the reading column use **hairline only** (`border` via `--line`, `--elev-0`); only floating layers (user menu, command palette) use `--elev-1`/`--elev-2`. No element gets shadow *and* a heavy border.
- Verify: reading column has zero drop shadows; only overlays float.

---

**P2-2 · Complete the interaction-state matrix for buttons/toggles/menu items**
- Dimension: Interaction states, Dark-mode parity
- File: `src/app/globals.css`
- Problem: hover exists (line 629) but active/disabled are underspecified, and hover currently breaks (P0-1).
- Fix, per interactive surface, with these semantics:
  - `:hover` → surface steps one level toward ink: `background: var(--rail)` (already corrected in P0-1).
  - `:active` → `background: color-mix(in oklch, var(--rail) 85%, var(--ink))` and `transform: translateY(0.5px)` for tactile press.
  - `:disabled` / `[aria-disabled="true"]` → `opacity: 0.5; cursor: not-allowed;` and **no** hover background.
  - For `.library-visibility-toggle` (line 1497), add a clear on/off pressed state: `[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-strong); border-color: color-mix(in oklch, var(--accent) 40%, transparent); }`. `--accent-soft` is defined in both themes (lines 12/59), so parity holds.
- Verify: every interactive element has visible hover, active, disabled, and (toggle) pressed states in both themes.

---

**P2-3 · Standardize transition timing to one motion token, motion-gated**
- Dimension: Motion, Accessibility
- File: `src/app/globals.css`
- Fix: add `--ease: cubic-bezier(0.2, 0, 0, 1); --dur: 150ms;` to `:root`. Apply targeted transitions only to color/background/transform/opacity on interactive elements, e.g. on `.user-menu-item` and `.library-visibility-toggle`: `transition: background var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease);`. Never transition `all`. Wrap globally:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
  }
  ```
- Verify: all transitions are 120–180ms; reduced-motion users get instant state changes; no auto-playing animation anywhere.

---

### P3 — Component polish & iconography

---

**P3-1 · Reading-column component pass**
- Dimension: Component polish
- File: `src/app/globals.css` + relevant components
- Fix: brief cards use hairline `--line` borders, `--space-6` internal padding, `--space-8` between cards, no shadow (per P2-1). Source citations render in `--font-geist-mono` at `--text-xs`, color `--muted`, with the citation marker in `--accent` (single signal). Ensure "Cite or stay silent" holds: any AI-generated block shows its source row inline.
- Verify: a full brief scans cleanly; citations are visually subordinate but present.

---

**P3-2 · Metadata & timestamp typography**
- Dimension: Typography, Iconography
- File: `src/app/globals.css`
- Fix: all timestamps/IDs/counts in `--font-geist-mono`, `--text-xs`, `letter-spacing: 0.02em`, color `--muted`. The uppercase label pattern at line 1488 (`letter-spacing: 0.08em; text-transform: uppercase;`) is good — extract it to a `.eyebrow` utility class and reuse rather than duplicating.
- Verify: metadata is consistently mono and quiet across the app.

---

**P3-3 · Iconography normalization (lucide-react)**
- Dimension: Iconography
- File: component layer
- Fix: standardize lucide icons to `size={16}` for inline UI, `size={18}` for primary actions, `strokeWidth={1.75}` (lighter than the 2 default, more editorial), `color: currentColor` so icons inherit the one-signal color rules. No filled/duotone icons; no decorative icons next to body text.
- Verify: icon weight reads as hairline-consistent with `--line`; icons never introduce a second color.

---

**P3-4 · Dark-mode parity audit sweep**
- Dimension: Dark-mode parity, Accessibility
- File: `src/app/globals.css`
- Fix: confirm every token added in this spec (`--soft`/`--rail` usage, `--elev-*`, `--text-*`, `--space-*`, `--fw-*`, `--ease`, `--measure`) is theme-invariant or mirrored. Note both a `@media (prefers-color-scheme: dark)` block (line 28) and an explicit `[data-theme]`-style block (line 50) exist — any mirrored value must be written to **both** or they will diverge. Re-check body-text contrast: `--ink` on `--paper` and `--muted` on `--paper` must hold AA+ (≥7:1 for body, ≥4.5:1 for secondary) in both themes.
- Verify: toggle themes on a brief; hierarchy, accent semantics, and contrast are identical in structure.

---

## Sequenced roadmap

1. **Sprint 1 — Foundation (P0):** Fix `--soft` (P0-1), ship global `:focus-visible` (P0-2), audit `outline:none` (P0-3). Ship independently; these are bug/a11y fixes with no visual-language risk.
2. **Sprint 2 — Type & rhythm (P1):** Land `--text-*`, `--space-*`, `--fw-*`, `--measure` tokens and migrate one-off values. This is the largest cascade change; do it as one reviewed pass.
3. **Sprint 3 — Depth, states, motion (P2):** Introduce `--elev-*`, complete the state matrix, add `--ease`/`--dur` with reduced-motion gate.
4. **Sprint 4 — Polish (P3):** Reading-column pass, metadata/iconography normalization, dark-mode parity sweep.

Each sprint is independently shippable and leaves the product in a consistent state.

---

## Open questions

1. Should `--soft` be hard-replaced with `--rail` at both call sites (one fewer token) or kept as an alias `--soft: var(--rail)` for future semantic divergence? Recommendation: alias, to preserve intent if "soft" later needs to differ from "rail."
2. Body reading size: 17px (`--text-base: 1.0625rem`) is proposed for Stratechery-like comfort — confirm against current effective body size to avoid a jarring shift.
3. The file maintains both a `prefers-color-scheme` block and an explicit theme block (lines 28 vs 50). Is there a manual theme toggle? If so, the explicit block is canonical and the media block should defer to it — confirm precedence to avoid double-definition drift.
4. Target browser floor for `color-mix(in oklch, …)` and oklch — already used pervasively, but confirm it matches the supported matrix before adding more `color-mix` in P2-2.
5. Are there interactive elements rendered outside `globals.css` (inline styles / CSS-in-component) that the global `:focus-visible` `:where()` rule won't reach? A quick component grep should confirm full coverage.
