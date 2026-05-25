@AGENTS.md

## Design Context

### Users
Knowledge workers — analysts, researchers, and power readers who follow many creators, newsletters, podcasts, and feeds. They open FollowBrief during focused reading time, looking for a calm, scannable digest with cited sources and durable recall. Job to be done: *replace doomscrolling with a daily, cited brief I can trust and search later.*

### Brand Personality
**Editorial, precise, calm.** Voice is an of-the-record newsroom: confident, sparing with adjectives, never breathless. Emotional goals: trust, focus, quiet authority. Never urgency, novelty, or hype.

### Aesthetic Direction
- Visual tone: editorial paper-and-ink. Newsreader serif for display, Geist sans for UI, Geist Mono for metadata. Generous whitespace, hairline `--line` separators over bordered boxes.
- Theme: light mode is canonical; dark mode required with parity (same hierarchy and accent semantics, no neon).
- Positive references: NYT/Stratechery reading views, Linear restraint, Are.na density, Pitchfork-era chrome.
- Anti-references: consumer social UIs, AI-app cliches (purple gradients, sparkle animations, glassmorphism), busy badges, emoji marketing clutter.

### Design Principles
1. **Reading first.** Optimize every screen for sustained reading — ~62–72ch line length, generous leading, optical-sized serif display, no decorative motion under text. Respect `prefers-reduced-motion`.
2. **Density with air.** Density comes from typography and rhythm, not chrome.
3. **One signal at a time.** Color carries meaning: `--accent` for interactive, `--signal` for live/success, `--warm`/`--danger` only when literal. No decorative color.
4. **Cite or stay silent.** AI-generated content always shows sources inline.
5. **Accessibility for long reading.** WCAG 2.2 AA floor with extra care: comfortable line length, motion-light, AA+ contrast on body text, focus-visible always, full keyboard navigation.

### Implementation Notes
- Type tokens: `--font-display` (Newsreader, opsz) for headings, `--font-geist-sans` for UI/body, `--font-geist-mono` for timestamps/IDs.
- Color tokens in `src/app/globals.css` as oklch variables — mirror every semantic token for dark mode.
- Reserve hover/transition motion to ~120–180ms ease; no parallax or auto-playing animation.

Full version with rationale lives in `.impeccable.md` at the project root.
