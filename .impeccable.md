# FollowBrief — Design Context

## Design Context

### Users
Knowledge workers — analysts, researchers, and power readers who follow many creators, newsletters, podcasts, and feeds. They open FollowBrief during focused reading time (often morning or end-of-day catchup), looking for a calm, scannable digest of what the people they trust said today, with the ability to dig into sources and recall a detail weeks later. The job to be done: *replace doomscrolling with a daily, cited brief I can trust and search later.*

### Brand Personality
**Editorial, precise, calm.** Voice is the of-the-record newsroom: confident, sparing with adjectives, never breathless. The interface should feel like a quality publication's reading view, not a social app. Emotional goals: trust, focus, quiet authority — never urgency, novelty, or hype.

### Aesthetic Direction
- **Visual tone:** Editorial / paper-and-ink. Generous whitespace, serif display headings (Newsreader), Geist sans for UI, Geist Mono for metadata. Signal accents are reserved — one blue accent, one green "live/success" signal, no rainbow.
- **Theme:** Light mode is the canonical experience (paper palette, oklch). Dark mode required with **parity** — same contrast hierarchy, same accent semantics, just inverted ink/paper. No high-saturation neon in dark mode.
- **References (positive):** NYT/Stratechery reading views, Linear's restraint, Are.na's calm density, Pitchfork-era editorial chrome.
- **Anti-references:** Consumer social UIs (TikTok-style chrome), AI-app cliches (purple gradients, "glow" effects, animated sparkles, glassmorphism dashboards), busy notification badges, marketing-page emoji clutter.

### Design Principles
1. **Reading first.** Every screen optimizes for sustained reading: line-length ~62–72ch on body, generous leading, optical-sized serif for display, no decorative motion under text. Respect `prefers-reduced-motion`.
2. **Density with air.** Briefs and archives can be information-dense, but density comes from typography and rhythm — not bordered boxes everywhere. Use the `--line` hairline and whitespace, not chrome, to separate.
3. **One signal at a time.** Color carries meaning: `--accent` (blue) for interactive/primary, `--signal` (green) for live/success, `--warm`/`--danger` only when literally needed. No decorative color.
4. **Cite or stay silent.** AI-generated content always shows its sources inline. The UI never asks the reader to trust a claim without a path back to the source.
5. **Accessibility for long reading.** Hold WCAG 2.2 AA as a floor, with extra care for sustained reading: comfortable line length, motion-light interactions, AA+ contrast on body text, focus-visible always, keyboard navigation through digest items.

### Implementation Notes
- Type system: `--font-display` (Newsreader, opsz) for headings; `--font-geist-sans` for UI/body; `--font-geist-mono` for timestamps, IDs, metadata.
- Color tokens live in `src/app/globals.css` as oklch variables — add dark-mode tokens via `@media (prefers-color-scheme: dark)` or a `[data-theme="dark"]` selector, mirroring every semantic token.
- Reserve hover/transition motion to ~120–180ms ease; no parallax, no auto-playing animation.
