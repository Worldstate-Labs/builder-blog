# Runner-owned ASR Design

## Goal

Make long-media extraction behave the same under Codex, Claude Code, and
OpenClaw. The model runtime summarizes prepared primary content; it no longer
owns downloads, ffmpeg, ASR subprocesses, timeouts, or transcript files.

## Boundaries

- The outer interactive setup agent may inspect the machine, explain missing
  dependencies, ask before installing software, and run an approved install
  recipe.
- The unattended FollowBrief runner owns deterministic media preparation.
- The inner shard agent receives `contentStatus: "ready"` after preparation and
  only writes the summary/headline and normal result checkpoints.
- Source-type fetch prompts describe what valid primary content is and source
  semantics. They cannot override the managed-media execution policy.
- Regular and Cloud runs use the same preparation command. Cloud hosts are
  provisioned by the admin; end users never install Cloud worker dependencies.

## Machine Capability

`builder-digest.mjs asr-doctor` probes downloader, decoder, and ASR adapters and
writes a versioned machine profile under the FollowBrief agent directory. The
profile records absolute executable paths, backend/model, platform, probe time,
and measured or configured realtime factor. Unattended jobs only probe and
report; they never install packages.

Setup prompts run the doctor after installing the FollowBrief bundle. When a
media-capable library has missing dependencies, the interactive agent asks for
permission before using the platform-specific install guidance and re-runs the
doctor. Declining does not block non-media or caption-backed items.

## Execution

After deterministic discovery and before shard assignment, the runner invokes
`prepare-managed-media`. It finds YouTube/podcast tasks whose planned method is
audio transcription, acquires a machine-wide ASR lock, and performs download,
normalization, and transcription as foreground subprocesses owned by Node.

Each task gets a stable directory under the current job. Completed stages and
artifacts are written atomically so a retry can reuse downloaded audio or an
already completed transcript. Progress heartbeats report `download`,
`prepare_audio`, and `transcribe`. Successful tasks are rewritten as `ready`
with the transcript body and provenance. The transcript is passed to the model
through the task file, never through a model tool-call stdout stream.

The ASR lock defaults to one concurrent transcription per machine and includes
owner metadata plus stale-owner recovery. This prevents a regular fetch and a
Cloud host from saturating the same CPU/GPU concurrently.

## Failure Semantics

- Missing local ASR capability becomes a per-task `blocked` outcome with reason
  `asr_capability_missing`; other tasks continue.
- A deterministic subprocess failure becomes a normal failed outcome with
  concrete stage/backend evidence.
- Cloud sources whose only unsatisfied posts are capability-blocked finalize as
  `deferred`: the queue item is released without increasing consecutive
  failures or tripping the circuit breaker, and it is retried after the normal
  retry interval.
- A Cloud source with some synced posts remains partial; capability-blocked
  posts remain visible in its post-level log.

## Configuration And Migration

Podcast and YouTube default fetch prompts stop instructing agents to invoke
Whisper, yt-dlp, or ffmpeg. They retain content requirements and provenance
rules. Common fetch rules explicitly reserve managed long media for the runner.
A guarded migration updates system defaults and only known legacy per-user
copies, preserving genuinely customized prompts.

The Settings UI labels the field as content extraction guidance. The API makes
fetch instructions admin-only, matching the existing UI. Machine ASR settings
do not become source-type settings.

## Verification

Contract tests prove the runner prepares media before shard assignment and that
the worker prompt cannot start ASR. CLI tests cover profile probing, resumable
artifacts, lock behavior, successful rewrite to `ready`, and blocked outcomes.
Cloud tests cover deferred scheduling without failure/circuit-breaker changes.
Prompt migration, Settings API, and UI wording receive regression coverage.
