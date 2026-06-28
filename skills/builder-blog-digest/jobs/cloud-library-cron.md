# FollowBrief Cloud Source Fetch

Run the cloud source fetch job through the local runner. The runner owns source leasing, task sharding, checkpoint sync, final sync, and cloud run status updates. Worker agents should only execute the shard tasks assigned by `library-worker.md`.

Use this command:

```bash
BUILDER_BLOG_RUN_SOURCE=cloud "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-agent-runner.sh" cloud-library-cron
```

Before the first real run against a database, run the read-only readiness check:

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
- `BUILDER_BLOG_CLOUD_FETCH_LIMIT`: number of cloud source tasks to lease per run.
- `BUILDER_BLOG_FETCH_LIMIT`: maximum posts planned per leased source.
- `BUILDER_BLOG_FETCH_DAYS`: lookback window for source fetch planning.
- `BUILDER_BLOG_PARALLEL_WORKERS`: shard workers, capped by the runner.

Do not run `fetch-cloud-library`, `shard-tasks`, or `sync-cloud-builders` by hand unless you are debugging a failed runner step. The runner keeps their file paths and `cloudRunId` consistent.
