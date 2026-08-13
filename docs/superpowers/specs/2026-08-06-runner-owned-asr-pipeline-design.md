# Runner-owned ASR pipeline design

## Problem

The fetch runner currently completes every managed long-media transcription before it assigns any model worker. A single multi-hour recording can therefore consume the whole job budget while ordinary post tasks remain unassigned and appear as `Worker unknown`.

This behavior was introduced when managed ASR moved out of model workers and into the deterministic runner pre-pass. Runner ownership and machine-wide serialization are still required, but the batch-wide scheduling barrier is not.

## Approved behavior

The runner treats managed-media preparation as a producer feeding the existing dynamic worker queue:

1. Discovery and normalization create the complete fetch plan.
2. Managed-media tasks remain visible in that plan but are deferred from model-worker assignment while their extraction method is `audio_transcription`.
3. The runner starts one background managed-media producer. It continues to use the existing machine-wide ASR lock and processes media tasks serially.
4. Ordinary ready tasks are assigned immediately, without waiting for the producer.
5. After each media task succeeds or reaches a terminal preparation outcome, the producer atomically persists a new fetch-result snapshot.
6. A successfully prepared media task changes to `summarize_prepared_media`; the next dynamic queue poll can assign it immediately. Failed or blocked media tasks become terminal outcomes and are no longer pending.
7. The job loop remains alive while either a model worker or the managed-media producer is running.

## Invariants

- Model workers never perform local ASR.
- At most one local ASR operation runs on a machine at a time.
- An unprepared media task is never assigned to a model worker.
- Every completed preparation step is durably represented in the shared fetch-result file.
- Worker assignment reads only complete JSON snapshots; producer writes remain atomic.
- Existing account, run, task, and cloud-source identity fields are preserved.
- A long media task cannot prevent unrelated ready tasks from receiving worker IDs.

## Failure and timeout behavior

If preparation of one media task fails, its terminal outcome is persisted and preparation proceeds to the next media task. If the outer job is terminated, already persisted ready tasks and terminal outcomes remain recoverable; only the currently running or not-yet-processed media tasks remain pending. The runner reports producer command failure separately from individual task outcomes.

Managed media acquisition remains a deterministic shared runner responsibility for both regular and Cloud fetches. Download retries stay bounded within the existing task budget, and terminal media-preparation failures persist stable failure codes rather than host-specific subprocess text.

## Scope

This replaces only the batch-wide scheduling barrier from the 2026-08-04 runner-owned ASR design. Deterministic discovery, runner-owned ASR, the machine lock, transcript artifacts, dynamic one-task assignments, and checkpoint synchronization remain unchanged.

Cloud scheduling semantics are unchanged: the same runner-owned media producer prepares tasks, ready non-media work can still start immediately, and this resilience work does not reintroduce a batch-wide barrier or move download/ffmpeg/ASR execution into model workers.
