# Cloud deferred source visibility

## Problem

The admin Cloud libraries panel lists every active submitted source, but the Cloud fetch monitor only lists post tasks, leased source batches, and assigned worker lanes. A due source that the scheduler defers before creating a `CloudFetchQueueItem` is therefore absent from every operational list. This makes an intact task look lost.

## Decision

Add a **Waiting for source lease** section to the live Cloud fetch monitor. Compute its rows from current scheduler state instead of adding persisted diagnostic columns.

Each row contains:

- source name and type;
- current scheduling reason;
- consecutive deferral count and last deferral time;
- estimated token requirement and current hourly token budget remaining;
- next attempt time when retry backoff or a circuit breaker applies.

The section includes active sources that have active submission demand, have not yet been leased, and still have outstanding work: queued sources, due/deferred sources, retry backoff, or an open circuit breaker. A normally scheduled source whose last run succeeded and whose next daily/weekly attempt is still in the future is excluded. A queued source remains visible with the `queued` reason. Sources with a leased queue item or a running delivery are excluded.

## Scheduling reasons

Reasons are evaluated in scheduler order:

1. `queued` when a queue item exists but has not yet been leased;
2. `circuit_breaker` when `circuitBreakerUntil` is in the future;
3. `retry_backoff` when a failed source has a future `nextAttemptAt`;
4. `canonical_active` when another active lease owns the same canonical source;
5. `canonical_cooldown` when recent canonical-source activity temporarily blocks this task;
6. `token_budget` when the source estimate does not fit the rolling hourly budget;
7. `scheduler_capacity` when the source is due and fits the current budget but has not yet been selected.

The calculation reuses scheduler estimation and default configuration values. It must not claim a precise future lease time because the rolling budget and competing demand can change.

## Data flow

The initial admin page and the existing `/api/admin/cloud-fetch/runs` live endpoint both load a single pending-source diagnostic snapshot. `AdminCloudFetchLog` stores that snapshot alongside worker-host and delivery state and refreshes it through the existing polling cycle.

No database migration is required. No queue, lease, source-task, or worker behavior changes.

## UI behavior

Render **Waiting for source lease** before **Waiting for assignment** so source-level scheduling is visibly distinct from post-task assignment.

- Empty state: `No sources waiting for lease.`
- `token_budget`: explain that the source needs more tokens than remain in the rolling hourly window.
- `scheduler_capacity`: explain that the source is due, fits the current budget, and is waiting for the scheduler's next selection.
- `retry_backoff` and `circuit_breaker`: show the next attempt timestamp.
- `canonical_active` and `canonical_cooldown`: explain that duplicate canonical work is already active or cooling down.
- `queued`: explain that the source is queued and waiting for a worker lease.

Rows use the existing monitor list styling and remain read-only.

## Error handling

If diagnostic loading fails during polling, preserve the last successful snapshot, matching existing live monitor behavior. Initial page loading fails with the page query rather than silently presenting an incorrect empty state.

## Tests

- Unit-test pending-source classification and hourly budget calculation.
- Cover a new YouTube source deferred because `120,000` estimated tokens exceed `60,675` remaining.
- Cover queued, retry-backoff, circuit-breaker, canonical blocking, scheduler-capacity, normal future-schedule exclusion, active-lease exclusion, and inactive-demand exclusion.
- Contract-test the admin page/API wiring and the monitor labels.
- Run typecheck, lint, targeted cloud admin tests, and the production build.

## Rejected alternatives

- Persist `lastDeferredReason` on `CloudSourceTask`: adds a migration and risks stale diagnostics when budget changes between polls.
- Only add a `Pending` chip in Cloud libraries: still hides the source from the operational monitor and does not explain the scheduling gate.
