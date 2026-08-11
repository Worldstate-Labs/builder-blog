# Codex Unattended CLI Compatibility Design

## Problem

FollowBrief's unattended Codex workers invoke `codex exec --full-auto`. The
installed Codex CLI on the failing Linux host rejects that deprecated flag, so
every shard exits before processing its prompt. The model preflight misses the
failure because it uses a different, read-only command line.

## Decision

Use the explicit Codex settings that `--full-auto` previously represented:

- `--sandbox workspace-write`
- `-c 'approval_policy="never"'`
- `-c sandbox_workspace_write.network_access=true`

Keep the existing explicit model, reasoning effort, working directory, JSON
mode, and non-git-repository allowance. Do not use the unsandboxed
`--dangerously-bypass-approvals-and-sandbox` option.

Put the common unattended arguments behind one POSIX-shell function. Both the
model preflight and real unattended workers must call that function, so an
unsupported argument fails before fetch-task fanout rather than once per
worker.

## Runtime evidence

Capture the first line of `codex --version` immediately after the runtime is
resolved. Export it for the remainder of the runner process and include it as
`details.runtimeVersion` in every subsequent agent job update. Updates emitted
before runtime resolution may omit the field. This is diagnostic metadata only;
failure to read the version must not block a job.

## Compatibility

The runner already relies on `--sandbox` and `-c` for its existing Codex
preflight, so replacing the deprecated composite flag does not introduce a new
minimum capability. Old and new installations use the same explicit command;
there is no version-number branch and no fallback to an unsafe mode.

## Error handling

If the exact unattended command is rejected, the preflight returns the CLI
error and the job stops before assigning workers. Model compatibility fallback
continues to apply only to model errors, not arbitrary CLI, authentication, or
network failures.

## Verification

Automated regression tests use a fake Codex executable that rejects
`--full-auto` and records its arguments. They verify that:

1. the preflight and worker invocation both omit `--full-auto`;
2. both include workspace-write, never-approve, and sandbox networking;
3. the runtime version is propagated into `details.runtimeVersion`.

In addition, run a development-machine smoke command against the installed
Codex binary to verify that it parses the replacement argument set. This is an
explicit verification command, not a required automated test, because CI and
other developer machines may not have Codex installed or authenticated.
