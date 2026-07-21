# Launchd Service Transition Waits Design

## Goal

Prevent FollowBrief stop and replacement prompts from treating launchd's asynchronous `bootout` transition as an immediate failure or an immediate success.

## Confirmed failure

On macOS, `launchctl bootout gui/<uid>/com.followbrief.cloud-library-host` returned zero, but an immediate `launchctl print` still found the service. The stop prompt exited with code 75. A later read showed the service absent and its recorded worker dead, while the plist, current marker, and runtime pins remained because cleanup had stopped early.

The same immediate-check pattern exists in regular local `library-cron` and `digest-cron` stop/setup prompts. Their stop paths are less strict: they can remove the plist and later report `stopped` even when the immediate probe still sees the service.

## Scope

Modify only macOS launchd transitions in:

- `skills/builder-blog-digest/jobs/cloud-library-cron-stop.md`
- `skills/builder-blog-digest/jobs/cloud-library-cron-setup.md`
- `skills/builder-blog-digest/jobs/library-cron-stop.md`
- `skills/builder-blog-digest/jobs/library-cron-setup.md`
- `skills/builder-blog-digest/jobs/digest-cron-stop.md`
- `skills/builder-blog-digest/jobs/digest-cron-setup.md`

Do not change:

- regular-user FollowBrief Cloud stop through `DELETE /api/cloud-library/source-submissions`, because it cancels database work and does not manage launchd;
- Linux systemd or crontab behavior;
- the runner's worker identity and terminal-update controls;
- the runner's launchd self-uninstall path, which is intentionally executing inside the service being removed.

## Transition contract

Each affected launchd block will use the same small POSIX-shell function:

```sh
wait_for_launchd_absent() {
  label="$1"
  remaining=30
  while launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; do
    [ "$remaining" -gt 0 ] || return 1
    sleep 1
    remaining=$((remaining - 1))
  done
}
```

Thirty seconds bounds prompt latency while allowing launchd to finish an asynchronous removal. The function succeeds immediately when the service is already absent.

### Stop paths

1. Preserve the existing account/label ownership checks.
2. If the service is loaded, request `bootout`.
3. Poll until the service is absent.
4. If the timeout expires, exit 75 before removing the plist, clearing runtime state, stopping detached workers, or reporting `stopped`.
5. Once absence is proven, remove stale plist state and continue the existing worker/status cleanup.

For regular local cron prompts, a stale plist with no loaded service remains removable. A nonzero `bootout` result is recorded in the existing audit trail, but the authoritative condition is whether launchd becomes absent. A service that remains loaded after the bound is a fatal stop failure.

### Replacement/setup paths

After requesting removal of the old label, wait for absence before `launchctl enable` or `launchctl bootstrap`. A timeout exits 75 and does not install or report the replacement schedule. Existing bootstrap verification remains in place.

## Error handling and state preservation

- Timeout messages name the label and state that launchd did not finish unloading it.
- Admin stop continues to preserve its plist, current marker, and runtime pins on timeout.
- Regular local stops no longer continue to plist deletion or `cron-status --status stopped` while launchd is still loaded.
- Ownership mismatches and unknown owners remain fail-closed before `bootout`.
- Already-absent services remain idempotent and proceed without delay.

## Tests

Add behavioral shell-harness tests with a fake `launchctl` and no-op `sleep`:

1. `bootout` succeeds, `print` remains loaded for several probes, then becomes absent; the prompt completes cleanup.
2. `print` remains loaded for the whole bound; the prompt exits 75 and preserves the plist without reporting stopped.
3. Setup prompts place the bounded absence wait after `bootout` and before `bootstrap`.
4. Existing cross-account, missing-systemctl, worker-identity, prompt-rendering, and audit tests remain green.

No new dependency or production runtime component is introduced.
