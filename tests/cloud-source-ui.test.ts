import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("Fetch sources dialog exposes cloud runtime before frequency and keeps local controls local-only", () => {
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
  assert.match(skillPromptActions, /Cloud/);
  assert.match(skillPromptActions, /Your Local Agent/);
  assert.match(skillPromptActions, /CLOUD_FREQUENCY_OPTIONS[\s\S]*Every day[\s\S]*Every week/);
  assert.match(skillPromptActions, /runtimeType === "cloud"[\s\S]*\/api\/cloud-library\/source-submissions/);
  assert.match(skillPromptActions, /const cloudSubmitLabel =/);
  assert.match(skillPromptActions, /"Submitting"/);
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
  assert.match(skillPromptActions, /already submitted/i);
  assert.match(skillPromptActions, /Overwrite & submit/);
});
