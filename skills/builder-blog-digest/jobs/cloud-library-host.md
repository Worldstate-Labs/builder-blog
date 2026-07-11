# FollowBrief Cloud Worker Host

Run the persistent cloud source worker host through the local runner. This is
the admin-facing cloud fetch command: the runner owns source leasing, local
post-task queueing, same-domain worker assignment, checkpoint sync, result sync,
heartbeats, and idle polling. Worker agents should only execute shard tasks
assigned by `library-worker.md`.

Use this command:

```bash
BUILDER_BLOG_RUN_SOURCE=cloud \
BUILDER_BLOG_AGENT_RUNTIME="${BUILDER_BLOG_AGENT_RUNTIME-{{AGENT_RUNTIME}}}" \
BUILDER_BLOG_FETCH_DAYS="${BUILDER_BLOG_FETCH_DAYS-{{FETCH_DAYS}}}" \
BUILDER_BLOG_PARALLEL_WORKERS="${BUILDER_BLOG_PARALLEL_WORKERS-{{PARALLEL_WORKERS}}}" \
"${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-agent-runner.sh" cloud-library-host
```

Before the first real worker host run against a database, run the read-only readiness check:

```bash
npx tsx scripts/check-cloud-source-fetch-readiness.mts --language zh
```

It must report `ready`. If it reports `not_ready`, do not start the cloud worker host; apply the migration and configure the cloud language owner first.

After readiness reports `ready`, run the rollback-only smoke before enabling the host:

```bash
npx tsx scripts/smoke-cloud-source-fetch-rollback.mts --language zh
```

It writes only inside a database transaction and intentionally rolls back after verifying cloud submission, leasing, sync, Hub projection, and source-candidate projection.

Useful environment variables:

- `BUILDER_BLOG_ACCOUNT`: admin account email with Cloud Fetch access.
- `BUILDER_BLOG_AGENT_RUNTIME`: local runtime for unattended shard workers. Copied value: `{{AGENT_RUNTIME}}`.
- `BUILDER_BLOG_FETCH_DAYS`: source post lookback window. Copied value: `{{FETCH_DAYS}}`.
- `BUILDER_BLOG_PARALLEL_WORKERS`: local worker count on this admin machine. Copied value: `{{PARALLEL_WORKERS}}`.
- `BUILDER_BLOG_CLOUD_IDLE_SECONDS`: seconds to wait before asking Cloud for more sources when no work is available.

Do not run `fetch-cloud-library`, `assign-fetch-tasks`, `merge-fetch-results`, or `sync-cloud-builders` by hand unless you are debugging a failed runner step. The runner keeps their file paths, local queue state, and cloud run ids consistent.
