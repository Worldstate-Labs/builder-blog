# FollowBrief Cloud Source Fetch

Run the internal cloud source fetch command through the local runner. The
admin-facing path should use `cloud-library-host`; this command remains for
diagnostics and backward-compatible copied prompts. The runner owns source
leasing, local post-task queueing, task sharding, checkpoint sync, result sync,
and source delivery status updates. Worker agents should only execute the
shard tasks assigned by `library-worker.md`.

Use this command:

```bash
BUILDER_BLOG_RUN_SOURCE=cloud \
BUILDER_BLOG_FETCH_LIMIT="${BUILDER_BLOG_FETCH_LIMIT-{{FETCH_LIMIT}}}" \
BUILDER_BLOG_FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS-{{FETCH_DAYS}}}" \
BUILDER_BLOG_PARALLEL_WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS-{{PARALLEL_WORKERS}}}" \
"${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-agent-runner.sh" cloud-library-cron
```

Before the first real worker host run against a database, run the read-only readiness check:

```bash
npx tsx scripts/check-cloud-source-fetch-readiness.mts --language zh
```

It must report `ready`. If it reports `not_ready`, do not start the cloud fetch runner; apply the migration and configure the cloud language owner first.

After readiness reports `ready`, run the rollback-only smoke before enabling the cron:

```bash
npx tsx scripts/smoke-cloud-source-fetch-rollback.mts --language zh
```

It writes only inside a database transaction and intentionally rolls back after verifying cloud submission, leasing, sync, Hub projection, and source-candidate projection.

Useful environment variables:

- `BUILDER_BLOG_ACCOUNT`: admin account email with Cloud Fetch access.
- `BUILDER_BLOG_FETCH_LIMIT`: posts to try per leased source. Copied value: `{{FETCH_LIMIT}}`.
- `BUILDER_BLOG_FETCH_DAYS`: source post lookback window. Copied value: `{{FETCH_DAYS}}`.
- `BUILDER_BLOG_PARALLEL_WORKERS`: local worker count on this admin machine. Copied value: `{{PARALLEL_WORKERS}}`.

Do not run `fetch-cloud-library`, `shard-tasks`, or `sync-cloud-builders` by hand unless you are debugging a failed runner step. The runner keeps their file paths and `cloudRunId` consistent.
