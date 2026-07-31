# Local Schedule Time Zone Design

## Goal

Make FollowBrief daily and weekly local-agent schedules report the same windows
that macOS `launchd` and Linux `cron` can actually execute. A setup validation is
an immediate one-time run; the first recurring window is the next local calendar
day or week after schedule installation.

## Confirmed schedule semantics

- A schedule has one business time zone: the IANA time zone of the machine that
  installs and runs it, for example `America/Los_Angeles`.
- The server's process time zone is never used to interpret a local cron
  expression.
- Setup validation runs immediately and is not a recurring schedule window.
- Daily schedules first run on the next local calendar day at the installed
  wall-clock hour and minute.
- Weekly schedules first run on the same local weekday and wall-clock time in
  the following local calendar week.
- Later daily and weekly windows remain at that local wall-clock time through
  daylight-saving transitions. Their UTC instants may therefore move by one
  hour.
- If a spring-forward transition makes a scheduled local time nonexistent,
  move that occurrence forward by the size of the DST gap while preserving its
  minute (for example, `02:30` becomes `03:30`). If a fall-back transition
  repeats a local time, use the earlier occurrence and execute the slot at most
  once. This is the same `compatible` disambiguation used by modern zoned date
  APIs.
- A window becomes `Missed` only after its explicit expected instant plus the
  existing grace period, with no matching scheduled job run.

## Data model and reporting

Add nullable `timeZone` columns to `LibraryCronJob` and `DigestCronJob`.
Nullable fields preserve compatibility with existing rows and older installed
agent bundles.

The local CLI reports
`Intl.DateTimeFormat().resolvedOptions().timeZone` in an
`x-machine-time-zone` header alongside the existing machine hostname and
platform headers. The cron status endpoint validates that it is an IANA time
zone and stores it when a schedule is activated. The recurring guard heartbeat
also refreshes it, so a machine whose system time zone changes eventually
realigns the server status without reinstalling the schedule.

Both cron job serializers expose `timeZone` to the shared schedule-window
calculation.

## Window calculation

For daily and weekly schedules with a valid time zone:

1. Parse the stored cron hour, minute, and optional weekday.
2. Convert local calendar occurrences to UTC using explicit `Intl` time-zone
   formatting.
3. Treat the first occurrence strictly after `startedAt` as the first recurring
   window.
4. Add or subtract calendar days/weeks in the schedule time zone, not in the
   Vercel process time zone and not as fixed milliseconds.
5. Apply the same gap/fold disambiguation when calculating historical, current,
   and next windows.

For sub-daily schedules, retain the existing fixed-interval behavior.

For legacy daily/weekly rows without `timeZone`, use fixed intervals from
`startedAt`. This is preferable to interpreting local cron text in the server
time zone: it prevents fabricated windows immediately and remains accurate
except across a daylight-saving transition. The next real guard heartbeat
backfills the machine time zone.

## Local scheduler behavior

The existing installation anchor is written after setup validation succeeds and
before the scheduler is installed.

- macOS continues to use `StartCalendarInterval`.
- Linux continues to use the machine-local crontab schedule.
- Both platforms use the same local CLI to report the IANA zone.
- The schedule anchor is normalized to minute precision because both local
  schedulers execute at minute precision.
- The local runner derives scheduled `expectedAt` values from the same zoned
  calendar rules instead of `anchor + N fixed UTC minutes`. This keeps server
  matching correct after DST changes. Both invocations of a repeated fall-back
  wall-clock time resolve to the same earlier canonical `expectedAt`, so the
  existing last-fired guard suppresses a duplicate.

No `CRON_TZ` directive is required. It is not consistently supported by all
Linux cron implementations, while the existing product contract is explicitly
a schedule on the local machine.

## Compatibility and failure behavior

- Existing clients may omit the time-zone header.
- Invalid time-zone headers are ignored rather than rejecting an otherwise
  valid heartbeat or cron status update.
- Existing cron rows require no destructive migration or reset.
- Stopped schedules retain their last known time zone for diagnostics.
- If explicit zoned conversion cannot be performed, calculation falls back to
  fixed interval timing rather than the server's wall clock.
- The local `fetch-status-audit` and `digest-status-audit` calculations use the
  same explicit-zone and first-window rules. They must not retain an independent
  `startedAt + fixed interval` interpretation that can disagree with the web
  status.

## Verification

Regression tests cover:

- the production-shaped Los Angeles daily schedule before its first real run;
- no false missed slot between setup validation and the first recurring window;
- daily and weekly local wall-clock alignment;
- UTC instant changes across a daylight-saving transition;
- spring-forward gaps and fall-back folds;
- legacy rows without a time zone;
- invalid time zones;
- cron status persistence and serialization;
- macOS and Linux setup/runner contracts, including canonical scheduled
  `expectedAt` values and duplicate suppression.
