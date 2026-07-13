import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("Fetch sources dialog defaults to FollowBrief runtime before frequency and keeps agent controls local-only", () => {
  const skillPromptActions = source("src/components/SkillPromptActions.tsx");
  const cronConfigDialog = skillPromptActions.slice(
    skillPromptActions.indexOf("function CronConfigDialog"),
  );

  assert.match(skillPromptActions, /type RuntimeType = "cloud" \| "local"/);
  assert.ok(
    cronConfigDialog.indexOf('htmlFor="cron-runtime-type"') >= 0 &&
      cronConfigDialog.indexOf('htmlFor="cron-runtime-type"') <
        cronConfigDialog.indexOf('htmlFor="cron-freq"'),
    "Runtime type should render before Frequency",
  );
  assert.match(skillPromptActions, /defaultRuntimeTypeForContext\(context\)/);
  assert.match(skillPromptActions, /<option value="cloud">FollowBrief<\/option>/);
  assert.match(skillPromptActions, /<option value="local">Your agent<\/option>/);
  assert.match(skillPromptActions, /CLOUD_FREQUENCY_OPTIONS[\s\S]*Daily[\s\S]*Weekly/);
  assert.match(skillPromptActions, /runtimeType === "cloud"[\s\S]*\/api\/cloud-library\/source-submissions/);
  assert.match(skillPromptActions, /const cloudSubmitLabel =/);
  assert.match(skillPromptActions, /"Asking FollowBrief"/);
  assert.match(skillPromptActions, /runtimeType === "local"[\s\S]*cron-parallel-workers/);
  assert.match(skillPromptActions, /runtimeType === "local"[\s\S]*cron-runtime/);
  assert.match(skillPromptActions, /runtimeType === "local"[\s\S]*cron-fetch-days/);
  assert.match(skillPromptActions, /runtimeType === "local"[\s\S]*override-fetched/);
});

test("opening Fetch sources no longer requires an access key before choosing cloud or local", () => {
  const skillPromptActions = source("src/components/SkillPromptActions.tsx");
  const copyCommand = skillPromptActions.slice(
    skillPromptActions.indexOf("async function copyCommand"),
    skillPromptActions.indexOf("function openStopDialog"),
  );

  assert.match(copyCommand, /if \(target === "cron"\)[\s\S]*setCronConfigOpen\(true\)/);
  assert.ok(
    copyCommand.indexOf('if (target === "cron")') < copyCommand.indexOf("activeTokens.length === 0"),
    "Fetch sources should open the schedule dialog before checking Local Agent access keys",
  );
  assert.match(skillPromptActions, /continueCronCopy[\s\S]*activeTokens\.length === 0/);
});

test("cloud submit reminds the user before overwriting a prior submission and relabels the button", () => {
  const skillPromptActions = source("src/components/SkillPromptActions.tsx");

  // Loads the user's existing cloud submission state for cloud mode.
  assert.match(skillPromptActions, /hasActiveSubmission/);
  assert.match(skillPromptActions, /cloudExisting/);
  // Shows an overwrite reminder and switches the primary button label.
  assert.match(skillPromptActions, /already asked FollowBrief to fetch/i);
  assert.match(skillPromptActions, /Replace FollowBrief request/);
  assert.match(skillPromptActions, /Fetch with FollowBrief/);
  assert.match(skillPromptActions, /Ask FollowBrief to fetch and summarize sources in your library\./);
  assert.match(skillPromptActions, /Could not ask FollowBrief to fetch these sources\./);
  assert.match(skillPromptActions, /FollowBrief will fetch/);
  assert.doesNotMatch(skillPromptActions, /Submit a request for FollowBrief|Could not submit sources to FollowBrief|Submitted \$\{body\?\.sourcesSubmitted|Overwrite & submit/);
});

test("Stop fetching dialog lets users choose local or cloud fetch without stopping the admin worker host", () => {
  const skillPromptActions = source("src/components/SkillPromptActions.tsx");
  const stopDialog = skillPromptActions.slice(
    skillPromptActions.indexOf("function StopScheduleDialog"),
  );

  assert.match(skillPromptActions, /cloudFetchActive/);
  assert.match(skillPromptActions, /localFetchActive/);
  assert.match(skillPromptActions, /type StopFetchTarget = "cloud" \| "local"/);
  assert.match(skillPromptActions, /method: "DELETE"/);
  assert.match(skillPromptActions, /\/api\/cloud-library\/source-submissions/);
  assert.match(skillPromptActions, /\/api\/skill\/cron-jobs/);
  assert.doesNotMatch(skillPromptActions, /cloud-library-cron-stop/);
  assert.match(skillPromptActions, /Any installed Local Agent schedule will remove itself on its next check/);
  assert.match(stopDialog, /name="stop-fetch-target"/);
  assert.match(stopDialog, /Your agent/);
  assert.match(stopDialog, /FollowBrief/);
  assert.match(stopDialog, /Stop FollowBrief fetching for your sources\./);
  assert.match(stopDialog, /No FollowBrief fetching is active\./);
  assert.match(stopDialog, /disabled=\{!canStopLocal \|\| submitting\}/);
  assert.match(stopDialog, /disabled=\{!canStopCloud \|\| submitting\}/);
  assert.doesNotMatch(stopDialog, /Stop cloud fetching|cloud source submissions|queued cloud fetches/);
});
