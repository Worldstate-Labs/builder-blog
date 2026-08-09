# Fetch and Digest Luna Migration Design

**Date:** 2026-08-09
**Branch / worktree:** `codex/migrate-fetch-digest-luna`

## Summary

Move every Codex-backed FollowBrief Fetch and Digest run from the retired
`gpt-5.4-mini` default to `gpt-5.6-luna`, with `medium` reasoning explicitly
selected for these jobs. Fetch, Digest, scheduled jobs, one-time jobs, and the
cloud Fetch host all execute through `scripts/builder-agent-runner.sh`, so the
migration belongs in that shared runner instead of duplicated per-job setup.

OpenAI's current guidance identifies Luna as the efficient, high-volume GPT-5.6
variant and recommends setting reasoning effort intentionally. The official
standard short-context prices are $0.20 input, $0.02 cached input, and $1.20
output per million tokens.

## Goals

- Make `gpt-5.6-luna` the default Codex model for both Fetch and Digest.
- Pin the default reasoning effort to `medium` instead of inheriting a user's
  unrelated global Codex configuration.
- Cover interactive, unattended, scheduled, and cloud-hosted execution paths.
- Keep per-run and per-job overrides available.
- Record the effective Luna model in usage and job-run metadata.
- Keep estimated usage costs working for the new default model.

## Non-Goals

- Do not change Claude or OpenClaw model selection.
- Do not change the user's global Codex configuration.
- Do not remove historical `gpt-5.4-mini` usage fixtures or price entries.
- Do not change prompts, Fetch/Digest business logic, scheduling, or sandbox
  permissions.
- Do not reinterpret `BUILDER_BLOG_AGENT_MODEL`; it remains reporting metadata,
  while `BUILDER_BLOG_CODEX_MODEL` controls the actual Codex model.

## Runtime Design

Define shared defaults in `scripts/builder-agent-runner.sh`:

- `DEFAULT_CODEX_MODEL=gpt-5.6-luna`
- `DEFAULT_CODEX_REASONING_EFFORT=medium`

Both `run_with_codex` and `run_with_codex_unattended` resolve:

- model from `BUILDER_BLOG_CODEX_MODEL`, falling back to the shared model
  default;
- reasoning effort from `BUILDER_BLOG_CODEX_REASONING_EFFORT`, falling back to
  the shared reasoning default.

Every `codex exec` invocation passes the resolved model with `--model` and the
resolved reasoning effort with Codex config override
`-c model_reasoning_effort=<value>`. The structured and plain-output branches
must remain equivalent.

The existing environment variables continue to support custom model selection.
The new `BUILDER_BLOG_CODEX_REASONING_EFFORT` variable provides the matching
job-scoped reasoning override. Invalid values remain Codex CLI errors rather
than being silently rewritten by the runner.

## Metadata and Cost Accounting

When Codex is selected and `BUILDER_BLOG_AGENT_MODEL` is unset, metadata uses
the same shared Luna default as execution. `capture_runtime_usage` already
receives the resolved runtime model and therefore requires no interface change.

Add `gpt-5.6-luna` entries for both `openai-codex` and `openai` to the default
short-context price registry using current official standard pricing:

- input: `0.20` USD per million tokens;
- cached input: `0.02` USD per million tokens;
- output: `1.20` USD per million tokens.

Keep all older model price entries so historical usage remains estimable.
Update the `parse-runtime-usage` help example to use Luna because it describes
the current active default rather than a historical record.

## Compatibility and Rollout

Existing installations can keep overriding the model through
`BUILDER_BLOG_CODEX_MODEL`. Installations that set no override switch to Luna
when they receive the updated runtime bundle. A reasoning override can be added
without changing setup prompts or scheduler state.

No LaunchAgent or cron definition needs a model field: those jobs already call
the shared runner. The migration does not modify local installed files during
the repository change; normal runtime bundle refresh/deployment distributes it.

## Testing Strategy

Use test-driven development:

1. Add contract assertions that the runner defines the Luna and medium shared
   defaults.
2. Assert interactive and unattended Codex paths pass both the resolved model
   and `model_reasoning_effort` to every structured/plain `codex exec` branch.
3. Assert job metadata falls back to the shared Luna default while preserving
   explicit overrides.
4. Add a usage parsing test that estimates Luna cost from the official short-
   context rates while retaining the existing 5.4-mini historical test.
5. Run the focused tests first, then the full test suite, lint, TypeScript
   checking, and production build.

## Risks

- Luna may produce different Fetch/Digest quality than 5.4-mini. Explicit
  `medium` reasoning is the agreed baseline; representative production runs
  should be monitored after deployment.
- Very long contexts use higher prices than the existing estimator can express.
  This registry has always modeled one flat rate per model, so the migration
  preserves its short-context convention rather than expanding the accounting
  schema.
- A stale installed bundle continues using 5.4-mini until refreshed; repository
  verification cannot prove external hosts have deployed the new bundle.
