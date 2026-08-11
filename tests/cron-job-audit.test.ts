import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const markdownShellBlocks = (text: string) =>
  [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);

const forceDeleteCommand = /(?:^|[;&|()\s])rm[ \t]+(?:--force|-[A-Za-z]*f[A-Za-z]*)(?=[ \t]|$)/m;

const regularLocalLaunchdStopBlock = (prompt: string, job: string) => {
  const block = markdownShellBlocks(prompt).find(
    (candidate) => candidate.includes("legacy_account_slug()") && candidate.includes('launchd absent: $LABEL'),
  );
  assert.ok(block, `missing regular local launchd stop block for ${job}`);
  return block;
};

const regularLocalLaunchdSetupBlock = (prompt: string, job: string) => {
  const block = markdownShellBlocks(prompt).find(
    (candidate) =>
      candidate.includes("LAUNCHD_SCHEDULE_XML") && candidate.includes("launchd_bootstrap_succeeded"),
  );
  assert.ok(block, `missing regular local launchd setup block for ${job}`);
  return block;
};

test("cron scheduler status changes leave local and server audit events", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/000090_local_cron_time_zone/migration.sql");
  const cli = source("scripts/builder-digest.mjs");
  const cronJobsRoute = source("src/app/api/skill/cron-jobs/route.ts");
  const cronEventsRoute = source("src/app/api/skill/cron-events/route.ts");
  const digestRuns = source("src/lib/digest-runs.ts");

  assert.match(schema, /cronJobStatusEvents\s+CronJobStatusEvent\[\]/);
  assert.match(schema, /model CronJobStatusEvent \{/);
  assert.match(schema, /model LibraryCronJob \{[\s\S]*\n\s*timeZone\s+String\?/);
  assert.match(schema, /model DigestCronJob \{[\s\S]*\n\s*timeZone\s+String\?/);
  assert.match(migration, /ALTER TABLE "LibraryCronJob" ADD COLUMN "timeZone" TEXT;/);
  assert.match(migration, /ALTER TABLE "DigestCronJob" ADD COLUMN "timeZone" TEXT;/);
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
  assert.match(cronJobsRoute, /timeZone: z\.string\(\)\.max\(120\)\.nullable\(\)\.optional\(\)/);
  assert.match(cronJobsRoute, /function normalizeTimeZone\(value: string \| null \| undefined\)/);
  assert.match(cronJobsRoute, /const headerTimeZone = normalizeTimeZone\(request\.headers\.get\("x-machine-time-zone"\)\)/);
  assert.match(cronJobsRoute, /const bodyTimeZone = normalizeTimeZone\(parsed\.data\.timeZone\)/);
  assert.match(cronJobsRoute, /const validTimeZone = headerTimeZone \?\? bodyTimeZone/);
  assert.match(cronJobsRoute, /Intl\.DateTimeFormat\("en-US", \{ timeZone \}\)/);
  assert.match(cronJobsRoute, /timeZone: validTimeZone \?\? current\.timeZone \?\? null/);
  assert.match(cronJobsRoute, /timeZone: validTimeZone,/);
  assert.match(cronJobsRoute, /eventType: "cron_status_applied"/);
  assert.doesNotMatch(cronJobsRoute, /"1h"|"Hourly"/);
  assert.match(cronJobsRoute, /daily: \{ intervalMinutes: 1_440, label: "Daily" \}/);
  assert.match(cronJobsRoute, /weekly: \{ intervalMinutes: 10_080, label: "Weekly" \}/);
  assert.doesNotMatch(cronJobsRoute, /every day|every week/);
  assert.doesNotMatch(cronJobsRoute, /"30m"|"3h"|"6h"|"12h"/);
  assert.doesNotMatch(cronJobsRoute, /every 30 minutes|every hour|every 3 hours|every 6 hours|every 12 hours/);

  assert.match(cli, /cron-audit/);
  assert.match(cli, /cronAuditLogPath/);
  assert.match(cli, /cron-events\.jsonl/);
  assert.match(cli, /\/api\/skill\/cron-events/);
  assert.match(cli, /cron_status_sync_start/);
  assert.match(cli, /cron_status_sync_succeeded/);
  assert.match(cli, /cron_status_sync_failed/);
  assert.match(cli, /local_scheduler_missing/);
  assert.match(digestRuns, /export type DigestCronJobStatus = \{[\s\S]*timeZone\?: string \| null;/);
  assert.match(digestRuns, /timeZone: cronJob\.timeZone \?\? null,/);
});

test("library setup verifies the current initial run before mutating scheduler state", () => {
  const prompt = source("skills/builder-blog-digest/jobs/library-cron-setup.md");
  const setupBlocks = markdownShellBlocks(prompt);
  const stepSixBlockIndex = setupBlocks.findIndex((candidate) =>
    candidate.includes("verify-library-setup-verdict"),
  );
  assert.ok(stepSixBlockIndex >= 0, "missing step 6 setup block for library-cron");
  const stepSixBlock = setupBlocks[stepSixBlockIndex]!;

  assert.match(prompt, /randomUUID/);
  assert.match(
    prompt,
    /SETUP_VERDICT_FILE="\$SETUP_TMP_DIR\/setup-verdict-\$EXPECTED_INSTANCE_ID\.json"/,
  );
  assert.match(
    prompt,
    /if \[ -e "\$SETUP_VERDICT_FILE" \] \|\| \[ -L "\$SETUP_VERDICT_FILE" \]; then[\s\S]*Refusing to reuse an existing setup verdict file:[\s\S]*exit 1[\s\S]*fi/,
  );
  assert.match(prompt, /BUILDER_BLOG_SETUP_INITIAL=1/);
  assert.match(prompt, /BUILDER_BLOG_JOB_RUN_ID="\$EXPECTED_INSTANCE_ID"/);
  assert.match(prompt, /BUILDER_BLOG_SETUP_VERDICT_FILE="\$SETUP_VERDICT_FILE"/);
  assert.match(
    prompt,
    /if BUILDER_BLOG_JOB_TMP_DIR="\$SETUP_TMP_DIR"[\s\S]*then\n  RUNNER_EXIT_CODE=0\nelse\n  RUNNER_EXIT_CODE="\$\?"\nfi/,
  );
  assert.match(
    stepSixBlock,
    /verify-library-setup-verdict[\s\S]*--file "\$SETUP_VERDICT_FILE"[\s\S]*--instance-id "\$EXPECTED_INSTANCE_ID"[\s\S]*--runner-exit-code "\$RUNNER_EXIT_CODE"/,
  );
  assert.match(stepSixBlock, /node - "\$SETUP_VERDICT_JSON" <<'NODE'/);
  assert.match(stepSixBlock, /FAILED_POST_DETAILS="\$\(/);
  assert.match(stepSixBlock, /Array\.isArray\(verdict\.failures\)/);
  assert.doesNotMatch(stepSixBlock, /verdict\.failedPosts/);
  assert.match(
    stepSixBlock,
    /RESUME_CONTRACT_PATH="\$AGENT_DIR\/tmp\/accounts\/\$ACCOUNT_SLUG\/library-cron-direct\/resume-contract-\$EXPECTED_INSTANCE_ID\.json"/,
  );
  assert.match(
    stepSixBlock,
    /if ! rm -- "\$RESUME_CONTRACT_PATH" 2>\/dev\/null &&[\s\S]*\{ \[ -e "\$RESUME_CONTRACT_PATH" \] \|\| \[ -L "\$RESUME_CONTRACT_PATH" \]; \}; then[\s\S]*echo "Failed to remove file: \$RESUME_CONTRACT_PATH" >&2[\s\S]*exit 1[\s\S]*fi/,
  );
  assert.doesNotMatch(stepSixBlock, forceDeleteCommand);
  assert.match(stepSixBlock, /chmod 600 "\$RESUME_CONTRACT_TMP"/);
  assert.match(stepSixBlock, /mv -f "\$RESUME_CONTRACT_TMP" "\$RESUME_CONTRACT_PATH"/);
  assert.match(stepSixBlock, /BUILDER_BLOG_AGENT_DIR="\$AGENT_DIR" "\$HELPER_PATH" --contract "\$RESUME_CONTRACT_PATH"/);
  assert.match(stepSixBlock, /followbriefScheduleInstall/);
  assert.match(stepSixBlock, /FollowBrief schedule is not confirmed active\./);
  assert.match(stepSixBlock, /printf 'Exact confirmation command: FOLLOWBRIEF_CONFIRM_PARTIAL=1 BUILDER_BLOG_AGENT_DIR="%s" "%s" --contract "%s"\\n'/);
  assert.match(prompt, /If the verified verdict was `"fatal"`[\s\S]*stop/);
  assert.match(prompt, /If the verified verdict was `"needs_confirmation"`[\s\S]*Ask whether to install the scheduled run\s+anyway\./);
  assert.doesNotMatch(
    prompt,
    /node - "\$TMP_DIR\/library-fetch-result\.json" "\$TMP_DIR\/library-agent-sync\.json"/,
  );
  assert.doesNotMatch(prompt, /launchctl bootstrap "gui\/\$\(id -u\)"/);
  assert.doesNotMatch(prompt, /\|\s*crontab -/);
  assert.doesNotMatch(prompt, /cron-status[\s\S]*--job library-cron/);
  assert.doesNotMatch(prompt, /cron-audit[\s\S]*--job library-cron[\s\S]*--event launchd_bootstrap_succeeded/);
  for (const laterBlock of setupBlocks.slice(stepSixBlockIndex + 1)) {
    assert.doesNotMatch(laterBlock, /SETUP_VERDICT_JSON|EXPECTED_INSTANCE_ID|SETUP_TMP_DIR/);
  }

  const verifierIndex = prompt.indexOf("verify-library-setup-verdict");
  const contractPathIndex = stepSixBlock.indexOf("resume-contract-$EXPECTED_INSTANCE_ID.json");
  const helperIndex = stepSixBlock.indexOf('BUILDER_BLOG_AGENT_DIR="$AGENT_DIR" "$HELPER_PATH" --contract "$RESUME_CONTRACT_PATH"');
  const stepSevenIndex = prompt.indexOf("7. Interpret the output from step 6");
  assert.ok(verifierIndex >= 0, "setup verdict verifier must be present");
  assert.ok(contractPathIndex >= 0, "resume contract path must be defined in the step 6 verdict block");
  assert.ok(helperIndex > contractPathIndex, "helper execution must follow contract creation");
  assert.ok(stepSevenIndex > prompt.indexOf("```", verifierIndex), "step 7 must describe the completed step 6 output");
});

test("cron stop prompts audit scheduler mutations before web status sync", () => {
  const librarySetup = source("skills/builder-blog-digest/jobs/library-cron-setup.md");
  const digestSetup = source("skills/builder-blog-digest/jobs/digest-cron-setup.md");
  const libraryStop = source("skills/builder-blog-digest/jobs/library-cron-stop.md");
  const digestStop = source("skills/builder-blog-digest/jobs/digest-cron-stop.md");

  assert.match(librarySetup, /builder-library-cron-install\.sh/);
  assert.doesNotMatch(librarySetup, /cron-audit[\s\S]*--job library-cron[\s\S]*--event launchd_bootout_start/);
  assert.doesNotMatch(librarySetup, /cron-audit[\s\S]*--job library-cron[\s\S]*--event crontab_install_succeeded/);
  assert.doesNotMatch(librarySetup, /cron-status[\s\S]*--job library-cron/);

  for (const [job, prompt] of [["digest-cron", digestSetup]] as const) {
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_start`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_finished`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootstrap_succeeded`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event crontab_install_succeeded`));
  }

  for (const [job, prompt] of [
    ["library-cron", libraryStop],
    ["digest-cron", digestStop],
  ] as const) {
    const block = regularLocalLaunchdStopBlock(prompt, job);
    assert.match(prompt, /Install or refresh the skill/);
    assert.ok(
      prompt.indexOf("Install or refresh the skill") < prompt.indexOf("cron-audit"),
      `${job} stop prompt must refresh the local CLI before using cron-audit`,
    );
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_start`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_finished`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_remove_plist`));
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event crontab_remove_succeeded`));
    assert.match(prompt, /cron-status[\s\S]*--status stopped/);
    assert.match(block, /wait_for_launchd_absent\(\) \{/);
    assert.match(block, /remaining=30/);
    assert.match(block, /while launchctl print "gui\/\$\(id -u\)\/\$label" >/);
    assert.match(block, /BOOTOUT_CODE=0[\s\S]*launchctl bootout "gui\/\$\(id -u\)\/\$LABEL" 2>\/dev\/null \|\| BOOTOUT_CODE="\$\?"/);
    assert.match(block, /if \[ "\$LOADED" = "1" \]; then[\s\S]*wait_for_launchd_absent "\$LABEL"/);
    assert.match(block, /if wait_for_launchd_absent "\$LABEL"; then[\s\S]*LOADED_AFTER=0[\s\S]*else[\s\S]*LOADED_AFTER=1/);
    assert.match(
      block,
      new RegExp(
        `cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_finished[\\s\\S]*--launchctl-loaded "\\$LOADED_AFTER"[\\s\\S]*--reason "exit_\\$BOOTOUT_CODE"`,
      ),
    );
    assert.match(
      block,
      /if \[ "\$LOADED" = "1" \] && \[ "\$LOADED_AFTER" = "1" \]; then[\s\S]*exit 75[\s\S]*if ! rm -- "\$PLIST" 2>\/dev\/null &&[\s\S]*\{ \[ -e "\$PLIST" \] \|\| \[ -L "\$PLIST" \]; \}; then[\s\S]*echo "Failed to remove file: \$PLIST" >&2[\s\S]*exit 1[\s\S]*fi/,
    );
    assert.match(
      block,
      new RegExp(
        `launchd_bootout_finished[\\s\\S]*rm -- "\\$PLIST"[\\s\\S]*cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_remove_plist[\\s\\S]*--launchctl-loaded "\\$LOADED_AFTER"`,
      ),
    );
    assert.doesNotMatch(block, forceDeleteCommand);
  }
});

test("cron stop prompts clean stale local scheduler state before reporting stopped", () => {
  const libraryStop = source("skills/builder-blog-digest/jobs/library-cron-stop.md");
  const digestStop = source("skills/builder-blog-digest/jobs/digest-cron-stop.md");

  for (const [job, prompt] of [
    ["library-cron", libraryStop],
    ["digest-cron", digestStop],
  ] as const) {
    const block = regularLocalLaunchdStopBlock(prompt, job);
    assert.doesNotMatch(
      prompt,
      /account-scoped label is not\s+present in `launchctl list[\s\S]*STOP: report that\s+there is no/,
      `${job} stop prompt must not treat a missing launchctl list row as fully stopped`,
    );
    assert.match(prompt, /Stopped-state contract/);
    assert.match(prompt, /stale LaunchAgent plist/);
    assert.match(prompt, /When `BUILDER_BLOG_ACCOUNT` is set,[\s\S]*continue/);
    assert.match(prompt, /legacy_account_slug/);
    assert.match(prompt, /CURRENT_LABEL=/);
    assert.match(prompt, /LEGACY_LABEL=/);
    assert.match(prompt, /for CANDIDATE_LABEL in "\$CURRENT_LABEL" "\$LEGACY_LABEL"/);
    assert.match(prompt, /LABELS="\$CURRENT_LABEL"/);
    assert.match(prompt, /LABELS="\$LABELS \$LEGACY_LABEL"/);
    assert.match(prompt, /for LABEL in \$LABELS/);
    assert.match(prompt, /loaded service,\s+no target plist\/crontab entry,\s+no current\s+worker file, no pin files/);
    assert.match(block, /launchctl print "gui\/\$\(id -u\)\/\$LABEL"/);
    assert.match(block, /\[ -f "\$PLIST" \]/);
    assert.match(prompt, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_no_schedule_found`));
    assert.match(prompt, /"plist absent: \$PLIST"/);
    assert.match(prompt, new RegExp(`cron-status[\\s\\S]*--job ${job}[\\s\\S]*--status stopped`));
  }
});

test("launchd replacement waits before bootstrap in regular local setup prompts", () => {
  const librarySetup = source("skills/builder-blog-digest/jobs/library-cron-setup.md");
  const digestSetup = source("skills/builder-blog-digest/jobs/digest-cron-setup.md");

  assert.doesNotMatch(librarySetup, /launchctl bootstrap "gui\/\$\(id -u\)"/);

  for (const [job, prompt] of [["digest-cron", digestSetup]] as const) {
    const block = regularLocalLaunchdSetupBlock(prompt, job);

    assert.match(block, /wait_for_launchd_absent\(\) \{/);
    assert.match(block, /remaining=30/);
    assert.match(block, /while \[ "\$remaining" -gt 0 \]/);
    assert.match(block, /sleep 1/);
    assert.match(block, /remaining=\$\(\(remaining - 1\)\)/);
    assert.match(block, /launchctl print "gui\/\$\(id -u\)\/\$label" >/);

    assert.match(
      block,
      /BOOTOUT_CODE=0[\s\S]*launchctl bootout "gui\/\$\(id -u\)\/\$LABEL" 2>\/dev\/null \|\| BOOTOUT_CODE="\$\?"/,
    );
    assert.match(block, new RegExp(`cron-audit[\\s\\S]*--job ${job}[\\s\\S]*--event launchd_bootout_finished[\\s\\S]*--reason "exit_\\$BOOTOUT_CODE"`));

    const bootoutIndex = block.indexOf('launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null');
    const waitIndex = block.indexOf('wait_for_launchd_absent "$LABEL"');
    const enableIndex = block.indexOf('launchctl enable "gui/$(id -u)/$LABEL"');
    const bootstrapIndex = block.indexOf('launchctl bootstrap "gui/$(id -u)" "$PLIST"');
    assert.ok(bootoutIndex >= 0, `${job} setup block must boot out the existing job`);
    assert.ok(waitIndex > bootoutIndex, `${job} setup block must wait for launchd absence after bootout`);
    assert.ok(enableIndex > waitIndex, `${job} setup block must wait before launchctl enable`);
    assert.ok(bootstrapIndex > waitIndex, `${job} setup block must wait before launchctl bootstrap`);

    assert.match(
      block,
      /if ! wait_for_launchd_absent "\$LABEL"; then[\s\S]*timed out waiting for launchd to unload: \$LABEL[\s\S]*exit 75[\s\S]*fi/,
    );
    assert.doesNotMatch(
      block,
      /launchctl bootout "gui\/\$\(id -u\)\/\$LABEL" 2>\/dev\/null\s*\nBOOTOUT_CODE="\$\?"\s*\n(?:.*\n){0,2}launchctl enable "gui\/\$\(id -u\)\/\$LABEL"/,
      `${job} setup block must not regress to immediate bootstrap after bootout`,
    );
  }
});
