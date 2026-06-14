import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("Prisma schema declares LibraryFetchRun with user-indexed ordering", () => {
  const schema = source("prisma/schema.prisma");
  assert.match(schema, /model LibraryFetchRun \{/);
  // Required scalar columns the fetch log relies on.
  for (const field of [
    "userId",
    "startedAt",
    "finishedAt",
    "durationMs",
    "status",
    "source",
    "cliVersion",
    "hostname",
    "platform",
    "buildersAttempted",
    "itemsFetched",
    "tasksGenerated",
    "userActionsCount",
    "errorCount",
    "summary",
    "details",
  ]) {
    assert.match(schema, new RegExp(`\\n\\s*${field}\\s+`), `LibraryFetchRun is missing ${field}`);
  }
  // details is stored as JSON (Postgres jsonb), per the schema spec.
  assert.match(schema, /details\s+Json/);
  // Cascade on user delete keeps logs from outliving the account.
  assert.match(schema, /libraryFetchRuns\s+LibraryFetchRun\[\]/);
  assert.match(schema, /libraryCronJob\s+LibraryCronJob\?/);
  assert.match(schema, /digestCronJob\s+DigestCronJob\?/);
  assert.match(
    schema,
    /model LibraryFetchRun \{[\s\S]*user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
  );
  // Index by (userId, startedAt DESC) supports the list query.
  assert.match(schema, /@@index\(\[userId, startedAt\(sort: Desc\)\]\)/);
  assert.match(schema, /model LibraryCronJob \{/);
  assert.match(schema, /intervalMinutes\s+Int/);
  assert.match(schema, /@@index\(\[userId, status\]\)/);
  assert.match(schema, /model DigestCronJob \{/);
  assert.match(schema, /regenerateDigest\s+Boolean\s+@default\(false\)/);
});

test("migration creates LibraryFetchRun with the expected columns and index", () => {
  const migration = source("prisma/migrations/000028_library_fetch_runs/migration.sql");
  assert.match(migration, /CREATE TABLE "LibraryFetchRun"/);
  assert.match(migration, /"details"\s+JSONB\s+NOT NULL/);
  assert.match(migration, /CREATE INDEX "LibraryFetchRun_userId_startedAt_idx"/);
  assert.match(migration, /REFERENCES "User"\("id"\) ON DELETE CASCADE/);
  const cronMigration = source("prisma/migrations/000041_library_cron_job/migration.sql");
  assert.match(cronMigration, /CREATE TABLE "LibraryCronJob"/);
  assert.match(cronMigration, /"intervalMinutes"\s+INTEGER\s+NOT NULL/);
  assert.match(cronMigration, /CREATE UNIQUE INDEX "LibraryCronJob_userId_key"/);
  assert.match(cronMigration, /REFERENCES "User"\("id"\)[\s\S]*ON DELETE CASCADE/);
  const digestCronMigration = source("prisma/migrations/000042_digest_cron_job/migration.sql");
  assert.match(digestCronMigration, /CREATE TABLE "DigestCronJob"/);
  assert.match(digestCronMigration, /"regenerateDigest"\s+BOOLEAN\s+NOT NULL DEFAULT false/);
  assert.match(digestCronMigration, /CREATE UNIQUE INDEX "DigestCronJob_userId_key"/);
  assert.match(digestCronMigration, /REFERENCES "User"\("id"\)[\s\S]*ON DELETE CASCADE/);
});

test("skill fetch-runs route validates payload size and gates auth on user or bearer", () => {
  const route = source("src/app/api/skill/fetch-runs/route.ts");
  const patchRoute = source("src/app/api/skill/fetch-runs/[id]/route.ts");
  const cronRoute = source("src/app/api/skill/cron-jobs/route.ts");
  // POST is bearer-token (CLI); GET is browser session or bearer read-only
  // so local production audits can read the same status model as the UI.
  assert.match(route, /getUserFromBearer\(request\)/);
  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /const userId = session\?\.user\?\.id \?\? bearerUser\?\.id \?\? null/);
  // Schema enforces the documented status / source enums.
  assert.match(route, /z\.enum\(\["ok", "partial", "failed"\]\)/);
  assert.match(route, /z\.enum\(\["manual", "cron"\]\)/);
  // Summary is capped at 280 chars.
  assert.match(route, /MAX_SUMMARY_CHARS = 280/);
  // details payload is rejected over 50 KB with the spec'd message.
  assert.match(route, /MAX_DETAILS_BYTES = 50_000/);
  assert.match(route, /details payload too large; cap at 50 KB/);
  // Server filters the GET by the caller's user id.
  assert.match(route, /where: \{ userId \}/);
  assert.match(route, /source: "cron"/);
  assert.match(route, /cronRuns/);
  assert.match(route, /libraryCronJob\.findUnique/);
  assert.match(route, /cronJob: cron/);
  // PATCH may append discovery-expanded tasks, but only for builders already
  // present in this run's perBuilder snapshot.
  assert.match(patchRoute, /workerId: z\.string\(\)\.max\(120\)\.nullable\(\)\.optional\(\)/);
  assert.match(patchRoute, /plannedBuilderIds/);
  assert.match(patchRoute, /details\.perBuilder/);
  // Server orders by startedAt desc and limits to the spec'd 25.
  assert.match(route, /orderBy: \{ startedAt: "desc" \}/);
  assert.match(route, /take: RUN_HISTORY_LIMIT/);
  assert.match(route, /RUN_HISTORY_LIMIT = 25/);
  assert.match(cronRoute, /getUserFromBearer\(request\)/);
  assert.match(cronRoute, /z\.enum\(\["library-cron", "digest-cron"\]\)/);
  assert.match(cronRoute, /z\.enum\(\["active", "stopped"\]\)/);
  assert.match(cronRoute, /intervalMinutes/);
  assert.match(cronRoute, /libraryCronJob\.upsert/);
  assert.match(cronRoute, /libraryCronJob\.updateMany/);
  assert.match(cronRoute, /digestCronJob\.upsert/);
  assert.match(cronRoute, /digestCronJob\.updateMany/);
  assert.match(cronRoute, /regenerateDigest/);
});

test("CLI emits a fetch-run record on both success and failure paths", () => {
  const cli = source("scripts/builder-digest.mjs");
  // CLI_VERSION is bumped for this change.
  assert.match(cli, /const CLI_VERSION = "0\.6\.0";/);
  // The CLI POSTs to the new endpoint with the bearer token.
  assert.match(cli, /\/api\/skill\/fetch-runs/);
  assert.match(cli, /BUILDER_BLOG_DISABLE_WEB_SYNC/);
  assert.match(cli, /webSyncDisabled\(\)/);
  assert.match(cli, /cron-status/);
  assert.match(cli, /\/api\/skill\/cron-jobs/);
  // Detects cron vs manual via the env variable exported by the runner.
  assert.match(cli, /BUILDER_BLOG_RUN_SOURCE/);
  // Success path logs the record after printing JSON to stdout.
  assert.match(cli, /emitFetchRunRecord\(config, \{[\s\S]*status: "ok"/);
  assert.match(cli, /emitFetchRunRecord\(config, \{[\s\S]*status: "failed"/);
  // Upload failures must not fail the command itself.
  assert.match(cli, /Failed to upload fetch log:/);
  // A failed fetch-run POST must not leave sync-builders patching a stale run id.
  assert.match(cli, /rm\(libraryFetchRunIdFile\(\), \{ force: true \}\)/);
  // Original error is printed and rethrown so the user still sees it.
  assert.match(cli, /console\.error\(message\);[\s\S]*throw error;/);
  // Fetch-run details carry an audit trail of the queued tasks plus
  // the deduped per-source-type prompts the agent was instructed with.
  assert.match(cli, /summarizeFetchTasksForLog/);
  assert.match(cli, /fetchTasks: slimFetchTasks/);
  assert.match(cli, /prompts: promptsBySourceType/);
  assert.match(cli, /Read \$\{itemsFetched\} post/);
  assert.doesNotMatch(cli, /Fetched \$\{itemsFetched\} post/);
  assert.doesNotMatch(cli, /Synced \$\{itemsFetched\} post/);
  assert.match(cli, /JOB_RUN_UPDATE_TIMEOUT_MS/);
  assert.match(cli, /\/api\/skill\/job-runs[\s\S]*timeoutMs: JOB_RUN_UPDATE_TIMEOUT_MS/);
  assert.match(cli, /HTTP \$\{details\.method\} \$\{details\.url\} \$\{message\}/);
  assert.match(cli, /timed out after \$\{Math\.round\(options\.timeoutMs \/ 1000\)\}s/);
  // Product Hunt direct-fetch 403s are recoverable: they should be shown as a
  // fallback note while agent discovery continues, not counted as a source error.
  assert.match(cli, /isRecoverableFetchFallback/);
  assert.match(cli, /builderStat\.fallback = sourceFallbackNotice\(task, message\)/);
  assert.match(cli, /agentWorkType === "fetch_builder_fallback"/);
  assert.match(cli, /Initial source scan stopped; Local Agent fallback was queued\./);
  assert.match(cli, /else \{[\s\S]*builderStat\.error = message;[\s\S]*errorCount \+= 1;/);
  // Expanded candidate discovery is reconciled back onto the original
  // discovery task, otherwise the initial fetch-log row stays pending forever.
  assert.match(cli, /discoveryExpansions/);
  assert.match(cli, /discoveryExpansionById/);
  assert.match(cli, /discoveryExpanded: true/);
});

test("agent runner tags cron-driven CLI runs as source=cron", () => {
  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /BUILDER_BLOG_RUN_SOURCE=cron/);
  assert.match(runner, /export[^\n]*BUILDER_BLOG_RUN_SOURCE/);
  assert.match(runner, /run_cron_supervisor/);
  assert.match(runner, /run_cron_scheduler_tick/);
  assert.match(runner, /run_cron_worker/);
  assert.match(runner, /BUILDER_BLOG_SCHEDULER_TICK/);
  assert.match(runner, /ACCOUNT_SLUG/);
  assert.match(runner, /CURRENT_FILE="\$JOB_TMP_DIR\/current\.json"/);
  assert.match(runner, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(runner, /write_current_file "\$CURRENT_FILE" "\$INSTANCE_ID" "\$BUILDER_BLOG_WORKER_PID"/);
  assert.match(runner, /write_current_file "\$CURRENT_FILE" "\$INSTANCE_ID" "\$WORKER_PID"/);
  assert.match(runner, /WORKER_PID="\$\$"/);
  assert.match(runner, /BUILDER_BLOG_SKIP_BOOTSTRAP_REFRESH/);
  assert.match(runner, /worker_bootstrap_failed/);
  assert.match(runner, /worker_prompt_missing/);
  assert.match(runner, /Scheduled worker running in launchd foreground/);
  assert.match(runner, /Running scheduled window \$EXPECTED_AT as pid \$WORKER_PID/);
  assert.match(runner, /exec "\$0" "\$JOB_NAME"/);
  assert.doesNotMatch(runner, /WORKER_PID="\$!"/);
  assert.match(runner, /verify_followbrief_pid/);
  assert.match(runner, /terminate_process_tree/);
  assert.match(runner, /process_tree_pids/);
  assert.match(runner, /worker_shard_timeout/);
  assert.match(runner, /shard_timeout_seconds\(\)/);
  assert.match(runner, /_shard_timeout="\$\(shard_timeout_seconds "\$_whole_timeout"\)"/);
  assert.match(runner, /still_alive_after_kill/);
  assert.match(runner, /skipped-wait-pids/);
  assert.match(runner, /job_run_update_for_instance/);
  assert.match(runner, /stale_pid_next_schedule_arrived/);
  assert.match(runner, /OLD_STARTED="\$\(json_get_string startedAt "\$CURRENT_FILE"\)"/);
  assert.match(runner, /OLD_EXPECTED="\$\(json_get_string expectedAt "\$CURRENT_FILE"\)"/);
  assert.match(runner, /status replaced/);
  assert.match(runner, /status killed/);
  assert.match(runner, /\*\-cron\)/);
});

test("CLI can audit production fetch status against local scheduler state", () => {
  const cli = source("scripts/builder-digest.mjs");

  assert.match(cli, /fetch-status-audit/);
  assert.match(cli, /async function fetchStatusAudit\(\)/);
  assert.match(cli, /\/api\/skill\/fetch-runs/);
  assert.match(cli, /schedule-anchor-library-cron-\$\{accountSlug\(\)\}/);
  assert.match(cli, /last-fired-expected-at/);
  assert.match(cli, /current\.json/);
  assert.match(cli, /production_cron_active/);
  assert.match(cli, /local_anchor_matches_production/);
  assert.match(cli, /latest_scheduled_run_terminal/);
  assert.match(cli, /last_fired_matches_latest_scheduled_run/);
  assert.match(cli, /current_file_not_dead/);
});

test("FetchLogPanel renders status pills and status/log tabs with semantic CSS variables", () => {
  const panel = source("src/components/FetchLogPanel.tsx");
  assert.match(panel, /@\/lib\/schedule-timing/);
  assert.doesNotMatch(panel, /function floorToExpectedSchedule/);
  assert.doesNotMatch(panel, /function addScheduleInterval/);
  // Status pill colors must reuse existing tokens, not new colors.
  assert.match(panel, /var\(--signal\)/);
  assert.match(panel, /var\(--warm\)/);
  assert.match(panel, /var\(--danger\)/);
  // Background refresh still calls the GET endpoint, but the panel no longer
  // renders its own manual Refresh button.
  assert.match(panel, /fetch\("\/api\/skill\/fetch-runs"/);
  assert.doesNotMatch(panel, /RefreshCw/);
  assert.doesNotMatch(panel, />Refresh</);
  assert.match(panel, /VISIBLE_RUN_LIMIT = 2/);
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /onKeyDown=\{handleTabKeyDown\}/);
  assert.match(panel, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(panel, /tabIndex=\{activeTab === "status" \? 0 : -1\}/);
  assert.match(panel, /tabIndex=\{activeTab === "log" \? 0 : -1\}/);
  assert.match(panel, /fb-segmented-tabs/);
  assert.match(panel, /id="fetch-sync-tab-status"/);
  assert.match(panel, /aria-controls="fetch-sync-panel-status"/);
  assert.match(panel, /aria-labelledby="fetch-sync-tab-status"/);
  assert.match(panel, /id="fetch-sync-panel-status"/);
  assert.match(panel, /id="fetch-sync-tab-log"/);
  assert.match(panel, /aria-controls="fetch-sync-panel-log"/);
  assert.match(panel, /aria-labelledby="fetch-sync-tab-log"/);
  assert.match(panel, /id="fetch-sync-panel-log"/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /Fetch status/);
  assert.match(panel, /Fetch log/);
  assert.match(panel, /Fetch sources run history/);
  assert.match(panel, /className="sync-panel-run-list-shell"/);
  assert.match(panel, /aria-label="Fetch sources run history list"/);
  assert.match(panel, /className="sync-panel-run-list sync-panel-run-list-scroll"/);
  assert.match(panel, /fallback\?:/);
  assert.match(panel, /const postTasks = fetchTasks\.filter\(isPlannedPostTask\)/);
  assert.match(panel, /taskWorkerGroups\(postTasks, liveTasks\)/);
  assert.match(panel, /Post tasks \(\{postTasks\.length\}\)/);
  assert.match(panel, /className="sync-panel-task-worker-group-list"/);
  assert.match(panel, /className="sync-panel-task-worker-details" open/);
  assert.match(panel, /className="sync-panel-task-worker-summary"/);
  assert.match(panel, /className="sync-panel-task-source-group-list"/);
  assert.match(panel, /className="sync-panel-task-source-details" open/);
  assert.match(panel, /taskSourceGroups\(group\.tasks\)/);
  assert.match(panel, /function discoveryTaskState/);
  assert.match(panel, /expandedByPosts/);
  assert.match(panel, /Waiting on posts/);
  assert.match(panel, /post tasks synced/);
  assert.match(panel, /discovery tasks/);
  assert.match(panel, /post tasks/);
  assert.doesNotMatch(panel, /sourceRunStats/);
  // A fetch run linked to a stopped/killed runtime job is no longer live even
  // if its planned task outcomes were never patched.
  assert.match(panel, /jobRunByInstanceId/);
  assert.match(panel, /cronJobRef/);
  assert.match(panel, /run\.source === "cron" && cronJob && cronJob\.status !== "active"/);
  assert.match(panel, /isRunInflight\(run, run\.jobRunId \? jobsByInstanceId\.get\(run\.jobRunId\) : null, cronJob\)/);
  assert.match(panel, /if \(cronJob\.status !== "active"\) \{[\s\S]*key: "stopped"/);
  assert.match(panel, /<RunCard key=\{entry\.id\} cronJob=\{cronJob\} jobRun=\{entry\.jobRun\} run=\{entry\.run\} \/>/);
  assert.match(panel, /interruptedFetchRunStatus/);
  assert.match(panel, /label: "Stopped"/);
  assert.match(panel, /const displayStatus = !inflight && interruptedStatus/);
  assert.match(panel, /displayStatus\.label/);
  assert.match(panel, /displayStatus\.style\.background/);
  assert.match(panel, /case "stale":[\s\S]*return "Stopped"/);
  assert.match(panel, /latestSlot\?\.status === "running"/);
  assert.match(panel, /The current scheduled Fetch sources run is still in progress/);
  assert.match(panel, /slot\.status === "waiting" \|\| slot\.status === "running"/);
  assert.match(panel, /latestIsStalled/);
  assert.match(panel, /Recent outcomes by scheduled window\./);
  assert.match(panel, /No Local Agent job reported for the latest scheduled window/);
  assert.match(panel, /timeoutSeconds/);
  assert.match(panel, /cleanup failed/);
  assert.doesNotMatch(panel, /Green OK|amber waiting|red issue/);
  assert.match(panel, /label="Missed"/);
  assert.match(panel, /label="Failed"/);
  assert.match(panel, /label="Active"/);
  assert.match(panel, /cronSlotRunNote/);
  assert.match(panel, /jobRunStatusLabel\(slot\.jobRun\)/);
  assert.match(panel, /actionsPlacement = "end"/);
  assert.match(panel, /actionsPlacement === "start"/);
  assert.match(panel, /className="source-fetch-overview"/);
  assert.doesNotMatch(panel, /Use Update sources to copy a Local Agent prompt/);
  assert.doesNotMatch(panel, /Schedule stopped[\s\S]{0,120}Local Agent prompt/);
  assert.match(panel, /Needs Local Agent/);
  assert.match(panel, /taskStatusPill/);
  assert.match(panel, /return \{ label: "summarizing", tone: "warn" \}/);
  assert.match(panel, /return \{ label: "reading", tone: "idle" \}/);
  assert.match(panel, /return \{ label: "syncing", tone: "warn" \}/);
  assert.match(panel, /return \{ label: "discovering", tone: "warn" \}/);
  assert.match(panel, /return \{ label: "failed", tone: "fail" \}/);
  assert.doesNotMatch(panel, /task\.contentStatus === "ready"\) return "ready"/);
  assert.match(panel, /isCandidateDiscoveryTask/);
  assert.doesNotMatch(panel, /return \{ label: "expanded", tone: "ok" \}/);
  assert.match(panel, /Candidates discovered/);
  assert.match(panel, /label: isDiscovery \? "Expand" : "Summarize"/);
  assert.match(panel, /function hasReadSignal/);
  assert.match(panel, /statusBanner\(task, liveTask\)/);
  assert.match(panel, /Waiting for Local Agent/);
  assert.match(panel, /Read has not completed yet, so summary has not started\./);
  assert.match(panel, /Discovery task lifecycle/);
  assert.match(panel, /Expanded into/);
  assert.doesNotMatch(panel, /\{ready \? "ready" : "Local Agent"\}/);
  assert.match(panel, /<FactRow label="Local Agent"/);
  assert.doesNotMatch(panel, /Read by helper|<FactRow label="Helper"|\{ready \? "ready" : "helper"\}/);
  assert.match(panel, /digest-updates-panel/);
  assert.match(panel, /FetchStatusToggle/);
  assert.match(panel, /SourceFetchMetaGrid/);
  assert.match(panel, /SourceFetchMetaItem/);
  assert.match(panel, /aria-label="Fetch sources details"/);
  assert.doesNotMatch(panel, /aria-label="Source update details"/);
  assert.match(panel, /Fetch frequency/);
  assert.doesNotMatch(panel, /Update frequency/);
  assert.match(panel, /Language/);
  assert.match(panel, /Latest fetch/);
  assert.match(panel, /Schedule status/);
  assert.doesNotMatch(panel, /Cron status/);
  assert.match(panel, /formatLanguage\(summaryLanguage \?\? "zh"\)/);
  assert.match(panel, /displayLanguagePreference\(value\)/);
  assert.match(panel, /formatMetaDate\(latestRun\.startedAt, hydrated\)/);
  assert.match(panel, /function formatMetaDate\(iso: string, hydrated: boolean\)/);
  assert.match(panel, /if \(!hydrated\) return formatAbsolute\(iso\)/);
  assert.match(panel, /aria-controls="fetch-sync-details"/);
  assert.match(panel, /className="sync-panel-error"/);
  assert.match(panel, /className="sync-panel-run-card"/);
  assert.match(panel, /className="sync-panel-run-card-head"/);
  assert.match(panel, /className="sync-panel-run-card-summary"/);
  assert.match(panel, /className="mono sync-panel-run-card-meta"/);
  assert.match(panel, /className="sync-panel-run-card-details"/);
  assert.match(panel, /className="sync-panel-run-card-details-summary"/);
  assert.match(panel, /className="sync-panel-run-card-details-body"/);
  assert.match(panel, /className="sync-panel-run-card-details-stack"/);
  assert.match(panel, /className="sync-panel-task-worker-group"/);
  assert.match(panel, /className="mono sync-panel-task-worker-meta"/);
  assert.match(panel, /className="sync-panel-task-source-group"/);
  assert.match(panel, /className="mono sync-panel-task-source-meta"/);
  assert.match(panel, /className="sync-panel-status-note"/);
  assert.match(panel, /className=\{`sync-panel-slot-bar \$\{heightClass\}`\}/);
  assert.match(panel, /className="sync-panel-slot-row"/);
  assert.match(panel, /className="sync-panel-slot-row-main"/);
  assert.match(panel, /className="sync-panel-slot-row-side"/);
  assert.match(panel, /className="sync-panel-slot-row-time"/);
  assert.match(panel, /className="mono sync-panel-slot-row-note"/);
  assert.match(panel, /className="sync-panel-stopped-time"/);
  assert.match(panel, /className="sync-panel-see-more-label"/);
  assert.match(panel, /className="fb-chip sync-panel-live-chip"/);
  assert.match(panel, /className="sync-panel-run-card-live-dot"/);
  assert.doesNotMatch(panel, /className="mt-2 text-\[12\.5px\] leading-relaxed"/);
  assert.doesNotMatch(panel, /className="block min-w-0 flex-1 cursor-pointer rounded-sm border/);
  assert.doesNotMatch(panel, /className="flex flex-wrap items-center justify-between gap-2 rounded-\[7px\] px-1 py-1 text-\[12\.5px\] target:bg-\[var\(--accent-soft\)\]"/);
  assert.doesNotMatch(panel, /className="text-\[12\.5px\] text-\[var\(--muted-strong\)\]"/);
  assert.doesNotMatch(panel, /className="mono truncate text-\[11\.5px\] text-\[var\(--muted-strong\)\]"/);
  assert.doesNotMatch(panel, /className="fb-chip inline-flex items-center gap-1\.5"/);
  assert.match(panel, /className="sync-panel-task-card fb-task"/);
  assert.match(panel, /className="sync-panel-task-summary fb-task-summary"/);
  assert.match(panel, /className="sync-panel-task-chev fb-task-chev"/);
  assert.match(panel, /className="mono sync-panel-task-source-type"/);
  assert.match(panel, /className="sync-panel-task-status-pill"/);
  assert.match(panel, /className="sync-panel-task-title"/);
  assert.match(panel, /className="sync-panel-task-builder"/);
  assert.match(panel, /className="sync-panel-task-body"/);
  assert.match(panel, /className="sync-panel-task-banner"/);
  assert.match(panel, /className="sync-panel-lifecycle"/);
  assert.match(panel, /className=\{`sync-panel-lifecycle-step is-\$\{step\.tone\}`\}/);
  assert.match(panel, /className="sync-panel-task-fact-row"/);
  assert.match(panel, /className="sync-panel-task-technical"/);
  assert.match(panel, /className="mono sync-panel-task-technical-code"/);
  assert.match(panel, /className="sync-panel-detail-note"/);
  assert.match(panel, /className="sync-panel-detail-card-list"/);
  assert.match(panel, /className="sync-panel-detail-card"/);
  assert.match(panel, /className="sync-panel-detail-card-summary"/);
  assert.match(panel, /className="sync-panel-detail-card-body"/);
  assert.match(panel, /className="sync-panel-detail-kicker"/);
  assert.match(panel, /className="sync-panel-detail-kicker-row"/);
  assert.match(panel, /className="sync-panel-detail-default-pill"/);
  assert.match(panel, /className="mono sync-panel-detail-code"/);
  assert.match(panel, /className="sync-panel-detail-action-list"/);
  assert.match(panel, /className="sync-panel-detail-action-row"/);
  assert.match(panel, /className="sync-panel-detail-link"/);
  assert.match(panel, /className="sync-panel-detail-error-list"/);
  assert.match(panel, /className="mono sync-panel-detail-error-row"/);
  assert.match(panel, /className="mono sync-panel-detail-json"/);
  assert.match(panel, /className="sync-panel-detail-empty"/);
  assert.doesNotMatch(panel, /className="rounded-\[10px\] border bg-\[var\(--paper-strong\)\] px-3\.5 py-3"/);
  assert.doesNotMatch(panel, /className="mt-2 rounded-\[8px\] border border-\[var\(--line\)\] bg-\[var\(--paper\)\]"/);
  assert.doesNotMatch(panel, /className="fb-task rounded-\[8px\] border border-\[var\(--line\)\] bg-\[var\(--paper-strong\)\]"/);
  assert.doesNotMatch(panel, /className="fb-task-summary flex items-center gap-1\.5 px-2\.5 py-1\.5 text-\[12\.5px\] leading-snug"/);
  assert.doesNotMatch(panel, /className="flex gap-2 text-\[12px\] leading-relaxed"/);
  assert.doesNotMatch(panel, /className="rounded-\[6px\] px-2\.5 py-1\.5 text-\[12px\] font-bold"/);
  assert.doesNotMatch(panel, /className="mt-2 grid gap-2"/);
  assert.doesNotMatch(panel, /className="rounded-\[8px\] border border-\[var\(--line\)\] bg-\[var\(--paper-strong\)\]"/);
  assert.doesNotMatch(panel, /className="mono mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-\[11\.5px\]"/);
  assert.doesNotMatch(panel, /digest-updates-head[\s\S]{0,360}flex flex-wrap items-center gap-2/);
  assert.doesNotMatch(panel, /error \? \([\s\S]{0,120}mt-3 text-\[12px\] text-\[var\(--danger\)\]/);
  assert.match(panel, /Fetch schedule status graph/);
  assert.match(panel, /buildCronStatus/);
  assert.match(panel, /run\.source === "cron"/);
  assert.match(panel, /slotDomId/);
  assert.match(panel, /runDomId/);
  assert.match(panel, /onOpenRun/);
  assert.match(panel, /setActiveTab\("log"\)/);
  assert.match(panel, /Open log/);
  assert.match(panel, /slots\.slice\(\)\.reverse\(\)\.slice\(0, 6\)/);
  assert.doesNotMatch(panel, /slots\.slice\(-4\)/);
  // Editorial design tokens — panel chrome and chips are reused.
  assert.match(panel, /fb-panel/);
  assert.match(panel, /fb-hub-digest-meta-item/);
  assert.match(panel, /fb-chip/);
  // Relative time updater honors prefers-reduced-motion.
  assert.match(panel, /prefers-reduced-motion/);
  // Absolute timestamp is exposed via title for hover discoverability.
  assert.match(panel, /title=\{formatAbsolute\(run\.startedAt\)\}/);
});

test("DigestLogPanel renders digest status and digest log tabs from cron data", () => {
  const panel = source("src/components/DigestLogPanel.tsx");
  const route = source("src/app/api/digest-runs/route.ts");
  const digestRuns = source("src/lib/digest-runs.ts");
  const digestUpdateStatus = source("src/lib/digest-update-status.ts");

  assert.match(digestUpdateStatus, /@\/lib\/schedule-timing/);
  assert.doesNotMatch(digestUpdateStatus, /function floorToExpectedSchedule/);
  assert.doesNotMatch(digestUpdateStatus, /function addScheduleInterval/);
  assert.match(panel, /AI Digest updates/);
  assert.match(panel, /showHeading = true/);
  assert.match(panel, /actionsPlacement = "end"/);
  assert.match(panel, /actionsPlacement === "start"/);
  assert.match(panel, /showHeading \|\| showStatusToggle/);
  assert.match(panel, /Schedule status/);
  assert.match(panel, /Build log/);
  assert.match(panel, /AI Digest build history/);
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /onKeyDown=\{handleTabKeyDown\}/);
  assert.match(panel, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(panel, /tabIndex=\{activeTab === "status" \? 0 : -1\}/);
  assert.match(panel, /tabIndex=\{activeTab === "log" \? 0 : -1\}/);
  assert.match(panel, /fb-segmented-tabs/);
  assert.match(panel, /id="digest-update-tab-status"/);
  assert.match(panel, /aria-controls="digest-update-panel-status"/);
  assert.match(panel, /aria-labelledby="digest-update-tab-status"/);
  assert.match(panel, /id="digest-update-panel-status"/);
  assert.match(panel, /id="digest-update-tab-log"/);
  assert.match(panel, /aria-controls="digest-update-panel-log"/);
  assert.match(panel, /aria-labelledby="digest-update-tab-log"/);
  assert.match(panel, /id="digest-update-panel-log"/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /AI Digest schedule status graph/);
  assert.doesNotMatch(panel, />Digest updates<|aria-label="Digest schedule status graph"/);
  assert.match(panel, /buildDigestCronStatus/);
  assert.match(panel, /run\.source === "cron"/);
  assert.match(panel, /run\.status === "synced"/);
  assert.match(panel, /className="sync-panel-candidate-link-icon"/);
  assert.doesNotMatch(panel, /h-3\.5 w-3\.5/);
  assert.match(panel, /VISIBLE_RUN_LIMIT = 2/);
  assert.match(panel, /slotDomId/);
  assert.match(panel, /onOpenRun/);
  assert.match(panel, /setActiveTab\("log"\)/);
  assert.match(panel, /document\.getElementById\(runDomId\(runId\)\)/);
  assert.match(panel, /Last \{slots\.length\} scheduled/);
  assert.match(panel, /Green saved · amber waiting · red issue/);
  assert.match(panel, /No run recorded/);
  assert.match(panel, /No AI Digest schedule has reported yet/);
  assert.match(panel, /No AI Digest builds yet/);
  assert.match(panel, /prepares an AI Digest/);
  assert.match(panel, /Runtime job did not create an AI Digest build record/);
  assert.doesNotMatch(panel, /No digest schedule has reported yet|No digest builds yet|prepares a digest|digest build record/);
  assert.match(panel, /Open log/);
  assert.match(panel, /className="sync-panel-title-row"/);
  assert.match(panel, /className="sync-panel-error"/);
  assert.match(panel, /className="sync-panel-run-card"/);
  assert.match(panel, /className="sync-panel-run-card-head"/);
  assert.match(panel, /className="sync-panel-run-card-summary"/);
  assert.match(panel, /className="sync-panel-run-card-title"/);
  assert.match(panel, /className="sync-panel-run-card-funnel"/);
  assert.match(panel, /className="sync-panel-run-card-details"/);
  assert.match(panel, /className="sync-panel-schedule-summary"/);
  assert.match(panel, /className="sync-panel-column"/);
  assert.match(panel, /className="sync-panel-truncate"/);
  assert.match(panel, /className="sync-panel-status-note"/);
  assert.match(panel, /className=\{`sync-panel-slot-bar \$\{heightClass\}`\}/);
  assert.match(panel, /className="sync-panel-slot-row"/);
  assert.match(panel, /className="sync-panel-slot-row-main"/);
  assert.match(panel, /className="sync-panel-slot-row-side"/);
  assert.match(panel, /className="sync-panel-slot-row-time"/);
  assert.match(panel, /className="mono sync-panel-slot-row-note"/);
  assert.match(panel, /className="sync-panel-funnel-arrow"/);
  assert.match(panel, /className="sync-panel-funnel-stat"/);
  assert.match(panel, /className="mono sync-panel-funnel-stat-value"/);
  assert.match(panel, /className="sync-panel-funnel-stat-label"/);
  assert.match(panel, /className="sync-panel-run-card-detail-heading"/);
  assert.match(panel, /className="sync-panel-run-card-source-list"/);
  assert.match(panel, /className="sync-panel-run-card-candidate-list"/);
  assert.match(panel, /className="sync-panel-source-row"/);
  assert.match(panel, /className="sync-panel-candidate-row"/);
  assert.match(panel, /className="mono sync-panel-candidate-outcome"/);
  assert.match(panel, /sync-panel-candidate-title/);
  assert.doesNotMatch(panel, /className="rounded-\[10px\] border bg-\[var\(--paper-strong\)\] px-3\.5 py-3"[\s\S]*Runtime job did not create an AI Digest build record/);
  assert.doesNotMatch(panel, /className="rounded-\[10px\] border bg-\[var\(--paper-strong\)\] px-3\.5 py-3"[\s\S]*Previous AI Digest/);
  assert.doesNotMatch(panel, /className="flex items-baseline justify-between gap-2 text-\[12px\]"/);
  assert.doesNotMatch(panel, /className="flex items-start gap-2 text-\[12\.5px\] leading-snug"/);
  assert.doesNotMatch(panel, /className="mono mt-\[1px\] w-\[2\.6em\] shrink-0 text-\[10px\]/);
  assert.doesNotMatch(panel, /className="mt-1\.5 text-\[13px\] leading-relaxed text-\[var\(--muted-strong\)\]"/);
  assert.doesNotMatch(panel, /className="flex flex-wrap items-center justify-between gap-2 rounded-\[7px\] px-1 py-1 text-\[12\.5px\] target:bg-\[var\(--accent-soft\)\]"/);
  assert.doesNotMatch(panel, /focus-visible:outline-\[var\(--accent\)\]/);
  assert.doesNotMatch(panel, /className="inline-flex items-baseline gap-1"/);
  assert.doesNotMatch(panel, /digest-updates-head[\s\S]{0,360}flex flex-wrap items-center gap-2/);
  assert.doesNotMatch(panel, /error \? \([\s\S]{0,120}mt-3 text-\[12px\] text-\[var\(--danger\)\]/);
  assert.doesNotMatch(panel, /slots\.slice\(-4\)/);
  assert.doesNotMatch(panel, /RefreshCw/);
  assert.doesNotMatch(panel, />Refresh</);
  assert.match(route, /cronRuns/);
  assert.match(route, /digestCronJob\.findUnique/);
  assert.match(route, /serializeDigestCronJob/);
  assert.match(digestRuns, /export type DigestCronJobStatus/);
  assert.match(digestRuns, /source\?: string/);
  assert.match(digestRuns, /serializeDigestCronJob/);
});

test("builders page mounts the fetch log inside the sync header section", () => {
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  assert.match(buildersPage, /FetchLogPanel/);
  // Fetch the user's recent runs server-side, ordered by startedAt desc.
  assert.match(buildersPage, /prisma\.libraryFetchRun\.findMany/);
  assert.match(buildersPage, /prisma\.libraryCronJob\.findUnique/);
  assert.match(buildersPage, /source: "cron"/);
  assert.match(buildersPage, /orderBy: \{ startedAt: "desc" \}/);
  assert.match(buildersPage, /take: 25/);
  // Mounted with the user's own library controls so Fetch setup stays together.
  assert.match(buildersPage, /<Suspense fallback=\{<FetchSourcesFallback \/>/);
  assert.match(buildersPage, /function FetchSourcesFallback/);
  assert.match(buildersPage, /className="your-library-panel fb-panel"/);
  assert.match(buildersPage, /actions=\{/);
  assert.match(buildersPage, /compactOnly/);
  assert.match(buildersPage, /showStop=\{showStopLibraryCron\}/);
  assert.match(buildersPage, /libraryCronJob\?\.status === "active"/);
  assert.match(buildersPage, /initialCronJob=\{data\.libraryCronJob\}/);
  assert.match(buildersPage, /initialCronRuns=\{data\.cronRuns\}/);
  assert.match(buildersPage, /initialRuns=\{data\.fetchRuns\}/);
  assert.match(buildersPage, /summaryLanguage=\{data\.summaryLanguage\}/);
  assert.match(buildersPage, /<OwnDigestPipelineUpdatesCard/);
  assert.match(buildersPage, /context="digest"/);
  assert.match(buildersPage, /showStop=\{showStopDigestCron\}/);
  assert.match(buildersPage, /initialCronJob=\{data\.digestCronJob\}/);
  assert.match(buildersPage, /initialCronRuns=\{data\.digestCronRuns\}/);
  assert.match(buildersPage, /initialRuns=\{data\.digestRuns\}/);
});
