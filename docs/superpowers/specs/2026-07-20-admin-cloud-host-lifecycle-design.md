# Admin Cloud Host Lifecycle Design

## Goal

Make Cloud worker-host replacement and stop operations truthful and account-safe: no mutation before replacement confirmation, no cross-account service removal, no false stopped state, and no lost local recovery marker when process termination or server status sync fails.

## Invariants

1. A declined or blocked replacement does not change runtime pins, service definitions, current markers, or job-run status.
2. Replacement marks every recorded live old host as `replaced` before unloading its service. A late signal cleanup cannot regress that terminal status.
3. The machine-global service is changed only when its recorded account is the current account or the setup replacement was explicitly confirmed for the recorded owner.
4. Stop refuses to unload a machine-global service owned by another account.
5. New current markers record the runner process start epoch. A PID is a kill target only when its command contains `builder-agent-runner.sh` and its live process start matches the marker; legacy markers retain command-only compatibility. Generic Codex, Claude, Hermes, or OpenClaw processes are never kill targets.
6. TERM is followed by KILL when needed. The descendant PID set is captured before TERM so children that outlive and detach from the runner root can still be escalated and verified.
7. A current marker is removed only after the process is gone and the terminal job-run update succeeds. Failed status sync leaves the marker for a safe retry.
8. Runtime pins are removed only after the service and current-worker cleanup both satisfy their stopped-state checks.

## Architecture

The runner owns the account-scoped `cloud-library-host/current.json` and compatibility `cloud-library-cron/current.json` process lifecycle operations because it already contains the canonical PID verifier, process-tree terminator, job identity mapping, and authenticated job-run update path. Two control actions are exposed through the existing `cloud-library-host` runner entry point:

- `mark-replaced`: strictly records live current hosts as `replaced`; stale PID records are marked `stale` and cleared.
- `stop-current`: terminates verified recorded runners, verifies they are gone, strictly records a terminal status, and only then clears current markers.

The setup and stop prompts retain OS-specific launchd/systemd handling. They call the runner actions instead of embedding a second process-management implementation.

## Setup flow

1. Refresh the skill and verify the selected runtime without writing pins.
2. Inspect the shared service definition and both account-scoped current files.
3. If anything is active, require explicit replacement confirmation.
4. Resolve the account that owns the existing shared service and run `mark-replaced` under that account.
5. Unload the old service and verify it is absent. Service-manager failures are fatal.
6. Run `stop-current` under the old account to terminate any detached or residual runner and clear its current marker.
7. Write the new account's runtime pins, install the service, and verify it is active.

## Stop flow

1. Refresh the skill.
2. Resolve the shared service owner before mutation. Refuse a cross-account or unprovable loaded-service stop.
3. Unload/disable the service and verify it is inactive before removing its definition.
4. Run `stop-current` for the current account. Any process or status-sync failure is fatal and preserves the current marker.
5. Remove runtime pins and report success only after every stopped-state invariant passes.

## Error handling

The existing best-effort job heartbeat behavior remains unchanged. Strictness is opt-in for control operations so ordinary runtime heartbeats do not begin failing jobs during transient network errors. Control operations propagate terminal update failures.

## Testing

- Contract tests verify prompt ordering, ownership gates, strict service checks, and delayed pin mutation/removal.
- Shell harness tests execute extracted runner control functions with fake current files and process/update functions, including PID reuse and a descendant that outlives the runner root.
- Failure tests prove an unkillable runner or failed status update leaves `current.json` intact.
- Existing Cloud CLI, agent job-run, prompt-rendering, and user-journey tests guard compatibility.
