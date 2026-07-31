# Remove Hermes Runtime Design

## Goal

Remove Hermes as a supported FollowBrief agent runtime without allowing existing
Hermes pins to silently fall back to another installed agent.

## Scope

- Remove Hermes from user-facing runtime selectors.
- Reject `runtime: "hermes"` in prompt-link validation. A direct skill route
  request with any present unsupported `runtime` query value returns HTTP 400
  instead of silently rendering an unpinned prompt.
- Remove Hermes prompt labels, runner execution functions, runtime discovery,
  model detection, auth detection, output cleanup, and process matching.
- Update tests to assert the supported runtime set is Claude Code, Codex, and
  OpenClaw.
- Preserve historical database values and historical design documents.
- Preserve the transitive `hermes-parser` npm package because it is unrelated to
  the Hermes agent.

## Compatibility

Runtime pins remain free-form files and persisted schedule runtime fields remain
strings. The runner must inspect the raw configured runtime before normalization.
Both an env-provided runtime and a value read from a runtime pin are validated
before normalization, before `BUILDER_BLOG_RUNTIME` is exported, and before any
override or discovery dispatch. Any non-empty unsupported value, including
`hermes`, exits with code 78 and a clear unsupported-runtime message. It must
never enter runtime auto-discovery.

Existing database rows are retained for audit history. Users can stop an old
Hermes schedule and create a new schedule with a supported runtime.

## Verification

- Contract tests fail before implementation when Hermes remains in UI, APIs,
  renderer, CLI, or runner.
- Focused prompt-link, prompt-renderer, runner, UX, and journey tests pass.
- Repository search finds no product-code Hermes agent references.
- Full lint, typecheck, tests, and production build pass.
