# Managed Media Download Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runner-owned YouTube media preparation recover from bounded transient download failures, persist stable and useful failure semantics, expose the failure in the correct fetch-log stage, and surface downloader maintenance without changing regular/cloud scheduling architecture or installing software unattended.

**Architecture:** Keep the existing deterministic runner as the only owner of download, ffmpeg, and ASR work for both regular and Cloud fetches. Insert one pure classification boundary between media subprocess output and persisted task outcomes, retry only the failed download phase within the existing task budget, and keep raw diagnostics in structured evidence instead of `failureReason`. Extend the existing version-1 machine profile additively so current and rolled-back runners can still consume it; setup prompts may offer an explicit update, while unattended runs remain probe-only.

**Tech Stack:** Node.js ESM CLI, POSIX shell skill prompts, Next.js/React, TypeScript, `node:test` through `tsx`, yt-dlp, ffmpeg, local Whisper backends

---

## Current-state audit

### Production incident

The failing post was `https://www.youtube.com/watch?v=EWvNQjAaOHw` in the admin Cloud fetch source `Andrej Karpathy YouTube`.

- The source run was `PARTIAL`, not globally stuck: two sibling videos synced, this video failed download, and two videos exceeded the supported workload budget.
- The failing task persisted the whole yt-dlp stderr string as `failureReason`: an older-than-90-days warning followed by `HTTP Error 403: Forbidden`.
- The machine profile reported a ready media host and pointed to `/opt/homebrew/bin/yt-dlp` version `2026.03.17`; Homebrew offered a newer stable version.
- A later `yt-dlp --test -f ba` against the same video succeeded with both the installed binary and an isolated current binary. Therefore the old-version warning is a maintenance risk, but the incident cannot honestly be attributed to version age alone. The observed 403 was transient or request/client dependent.

### Shared execution path

Regular and Cloud fetches already use the correct common boundary:

1. `scripts/builder-agent-runner.sh` starts `prepare-managed-media` for both regular and Cloud jobs.
2. `scripts/builder-digest.mjs` runs yt-dlp, ffmpeg, and ASR outside the model worker.
3. A successful transcript rewrites the task to `summarize_prepared_media`.
4. A failed media task becomes a terminal per-post outcome while unrelated tasks continue.
5. Cloud adds lease, heartbeat, source reconciliation, and scheduling around that same media path.

This implementation must repair the shared media boundary once. It must not add a Cloud-only downloader, a regular-only fallback, or new agent prompt instructions that ask the model to operate yt-dlp.

### Defects and risks found

| Priority | Finding | Current evidence | Required correction |
| --- | --- | --- | --- |
| P0 | One yt-dlp process failure immediately ends media preparation. | `fetchYouTubeLocalAsr` executes the audio download once and returns on failure. | Add a bounded, phase-local retry that re-extracts a fresh media URL without rerunning discovery, other posts, or the model worker. |
| P0 | Subprocess stderr is used as a durable business error code. | `commandFailureReason` returns raw stderr; `prepareManagedMediaTasks` persists it as `reason`. | Classify subprocess output at the runner boundary and persist a stable short code. Keep sanitized diagnostics in `evidence`. |
| P0 | The UI cannot place an unknown media failure in the read stage. | Unknown codes have stage `unknown`; `FetchLogPanel` consequently renders `Summarize Failed` and `Sync Failed`. | Add media failure taxonomy entries and make lifecycle rendering follow the taxonomy stage. |
| P1 | yt-dlp health is path-only and version-blind. | `asr-doctor` records the downloader path but not its version or maintenance warnings. | Record version and warning state in the existing profile schema without making an old-but-working downloader a hard capability failure. |
| P1 | The install prompt only distinguishes ready from missing capability. | `_asr-capability-setup.md` cannot offer maintenance when all paths exist. | Parse profile maintenance warnings and ask before updating. Never update inside an unattended fetch. |
| P1 | Existing logs contain legacy `audio_download:<stderr>` reasons. | Historical task outcomes predate stable media codes. | Add narrow read-only compatibility normalization in the taxonomy; do not rewrite production rows. |
| P1 | Retryability in the UI taxonomy does not drive Cloud scheduling. | Cloud lifecycle consumes source status (`succeeded`, `partial`, `failed`, `deferred`), not `fetchFailureInfo.retryable`. | Do not silently redesign source scheduling in this patch. Lock current partial/failed/deferred behavior with regression tests. |
| P1 | Mixed capability-blocked Cloud results currently have independent design drift. | Reconciliation can mark a mixed synced+blocked source `deferred`, while the older ASR design says `partial`. | Record this as a separate follow-up; do not combine it with downloader reliability. |
| P2 | Managed-media tests cover missing tools and budgets but not noisy 403 failures. | No test classifies an old-version warning plus HTTP 403 or proves a retry can recover. | Add deterministic subprocess fixtures for transient, durable, and warning-only outcomes. |

### Upstream constraints

- yt-dlp already has internal HTTP, fragment, and extractor retries, but restarting the yt-dlp process is still useful for a bounded retry because it performs extraction again and obtains a fresh media URL.
- A YouTube 403 is not one universal condition. It can reflect stale extractor behavior, IP/client behavior, or current PO-token enforcement. Repeating every 403 indefinitely is incorrect.
- yt-dlp's current YouTube path needs an external JavaScript runtime and matching EJS components. The repo already requires Node.js 22+ and installs `yt-dlp[default]`, which is the correct deterministic package boundary.
- A PO-token provider is an optional host capability with security and operational consequences. It is not part of this fix and must not be silently downloaded or configured.

Official references:

- https://github.com/yt-dlp/yt-dlp
- https://github.com/yt-dlp/yt-dlp/wiki/EJS
- https://github.com/yt-dlp/yt-dlp/wiki/Po-Token-Guide

## Chosen design

### 1. Stable subprocess-to-domain boundary

Create a small pure module, `scripts/media-tool-failures.mjs`. It owns no I/O. Its public contract is:

```js
classifyMediaToolFailure({ stage, result, toolVersion, now }) => ({
  code,
  stage,
  retryable,
  durable,
  httpStatus,
  maintenanceWarnings,
  diagnostic,
})
```

The minimum stable codes are:

| Code | Stage | Retryable in-process | Meaning |
| --- | --- | --- | --- |
| `media_download_forbidden` | read/download | once | HTTP 403 without a durable access marker; one fresh-process retry is allowed. |
| `media_download_rate_limited` | read/download | once | HTTP 429; bounded retry only when task budget remains. |
| `media_download_temporarily_unavailable` | read/download | once | timeout, network failure, or HTTP 5xx. |
| `media_download_access_required` | read/download | no | private, members-only, login, age, geo, bot-confirmation, or explicit PO-token requirement. |
| `media_download_unavailable` | read/download | no | deleted, removed, copyright-blocked, or no supported media format. |
| `media_download_output_missing` | read/download | once | yt-dlp exited successfully but did not produce the expected file. |
| `media_download_failed` | read/download | once | bounded fallback for an unclassified downloader failure. |
| `media_convert_failed` | read/prepare_audio | no | ffmpeg could not create the normalized audio artifact. |
| `media_transcription_failed` | read/transcribe | no | every configured local ASR adapter failed. |

`yt_dlp_outdated` is a maintenance warning, not a task failure code. A successful command that prints the warning remains successful. A failed command can carry both `code = media_download_forbidden` and `maintenanceWarnings = ["yt_dlp_outdated"]`.

`diagnostic` must be bounded and sanitized. It may include the final stderr excerpt and exit code, but must remove URL query strings, cookies, authorization values, local home-directory prefixes, and control characters. Stable `reason` fields never contain raw stderr.

### 2. Bounded retry inside the download phase

Keep retry scope smaller than the media task:

1. Run yt-dlp with explicit finite internal retry options.
2. On failure, classify it.
3. If the class is retryable and at least 30 seconds remain in the task budget, remove partial `audio.*` artifacts, wait a short bounded delay, and start yt-dlp once more.
4. The second process performs extraction again and therefore does not reuse a stale signed media URL.
5. If it still fails, return the stable code and all attempt evidence.

Use two process attempts total. Each process receives:

```text
--retries 3
--fragment-retries 3
--extractor-retries 2
--retry-sleep http:linear=1:3:1
--retry-sleep fragment:linear=1:3:1
--retry-sleep extractor:linear=1:3:1
```

Do not retry durable access/unavailable classes. Do not use infinite retry, rerun the whole source, restart a worker shard, force IPv4 globally, inject browser cookies, or install a PO-token provider.

The outer delay is fixed and testable, defaulting to two seconds. Tests inject a no-op sleeper. The existing `longToolTimeoutMsResolver` remains authoritative; retries stop before the task budget is exhausted.

### 3. Structured task evidence

New failed managed-media outcomes use:

```json
{
  "status": "failed",
  "reason": "media_download_forbidden",
  "evidence": {
    "managedBy": "followbrief-runner",
    "mediaFailure": {
      "stage": "download",
      "httpStatus": 403,
      "retryable": true,
      "processAttempts": 2,
      "tool": "yt-dlp",
      "toolVersion": "2026.03.17",
      "maintenanceWarnings": ["yt_dlp_outdated"],
      "diagnostic": "ERROR: unable to download video data: HTTP Error 403: Forbidden"
    },
    "attemptedMethods": [],
    "artifactDirectory": "..."
  }
}
```

The exact diagnostic is illustrative; sanitization and length limits apply. `state.json` stores the same stable code plus structured failure metadata so resumable artifacts and server logs agree.

No database migration is required. Existing task outcome and evidence schemas already accept a bounded string reason and structured evidence.

### 4. Machine health without unattended mutation

Keep the profile at `version: 1` and add optional fields. This is deliberately additive: old runners ignore the fields, and new runners continue to accept existing profiles.

```json
{
  "version": 1,
  "status": "ready",
  "downloader": {
    "command": "yt-dlp",
    "path": "/.../asr-venv/bin/yt-dlp",
    "version": "2026.07.04",
    "outdated": false
  },
  "decoder": {
    "command": "ffmpeg",
    "path": "/.../ffmpeg",
    "version": "8.0"
  },
  "maintenanceWarnings": []
}
```

`asr-doctor` runs absolute `--version` probes and calculates the yt-dlp age from a parseable release date. An old or unparsable version leaves `status = ready` when all capabilities exist; it only adds a warning. Missing EJS/JavaScript runtime remains a real capability problem.

Do not add a new doctor exit code. Exit `0` remains ready, `2` remains missing capability. The setup markdown captures the JSON and prints a maintenance marker when `maintenanceWarnings` is non-empty. This avoids breaking old callers that understand only the existing exit-code contract.

When maintenance is recommended, the interactive setup agent asks before running:

```bash
"$AGENT_DIR/asr-venv/bin/python" -m pip install --upgrade "yt-dlp[default]"
```

If the managed venv does not exist, use the existing consented install recipe. Re-run `asr-doctor` with `$AGENT_DIR/asr-venv/bin` first on `PATH` so the regenerated profile points to the managed binary. Declining maintenance does not stop the run. Unattended regular cron and Cloud workers never execute package-manager commands.

### 5. Lifecycle and UI semantics

Add the stable codes to `src/lib/fetch-failure-taxonomy.ts`. Download, conversion, and transcription runtime failures have `stage = "read"` and `notCompleted = true`. Durable unavailable/access classes can additionally set `contentFailure = true` when content cannot be accessed under FollowBrief's allowed acquisition policy.

`FetchLogPanel` must derive lifecycle placement from `fetchFailureInfo(...).stage`, not from `contentFailure` alone:

- A read-stage failure renders `Read: Failed` or `Read: Not completed` with the reason.
- `Summarize` renders `Not reached`.
- `Sync` renders `Not reached`.
- The banner shows the short user message.
- Admin detail rows show attempt count, HTTP status, downloader version, and maintenance warning from `evidence.mediaFailure`; they do not dump the entire evidence object.

For historical rows only, normalize these prefixes at read time:

- `audio_download:*403*` -> `media_download_forbidden`
- `audio_download:*` -> `media_download_failed`
- `audio_download_missing_file` -> `media_download_output_missing`
- `audio_convert:*` -> `media_convert_failed`

Do not broaden this into fuzzy matching of arbitrary errors, and do not rewrite historical database records.

### 6. Scheduling and prompt non-goals

This patch intentionally preserves source-level behavior:

- If siblings sync and one media post still fails after bounded retry, Cloud source status remains `partial` and follows the current success schedule.
- If all planned posts fail, the source remains `failed` and follows the current failure backoff/circuit-breaker path.
- Only `asr_capability_missing` retains the current Cloud `deferred` behavior.
- Regular fetch records the same per-post code and continues other tasks.
- Recurring setup verification treats a durably synchronized media failure as `needs_confirmation`, so the user is still asked whether to install the schedule.

Do not change `cloud-source-sync.ts` production logic in this plan. Add tests that prove the existing semantics remain unchanged. Generalizing Cloud scheduling around taxonomy `retryable` is a separate state-machine project.

Source-type fetch prompts and inner worker prompts do not change. They already correctly reserve downloader and ASR work for the deterministic runner. Only the shared capability setup include changes to report optional maintenance.

### Alternatives rejected

- Auto-updating yt-dlp after a failed unattended run: rejected because it mutates the host without consent, creates package/network failure modes, and makes regular/Cloud behavior non-reproducible.
- Treating every older-than-90-days warning as the root cause: rejected because it is a warning and the exact video later downloaded with the old binary.
- Retrying the whole source or worker shard: rejected because it repeats discovery, completed posts, model cost, and sync work.
- Retrying every 403 indefinitely: rejected because login/private/geo/attestation failures can be durable and repeated requests may worsen throttling.
- Automatically installing cookies or a PO-token provider: rejected because it introduces credentials, security, provider-policy, and host-maintenance decisions outside this incident's scope.
- Adding separate regular and Cloud media implementations: rejected because both paths already share the correct deterministic runner boundary.
- Converting all retryable post failures into Cloud `deferred`: rejected for this patch because scheduler semantics currently use source status, not failure taxonomy, and that rewrite has a much larger regression surface.

## File structure

### Add

- `scripts/media-tool-failures.mjs`: pure failure classification, redaction, version-age evaluation, and bounded retry decision helpers.
- `tests/media-tool-failures.test.ts`: deterministic classifier, redaction, version-warning, and retry-policy tests.

### Modify

- `scripts/builder-digest.mjs`: use the classifier, perform one budget-aware fresh-process retry, persist structured media evidence, and enrich the machine profile.
- `src/lib/agent-skill-files.ts`: add the helper to the canonical downloadable runtime manifest used by the server bundle and file routes.
- `next.config.ts`: trace the helper into the downloadable runtime route output for local and Vercel builds.
- `scripts/install-agent-skill-bundle.cjs`: include `media-tool-failures.mjs` in installed bundles.
- `scripts/verify-prompt-runtime-traces.mjs`: include the new runtime module in bundle trace verification.
- `skills/builder-blog-digest/jobs/_asr-capability-setup.md`: distinguish missing capabilities from optional maintenance and ask before updating.
- `src/lib/fetch-failure-taxonomy.ts`: add stable media codes and narrow legacy normalization.
- `src/components/FetchLogPanel.tsx`: render read-stage failure reasons and structured media details in the correct lifecycle step.
- `tests/builder-digest-cli.test.ts`: cover retry recovery, persistent failure evidence, warning-only success, profile enrichment, old-profile compatibility, and managed outcome persistence.
- `tests/agent-skill-bundle.test.ts`: require the new runtime helper in the installed skill bundle.
- `tests/prompt-runtime-assets.test.ts`: keep the canonical runtime manifest, Next.js trace includes, and post-build trace verifier aligned.
- `tests/cloud-source-cli-contract.test.ts`: lock capability-maintenance prompt behavior and regular/Cloud shared runner ownership.
- `tests/fetch-failure-taxonomy.test.ts`: cover new and legacy media failure mappings.
- `tests/fetch-log-panel-status.test.ts`: cover read/summarize/sync lifecycle placement and concise detail rendering.
- `tests/library-setup-verdict.test.ts`: replace raw `audio_download:*` fixtures and keep recurring setup at `needs_confirmation` after a synchronized media failure.
- `tests/cloud-fetch-terminal-reconcile.test.ts`: prove persistent media failures keep existing partial/failed semantics.
- `tests/cloud-source-sync.test.ts`: prove this patch does not convert media failures into capability deferrals or alter scheduling.
- `docs/superpowers/specs/2026-08-04-runner-owned-asr-design.md`: document phase-local retry, structured failure evidence, and maintenance-with-consent.

### Explicitly unchanged

- Prisma schema and migrations
- Cloud lease acquisition, heartbeat, and queue reconciliation
- `scripts/builder-agent-runner.sh` process topology and worker-lane concurrency
- Source-type fetch/summarization prompts
- Stop-fetch and stop-AI-Brief flows
- User-facing source settings

---

### Task 1: Lock the media failure contract with pure tests

**Files:**
- Create: `tests/media-tool-failures.test.ts`
- Create: `scripts/media-tool-failures.mjs`

- [ ] **Step 1: Write failing classification tests**

Cover at least:

```ts
test("classifies a noisy yt-dlp warning plus HTTP 403 without persisting raw stderr", () => {
  const failure = classifyMediaToolFailureForTest({
    stage: "download",
    toolVersion: "2026.03.17",
    now: new Date("2026-08-12T00:00:00Z"),
    result: {
      ok: false,
      code: 1,
      stderr: "WARNING: Your yt-dlp version (2026.03.17) is older than 90 days! ... HTTP Error 403: Forbidden",
    },
  });
  assert.equal(failure.code, "media_download_forbidden");
  assert.equal(failure.httpStatus, 403);
  assert.equal(failure.retryable, true);
  assert.deepEqual(failure.maintenanceWarnings, ["yt_dlp_outdated"]);
  assert.doesNotMatch(failure.code, /WARNING|403:/);
});
```

Also test warning-only success, 429, 5xx, timeout, explicit private/login/PO-token markers, removed media, missing output, ffmpeg failure, ASR failure, query-string redaction, authorization/cookie redaction, and home-path redaction.

- [ ] **Step 2: Run the tests and verify the module is missing**

Run:

```bash
npx tsx --test tests/media-tool-failures.test.ts
```

Expected: FAIL because the new module/exports do not exist.

- [ ] **Step 3: Implement the pure classifier and retry decision**

Keep pattern matching centralized and ordered from durable/specific to transient/generic. Export test-facing functions without importing application or filesystem state.

- [ ] **Step 4: Run the focused tests**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit the boundary**

Use a Lore-format commit whose intent is to prevent subprocess diagnostics from becoming persisted domain codes. Include focused tests and note that scheduling is intentionally unchanged.

### Task 2: Add a bounded fresh-process retry to shared media preparation

**Files:**
- Modify: `scripts/builder-digest.mjs`
- Modify: `tests/builder-digest-cli.test.ts`

- [ ] **Step 1: Write a failing transient-recovery test**

Inject a command runner that returns a noisy 403 on the first yt-dlp download and writes `audio.mp3` on the second. Assert:

- yt-dlp download runs exactly twice;
- ffmpeg and ASR run once;
- the final transcript succeeds;
- the first attempt is preserved as structured evidence;
- no terminal task failure is produced.

- [ ] **Step 2: Write persistent and non-retryable failure tests**

Assert that:

- two ambiguous 403 failures return `media_download_forbidden` and two structured process attempts;
- explicit private/login/PO-token output returns `media_download_access_required` after one process;
- a stale-version warning on an otherwise successful process does not fail the task;
- a retry is skipped when fewer than 30 seconds remain;
- partial `audio.*` files are removed before retry;
- a successful exit with no output file becomes `media_download_output_missing` and is retried once.

- [ ] **Step 3: Run the managed-media test slice and observe failure**

```bash
npx tsx --test --test-name-pattern="managed media|profiled ASR|audio download" tests/builder-digest-cli.test.ts
```

Expected: FAIL on retry count or raw reason assertions.

- [ ] **Step 4: Implement phase-local retry**

Import the pure helper, add explicit finite yt-dlp retry arguments, inject a sleeper for tests, enforce the remaining-budget guard, clean partial download outputs, and keep the current artifact/resume and machine-lock behavior.

- [ ] **Step 5: Persist stable state during each failed attempt**

Write `state.json` with stable `code`, stage, attempt count, and sanitized failure metadata. Never put raw stderr into `reason`.

- [ ] **Step 6: Run focused tests**

Expected: PASS, including existing resume, disk, timeout, absolute-path, and lock tests.

### Task 3: Preserve stable reasons through task outcome and setup verification

**Files:**
- Modify: `scripts/builder-digest.mjs`
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `tests/library-setup-verdict.test.ts`

- [ ] **Step 1: Write a failing task-outcome test**

Make `transcribeTask` return a classified persistent 403 failure. Assert the final task outcome has:

```json
{
  "status": "failed",
  "reason": "media_download_forbidden"
}
```

and structured `evidence.mediaFailure`, while `evidence.sourceReason` does not contain stderr.

- [ ] **Step 2: Replace the raw setup-verdict fixture**

Change `audio_download:javascript_runtime_unavailable` to a stable read-stage media code. Preserve these assertions:

- the post remains one planned task;
- the terminal task was synchronized;
- runner exit 65 becomes `needs_confirmation`, not `fatal`;
- recurring setup can still ask whether to install the scheduler.

- [ ] **Step 3: Implement the outcome handoff**

Return `{ reason, failure }` from managed media preparation, store the stable reason, and attach only bounded structured diagnostics. Keep capability failures mapped to `asr_capability_missing`.

- [ ] **Step 4: Run focused tests**

```bash
npx tsx --test tests/library-setup-verdict.test.ts
npx tsx --test --test-name-pattern="managed media preparation" tests/builder-digest-cli.test.ts
```

Expected: PASS.

### Task 4: Make downloader health visible and consented

**Files:**
- Modify: `scripts/builder-digest.mjs`
- Modify: `skills/builder-blog-digest/jobs/_asr-capability-setup.md`
- Modify: `tests/builder-digest-cli.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`

- [ ] **Step 1: Extend doctor tests before implementation**

Assert that doctor:

- runs absolute `yt-dlp --version` and `ffmpeg -version` probes;
- writes optional version fields while keeping profile `version: 1`;
- marks a parseable release older than 90 days with `yt_dlp_outdated`;
- leaves `status = ready` and exit behavior successful when only maintenance is needed;
- still treats missing downloader, decoder, JS runtime, or ASR backend as missing capability;
- continues to consume old version-1 profiles without the new optional fields.

- [ ] **Step 2: Implement additive health fields**

Use the pure version-age helper. Do not perform a network smoke test in doctor and do not make an unparsable version a hard failure.

- [ ] **Step 3: Update the interactive setup contract**

Capture doctor JSON, preserve exit codes `0` and `2`, and print one of:

```text
FOLLOWBRIEF_ASR_READY
FOLLOWBRIEF_ASR_MAINTENANCE_RECOMMENDED
FOLLOWBRIEF_ASR_SETUP_NEEDED
```

For maintenance, list warnings and ask before updating only the managed venv package. Declining must continue. Cloud host setup still stops only for missing capabilities when the admin declines.

- [ ] **Step 4: Run doctor and prompt contract tests**

```bash
npx tsx --test --test-name-pattern="ASR doctor|machine profile" tests/builder-digest-cli.test.ts
npx tsx --test --test-name-pattern="media|ASR" tests/cloud-source-cli-contract.test.ts
```

Expected: PASS.

### Task 5: Bundle the new runtime helper atomically

**Files:**
- Modify: `src/lib/agent-skill-files.ts`
- Modify: `next.config.ts`
- Modify: `scripts/install-agent-skill-bundle.cjs`
- Modify: `scripts/verify-prompt-runtime-traces.mjs`
- Modify: `tests/agent-skill-bundle.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`
- Modify: `tests/prompt-runtime-assets.test.ts`

- [ ] **Step 1: Write failing bundle assertions**

Require `media-tool-failures.mjs` in `agentSkillFiles`, the installer source list, installed file set, staged transaction, Next.js output-file tracing, and the post-build runtime trace surface.

- [ ] **Step 2: Add the helper to the atomic skill bundle**

Add the helper to `src/lib/agent-skill-files.ts` and `completeAgentRuntimeTraceFiles` in `next.config.ts`, then keep the installer and trace verifier aligned with that canonical manifest. Do not make hosts download this helper separately. `builder-digest.mjs` and its helper must switch together under the existing transaction/rollback contract.

- [ ] **Step 3: Run bundle tests**

```bash
npx tsx --test tests/agent-skill-bundle.test.ts tests/cloud-source-cli-contract.test.ts tests/prompt-runtime-assets.test.ts
npm run build
```

Expected: tests pass; the build emits `.next/server/**/*.nft.json` and then `verify-prompt-runtime-traces.mjs` passes against those fresh manifests.

### Task 6: Render media failures in the correct lifecycle stage

**Files:**
- Modify: `src/lib/fetch-failure-taxonomy.ts`
- Modify: `src/components/FetchLogPanel.tsx`
- Modify: `tests/fetch-failure-taxonomy.test.ts`
- Modify: `tests/fetch-log-panel-status.test.ts`

- [ ] **Step 1: Add failing taxonomy tests**

Cover every new stable code, retryability, stage, visibility, and narrow legacy mapping. Assert arbitrary unknown text still remains unknown.

- [ ] **Step 2: Add failing lifecycle tests**

For `media_download_forbidden`, assert:

```text
Read: Not completed
Summarize: Not reached
Sync: Not reached
```

Assert the reason appears under Read, not Summarize, and structured evidence produces concise facts rather than a JSON dump.

- [ ] **Step 3: Implement taxonomy and stage-derived rendering**

Introduce small helpers such as `isReadStageFailure(task)` and use them consistently in read detail visibility, summarize outcome, sync outcome, and reason placement. Preserve candidate discovery, skipped, validation, and worker-runtime behavior.

- [ ] **Step 4: Run focused UI logic tests**

```bash
npx tsx --test tests/fetch-failure-taxonomy.test.ts tests/fetch-log-panel-status.test.ts
```

Expected: PASS.

### Task 7: Lock regular/Cloud parity and scheduling non-regression

**Files:**
- Modify: `tests/cloud-fetch-terminal-reconcile.test.ts`
- Modify: `tests/cloud-source-sync.test.ts`
- Modify: `tests/cloud-source-cli-contract.test.ts`

- [ ] **Step 1: Add shared-path contract assertions**

Prove both `library-once`/`library-cron` and Cloud refill paths invoke the same `prepare-managed-media` command and do not send download instructions to model workers.

- [ ] **Step 2: Add terminal reconciliation tests**

Cover:

- one synced sibling plus one `media_download_forbidden` post -> source `partial`;
- all posts persistently fail media download -> source `failed`;
- `media_download_forbidden` never becomes `asr_capability_missing` or `deferred`;
- existing capability-only deferral behavior remains unchanged.

- [ ] **Step 3: Add scheduling assertions**

Verify partial results use the current success schedule, failed results use current failure backoff, and neither path changes lease release or circuit-breaker counters beyond existing behavior.

- [ ] **Step 4: Run focused Cloud tests**

```bash
npx tsx --test tests/cloud-fetch-terminal-reconcile.test.ts tests/cloud-source-sync.test.ts tests/cloud-source-cli-contract.test.ts
```

Expected: PASS.

### Task 8: Update architecture documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-runner-owned-asr-design.md`

- [ ] **Step 1: Document the new boundary**

Add phase-local retry, stable reason/structured evidence, optional health warnings, explicit consent for updates, and the decision not to alter Cloud source scheduling.

- [ ] **Step 2: Record rejected operational shortcuts**

Document why unattended package updates, whole-source retry, universal 403 retry, cookies, and automatic PO-token providers are outside the runner contract.

- [ ] **Step 3: Commit documentation with the related implementation**

Use Lore trailers to record the external yt-dlp/YouTube constraint and the directive that unattended fetches must remain mutation-free.

### Task 9: Verify the integrated implementation

**Files:**
- No additional files unless verification reveals a defect.

- [ ] **Step 1: Run syntax and focused suites**

```bash
node --check scripts/media-tool-failures.mjs
node --check scripts/builder-digest.mjs
bash -n scripts/builder-agent-runner.sh
npx tsx --test tests/media-tool-failures.test.ts
npx tsx --test tests/builder-digest-cli.test.ts
npx tsx --test tests/fetch-failure-taxonomy.test.ts tests/fetch-log-panel-status.test.ts
npx tsx --test tests/library-setup-verdict.test.ts
npx tsx --test tests/agent-skill-bundle.test.ts tests/cloud-source-cli-contract.test.ts tests/prompt-runtime-assets.test.ts
npx tsx --test tests/cloud-fetch-terminal-reconcile.test.ts tests/cloud-source-sync.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run static and full verification**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
git diff --check
```

Expected: all pass with no new warnings attributable to this change.

- [ ] **Step 3: Review the diff for scope**

Confirm there is no Prisma migration, no scheduler production change, no worker prompt download instruction, no unattended installer call, and no unrelated formatting churn.

### Task 10: Roll out and validate on a real runner host

**Files:**
- No source edits expected.

- [ ] **Step 1: Deploy web/API and skill bundle from the same commit**

Wait for the Vercel production deployment to succeed before refreshing the runner bundle. This ensures the web UI understands stable media codes before hosts emit them.

- [ ] **Step 2: Run doctor interactively on the Cloud host**

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
PATH="$AGENT_DIR/asr-venv/bin:$PATH" node "$AGENT_DIR/builder-digest.mjs" asr-doctor
```

If maintenance is recommended, obtain explicit admin consent, update `yt-dlp[default]` in the managed venv, rerun doctor, and verify the profile points to that venv binary.

- [ ] **Step 3: Perform a direct download smoke test**

Use yt-dlp's `--test` mode on the incident video. Do not use this live network request as the only proof; deterministic tests remain authoritative.

- [ ] **Step 4: Run one regular one-time fetch and one admin Cloud fetch**

Use the same public YouTube source. Verify both paths either sync successfully or report the same stable read-stage failure contract. Confirm unrelated posts continue and Cloud lease/run terminal states settle normally.

- [ ] **Step 5: Inspect production log presentation**

Verify the UI shows a concise read-stage message, bounded attempt/version details, `Summarize: Not reached`, and `Sync: Not reached`. Confirm no raw stderr, local absolute home path, signed media URL, cookie, or authorization value is visible.

## Rollback

- Revert the implementation commits and redeploy the previous web/skill bundle.
- No database rollback is needed.
- The enriched profile remains `version: 1`; old runners ignore optional fields and continue using the recorded absolute paths.
- Existing stable-code rows remain readable as unknown failures on an old web build; no destructive data conversion is performed.
- If the managed venv was explicitly updated, leave it installed. Downgrading a host dependency is a separate operator action and is not required for application rollback.

## Remaining risks and follow-ups

- A persistent YouTube attestation requirement may still need an explicitly reviewed PO-token provider. That requires a separate security, credential, provider-policy, and operations design.
- Data-center IP reputation or mass-download throttling can still produce 403/429 failures even on a current binary. Stable evidence will make that distinguishable without pretending the app can always bypass it.
- Cloud mixed synced+capability-blocked source semantics have pre-existing drift between code and the August 4 design. Resolve it in a separate state-machine change with its own migration and regression plan.
- Retry constants should remain code-level policy initially. Do not add source settings or admin UI until production evidence shows operators need tuning.
