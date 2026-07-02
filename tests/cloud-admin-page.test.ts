import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("admin cloud fetch runs route is admin-gated and serializes worker host plus source deliveries", () => {
  const route = source("src/app/api/admin/cloud-fetch/runs/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /NextResponse\.json\(\{ error: auth\.error \}/);
  assert.match(route, /cloudFetchRun\.findMany/);
  assert.match(route, /serializeCloudFetchRun/);
  assert.match(route, /serializeCloudWorkerHost/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /leaseBatches/);
  assert.match(route, /workerHost/);
  assert.match(route, /builder: \{ select: \{ name: true, sourceType: true \} \}/);
});

test("cloud-library management page is admin-gated and mounts the cloud monitor sections", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");

  assert.match(page, /isAdminEmail/);
  assert.match(page, /redirect\(/);
  assert.match(page, /AdminCloudFetchRunActions/);
  assert.match(page, /AdminCloudFetchLog/);
  assert.match(page, /Cloud fetch monitor/);
  assert.match(page, /AdminCloudLibraryMaintenancePanel/);
  // The scheduler config form was moved here from the main Settings page.
  assert.match(page, /AdminCloudFetchConfigForm/);
  assert.match(page, /CLOUD_FETCH_CONFIG_ID/);
});

test("cloud library maintenance reset is admin-gated and scoped to cloud generated state", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  const panel = source("src/components/AdminCloudLibraryMaintenancePanel.tsx");
  const route = source("src/app/api/admin/cloud-fetch/reset/route.ts");
  const helper = source("src/lib/cloud-library-reset.ts");

  assert.match(page, /Cloud library maintenance/);
  assert.match(panel, /Reset Cloud library posts and fetch records/);
  assert.match(panel, /\/api\/admin\/cloud-fetch\/reset/);
  assert.match(panel, /RESET/);
  assert.match(route, /requireCloudFetchAdmin/);
  assert.match(route, /resetCloudLibraryGeneratedState/);
  assert.match(route, /confirmation[\s\S]*RESET/);
  assert.match(helper, /cloudLanguageLibrary\.findMany/);
  assert.match(helper, /feedItem\.deleteMany\(\{[\s\S]*builderId: \{ in: builderIds \}/);
  assert.match(helper, /cloudFetchQueueItem\.deleteMany\(\{[\s\S]*cloudSourceTaskId: \{ in: sourceTaskIds \}/);
  assert.match(helper, /cloudFetchRunTask\.deleteMany\(\{[\s\S]*cloudSourceTaskId: \{ in: sourceTaskIds \}/);
  assert.match(helper, /cloudFetchRun\.deleteMany\(\)/);
  assert.match(helper, /agentJobRun\.deleteMany\(\{[\s\S]*jobType: "cloud-library-fetch"/);
  assert.match(helper, /cloudSourceTask\.updateMany/);
  assert.match(helper, /builder\.updateMany\(\{[\s\S]*ownerUserId: \{ in: ownerIds \}/);
  assert.doesNotMatch(helper, /cloudSourceSubmission\.deleteMany/);
  assert.doesNotMatch(helper, /cloudLanguageLibrary\.deleteMany/);
});

test("settings page links to the cloud library management route for admins", () => {
  const page = source("src/app/(workspace)/settings/page.tsx");

  assert.match(page, /\/settings\/cloud-library/);
});

test("copy-prompt jobs for cloud worker host setup and stop are whitelisted", () => {
  const jobs = source("src/lib/skill-job-files.ts");

  assert.match(jobs, /"cloud-library-cron-setup":/);
  assert.match(jobs, /"cloud-library-cron-stop":/);
  assert.match(jobs, /"cloud-library-host":/);
  assert.doesNotMatch(jobs, /"cloud-library-once":/);
});

test("cloud run actions component copies worker host and stop prompts via exchange codes", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");

  assert.match(actions, /cloud-library-cron-setup/);
  assert.match(actions, /cloud-library-cron-stop/);
  assert.doesNotMatch(actions, /cloud-library-once/);
  assert.match(actions, /exchange-code/);
  assert.match(actions, /\/api\/skill\/jobs\//);
  assert.doesNotMatch(actions, /cloud-run-cloud-limit/);
  assert.match(actions, /cloud-run-post-limit/);
  assert.match(actions, /cloud-run-fetch-days/);
  assert.match(actions, /cloud-run-parallel-workers/);
  assert.doesNotMatch(actions, /params\.set\("cloudLimit"/);
  assert.match(actions, /params\.set\("postLimit"/);
  assert.match(actions, /params\.set\("days"/);
  assert.match(actions, /params\.set\("parallel"/);
  assert.doesNotMatch(actions, /params\.set\("freq"/);
});

test("cloud run actions expose host settings without a cadence selector", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");

  assert.match(actions, /Copy worker host prompt/);
  assert.match(actions, /Copy stop cloud fetch prompt/);
  assert.match(actions, /CLOUD_WORKER_HOST_JOB/);
  assert.match(actions, /CLOUD_WORKER_STOP_JOB/);
  assert.doesNotMatch(actions, /FREQUENCY_OPTIONS/);
  assert.doesNotMatch(actions, /cloud-run-frequency/);
  assert.doesNotMatch(actions, /frequency === "once"/);
});

test("cloud fetch log component reads the admin runs endpoint", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /\/api\/admin\/cloud-fetch\/runs/);
  assert.match(log, /initialWorkerHost/);
  assert.match(log, /initialLeaseBatches/);
  assert.match(log, /workerHost/);
  assert.match(log, /leaseBatches/);
  assert.match(log, /Post task queue/);
  assert.match(log, /Worker lanes/);
  assert.match(log, /formatInlineUsage\(group\.usage\)/);
  assert.match(log, /formatInlineUsage\(usage\)/);
  assert.match(log, /Source deliveries/);
  assert.match(log, /Host id/);
  assert.match(log, /P\(success\)/);
  assert.match(log, /cache: "no-store"/);
  assert.match(log, /buildWorkerShardGroups/);
  assert.match(log, /fallbackMetrics/);
  assert.match(log, /contentSyncStateChanged/);
  assert.match(log, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(log, /This source is still running\. Post task outcomes appear after/);
  assert.match(log, /tasksClaimed/);
  assert.match(log, /pendingPosts/);
  assert.doesNotMatch(log, /claimed\s*\{/);
  assert.doesNotMatch(log, /disabled=\{!hasPosts\}/);
});

test("cloud fetch log reuses the personal fetch log's per-post staged renderer", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  // Genuine reuse: import and render the personal FetchLogPanel's TaskRow so
  // each cloud post shows the same read → summarize → sync lifecycle and
  // per-stage debug, instead of a bespoke per-post row.
  assert.match(log, /import \{ TaskRow[^}]*\} from "@\/components\/FetchLogPanel"/);
  assert.match(log, /<TaskRow/);
  assert.match(log, /postToFetchTaskLog/);

  // FetchLogPanel exports the shared renderer and the types cloud maps into.
  const panel = source("src/components/FetchLogPanel.tsx");
  assert.match(panel, /export function TaskRow/);
  assert.match(panel, /export type FetchTaskLog/);
  assert.match(panel, /export type FetchTaskProgress/);
});

test("cloud worker host uses a distinct jobType so it never leaks into a personal fetch log", () => {
  // Server accepts the cloud jobType.
  const jobRunsRoute = source("src/app/api/skill/job-runs/route.ts");
  assert.match(jobRunsRoute, /jobType: z\.enum\(\["library-fetch", "cloud-library-fetch", "digest-build"\]\)/);

  // The cloud management page and admin log endpoint read cloud-library-fetch
  // worker host progress...
  const cloudPage = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  assert.match(cloudPage, /getAgentJobRuns\(userId, "cloud-library-fetch", 5\)/);
  assert.match(cloudPage, /serializeCloudWorkerHost/);
  assert.match(cloudPage, /initialWorkerHost/);
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
