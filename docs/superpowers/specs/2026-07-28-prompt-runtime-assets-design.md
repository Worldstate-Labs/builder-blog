# Prompt Runtime Assets Design

## Problem

FollowBrief renders copied agent prompts from Markdown files at request time.
Next.js cannot infer those dynamic `readFile()` paths, so Vercel omits them
unless each server route declares the files in `outputFileTracingIncludes`.

The short-link route `/p/[token]` currently declares no prompt assets. The job
and downloadable-file routes declare the main job files but omit the shared
`_install-skill.md` fragment. Valid copied links and every prompt containing
the install fragment therefore return an empty HTTP 500 in production.

## Design

Define one narrow prompt-runtime trace list in `next.config.ts`:

- every Markdown file under `skills/builder-blog-digest/jobs/`
- `config/local-agent-timeouts.json`

Reuse that list for all three routes that render prompts:

- `/p/[token]`
- `/api/skill/jobs/[job]/skill.md`
- `/api/skill/files/[file]`

The downloadable-file route keeps its existing script and configuration
assets in addition to the shared prompt list. A directory-scoped Markdown
glob is intentional: adding a future job or include fragment should not
require another manually synchronized tracing edit.

## Verification

1. A contract test must fail on the current configuration because the short
   link route and `_install-skill.md` are missing.
2. The focused test must pass after the configuration is fixed.
3. A production build must produce `.nft.json` manifests where all three
   server routes contain the main job files and `_install-skill.md`.
4. TypeScript, ESLint, and the full test suite must pass.
