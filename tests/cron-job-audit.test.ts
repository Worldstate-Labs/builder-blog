import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("cron scheduler status changes leave local and server audit events", () => {
  const schema = source("prisma/schema.prisma");
  const cli = source("scripts/builder-digest.mjs");
  const cronJobsRoute = source("src/app/api/skill/cron-jobs/route.ts");
  const cronEventsRoute = source("src/app/api/skill/cron-events/route.ts");

  assert.match(schema, /cronJobStatusEvents\s+CronJobStatusEvent\[\]/);
  assert.match(schema, /model CronJobStatusEvent \{/);
  for (const field of [
    "userId",
    "job",
    "eventType",
    "status",
    "reason",
    "runtime",
    "hostname",
    "platform",
    "localLabel",
    "localPlistExists",
    "launchctlLoaded",
    "details",
  ]) {
    assert.match(schema, new RegExp(`\\n\\s*${field}\\s+`), `CronJobStatusEvent is missing ${field}`);
  }
  assert.match(schema, /@@index\(\[userId, job, createdAt\(sort: Desc\)\]\)/);

  assert.match(cronEventsRoute, /CronJobStatusEventSchema/);
  assert.match(cronEventsRoute, /z\.enum\(\["library-cron", "digest-cron"\]\)/);
  assert.match(cronEventsRoute, /cronJobStatusEvent\.create/);
  assert.match(cronEventsRoute, /MAX_DETAILS_BYTES = 50_000/);

  assert.match(cronJobsRoute, /recordCronJobStatusEvent/);
  assert.match(cronJobsRoute, /eventType: "cron_status_applied"/);

  assert.match(cli, /cron-audit/);
  assert.match(cli, /cronAuditLogPath/);
  assert.match(cli, /cron-events\.jsonl/);
  assert.match(cli, /\/api\/skill\/cron-events/);
  assert.match(cli, /cron_status_sync_start/);
  assert.match(cli, /cron_status_sync_succeeded/);
  assert.match(cli, /cron_status_sync_failed/);
  assert.match(cli, /local_scheduler_missing/);
});

test("cron setup and stop prompts audit scheduler mutations before web status sync", () => {
  const librarySetup = source("skills/builder-blog-digest/jobs/library-cron-setup.md");
  const digestSetup = source("skills/builder-blog-digest/jobs/digest-cron-setup.md");
  const libraryStop = source("skills/builder-blog-digest/jobs/library-cron-stop.md");
  const digestStop = source("skills/builder-blog-digest/jobs/digest-cron-stop.md");

  for (const [job, prompt] of [
    ["library-cron", librarySetup],
    ["digest-cron", digestSetup],
  ] as const) {
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_start`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_finished`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootstrap_succeeded`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event crontab_install_succeeded`));
  }

  for (const [job, prompt] of [
    ["library-cron", libraryStop],
    ["digest-cron", digestStop],
  ] as const) {
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_start`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_finished`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_remove_plist`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event crontab_remove_succeeded`));
    assert.match(prompt, /cron-status[\s\S]*--status stopped/);
  }
});
