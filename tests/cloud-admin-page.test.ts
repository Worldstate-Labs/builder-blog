import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("admin cloud fetch runs route is admin-gated and serializes cloud runs", () => {
  const route = source("src/app/api/admin/cloud-fetch/runs/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /NextResponse\.json\(\{ error: auth\.error \}/);
  assert.match(route, /cloudFetchRun\.findMany/);
  assert.match(route, /serializeCloudFetchRun/);
  assert.match(route, /builder: \{ select: \{ name: true, sourceType: true \} \}/);
});

test("cloud-library management page is admin-gated and mounts both Phase 1 sections", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");

  assert.match(page, /isAdminEmail/);
  assert.match(page, /redirect\(/);
  assert.match(page, /AdminCloudFetchRunActions/);
  assert.match(page, /AdminCloudFetchLog/);
  // The scheduler config form was moved here from the main Settings page.
  assert.match(page, /AdminCloudFetchConfigForm/);
  assert.match(page, /CLOUD_FETCH_CONFIG_ID/);
});

test("settings page links to the cloud library management route for admins", () => {
  const page = source("src/app/(workspace)/settings/page.tsx");

  assert.match(page, /\/settings\/cloud-library/);
});

test("copy-prompt jobs for cloud run-once and recurring setup are whitelisted", () => {
  const jobs = source("src/lib/skill-job-files.ts");

  assert.match(jobs, /"cloud-library-once":/);
  assert.match(jobs, /"cloud-library-cron-setup":/);
});

test("cloud run actions component copies prompts for both cloud jobs via exchange codes", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");

  assert.match(actions, /cloud-library-once/);
  assert.match(actions, /cloud-library-cron-setup/);
  assert.match(actions, /exchange-code/);
  assert.match(actions, /\/api\/skill\/jobs\//);
});

test("cloud run actions fold run-once into the frequency select instead of a second button", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");

  // A "One time" frequency option drives the single copy button to the
  // run-once job; any other cadence installs the recurring schedule.
  assert.match(actions, /label: "One time"/);
  assert.match(actions, /frequency === "once" \? "cloud-library-once" : "cloud-library-cron-setup"/);
});

test("cloud fetch log component reads the admin runs endpoint", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /\/api\/admin\/cloud-fetch\/runs/);
  assert.match(log, /tasksClaimed/);
});

test("cloud runs use a distinct jobType so they never leak into a personal fetch log", () => {
  // Server accepts the cloud jobType.
  const jobRunsRoute = source("src/app/api/skill/job-runs/route.ts");
  assert.match(jobRunsRoute, /jobType: z\.enum\(\["library-fetch", "cloud-library-fetch", "digest-build"\]\)/);

  // The cloud management page reads cloud-library-fetch live progress...
  const cloudRunsRoute = source("src/app/api/admin/cloud-fetch/runs/route.ts");
  assert.match(cloudRunsRoute, /getAgentJobRuns\(auth\.user\.id, "cloud-library-fetch", 5\)/);

  // ...while the personal fetch log stays on library-fetch (excludes cloud rounds).
  const personalFetchRuns = source("src/app/api/skill/fetch-runs/route.ts");
  assert.match(personalFetchRuns, /getAgentJobRuns\(userId, "library-fetch"/);
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  assert.match(buildersPage, /getAgentJobRuns\(user\.id, "library-fetch"/);
});

test("runner and CLI tag cloud rounds with the cloud-library-fetch jobType", () => {
  // Runner: job_type_for_name maps cloud-library-* to the cloud jobType.
  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /cloud-library-\*\) printf '%s\\n' "cloud-library-fetch"/);

  // CLI live-progress emitter derives the jobType from BUILDER_BLOG_RUN_SOURCE=cloud
  // instead of hardcoding "library-fetch".
  const cli = source("scripts/builder-digest.mjs");
  assert.match(cli, /BUILDER_BLOG_RUN_SOURCE\?\.trim\(\) === "cloud"\s*\n?\s*\? "cloud-library-fetch"/);
  assert.match(cli, /jobType: envJobType\(\)/);
});

test("admin cloud source drill-down route is admin-gated and returns submitters", () => {
  const route = source("src/app/api/admin/cloud-fetch/sources/[builderId]/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /cloudSourceSubmission\.findMany/);
  assert.match(route, /serializeCloudSourceSubmitter/);
});

test("cloud library explorer lists libraries and renders recent posts via BuilderFeedItems", () => {
  const explorer = source("src/components/AdminCloudLibraryExplorer.tsx");

  assert.match(explorer, /submitterCount/);
  assert.match(explorer, /postCount/);
  assert.match(explorer, /\/api\/admin\/cloud-fetch\/sources\//);
  // Recent posts reuse the shared per-source post component.
  assert.match(explorer, /BuilderFeedItems/);
});

test("cloud-library page mounts the library explorer with serialized libraries", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");

  assert.match(page, /AdminCloudLibraryExplorer/);
  assert.match(page, /serializeCloudLibrary/);
});
