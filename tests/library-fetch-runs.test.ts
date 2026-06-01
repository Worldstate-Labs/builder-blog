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

test("skill fetch-runs route validates payload size and gates auth on user session", () => {
  const route = source("src/app/api/skill/fetch-runs/route.ts");
  const cronRoute = source("src/app/api/skill/cron-jobs/route.ts");
  // POST is bearer-token (CLI), GET is web session (browser).
  assert.match(route, /getUserFromBearer\(request\)/);
  assert.match(route, /getCurrentSession\(\)/);
  // Schema enforces the documented status / source enums.
  assert.match(route, /z\.enum\(\["ok", "partial", "failed"\]\)/);
  assert.match(route, /z\.enum\(\["manual", "cron"\]\)/);
  // Summary is capped at 280 chars.
  assert.match(route, /MAX_SUMMARY_CHARS = 280/);
  // details payload is rejected over 50 KB with the spec'd message.
  assert.match(route, /MAX_DETAILS_BYTES = 50_000/);
  assert.match(route, /details payload too large; cap at 50 KB/);
  // Server filters the GET by the caller's user id.
  assert.match(route, /where: \{ userId: session\.user\.id \}/);
  assert.match(route, /source: "cron"/);
  assert.match(route, /cronRuns/);
  assert.match(route, /libraryCronJob\.findUnique/);
  assert.match(route, /cronJob: cron/);
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
  // Original error is printed and rethrown so the user still sees it.
  assert.match(cli, /console\.error\(message\);[\s\S]*throw error;/);
  // Fetch-run details carry an audit trail of the queued tasks plus
  // the deduped per-source-type prompts the agent was instructed with.
  assert.match(cli, /summarizeFetchTasksForLog/);
  assert.match(cli, /fetchTasks: slimFetchTasks/);
  assert.match(cli, /prompts: promptsBySourceType/);
});

test("agent runner tags cron-driven CLI runs as source=cron", () => {
  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /BUILDER_BLOG_RUN_SOURCE=cron/);
  assert.match(runner, /export[^\n]*BUILDER_BLOG_RUN_SOURCE/);
  assert.match(runner, /acquire_cron_lock/);
  assert.match(runner, /mkdir "\$LOCK_DIR"/);
  assert.match(runner, /ACCOUNT_SLUG/);
  assert.match(runner, /\$LOCK_ROOT\/\$ACCOUNT_SLUG\/\$JOB_NAME\.lock/);
  assert.match(runner, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(runner, /kill -0 "\$LOCK_PID"/);
  assert.match(runner, /skipping duplicate cron launch/);
  assert.match(runner, /Removing stale FollowBrief \$JOB_NAME lock for \$ACCOUNT_SLUG/);
  assert.match(runner, /\*\-cron\)/);
});

test("FetchLogPanel renders status pills and status/log tabs with semantic CSS variables", () => {
  const panel = source("src/components/FetchLogPanel.tsx");
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
  assert.match(panel, /Fetch status/);
  assert.match(panel, /Fetch log/);
  assert.match(panel, /digest-updates-panel/);
  assert.match(panel, /FetchStatusToggle/);
  assert.match(panel, /FetchScheduleSummary/);
  assert.match(panel, /aria-controls="fetch-sync-details"/);
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
  assert.match(panel, /fb-section-heading/);
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

  assert.match(panel, /Digest updates/);
  assert.match(panel, /Schedule status/);
  assert.match(panel, /Build history/);
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /Digest schedule status graph/);
  assert.match(panel, /buildCronStatus/);
  assert.match(panel, /run\.source === "cron"/);
  assert.match(panel, /run\.status === "synced"/);
  assert.match(panel, /VISIBLE_RUN_LIMIT = 2/);
  assert.match(panel, /slotDomId/);
  assert.match(panel, /onOpenRun/);
  assert.match(panel, /setActiveTab\("log"\)/);
  assert.match(panel, /document\.getElementById\(runDomId\(runId\)\)/);
  assert.match(panel, /Last \{slots\.length\} scheduled/);
  assert.match(panel, /Green saved, amber waiting, red missed or failed/);
  assert.match(panel, /no run recorded for this scheduled time/);
  assert.match(panel, /Open log/);
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
  // Mounted in a Suspense slot with SkillPromptActions embedded into the panel
  // so the fetch sync surface stays together above the source list.
  assert.match(buildersPage, /<Suspense fallback=\{<SyncHeaderFallback \/>/);
  assert.match(buildersPage, /function SyncHeaderFallback/);
  assert.match(buildersPage, /actions=\{/);
  assert.match(buildersPage, /compactOnly/);
  assert.match(buildersPage, /showStop=\{showStopCron\}/);
  assert.match(buildersPage, /libraryCronJob\?\.status === "active"/);
  assert.match(buildersPage, /initialCronJob=\{data\.libraryCronJob\}/);
  assert.match(buildersPage, /initialCronRuns=\{data\.cronRuns\}/);
  assert.match(buildersPage, /initialRuns=\{data\.fetchRuns\}/);
});
