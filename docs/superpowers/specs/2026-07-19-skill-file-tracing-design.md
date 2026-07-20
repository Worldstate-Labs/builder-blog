# Skill File Tracing Design

## Problem

The public skill bootstrap script downloads `cloud-shard-budget.mjs` through
`/api/skill/files/[file]`. The route registry points at
`scripts/cloud-shard-budget.mjs`, but the route's Vercel
`outputFileTracingIncludes` list does not include that file. Local development
works because the repository is present; the deployed serverless bundle omits
the asset and the endpoint returns HTTP 500. Because bootstrap uses `set -eu`,
Cloud worker stop/setup prompts abort before changing the local service.

## Decision

Make the files route's tracing list explicitly cover every filesystem path
registered by `src/app/api/skill/files/[file]/route.ts`. Add the missing
`scripts/cloud-shard-budget.mjs` entry and also explicitly trace
`config/sources.json`, which currently works only because another import happens
to pull it into the bundle.

Strengthen the existing deployment-contract test so it derives all registered
`path` values from the files route and asserts that each one appears in the
files route tracing block. This protects future assets without requiring a new
one-off assertion every time the registry grows. This registry-derived check is
additive: preserve the existing explicit tracing assertions for indirect
`expandSkillIncludes` dependencies (`_fetch-task-discovery.md`,
`_fetch-task-core.md`, `_fetch-task-syncing.md`, and
`_digest-task-contract.md`), because those fragments are read at runtime but do
not appear in the public `skillFiles` registry.

## Alternatives Considered

1. **Explicit tracing plus registry-derived coverage (chosen).** Smallest
   production change, follows the existing Vercel pattern, and closes the test
   gap that allowed this regression.
2. **Trace `scripts/*.mjs` and broad config globs.** Simpler configuration but
   unnecessarily enlarges the serverless bundle and can hide unused assets.
3. **Replace runtime `readFile` with static imports.** Lets the bundler discover
   assets, but would require restructuring heterogeneous shell, Markdown, JSON,
   and JavaScript downloads for no user-facing benefit.

## Error Handling and Compatibility

No endpoint or prompt contract changes. Missing files continue to fail loudly;
the fix ensures registered assets are actually deployed. Existing cache headers,
content types, token exchange, and stop safety behavior remain unchanged.

## Verification

- Demonstrate the new tracing-coverage test fails before the config change and
  names `scripts/cloud-shard-budget.mjs` (and any other implicit-only asset).
- Add the minimal tracing entries and rerun the targeted contract test.
- Run the full test suite, ESLint, TypeScript, and a production Next.js build.
- After deployment, require HTTP 200 from bootstrap and every asset URL it
  downloads before considering the production incident closed.
